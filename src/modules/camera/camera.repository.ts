import {
  cameraPrisma,
  DEFAULT_CAMERA_TRANSACTION_OPTIONS,
} from "../../database/camera.client";
import {
  calculatePaginationSkip,
  formatPaginationMeta,
} from "../../common/helpers/pagination.helper";
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
    return (this.db as any).camera.findUnique({
      where: { id },
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
    return (this.db as any).camera.findUnique({
      where: { code: code.toUpperCase() },
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
    const skip = calculatePaginationSkip(page, limit);

    const where: any = {};

    if (query.siteId) {
      where.siteId = query.siteId;
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
        take: limit,
        orderBy,
        include: {
          config: true,
          streams: true,
          _count: {
            select: { healthLogs: true },
          },
        },
      }),
    ]);

    return {
      data,
      meta: formatPaginationMeta(page, limit, total),
    };
  }

  async updateCamera(id: string, data: UpdateCameraDto) {
    const updateData: any = { ...data };
    if (data.code) {
      updateData.code = data.code.toUpperCase();
    }

    if (data.streamUrl) {
      const firstStream = await (this.db as any).cameraStream.findFirst({
        where: { cameraId: id },
        orderBy: { createdAt: "asc" },
      });
      if (firstStream) {
        await (this.db as any).cameraStream.update({
          where: { id: firstStream.id },
          data: { streamUrl: data.streamUrl },
        });
      }
    }

    return (this.db as any).camera.update({
      where: { id },
      data: updateData,
      include: {
        config: true,
        streams: true,
      },
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
    return (this.db as any).camera.delete({
      where: { id },
    });
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
    return (this.db as any).cameraStream.update({
      where: { id },
      data,
    });
  }

  async deleteCameraStream(id: string) {
    return (this.db as any).cameraStream.delete({
      where: { id },
    });
  }

  // ── Camera Health Log Operations ───────────────────────────────────────────
  async createHealthLog(data: CreateCameraHealthLogDto) {
    return (this.db as any).cameraHealthLog.create({
      data: {
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
    const skip = calculatePaginationSkip(page, limit);

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
        take: limit,
        orderBy: { checkedAt: query.sortOrder || "desc" },
      }),
    ]);

    return {
      data,
      meta: formatPaginationMeta(page, limit, total),
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
