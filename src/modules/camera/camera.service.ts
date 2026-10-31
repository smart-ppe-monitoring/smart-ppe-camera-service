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
import { ROLES } from "../../common/constants/role.constant";
import {
  AUDIT_ACTION,
  AUDIT_TARGET_TYPE,
} from "../../common/constants/audit-log.constant";

export interface UserContext {
  id?: string;
  role?: string;
  siteId?: string;
  siteIds?: string[];
}

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

/**
 * SEC-13: Default Camera Audit Logger thực hiện ghi nhật ký kiểm toán có cấu trúc (JSON Structured Logging)
 * ngăn chặn tình trạng thất thoát audit logs khi camera service vận hành độc lập.
 */
export class DefaultCameraAuditLogger implements CameraAuditLogger {
  async recordLog(data: {
    actorId?: string;
    action: string;
    targetType: string;
    targetId: string;
    details?: any;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<any> {
    const logEntry = {
      timestamp: new Date().toISOString(),
      service: "camera-service",
      actorId: data.actorId || "SYSTEM",
      action: data.action,
      targetType: data.targetType,
      targetId: data.targetId,
      details: data.details || {},
      ipAddress: data.ipAddress || null,
      userAgent: data.userAgent || null,
    };

    console.log(`[AUDIT] ${JSON.stringify(logEntry)}`);
    return logEntry;
  }
}

export const defaultCameraAuditLogger = new DefaultCameraAuditLogger();

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
    this.audit = audit !== undefined ? audit : defaultCameraAuditLogger;
    this.pinger = pinger || probeStreamConnection;
  }

  // ── Site Scoping & Tenant Isolation (SEC-08) ──────────────────────────────
  private getAllowedSiteIds(user?: UserContext): string[] | null {
    if (!user) return null; // Unrestricted if no user context supplied (e.g. internal calls)
    if (user.role === ROLES.ADMIN || user.role === "ADMIN") return null; // Admin unrestricted
    return [
      ...(user.siteId ? [user.siteId] : []),
      ...(Array.isArray(user.siteIds) ? user.siteIds : []),
    ];
  }

  private assertSiteAccess(siteId?: string | null, user?: UserContext) {
    if (!siteId) return;
    const allowed = this.getAllowedSiteIds(user);
    if (allowed === null) return;
    if (allowed.length === 0 || !allowed.includes(siteId)) {
      throw new AppError(
        "Bạn không có quyền truy cập hoặc quản lý camera thuộc công trường này",
        403,
        ERROR_CODE.FORBIDDEN,
      );
    }
  }

