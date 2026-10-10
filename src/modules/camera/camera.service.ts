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

/**
 * Che giấu thông tin mật khẩu nhúng trong RTSP/HTTP stream URL (vd: rtsp://user:pass@host -> rtsp://user:***@host)
 */
export function maskStreamCredentials(url: string | null | undefined): string {
  if (!url) return "";
  return url.replace(/:\/\/([^:@\s]+):([^@\s]+)@/g, "://$1:***@");
}

export class CameraService {
  private readonly repository: CameraRepository;

  constructor(repository?: CameraRepository) {
    this.repository = repository || cameraRepository;
  }

  // ── Camera Operations ──────────────────────────────────────────────────────
  async createCamera(data: CreateCameraDto) {
    const existing = await this.repository.findCameraByCode(data.code);
    if (existing) {
      throw new AppError(
        `Camera với mã '${data.code.toUpperCase()}' đã tồn tại trong hệ thống`,
        409,
        ERROR_CODE.DUPLICATE_ENTRY,
      );
    }

    return this.repository.createCamera(data);
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

  async updateCamera(id: string, data: UpdateCameraDto) {
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

    return this.repository.updateCamera(id, data);
  }

  async deleteCamera(id: string) {
    await this.findCameraById(id);
    return this.repository.deleteCamera(id);
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
