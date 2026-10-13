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
  return url.replace(/:\/\/([^:@\s]+):([^@\s]+)@/g, "://$1:***@");
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

export class CameraService {
  private readonly repository: CameraRepository;
  private readonly audit?: CameraAuditLogger;

  constructor(repository?: CameraRepository, audit?: CameraAuditLogger) {
    this.repository = repository || cameraRepository;
    this.audit = audit;
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

    return created;
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
    return camera;
  }

  async findAllCameras(query: CameraQueryDto) {
    return this.repository.findAllCameras(query);
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

    return updated;
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
    return this.repository.createCameraStream({
      ...data,
      cameraId,
    });
  }

  async findStreamsByCameraId(cameraId: string) {
    await this.findCameraById(cameraId);
    return this.repository.findStreamsByCameraId(cameraId);
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
    return stream;
  }

  async updateCameraStream(id: string, data: UpdateCameraStreamDto) {
    await this.findCameraStreamById(id);
    return this.repository.updateCameraStream(id, data);
  }

  async deleteCameraStream(id: string) {
    await this.findCameraStreamById(id);
    return this.repository.deleteCameraStream(id);
  }

  // ── Health Probe & Ping Operations ─────────────────────────────────────────
  async pingCamera(id: string): Promise<PingCameraResultDto> {
    const camera = await this.findCameraById(id);

    const checkedAt = new Date();
    // Giữ nguyên trạng thái nếu camera đang trong chế độ bảo trì
    let status: CameraStatus =
      camera.status === CAMERA_STATUS.MAINTENANCE
        ? CAMERA_STATUS.MAINTENANCE
        : CAMERA_STATUS.ONLINE;
    let latencyMs: number | null = Math.floor(Math.random() * 35) + 10; // Giả lập ping phản hồi stream từ 10ms đến 45ms
    let errorMessage: string | null = null;
    let success = true;

    // Kiểm tra định dạng cơ bản của streamUrl
    if (!camera.streamUrl || camera.streamUrl.trim().length === 0) {
      status = CAMERA_STATUS.ERROR;
      latencyMs = null;
      errorMessage = "Stream URL rỗng hoặc không hợp lệ";
      success = false;
    }

    // Cập nhật trạng thái camera và ghi health log
    await Promise.all([
      this.repository.updateCameraStatus(id, status),
      this.repository.createHealthLog({
        cameraId: id,
        status,
        latencyMs,
        errorMessage,
      }),
    ]);

    return {
      cameraId: id,
      status,
      latencyMs,
      success,
      errorMessage,
      checkedAt,
    };
  }

  async findHealthLogs(query: CameraHealthLogQueryDto) {
    if (query.cameraId) {
      await this.findCameraById(query.cameraId);
    }
    return this.repository.findHealthLogs(query);
  }
}

export const cameraService = new CameraService();
