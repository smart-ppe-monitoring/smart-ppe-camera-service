import {
  cameraPrisma,
  DEFAULT_CAMERA_TRANSACTION_OPTIONS,
} from "../../database/camera.client";
import {
  calculatePaginationSkip,
  formatPaginationMeta,
} from "../../common/helpers/pagination.helper";
import { generateId } from "../../common/helpers/uuid.helper";
import {
  CreateCameraDto,
  UpdateCameraDto,
  CameraQueryDto,
  CreateCameraStreamDto,
  UpdateCameraStreamDto,
  UpdateCameraConfigDto,
  CreateCameraHealthLogDto,
  CameraHealthLogQueryDto,
  PaginatedResultDto,
} from "./camera.dto";
import {
  CAMERA_STATUS,
  CAMERA_SOURCE_TYPE,
  STREAM_PROTOCOL,
  STREAM_STATUS,
  DEFAULT_CAMERA_CONFIG,
} from "../../common/constants/camera.constant";

export class CameraRepository {
  private readonly db: typeof cameraPrisma;

  constructor(dbClient?: any) {
    this.db = dbClient || cameraPrisma;
  }

  // ── Camera Operations ──────────────────────────────────────────────────────
  async createCamera(data: CreateCameraDto) {
    return (this.db as any).$transaction(
      async (tx: any) => {
        const camera = await tx.camera.create({
          data: {
            id: generateId(),
            siteId: data.siteId,
            zoneId: data.zoneId || null,
            name: data.name,
            code: data.code.toUpperCase(),
            sourceType: data.sourceType || CAMERA_SOURCE_TYPE.RTSP,
            streamUrl: data.streamUrl,
            status: data.status || CAMERA_STATUS.OFFLINE,
            location: data.location || null,
            description: data.description || null,
          },
        });

        // Tự động khởi tạo CameraConfig mặc định
        const config = await tx.cameraConfig.create({
          data: {
            id: generateId(),
            cameraId: camera.id,
            enabled: DEFAULT_CAMERA_CONFIG.enabled,
            captureFps: DEFAULT_CAMERA_CONFIG.captureFps,
            resolution: DEFAULT_CAMERA_CONFIG.resolution,
            processingEnabled: DEFAULT_CAMERA_CONFIG.processingEnabled,
          },
        });

        // Tự động khởi tạo CameraStream mặc định
        const defaultProtocol =
          data.sourceType === CAMERA_SOURCE_TYPE.HLS
            ? STREAM_PROTOCOL.HLS
            : STREAM_PROTOCOL.RTSP;

        const stream = await tx.cameraStream.create({
          data: {
            id: generateId(),
            cameraId: camera.id,
            protocol: defaultProtocol,
            streamUrl: data.streamUrl,
            resolution: DEFAULT_CAMERA_CONFIG.resolution,
            fps: 25,
            status: STREAM_STATUS.ACTIVE,
          },
        });

        return {
          ...camera,
          config,
          streams: [stream],
        };
      },
      DEFAULT_CAMERA_TRANSACTION_OPTIONS,
    );
  }

  async findCameraById(id: string) {
    return (this.db as any).camera.findFirst({
      where: { id, deletedAt: null },
      include: {
        config: true,
        streams: true,
        _count: {
          select: { healthLogs: true },
        },
      },
    });
  }

  async findCameraByCode(code: string) {
    return (this.db as any).camera.findFirst({
      where: { code: code.toUpperCase(), deletedAt: null },
      include: {
        config: true,
        streams: true,
      },
    });
  }