  // ── Camera Operations ──────────────────────────────────────────────────────
  async createCamera(
    data: CreateCameraDto,
    actorId?: string,
    userContext?: UserContext,
  ) {
    this.assertSiteAccess(data.siteId, userContext);

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

  async findCameraById(id: string, userContext?: UserContext) {
    const camera = await this.repository.findCameraById(id);
    if (!camera) {
      throw new AppError(
        "Không tìm thấy camera",
        404,
        ERROR_CODE.NOT_FOUND,
      );
    }
    this.assertSiteAccess(camera.siteId, userContext);
    return sanitizeCameraEntity(camera);
  }

  async findAllCameras(query: CameraQueryDto, userContext?: UserContext) {
    const scopedQuery = { ...query };
    const allowedSiteIds = this.getAllowedSiteIds(userContext);

    if (allowedSiteIds !== null) {
      if (scopedQuery.siteId) {
        if (!allowedSiteIds.includes(scopedQuery.siteId)) {
          throw new AppError(
            "Bạn không có quyền truy cập camera thuộc công trường này",
            403,
            ERROR_CODE.FORBIDDEN,
          );
        }
      } else if (allowedSiteIds.length === 1) {
        scopedQuery.siteId = allowedSiteIds[0];
      } else if (allowedSiteIds.length > 1) {
        (scopedQuery as any).siteIds = allowedSiteIds;
      } else {
        throw new AppError(
          "Người dùng chưa được phân công công trường quản lý",
          403,
          ERROR_CODE.FORBIDDEN,
        );
      }
    }

    const result = await this.repository.findAllCameras(scopedQuery);
    return {
      ...result,
      data: result.data.map((c: any) => sanitizeCameraEntity(c)),
    };
  }

  async updateCamera(
    id: string,
    data: UpdateCameraDto,
    actorId?: string,
    userContext?: UserContext,
  ) {
    await this.findCameraById(id, userContext);

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

  async deleteCamera(id: string, actorId?: string, userContext?: UserContext) {
    const camera = await this.findCameraById(id, userContext);
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

  /**
   * SEC-24: Xử lý sự kiện SITE_DELETED từ smart-ppe-site-service qua Kafka / EventBus.
   * Tự động cascade soft-delete toàn bộ camera gắn với công trường này để tránh orphaned records.
   */
  async handleSiteDeleted(
    payload: { siteId: string; reason?: string },
    actorId = "SYSTEM",
  ): Promise<{ affectedCount: number }> {
    if (!payload?.siteId) {
      throw new AppError(
        "siteId is required for handleSiteDeleted",
        400,
        ERROR_CODE.VALIDATION_ERROR,
      );
    }

    const affectedCount = await this.repository.softDeleteCamerasBySiteId(
      payload.siteId,
    );

    await this.audit?.recordLog({
      actorId,
      action: AUDIT_ACTION.DELETE_PPE_CAMERA,
      targetType: AUDIT_TARGET_TYPE.PPE_SITE,
      targetId: payload.siteId,
      details: {
        event: "SITE_DELETED_CASCADE_CLEANUP",
        affectedCamerasCount: affectedCount,
        reason: payload.reason,
      },
    });

    return { affectedCount };
  }

  /**
   * SEC-24: Xử lý sự kiện ZONE_DELETED từ smart-ppe-site-service qua Kafka / EventBus.
   * Gỡ bỏ zoneId (unassign) khỏi toàn bộ camera trong khu vực bị xóa.
   */
  async handleZoneDeleted(
    payload: { zoneId: string },
    actorId = "SYSTEM",
  ): Promise<{ affectedCount: number }> {
    if (!payload?.zoneId) {
      throw new AppError(
        "zoneId is required for handleZoneDeleted",
        400,
        ERROR_CODE.VALIDATION_ERROR,
      );
    }

    const affectedCount = await this.repository.unassignCamerasByZoneId(
      payload.zoneId,
    );

    await this.audit?.recordLog({
      actorId,
      action: AUDIT_ACTION.UPDATE_PPE_CAMERA,
      targetType: AUDIT_TARGET_TYPE.PPE_CAMERA,
      targetId: payload.zoneId,
      details: {
        event: "ZONE_DELETED_UNASSIGN_CAMERAS",
        unassignedCamerasCount: affectedCount,
      },
    });

    return { affectedCount };
  }

  // ── Camera Config Operations ───────────────────────────────────────────────
  async getCameraConfig(cameraId: string, userContext?: UserContext) {
    await this.findCameraById(cameraId, userContext);

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
    actorId?: string,
    userContext?: UserContext,
  ) {
    await this.findCameraById(cameraId, userContext);
    const updated = await this.repository.upsertCameraConfig(cameraId, data);

    // SEC-21: Ghi AuditLog bắt buộc khi thay đổi cấu hình AI an toàn lao động
    await this.audit?.recordLog({
      actorId,
      action: AUDIT_ACTION.UPDATE_PPE_CAMERA_SAFETY_CONFIG,
      targetType: AUDIT_TARGET_TYPE.PPE_CAMERA,
      targetId: cameraId,
      details: data,
    });

    return updated;
  }

  async clearCameraConfig(
    cameraId: string,
    actorId?: string,
    userContext?: UserContext,
  ) {
    await this.findCameraById(cameraId, userContext);
    const updated = await this.repository.upsertCameraConfig(cameraId, {
      enabled: true,
      captureFps: 10,
      resolution: "1920x1080",
      processingEnabled: true,
    });

    await this.audit?.recordLog({
      actorId,
      action: AUDIT_ACTION.DELETE_PPE_CAMERA_SAFETY_CONFIG,
      targetType: AUDIT_TARGET_TYPE.PPE_CAMERA,
      targetId: cameraId,
      details: { resetToDefault: true },
    });

    return updated;
  }

  // ── Camera Stream Operations ───────────────────────────────────────────────
  async createCameraStream(
    cameraId: string,
    data: Omit<CreateCameraStreamDto, "cameraId">,
    actorIdOrContext?: string | UserContext,
    userContext?: UserContext,
  ) {
    let actorId: string | undefined;
    let actualUserContext = userContext;

    if (typeof actorIdOrContext === "object") {
      actualUserContext = actorIdOrContext;
      actorId = actualUserContext?.id;
    } else {
      actorId = actorIdOrContext;
    }

    await this.findCameraById(cameraId, actualUserContext);
    const createdStream = await this.repository.createCameraStream({
      ...data,
      cameraId,
    });

    // SEC-26: Bổ sung audit log bắt buộc khi tạo mới camera stream
    await this.audit?.recordLog({
      actorId,
      action: AUDIT_ACTION.CREATE_PPE_CAMERA_STREAM,
      targetType: AUDIT_TARGET_TYPE.PPE_CAMERA_STREAM,
      targetId: createdStream.id,
      details: {
        cameraId,
        protocol: createdStream.protocol,
        streamUrl: maskStreamCredentials(createdStream.streamUrl),
        resolution: createdStream.resolution,
        fps: createdStream.fps,
      },
    });

    return sanitizeStreamEntity(createdStream);
  }

  async findStreamsByCameraId(cameraId: string, userContext?: UserContext) {
    await this.findCameraById(cameraId, userContext);
    const streams = await this.repository.findStreamsByCameraId(cameraId);
    return streams.map((s: any) => sanitizeStreamEntity(s));
  }

  async findCameraStreamById(id: string, userContext?: UserContext) {
    const stream = await this.repository.findCameraStreamById(id);
    if (!stream) {
      throw new AppError(
        "Không tìm thấy luồng stream của camera",
        404,
        ERROR_CODE.NOT_FOUND,
      );
    }
    // SEC-27: Kiểm tra phân quyền theo siteId bảo vệ BOLA trên endpoint trực tiếp camera-streams
    const siteId = stream.camera?.siteId;
    if (siteId) {
      this.assertSiteAccess(siteId, userContext);
    } else if (stream.cameraId) {
      const camera = await this.repository.findCameraById(stream.cameraId);
      if (camera?.siteId) {
        this.assertSiteAccess(camera.siteId, userContext);
      }
    }
    return sanitizeStreamEntity(stream);
  }

  async updateCameraStream(
    id: string,
    data: UpdateCameraStreamDto,
    actorId?: string,
    userContext?: UserContext,
  ) {
    const existing = await this.findCameraStreamById(id, userContext);
    const updated = await this.repository.updateCameraStream(id, data);

    // SEC-26: Bổ sung audit log bắt buộc khi cập nhật cấu hình stream
    const maskedDetails: Record<string, any> = { ...data };
    if (maskedDetails.streamUrl) {
      maskedDetails.streamUrl = maskStreamCredentials(maskedDetails.streamUrl);
    }

    await this.audit?.recordLog({
      actorId,
      action: AUDIT_ACTION.UPDATE_PPE_CAMERA_STREAM,
      targetType: AUDIT_TARGET_TYPE.PPE_CAMERA_STREAM,
      targetId: id,
      details: {
        cameraId: existing.cameraId || existing.camera?.id,
        ...maskedDetails,
      },
    });

    return sanitizeStreamEntity(updated);
  }

  async deleteCameraStream(
    id: string,
    actorId?: string,
    userContext?: UserContext,
  ) {
    const stream = await this.findCameraStreamById(id, userContext);

    // SEC-22: Không cho phép xóa stream duy nhất của camera, bảo đảm camera luôn có ít nhất 1 stream
    const existingStreams = await this.repository.findStreamsByCameraId(
      stream.cameraId || stream.camera?.id,
    );
    if (!existingStreams || existingStreams.length <= 1) {
      throw new AppError(
        "Không thể xóa luồng stream duy nhất của camera. Camera phải có ít nhất một luồng stream hoạt động.",
        400,
        ERROR_CODE.BAD_REQUEST,
      );
    }

    const deleted = await this.repository.deleteCameraStream(id);

    // SEC-26: Bổ sung audit log bắt buộc khi xóa sub-stream
    await this.audit?.recordLog({
      actorId,
      action: AUDIT_ACTION.DELETE_PPE_CAMERA_STREAM,
      targetType: AUDIT_TARGET_TYPE.PPE_CAMERA_STREAM,
      targetId: id,
      details: {
        cameraId: stream.cameraId || stream.camera?.id,
        protocol: stream.protocol,
        streamUrl: maskStreamCredentials(stream.streamUrl),
      },
    });

    return deleted;
  }

  // ── Health Probe & Ping Operations ─────────────────────────────────────────
  async pingCamera(
    id: string,
    userContext?: UserContext,
  ): Promise<PingCameraResultDto> {
    const camera = await this.findCameraById(id, userContext);
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

  async findHealthLogs(
    query: CameraHealthLogQueryDto,
    userContext?: UserContext,
  ) {
    if (query.cameraId) {
      await this.findCameraById(query.cameraId, userContext);
    }
    return this.repository.findHealthLogs(query);
  }
}

export const cameraService = new CameraService(
  cameraRepository,
  defaultCameraAuditLogger,
);
