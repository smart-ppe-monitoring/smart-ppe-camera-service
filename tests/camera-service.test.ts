import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CAMERA_STATUS,
  CAMERA_SOURCE_TYPE,
  STREAM_PROTOCOL,
  STREAM_STATUS,
  DEFAULT_CAMERA_CONFIG,
} from "../src/common/constants/camera.constant";
import {
  createCameraSchema,
  updateCameraSchema,
  cameraQuerySchema,
  createCameraStreamSchema,
  updateCameraStreamSchema,
  updateCameraConfigSchema,
  cameraHealthLogQuerySchema,
} from "../src/modules/camera/camera.validation";
import { CameraService, maskStreamCredentials } from "../src/modules/camera/camera.service";
import { CameraRepository } from "../src/modules/camera/camera.repository";
import { AppError } from "../src/common/errors/app-error";
import { ERROR_CODE } from "../src/common/errors/error-code";
import { PERMISSIONS } from "../src/common/constants/permission.constant";
import cameraApp from "../src/camera.app";

describe("Task BE-05: PPE Camera Management Service Suite", () => {
  // ── 1. Constants & Status Domain ───────────────────────────────────────────
  describe("1. Camera Domain Constants & Taxonomy", () => {
    it("should define standard camera status constants according to D08.pdf", () => {
      assert.equal(CAMERA_STATUS.ONLINE, "ONLINE");
      assert.equal(CAMERA_STATUS.OFFLINE, "OFFLINE");
      assert.equal(CAMERA_STATUS.CONNECTING, "CONNECTING");
      assert.equal(CAMERA_STATUS.ERROR, "ERROR");
      assert.equal(CAMERA_STATUS.MAINTENANCE, "MAINTENANCE");
    });

    it("should define video source types and stream protocols", () => {
      assert.equal(CAMERA_SOURCE_TYPE.RTSP, "RTSP");
      assert.equal(CAMERA_SOURCE_TYPE.HLS, "HLS");
      assert.equal(CAMERA_SOURCE_TYPE.HTTP, "HTTP");
      assert.equal(CAMERA_SOURCE_TYPE.FILE, "FILE");

      assert.equal(STREAM_PROTOCOL.RTSP, "RTSP");
      assert.equal(STREAM_PROTOCOL.HLS, "HLS");
      assert.equal(STREAM_PROTOCOL.WEBRTC, "WEBRTC");

      assert.equal(STREAM_STATUS.ACTIVE, "ACTIVE");
      assert.equal(STREAM_STATUS.INACTIVE, "INACTIVE");
    });

    it("should export baseline default camera AI config parameters", () => {
      assert.equal(DEFAULT_CAMERA_CONFIG.captureFps, 10);
      assert.equal(DEFAULT_CAMERA_CONFIG.resolution, "1920x1080");
      assert.equal(DEFAULT_CAMERA_CONFIG.enabled, true);
      assert.equal(DEFAULT_CAMERA_CONFIG.processingEnabled, true);
    });

    it("should define PPE camera-related permissions in PERMISSIONS constant", () => {
      assert.equal(PERMISSIONS.PPE_CAMERA_READ, "PPE_CAMERA_READ");
      assert.equal(PERMISSIONS.PPE_CAMERA_MANAGE, "PPE_CAMERA_MANAGE");
    });
  });

  // ── 2. Zod Validation Schemas ──────────────────────────────────────────────
  describe("2. Request Validation Schemas", () => {
    it("should validate valid camera creation payload with RTSP stream", () => {
      const validPayload = {
        siteId: "11111111-1111-4111-8111-111111111111",
        name: "Camera Cổng chính A",
        code: "CAM-GATE-01",
        sourceType: CAMERA_SOURCE_TYPE.RTSP,
        streamUrl: "rtsp://admin:123456@192.168.1.100:554/live/ch0",
        status: CAMERA_STATUS.OFFLINE,
        location: "Khu vực cổng soát vé ra vào số 1",
        description: "Camera AI giám sát mũ và áo bảo hộ",
      };
      const result = createCameraSchema.safeParse(validPayload);
      assert.equal(result.success, true);
    });

    it("should reject invalid camera code containing illegal characters", () => {
      const invalidPayload = {
        siteId: "11111111-1111-1111-1111-111111111111",
        name: "Camera Sai Mã",
        code: "CAM WITH SPACES & SPECIAL @!",
        streamUrl: "rtsp://example.com/stream",
      };
      const result = createCameraSchema.safeParse(invalidPayload);
      assert.equal(result.success, false);
      if (!result.success) {
        assert.ok(
          result.error.errors.some((e) =>
            e.message.includes("Mã camera chỉ gồm"),
          ),
        );
      }
    });

    it("should reject empty update payload in updateCameraSchema", () => {
      const emptyPayload = {};
      const result = updateCameraSchema.safeParse(emptyPayload);
      assert.equal(result.success, false);
      if (!result.success) {
        assert.ok(
          result.error.errors.some((e) =>
            e.message.includes("ít nhất một trường"),
          ),
        );
      }
    });

    it("should validate and enforce capture FPS bounds in updateCameraConfigSchema", () => {
      const invalidFps = {
        captureFps: 45, // > 30 FPS
      };
      const result = updateCameraConfigSchema.safeParse(invalidFps);
      assert.equal(result.success, false);

      const validConfig = {
        captureFps: 15,
        resolution: "1280x720",
        processingEnabled: false,
      };
      const validResult = updateCameraConfigSchema.safeParse(validConfig);
      assert.equal(validResult.success, true);
    });

    it("should reject invalid resolution format in camera stream schema", () => {
      const invalidResolution = {
        streamUrl: "rtsp://example.com/sub",
        resolution: "INVALID_RES", // không theo định dạng WxH
      };
      const result = createCameraStreamSchema.safeParse(invalidResolution);
      assert.equal(result.success, false);

      const validStream = {
        streamUrl: "rtsp://example.com/sub",
        resolution: "1280x720",
        fps: 20,
      };
      const validResult = createCameraStreamSchema.safeParse(validStream);
      assert.equal(validResult.success, true);
    });

    it("should reject streamUrl without valid protocol scheme", () => {
      const invalidStreamUrl = {
        siteId: "11111111-1111-1111-1111-111111111111",
        name: "Camera Sai Protocol",
        code: "CAM-01",
        streamUrl: "invalid-stream-string-without-scheme",
      };
      const result = createCameraSchema.safeParse(invalidStreamUrl);
      assert.equal(result.success, false);
      if (!result.success) {
        assert.ok(
          result.error.errors.some((e) =>
            e.message.includes("bắt đầu bằng giao thức hợp lệ"),
          ),
        );
      }
    });

    it("should allow nullable location and description in updateCameraSchema", () => {
      const clearPayload = {
        location: null,
        description: null,
      };
      const result = updateCameraSchema.safeParse(clearPayload);
      assert.equal(result.success, true);
    });

    it("should accept sortOrder in cameraHealthLogQuerySchema", () => {
      const queryPayload = {
        sortOrder: "asc",
      };
      const result = cameraHealthLogQuerySchema.safeParse(queryPayload);
      assert.equal(result.success, true);
      if (result.success) {
        assert.equal(result.data.sortOrder, "asc");
      }
    });
  });

  // ── 3. Camera Service Business Logic ───────────────────────────────────────
  describe("3. Camera Service Business Rules & Health Probing", () => {
    it("should throw DUPLICATE_ENTRY when creating a camera with duplicate code", async () => {
      const mockRepo = {
        findCameraByCode: async (code: string) => ({
          id: "cam-uuid-1",
          name: "Cam 1",
          code: code.toUpperCase(),
        }),
      } as unknown as CameraRepository;

      const service = new CameraService(mockRepo);

      await assert.rejects(
        async () => {
          await service.createCamera({
            siteId: "site-uuid-1",
            name: "Duplicate Cam",
            code: "CAM-01",
            streamUrl: "rtsp://test/live",
          });
        },
        (err: any) => {
          assert.ok(err instanceof AppError);
          assert.equal(err.statusCode, 409);
          assert.equal(err.code, ERROR_CODE.DUPLICATE_ENTRY);
          return true;
        },
      );
    });

    it("should throw NOT_FOUND when querying a non-existent camera", async () => {
      const mockRepo = {
        findCameraById: async (_id: string) => null,
      } as unknown as CameraRepository;

      const service = new CameraService(mockRepo);

      await assert.rejects(
        async () => {
          await service.findCameraById("00000000-0000-0000-0000-000000000000");
        },
        (err: any) => {
          assert.ok(err instanceof AppError);
          assert.equal(err.statusCode, 404);
          assert.equal(err.code, ERROR_CODE.NOT_FOUND);
          return true;
        },
      );
    });

    it("should auto-provision default camera config when config does not exist", async () => {
      let upsertCalled = false;
      const mockRepo = {
        findCameraById: async (id: string) => ({ id, name: "Cam 1" }),
        findCameraConfig: async (_id: string) => null,
        upsertCameraConfig: async (cameraId: string, data: any) => {
          upsertCalled = true;
          return {
            id: "config-uuid-1",
            cameraId,
            ...data,
          };
        },
      } as unknown as CameraRepository;

      const service = new CameraService(mockRepo);
      const config = await service.getCameraConfig("cam-uuid-1");

      assert.equal(upsertCalled, true);
      assert.equal(config.captureFps, 10);
      assert.equal(config.resolution, "1920x1080");
      assert.equal(config.enabled, true);
    });

    it("should execute ping probe, measure latency and log health", async () => {
      let loggedStatus: any = null;
      let updatedStatus: any = null;

      const mockRepo = {
        findCameraById: async (id: string) => ({
          id,
          name: "Live Cam",
          streamUrl: "rtsp://192.168.1.50:554/live",
        }),
        updateCameraStatus: async (id: string, status: string) => {
          updatedStatus = status;
          return { id, status };
        },
        createHealthLog: async (data: any) => {
          loggedStatus = data;
          return { id: "log-1", ...data };
        },
      } as unknown as CameraRepository;

      const service = new CameraService(mockRepo);
      const pingResult = await service.pingCamera("cam-uuid-1");

      assert.equal(pingResult.success, true);
      assert.equal(pingResult.status, CAMERA_STATUS.ONLINE);
      assert.ok(typeof pingResult.latencyMs === "number" && pingResult.latencyMs > 0);
      assert.equal(updatedStatus, CAMERA_STATUS.ONLINE);
      assert.equal(loggedStatus.status, CAMERA_STATUS.ONLINE);
    });

    it("should preserve MAINTENANCE status during ping probe", async () => {
      let updatedStatus: any = null;

      const mockRepo = {
        findCameraById: async (id: string) => ({
          id,
          name: "Maintenance Cam",
          status: CAMERA_STATUS.MAINTENANCE,
          streamUrl: "rtsp://192.168.1.50:554/live",
        }),
        updateCameraStatus: async (id: string, status: string) => {
          updatedStatus = status;
          return { id, status };
        },
        createHealthLog: async (data: any) => ({ id: "log-2", ...data }),
      } as unknown as CameraRepository;

      const service = new CameraService(mockRepo);
      const pingResult = await service.pingCamera("cam-uuid-maintenance");

      assert.equal(pingResult.status, CAMERA_STATUS.MAINTENANCE);
      assert.equal(updatedStatus, CAMERA_STATUS.MAINTENANCE);
    });

    it("should mask credentials in RTSP stream URL", () => {
      const rawUrl = "rtsp://admin:superSecret123@192.168.1.100:554/live/ch0";
      const masked = maskStreamCredentials(rawUrl);
      assert.equal(masked, "rtsp://admin:***@192.168.1.100:554/live/ch0");
    });
  });

  // ── 4. Standalone Express App & Routes Architecture ────────────────────────
  describe("4. Standalone Microservice Express Runtime & Health Probes", () => {
    it("should export initialized Express application for camera microservice", () => {
      assert.ok(cameraApp);
      assert.equal(typeof cameraApp.listen, "function");
      assert.equal(typeof cameraApp.use, "function");
    });

    it("should register health check endpoints on cameraApp", () => {
      const routes = (cameraApp._router?.stack || [])
        .filter((layer: any) => layer.route)
        .map((layer: any) => layer.route.path);

      assert.ok(routes.includes("/health"));
      assert.ok(routes.includes("/api/v1/cameras/health"));
      assert.ok(routes.includes("/cameras/health"));
    });
  });

  // ── 5. Router Endpoints & Permission Protection ────────────────────────────
  describe("5. Router Endpoints & Permission Protection", () => {
    it("should have correct routes configured for cameraRouter", async () => {
      const { cameraRouter } = await import(
        "../src/modules/camera/camera.route"
      );
      const routePaths = cameraRouter.stack
        .filter((layer: any) => layer.route)
        .map((layer: any) => layer.route.path);

      assert.ok(routePaths.includes("/"));
      assert.ok(routePaths.includes("/:id"));
      assert.ok(routePaths.includes("/:id/config"));
      assert.ok(routePaths.includes("/:id/streams"));
      assert.ok(routePaths.includes("/:id/health-logs"));
      assert.ok(routePaths.includes("/:id/ping"));
    });

    it("should have correct routes configured for cameraStreamRouter", async () => {
      const { cameraStreamRouter } = await import(
        "../src/modules/camera/camera.route"
      );
      const routePaths = cameraStreamRouter.stack
        .filter((layer: any) => layer.route)
        .map((layer: any) => layer.route.path);

      assert.ok(routePaths.includes("/:id"));
      assert.ok(routePaths.includes("/"));
    });
  });
});