  async findAllCameras(
    query: CameraQueryDto,
  ): Promise<PaginatedResultDto<any>> {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const { skip, take, page: safePage, limit: safeLimit } =
      calculatePaginationSkip(page, limit);

    // SEC-12: Mặc định lọc bỏ các camera đã bị xóa mềm (deletedAt !== null)
    const where: any = {
      deletedAt: null,
    };

    if (query.siteId) {
      where.siteId = query.siteId;
    } else if ((query as any).siteIds && Array.isArray((query as any).siteIds)) {
      where.siteId = { in: (query as any).siteIds };
    }

    if (query.zoneId) {
      where.zoneId = query.zoneId;
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.sourceType) {
      where.sourceType = query.sourceType;
    }

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: "insensitive" } },
        { code: { contains: query.search, mode: "insensitive" } },
        { location: { contains: query.search, mode: "insensitive" } },
      ];
    }

    const orderBy = query.sortBy
      ? { [query.sortBy]: query.sortOrder || "desc" }
      : { createdAt: "desc" };

    const [total, data] = await Promise.all([
      (this.db as any).camera.count({ where }),
      (this.db as any).camera.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          config: true,
          streams: true,
        },
      }),
    ]);

    return {
      data,
      meta: formatPaginationMeta(safePage, safeLimit, total),
    };
  }

  async updateCamera(id: string, data: UpdateCameraDto) {
    const updateData: any = { ...data };
    if (data.code) {
      updateData.code = data.code.toUpperCase();
    }

    const hasNewStreamUrl = Boolean(
      data.streamUrl && !data.streamUrl.includes(":***@"),
    );

    // SEC-04: If streamUrl contains masked credentials (:***@), do not overwrite real password in DB
    if (data.streamUrl && data.streamUrl.includes(":***@")) {
      delete updateData.streamUrl;
    }

    // SEC-15: Bọc toàn bộ thao tác cập nhật camera và đồng bộ luồng stream vào $transaction để đảm bảo tính nguyên tử (atomic)
    const runInTransaction =
      typeof (this.db as any).$transaction === "function"
        ? (fn: any) =>
            (this.db as any).$transaction(
              fn,
              DEFAULT_CAMERA_TRANSACTION_OPTIONS,
            )
        : async (fn: any) => fn(this.db);

    return runInTransaction(async (tx: any) => {
      if (hasNewStreamUrl) {
        const firstStream = await tx.cameraStream.findFirst({
          where: { cameraId: id },
          orderBy: { createdAt: "asc" },
        });
        if (firstStream) {
          await tx.cameraStream.update({
            where: { id: firstStream.id },
            data: { streamUrl: data.streamUrl },
          });
        }
      }

      return tx.camera.update({
        where: { id },
        data: updateData,
        include: {
          config: true,
          streams: true,
        },
      });
    });
  }

  async updateCameraStatus(id: string, status: string) {
    return (this.db as any).camera.update({
      where: { id },
      data: { status },
      include: {
        config: true,
      },
    });
  }

  async deleteCamera(id: string) {
    // SEC-12: Chuyển sang soft delete, lưu giữ deletedAt và chuyển status sang OFFLINE
    // để bảo toàn toàn bộ camera_streams, camera_configs và camera_health_logs cho lưu vết pháp lý và audit
    return (this.db as any).camera.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        status: CAMERA_STATUS.OFFLINE,
      },
    });
  }

  /**
   * SEC-24: Soft delete toàn bộ camera thuộc siteId khi site bị xóa trong smart-ppe-site-service.
   * Cập nhật deletedAt và status = OFFLINE để bảo toàn tính toàn vẹn dữ liệu và tránh orphaned cameras.
   */
  async softDeleteCamerasBySiteId(siteId: string): Promise<number> {
    const result = await (this.db as any).camera.updateMany({
      where: {
        siteId,
        deletedAt: null,
      },
      data: {
        deletedAt: new Date(),
        status: CAMERA_STATUS.OFFLINE,
      },
    });
    return result?.count ?? 0;
  }

  /**
   * SEC-24: Gỡ bỏ liên kết zoneId (unassign) khỏi toàn bộ camera thuộc zoneId khi zone bị xóa.
   */
  async unassignCamerasByZoneId(zoneId: string): Promise<number> {
    const result = await (this.db as any).camera.updateMany({
      where: {
        zoneId,
        deletedAt: null,
      },
      data: {
        zoneId: null,
      },
    });
    return result?.count ?? 0;
  }

  // ── Camera Config Operations ───────────────────────────────────────────────
  async findCameraConfig(cameraId: string) {
    return (this.db as any).cameraConfig.findUnique({
      where: { cameraId },
    });
  }

  async upsertCameraConfig(
    cameraId: string,
    data: UpdateCameraConfigDto,
  ) {
    return (this.db as any).cameraConfig.upsert({
      where: { cameraId },
      create: {
        id: generateId(),
        cameraId,
        enabled:
          data.enabled !== undefined
            ? data.enabled
            : DEFAULT_CAMERA_CONFIG.enabled,
        captureFps: data.captureFps || DEFAULT_CAMERA_CONFIG.captureFps,
        resolution: data.resolution || DEFAULT_CAMERA_CONFIG.resolution,
        processingEnabled:
          data.processingEnabled !== undefined
            ? data.processingEnabled
            : DEFAULT_CAMERA_CONFIG.processingEnabled,
      },
      update: data,
    });
  }

  // ── Camera Stream Operations ───────────────────────────────────────────────
  async createCameraStream(data: CreateCameraStreamDto) {
    return (this.db as any).cameraStream.create({
      data: {
        id: generateId(),
        cameraId: data.cameraId,
        protocol: data.protocol || STREAM_PROTOCOL.RTSP,
        streamUrl: data.streamUrl,
        resolution: data.resolution || DEFAULT_CAMERA_CONFIG.resolution,
        fps: data.fps || 25,
        status: data.status || STREAM_STATUS.ACTIVE,
      },
    });
  }

  async findCameraStreamById(id: string) {
    return (this.db as any).cameraStream.findUnique({
      where: { id },
      include: {
        camera: {
          select: { id: true, name: true, code: true, siteId: true },
        },
      },
    });
  }

  async findStreamsByCameraId(cameraId: string) {
    return (this.db as any).cameraStream.findMany({
      where: { cameraId },
      orderBy: { createdAt: "asc" },
    });
  }

  async updateCameraStream(id: string, data: UpdateCameraStreamDto) {
    const updateData: any = { ...data };
    // SEC-17: If streamUrl contains masked credentials (:***@), do not overwrite real password in DB
    if (typeof updateData.streamUrl === "string" && updateData.streamUrl.includes(":***@")) {
      delete updateData.streamUrl;
    }
    return (this.db as any).cameraStream.update({
      where: { id },
      data: updateData,
    });
  }

  async deleteCameraStream(id: string) {
    return (this.db as any).cameraStream.delete({
      where: { id },
    });
  }

  // ── Camera Health Log Operations ───────────────────────────────────────────
  async recordPingResult(
    id: string,
    status: any,
    log: CreateCameraHealthLogDto,
    retentionDays = 30,
  ) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    return (this.db as any).$transaction(
      [
        (this.db as any).camera.update({
          where: { id },
          data: { status },
        }),
        (this.db as any).cameraHealthLog.create({
          data: {
            id: generateId(),
            cameraId: log.cameraId,
            status: log.status,
            latencyMs: log.latencyMs ?? null,
            errorMessage: log.errorMessage ?? null,
          },
        }),
        // SEC-07: Auto-purge logs older than retentionDays (30 days) for this camera
        (this.db as any).cameraHealthLog.deleteMany({
          where: {
            cameraId: log.cameraId,
            checkedAt: { lt: cutoffDate },
          },
        }),
      ],
      DEFAULT_CAMERA_TRANSACTION_OPTIONS,
    );
  }

  /**
   * SEC-07: Dọn dẹp các bản ghi nhật ký camera cũ hơn retentionDays (mặc định 30 ngày)
   */
  async purgeExpiredHealthLogs(retentionDays = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    const result = await (this.db as any).cameraHealthLog.deleteMany({
      where: {
        checkedAt: { lt: cutoffDate },
      },
    });
    return result.count ?? 0;
  }

  async createHealthLog(data: CreateCameraHealthLogDto) {
    return (this.db as any).cameraHealthLog.create({
      data: {
        id: generateId(),
        cameraId: data.cameraId,
        status: data.status,
        latencyMs: data.latencyMs ?? null,
        errorMessage: data.errorMessage ?? null,
      },
    });
  }

  async findHealthLogs(
    query: CameraHealthLogQueryDto,
  ): Promise<PaginatedResultDto<any>> {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const { skip, take, page: safePage, limit: safeLimit } =
      calculatePaginationSkip(page, limit);

    const where: any = {};
    if (query.cameraId) {
      where.cameraId = query.cameraId;
    }
    if (query.status) {
      where.status = query.status;
    }

    const [total, data] = await Promise.all([
      (this.db as any).cameraHealthLog.count({ where }),
      (this.db as any).cameraHealthLog.findMany({
        where,
        skip,
        take,
        orderBy: { checkedAt: query.sortOrder || "desc" },
      }),
    ]);

    return {
      data,
      meta: formatPaginationMeta(safePage, safeLimit, total),
    };
  }

  async checkDatabaseHealth(): Promise<boolean> {
    try {
      await (this.db as any).$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}

export const cameraRepository = new CameraRepository();
