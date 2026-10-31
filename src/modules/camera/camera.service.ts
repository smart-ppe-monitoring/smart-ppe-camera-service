import * as net from "net";
import { CameraRepository, cameraRepository } from "./camera.repository";
import { AppError } from "../../common/errors/app-error";
import { ERROR_CODE } from "../../common/errors/error-code";
import {
  CreateCameraDto,
  UpdateCameraDto,
  CameraQueryDto,
  CreateCameraStreamDto,
  UpdateCameraStreamDto,
  UpdateCameraConfigDto,
  CameraHealthLogQueryDto,
  PingCameraResultDto,
} from "./camera.dto";
import {
  CAMERA_STATUS,
  CameraStatus,
  DEFAULT_CAMERA_CONFIG,
} from "../../common/constants/camera.constant";
import {
  AUDIT_ACTION,
  AUDIT_TARGET_TYPE,
} from "../../common/constants/audit-log.constant";

/**
 * Che giấu thông tin mật khẩu nhúng trong RTSP/HTTP stream URL (vd: rtsp://user:pass@host -> rtsp://user:***@host)
 */
export function maskStreamCredentials(url: string | null | undefined): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = "***";
      return parsed.toString();
    }
  } catch {}
  return url.replace(/:\/\/([^:\s\/]+):(.*)@([^:\/\s]+)/g, "://$1:***@$3");
}

function sanitizeCameraEntity<T extends { streamUrl?: string | null; streams?: Array<{ streamUrl?: string | null }> }>(camera: T): T {
  if (!camera) return camera;
  return {
    ...camera,
    streamUrl: maskStreamCredentials(camera.streamUrl),
    streams: camera.streams?.map((s) => ({
      ...s,
      streamUrl: maskStreamCredentials(s.streamUrl),
    })),
  };
}

function sanitizeStreamEntity<T extends { streamUrl?: string | null }>(stream: T): T {
  if (!stream) return stream;
  return {
    ...stream,
    streamUrl: maskStreamCredentials(stream.streamUrl),
  };
}

export interface CameraAuditLogger {
  recordLog(data: {
    actorId?: string;
    action: string;
    targetType: string;
    targetId: string;
    details?: any;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<any>;
}

export interface StreamPingResult {
  reachable: boolean;
  latencyMs: number | null;
  errorMessage?: string | null;
}

export type StreamPinger = (
  streamUrl: string,
  timeoutMs?: number,
) => Promise<StreamPingResult>;

/**
 * SEC-25: Kiểm tra kết nối TCP socket thực tế tới camera stream endpoint (host:port)
 * thay vì sinh số ngẫu nhiên giả mạo trạng thái ONLINE.
 */
export async function probeStreamConnection(
  streamUrl: string,
  timeoutMs = 2000,
): Promise<StreamPingResult> {
  const startTime = Date.now();
  try {
    const parsed = new URL(streamUrl);
    const host = parsed.hostname;
    let port = parsed.port ? parseInt(parsed.port, 10) : undefined;
    if (!port || Number.isNaN(port)) {
      if (parsed.protocol === "http:" || parsed.protocol === "ws:") {
        port = 80;
      } else if (parsed.protocol === "https:" || parsed.protocol === "wss:") {
        port = 443;
      } else {
        port = 554;
      }
    }

    return await new Promise<StreamPingResult>((resolve) => {
      const socket = new net.Socket();
      let settled = false;

      const finish = (result: StreamPingResult) => {
        if (!settled) {
          settled = true;
          socket.removeAllListeners();
          socket.destroy();
          resolve(result);
        }
      };

      socket.setTimeout(timeoutMs);

      socket.once("connect", () => {
        const latencyMs = Math.max(1, Date.now() - startTime);
        finish({ reachable: true, latencyMs, errorMessage: null });
      });

      socket.once("timeout", () => {
        finish({
          reachable: false,
          latencyMs: null,
          errorMessage: `Kết nối tới camera stream quá thời gian chờ (${timeoutMs}ms)`,
        });
      });

      socket.once("error", (err) => {
        finish({
          reachable: false,
          latencyMs: null,
          errorMessage: `Không thể kết nối tới stream camera: ${err.message}`,
        });
      });

      socket.connect(port, host);
    });
  } catch (err: any) {
    return {
      reachable: false,
      latencyMs: null,
      errorMessage: `Lỗi phân tích URL stream: ${err.message || String(err)}`,
    };
  }
}

export class CameraService {
  private readonly repository: CameraRepository;
  private readonly audit?: CameraAuditLogger;
  private readonly pinger: StreamPinger;

  constructor(
    repository?: CameraRepository,
    audit?: CameraAuditLogger,
    pinger?: StreamPinger,
  ) {
    this.repository = repository || cameraRepository;
    this.audit = audit;
    this.pinger = pinger || probeStreamConnection;
  }

  // ── Camera Operations ──────────────────────────────────────────────────────
  async createCamera(data: CreateCameraDto, actorId?: string) {
    const existing = await this.repository.findCameraByCode(data.code);
    if (existing) {
      throw new AppError(
        `Camera với mã '${data.code.toUpperCase()}' đã tồn tại trong hệ thống`,
        409,
        ERROR_CODE.DUPLICATE_ENTRY,
      );
    }

    const created = await this.repository.createCamera(data);

    // Ghi AuditLog đăng ký camera
    await this.audit?.recordLog({
      actorId,
      action: AUDIT_ACTION.REGISTER_PPE_CAMERA,
      targetType: AUDIT_TARGET_TYPE.PPE_CAMERA,
      targetId: created.id,
      details: {
        code: created.code,
        name: created.name,
        siteId: created.siteId,
      },
    });

    return sanitizeCameraEntity(created);
  }

  async findCameraById(id: string) {
    const camera = await this.repository.findCameraById(id);
    if (!camera) {
      throw new AppError(
        "Không tìm thấy camera",
        404,
        ERROR_CODE.NOT_FOUND,
      );
    }
    return sanitizeCameraEntity(camera);
  }

  async findAllCameras(query: CameraQueryDto) {
    const result = await this.repository.findAllCameras(query);
    return {
      ...result,
      data: result.data.map((c: any) => sanitizeCameraEntity(c)),
    };
  }

  async updateCamera(id: string, data: UpdateCameraDto, actorId?: string) {
    await this.findCameraById(id);

    if (data.code) {
      const existing = await this.repository.findCameraByCode(data.code);
      if (existing && existing.id !== id) {
        throw new AppError(
          `Camera với mã '${data.code.toUpperCase()}' đã tồn tại trong hệ thống`,
          409,
          ERROR_CODE.DUPLICATE_ENTRY,
        );
      }
    }

    const updated = await this.repository.updateCamera(id, data);

    // Ghi AuditLog cập nhật camera (che giấu mật khẩu stream URL nếu có)
    const sanitizedDetails = { ...data } as Record<string, unknown>;
    if (typeof sanitizedDetails.streamUrl === "string") {
      sanitizedDetails.streamUrl = maskStreamCredentials(sanitizedDetails.streamUrl);
    }

    await this.audit?.recordLog({
      actorId,
      action: AUDIT_ACTION.UPDATE_PPE_CAMERA,
      targetType: AUDIT_TARGET_TYPE.PPE_CAMERA,
      targetId: id,
      details: sanitizedDetails,
    });

    return sanitizeCameraEntity(updated);
  }

  async deleteCamera(id: string, actorId?: string) {
    const camera = await this.findCameraById(id);
    const deleted = await this.repository.deleteCamera(id);

    // Ghi AuditLog xóa camera
    await this.audit?.recordLog({
      actorId,
      action: AUDIT_ACTION.DELETE_PPE_CAMERA,
      targetType: AUDIT_TARGET_TYPE.PPE_CAMERA,
      targetId: id,
      details: {
        code: camera.code,
        name: camera.name,
      },
    });

    return deleted;
  }

  // ── Camera Config Operations ───────────────────────────────────────────────
  async getCameraConfig(cameraId: string) {
    await this.findCameraById(cameraId);

    const config = await this.repository.findCameraConfig(cameraId);
    if (!config) {
      return this.repository.upsertCameraConfig(cameraId, {
        enabled: DEFAULT_CAMERA_CONFIG.enabled,
        captureFps: DEFAULT_CAMERA_CONFIG.captureFps,
        resolution: DEFAULT_CAMERA_CONFIG.resolution,
        processingEnabled: DEFAULT_CAMERA_CONFIG.processingEnabled,
      });
    }

    return config;
  }

  async updateCameraConfig(
    cameraId: string,
    data: UpdateCameraConfigDto,
  ) {
    await this.findCameraById(cameraId);
    return this.repository.upsertCameraConfig(cameraId, data);
  }

  async clearCameraConfig(cameraId: string) {
    await this.findCameraById(cameraId);
    return this.repository.upsertCameraConfig(cameraId, {
      enabled: true,
      captureFps: 10,
      resolution: "1920x1080",
      processingEnabled: true,
    });
  }

  // ── Camera Stream Operations ───────────────────────────────────────────────
  async createCameraStream(
    cameraId: string,
    data: Omit<CreateCameraStreamDto, "cameraId">,
  ) {
    await this.findCameraById(cameraId);
    const createdStream = await this.repository.createCameraStream({
      ...data,
      cameraId,
    });
    return sanitizeStreamEntity(createdStream);
  }

  async findStreamsByCameraId(cameraId: string) {
    await this.findCameraById(cameraId);
    const streams = await this.repository.findStreamsByCameraId(cameraId);
    return streams.map((s: any) => sanitizeStreamEntity(s));
  }

  async findCameraStreamById(id: string) {
    const stream = await this.repository.findCameraStreamById(id);
    if (!stream) {
      throw new AppError(
        "Không tìm thấy luồng stream của camera",
        404,
        ERROR_CODE.NOT_FOUND,
      );
    }
    return sanitizeStreamEntity(stream);
  }

  async updateCameraStream(id: string, data: UpdateCameraStreamDto) {
    await this.findCameraStreamById(id);
    const updated = await this.repository.updateCameraStream(id, data);
    return sanitizeStreamEntity(updated);
  }

  async deleteCameraStream(id: string) {
    await this.findCameraStreamById(id);
    return this.repository.deleteCameraStream(id);
  }

  // ── Health Probe & Ping Operations ─────────────────────────────────────────
  async pingCamera(id: string): Promise<PingCameraResultDto> {
    const camera = await this.findCameraById(id);
    const checkedAt = new Date();

    // Kiểm tra định dạng cơ bản của streamUrl
    if (!camera.streamUrl || camera.streamUrl.trim().length === 0) {
      const status: CameraStatus =
        camera.status === CAMERA_STATUS.MAINTENANCE
          ? CAMERA_STATUS.MAINTENANCE
          : CAMERA_STATUS.ERROR;
      const latencyMs = null;
      const errorMessage = "Stream URL rỗng hoặc không hợp lệ";
      const success = false;

      await this.persistPingResult(id, status, latencyMs, errorMessage);

      return {
        cameraId: id,
        status,
        latencyMs,
        success,
        errorMessage,
        checkedAt,
      };
    }

    // SEC-25: Kiểm tra kết nối TCP socket thực tế tới camera stream thay vì mock ngẫu nhiên
    const probe = await this.pinger(camera.streamUrl, 2000);

    let status: CameraStatus;
    if (camera.status === CAMERA_STATUS.MAINTENANCE) {
      status = CAMERA_STATUS.MAINTENANCE;
    } else if (probe.reachable) {
      status = CAMERA_STATUS.ONLINE;
    } else {
      status = CAMERA_STATUS.OFFLINE;
    }

    const latencyMs = probe.reachable ? probe.latencyMs : null;
    const errorMessage = probe.reachable
      ? null
      : probe.errorMessage || "Không thể kết nối tới stream camera";
    const success = probe.reachable;

    await this.persistPingResult(id, status, latencyMs, errorMessage);

    return {
      cameraId: id,
      status,
      latencyMs,
      success,
      errorMessage,
      checkedAt,
    };
  }

  private async persistPingResult(
    id: string,
    status: CameraStatus,
    latencyMs: number | null,
    errorMessage?: string | null,
  ) {
    if (typeof (this.repository as any).recordPingResult === "function") {
      await (this.repository as any).recordPingResult(id, status, {
        cameraId: id,
        status,
        latencyMs,
        errorMessage,
      });
    } else {
      await Promise.all([
        this.repository.updateCameraStatus(id, status),
        this.repository.createHealthLog({
          cameraId: id,
          status,
          latencyMs,
          errorMessage,
        }),
      ]);
    }
  }

  async findHealthLogs(query: CameraHealthLogQueryDto) {
    if (query.cameraId) {
      await this.findCameraById(query.cameraId);
    }
    return this.repository.findHealthLogs(query);
  }
}

export const cameraService = new CameraService();
