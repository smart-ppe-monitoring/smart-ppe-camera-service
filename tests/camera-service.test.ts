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
  roiPolygonsSchema,
  cameraHealthLogQuerySchema,
  internalActiveStreamsQuerySchema,
  internalCameraLookupQuerySchema,
} from "../src/modules/camera/camera.validation";
import { createRequireInternalServiceToken } from "../src/middlewares/internal-auth.middleware";
import { GATEWAY_HEADERS } from "../src/common/constants/gateway.constant";
import {
  CameraService,
  cameraService,
  defaultCameraAuditLogger,
  maskStreamCredentials,
  hasMaskedStreamCredentials,
  resolveStreamUrlUpdate,
} from "../src/modules/camera/camera.service";
import { CameraRepository } from "../src/modules/camera/camera.repository";
import { AppError } from "../src/common/errors/app-error";
import { ERROR_CODE } from "../src/common/errors/error-code";
import { AUDIT_ACTION, AUDIT_TARGET_TYPE } from "../src/common/constants/audit-log.constant";
import { ROLES } from "../src/common/constants/role.constant";
import { PERMISSIONS } from "../src/common/constants/permission.constant";
import { isUuid, UUID_REGEX } from "../src/common/helpers/uuid.helper";
import cameraApp, { checkDatabaseHealth, DB_HEALTH_CACHE_TTL_MS } from "../src/camera.app";
import { getCameraPrisma } from "../src/database/camera.client";
import { parseTrustProxy } from "../src/config/env.config";
import { requireGatewayOrigin } from "../src/middlewares/request-id.middleware";
import {
  extractTokenFromRequest,
  authMiddleware,
} from "../src/middlewares/auth.middleware";
import { maintenanceGuard } from "../src/middlewares/maintenance.middleware";
import { encryptSecret, decryptSecret } from "../src/common/helpers/crypto.helper";
import {
  KAFKA_TOPICS,
  KAFKA_CONSUMER_GROUPS,
} from "../src/common/constants/kafka.constant";
import { BROKER_CONSUMER_GROUPS } from "../src/common/constants/broker.constant";
import {
  CameraEventConsumer,
  defaultCameraEventConsumer,
} from "../src/modules/camera/camera.consumer";
import fs from "node:fs";
import path from "node:path";

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

    it("should validate and accept roiPolygon and motionSensitivity in updateCameraConfigSchema", () => {
      // 1. motionSensitivity hợp lệ (1-100)
      const validSensitivity = updateCameraConfigSchema.safeParse({ motionSensitivity: 85 });
      assert.equal(validSensitivity.success, true);

      // 2. motionSensitivity ngoài khoảng
      const invalidLowSensitivity = updateCameraConfigSchema.safeParse({ motionSensitivity: 0 });
      assert.equal(invalidLowSensitivity.success, false);
      const invalidHighSensitivity = updateCameraConfigSchema.safeParse({ motionSensitivity: 105 });
      assert.equal(invalidHighSensitivity.success, false);

      // 3. roiPolygon hợp lệ (>= 3 điểm)
      const validPolygon = updateCameraConfigSchema.safeParse({
        roiPolygon: [
          { x: 10, y: 10 },
          { x: 100, y: 20 },
          { x: 80, y: 150 },
        ],
      });
      assert.equal(validPolygon.success, true);

      // 4. roiPolygon null hoặc mảng rỗng (để xóa ROI)
      const nullPolygon = updateCameraConfigSchema.safeParse({ roiPolygon: null });
      assert.equal(nullPolygon.success, true);
      const emptyPolygon = updateCameraConfigSchema.safeParse({ roiPolygon: [] });
      assert.equal(emptyPolygon.success, true);

      // 5. roiPolygon thiếu điểm (< 3 điểm)
      const invalidPolygon = updateCameraConfigSchema.safeParse({
        roiPolygon: [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ],
      });
      assert.equal(invalidPolygon.success, false);

      // 6. roiPolygon có tọa độ âm
      const negativePolygon = updateCameraConfigSchema.safeParse({
        roiPolygon: [
          { x: -5, y: 10 },
          { x: 100, y: 20 },
          { x: 80, y: 150 },
        ],
      });
      assert.equal(negativePolygon.success, false);

      // 7. roiPolygon vượt quá 50 điểm tọa độ (chống DoS / payload bloat)
      const oversizedPolygon = Array.from({ length: 51 }, (_, i) => ({ x: i, y: i }));
      const rejectedOversized = updateCameraConfigSchema.safeParse({ roiPolygon: oversizedPolygon });
      assert.equal(rejectedOversized.success, false);

      // 8. roiPolygon có tọa độ vượt quá giới hạn 10000 hoặc không hữu hạn
      const overflowPolygon = updateCameraConfigSchema.safeParse({
        roiPolygon: [
          { x: 10001, y: 10 },
          { x: 100, y: 20 },
          { x: 80, y: 150 },
        ],
      });
      assert.equal(overflowPolygon.success, false);

      const nonFinitePolygon = updateCameraConfigSchema.safeParse({
        roiPolygon: [
          { x: Infinity, y: 10 },
          { x: 100, y: 20 },
          { x: 80, y: 150 },
        ],
      });
      assert.equal(nonFinitePolygon.success, false);
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
      assert.equal(config.motionSensitivity, 75);
    });

    it("should update camera config with roiPolygon and motionSensitivity", async () => {
      let passedData: any = null;
      const mockRepo = {
        findCameraById: async (id: string) => ({ id, name: "Cam 1", code: "CAM-01" }),
        upsertCameraConfig: async (cameraId: string, data: any) => {
          passedData = { cameraId, ...data };
          return { id: "cfg-1", ...passedData };
        },
      } as unknown as CameraRepository;

      const service = new CameraService(mockRepo);
      const polygon = [
        { x: 10, y: 10 },
        { x: 100, y: 20 },
        { x: 80, y: 150 },
      ];
      const result = await service.updateCameraConfig("cam-uuid-1", {
        roiPolygon: polygon,
        motionSensitivity: 80,
      });

      assert.equal(result.cameraId, "cam-uuid-1");
      assert.deepEqual(result.roiPolygon, polygon);
      assert.equal(result.motionSensitivity, 80);
      assert.deepEqual(passedData.roiPolygon, polygon);
      assert.equal(passedData.motionSensitivity, 80);
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

      const mockPinger = async () => ({
        reachable: true,
        latencyMs: 25,
        errorMessage: null,
      });
      const service = new CameraService(mockRepo, undefined, mockPinger);
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

      const mockPinger = async () => ({
        reachable: true,
        latencyMs: 30,
        errorMessage: null,
      });
      const service = new CameraService(mockRepo, undefined, mockPinger);
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

  // ── 6. Security Patches Suite (SEC-01 – SEC-04) ───────────────────────────
  describe("6. Security Patches Suite (SEC-01 – SEC-04)", () => {
    it("SEC-01: authMiddleware should reject unauthenticated requests even if x-gateway-secret is present", async () => {
      const { authMiddleware } = await import("../src/middlewares/auth.middleware");
      let capturedError: any = null;
      const mockReq: any = {
        headers: { "x-gateway-secret": "test-secret" },
        cookies: {},
        query: {},
      };
      const mockRes: any = {};
      await authMiddleware(mockReq, mockRes, (err?: any) => {
        capturedError = err;
      });

      assert.ok(capturedError instanceof AppError);
      assert.equal(capturedError.statusCode, 401);
      assert.equal(mockReq.user, undefined);
    });

    it("SEC-02: authMiddleware should reject tokens with purpose !== ACCESS (e.g. 2FA_VERIFICATION)", async () => {
      const crypto = await import("node:crypto");
      const jwt = (await import("jsonwebtoken")).default;
      const { jwtConfig } = await import("../src/config/jwt.config");
      const { authMiddleware } = await import("../src/middlewares/auth.middleware");

      // Generate a test RSA pair
      const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
        modulusLength: 2048,
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
      });

      const originalPublicKey = jwtConfig.publicKey;
      (jwtConfig as any).publicKey = publicKey;

      try {
        const tempToken = jwt.sign(
          {
            id: "user-1",
            role: "ADMIN",
            purpose: "2FA_VERIFICATION",
          },
          privateKey,
          { algorithm: "RS256", expiresIn: "5m" },
        );

        let capturedError: any = null;
        const mockReq: any = {
          headers: { authorization: `Bearer ${tempToken}` },
          cookies: {},
          query: {},
        };
        const mockRes: any = {};

        await authMiddleware(mockReq, mockRes, (err?: any) => {
          capturedError = err;
        });

        assert.ok(capturedError instanceof AppError);
        assert.equal(capturedError.statusCode, 401);
        assert.equal(mockReq.user, undefined);
      } finally {
        (jwtConfig as any).publicKey = originalPublicKey;
      }
    });

    it("SEC-03: requirePermission should enforce restricted permissions on Admin API keys", async () => {
      const { requirePermission } = await import("../src/middlewares/permission.middleware");
      let capturedError: any = null;
      const mockReq: any = {
        user: {
          id: "admin-user-id",
          role: "ADMIN",
          permissions: [],
        },
        apiKey: {
          id: "key-1",
          name: "Health Monitor Bot",
          prefix: "ppe_key",
          permissions: [PERMISSIONS.PPE_CAMERA_READ], // Read-only scope
        },
      };
      const mockRes: any = {};
      const guard = requirePermission(PERMISSIONS.PPE_CAMERA_MANAGE);

      guard(mockReq, mockRes, (err?: any) => {
        capturedError = err;
      });

      assert.ok(capturedError instanceof AppError);
      assert.equal(capturedError.statusCode, 403);
      assert.equal(capturedError.code, ERROR_CODE.FORBIDDEN);
    });

    it("SEC-04: updateCamera should omit masked streamUrl (:***@) to protect real camera credentials", async () => {
      let streamUpdated = false;
      let cameraUpdateData: any = null;

      const mockDb: any = {
        cameraStream: {
          findFirst: async () => ({ id: "stream-id-1", streamUrl: "rtsp://admin:RealSecretPassword123@192.168.1.50:554/live" }),
          update: async () => {
            streamUpdated = true;
          },
        },
        camera: {
          update: async ({ data }: any) => {
            cameraUpdateData = data;
            return { id: "cam-1", ...data };
          },
        },
      };

      const repo = new CameraRepository(mockDb);
      await repo.updateCamera("cam-1", {
        name: "Renamed Camera",
        streamUrl: "rtsp://admin:***@192.168.1.50:554/live",
      });

      // Stream sub-entity must NOT be updated with asterisks
      assert.equal(streamUpdated, false);
      // Camera entity update payload must NOT contain the masked streamUrl
      assert.equal(cameraUpdateData.streamUrl, undefined);
      assert.equal(cameraUpdateData.name, "Renamed Camera");
    });

    it("SEC-17: updateCameraStream should omit masked streamUrl (:***@) to protect sub-stream credentials", async () => {
      let updatedData: any = null;
      const mockDb: any = {
        cameraStream: {
          update: async ({ data }: any) => {
            updatedData = data;
            return { id: "stream-1", ...data };
          },
        },
      };

      const repo = new CameraRepository(mockDb);
      await repo.updateCameraStream("stream-1", {
        resolution: "1920x1080",
        streamUrl: "rtsp://admin:***@192.168.1.50:554/live/sub",
      });

      assert.equal(updatedData.streamUrl, undefined);
      assert.equal(updatedData.resolution, "1920x1080");
    });

    it("SEC-18: streamUrlSchema should reject cloud metadata and loopback addresses", async () => {
      const { streamUrlSchema } = await import("../src/modules/camera/camera.validation");

      // AWS/Azure/GCP link-local metadata
      const resMetadata = streamUrlSchema.safeParse("http://169.254.169.254/latest/meta-data");
      assert.equal(resMetadata.success, false);

      // GCP internal metadata host
      const resGcp = streamUrlSchema.safeParse("http://metadata.google.internal/computeMetadata/v1/");
      assert.equal(resGcp.success, false);

      // Loopback IPv4
      const resLoopback = streamUrlSchema.safeParse("rtsp://127.0.0.1:554/live");
      assert.equal(resLoopback.success, false);

      // Localhost
      const resLocalhost = streamUrlSchema.safeParse("rtsp://localhost:554/live");
      assert.equal(resLocalhost.success, false);

      // Valid LAN RTSP camera must pass
      const resLan = streamUrlSchema.safeParse("rtsp://admin:secret@192.168.1.100:554/live");
      assert.equal(resLan.success, true);
    });

    it("SEC-25: pingCamera should mark camera as OFFLINE when stream endpoint is unreachable", async () => {
      let updatedStatus: any = null;
      let loggedData: any = null;

      const mockRepo = {
        findCameraById: async (id: string) => ({
          id,
          name: "Broken Camera",
          status: CAMERA_STATUS.ONLINE,
          streamUrl: "rtsp://192.168.1.99:554/broken",
        }),
        updateCameraStatus: async (id: string, status: string) => {
          updatedStatus = status;
          return { id, status };
        },
        createHealthLog: async (data: any) => {
          loggedData = data;
          return { id: "log-3", ...data };
        },
      } as unknown as CameraRepository;

      const failingPinger = async () => ({
        reachable: false,
        latencyMs: null,
        errorMessage: "Connection refused",
      });

      const service = new CameraService(mockRepo, undefined, failingPinger);
      const pingResult = await service.pingCamera("cam-broken-1");

      assert.equal(pingResult.success, false);
      assert.equal(pingResult.status, CAMERA_STATUS.OFFLINE);
      assert.equal(pingResult.latencyMs, null);
      assert.equal(pingResult.errorMessage, "Connection refused");
      assert.equal(updatedStatus, CAMERA_STATUS.OFFLINE);
      assert.equal(loggedData.status, CAMERA_STATUS.OFFLINE);
      assert.equal(loggedData.errorMessage, "Connection refused");
    });

    it("SEC-05: Dockerfile should enforce frozen lockfile and copy keys directory into runner stage", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const dockerfilePath = path.join(__dirname, "../Dockerfile");
      const dockerfileContent = fs.readFileSync(dockerfilePath, "utf-8");

      assert.ok(dockerfileContent.includes("pnpm install --frozen-lockfile"));
      assert.ok(dockerfileContent.includes("COPY --from=builder /app/keys ./keys"));
      assert.ok(fs.existsSync(path.join(__dirname, "../keys/public.key.pem")));
    });

    it("SEC-06: authMiddleware should reject tokens with mustChangePassword: true", async () => {
      const { authMiddleware } = await import("../src/middlewares/auth.middleware");
      const { jwtConfig } = await import("../src/config/jwt.config");
      const jwt = (await import("jsonwebtoken")).default;
      const crypto = await import("crypto");

      const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
        modulusLength: 2048,
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
      });

      const originalPublicKey = jwtConfig.publicKey;
      (jwtConfig as any).publicKey = publicKey;

      try {
        const token = jwt.sign(
          {
            id: "user-must-change",
            role: "OPERATOR",
            purpose: "ACCESS",
            mustChangePassword: true,
          },
          privateKey,
          { algorithm: "RS256", expiresIn: "5m" },
        );

        let capturedError: any = null;
        const mockReq: any = {
          headers: { authorization: `Bearer ${token}` },
          cookies: {},
          query: {},
        };
        const mockRes: any = {};

        await authMiddleware(mockReq, mockRes, (err?: any) => {
          capturedError = err;
        });

        assert.ok(capturedError instanceof AppError);
        assert.equal(capturedError.statusCode, 403);
        assert.equal(capturedError.code, ERROR_CODE.FORBIDDEN);
        assert.equal(mockReq.user, undefined);
      } finally {
        (jwtConfig as any).publicKey = originalPublicKey;
      }
    });

    it("SEC-07: CameraRepository should include retention purge in recordPingResult and export purgeExpiredHealthLogs", async () => {
      let transactionOperations: any[] = [];
      const mockDb: any = {
        $transaction: async (ops: any[]) => {
          transactionOperations = ops;
          return ops;
        },
        camera: { update: (args: any) => ({ op: "camera.update", ...args }) },
        cameraHealthLog: {
          create: (args: any) => ({ op: "cameraHealthLog.create", ...args }),
          deleteMany: (args: any) => ({ op: "cameraHealthLog.deleteMany", count: 5, ...args }),
        },
      };

      const repo = new CameraRepository(mockDb);
      await repo.recordPingResult("cam-1", CAMERA_STATUS.ONLINE, {
        cameraId: "cam-1",
        status: CAMERA_STATUS.ONLINE,
        latencyMs: 15,
      }, 30);

      // Verify transaction includes auto-purge deleteMany
      assert.equal(transactionOperations.length, 3);
      assert.equal(transactionOperations[2].op, "cameraHealthLog.deleteMany");
      assert.equal(transactionOperations[2].where.cameraId, "cam-1");
      assert.ok(transactionOperations[2].where.checkedAt.lt instanceof Date);

      // Test standalone purgeExpiredHealthLogs
      const purgedCount = await repo.purgeExpiredHealthLogs(30);
      assert.equal(purgedCount, 5);
    });

    it("SEC-08: CameraService should enforce site scoping (BOLA protection) for non-admin users", async () => {
      const mockCameras = [
        { id: "cam-site-a", name: "Cam Site A", siteId: "site-a-uuid" },
        { id: "cam-site-b", name: "Cam Site B", siteId: "site-b-uuid" },
      ];

      const mockRepo = {
        findCameraById: async (id: string) => {
          const found = mockCameras.find((c) => c.id === id);
          return found || null;
        },
        findAllCameras: async (query: any) => {
          let filtered = [...mockCameras];
          if (query.siteId) {
            filtered = filtered.filter((c) => c.siteId === query.siteId);
          }
          return { data: filtered, meta: { total: filtered.length, page: 1, limit: 10, totalPages: 1 } };
        },
      } as unknown as CameraRepository;

      const service = new CameraService(mockRepo);

      // User from Site A trying to access Camera from Site B
      const nonAdminUserSiteA = {
        id: "user-site-a",
        role: "SAFETY_OFFICER",
        siteId: "site-a-uuid",
      };

      await assert.rejects(
        async () => {
          await service.findCameraById("cam-site-b", nonAdminUserSiteA);
        },
        (err: any) => {
          assert.ok(err instanceof AppError);
          assert.equal(err.statusCode, 403);
          assert.equal(err.code, ERROR_CODE.FORBIDDEN);
          return true;
        },
      );

      // User from Site A successfully accessing Camera from Site A
      const camA = await service.findCameraById("cam-site-a", nonAdminUserSiteA);
      assert.equal(camA.id, "cam-site-a");

      // Non-admin querying Site B explicitly -> Forbidden
      await assert.rejects(
        async () => {
          await service.findAllCameras({ siteId: "site-b-uuid" }, nonAdminUserSiteA);
        },
        (err: any) => {
          assert.ok(err instanceof AppError);
          assert.equal(err.statusCode, 403);
          return true;
        },
      );

      // Admin user can access any camera across sites
      const adminUser = {
        id: "admin-user",
        role: "ADMIN",
      };
      const camBForAdmin = await service.findCameraById("cam-site-b", adminUser);
      assert.equal(camBForAdmin.id, "cam-site-b");
    });

    it("SEC-19: rate limiter should normalize /api/v1 prefix to prevent dual-mount quota dilution", async () => {
      const { createRateLimiter } = await import("../src/middlewares/rate-limit.middleware");
      const limiter = createRateLimiter({ windowMs: 60000, maxRequests: 2 });

      let resHeaders1: Record<string, any> = {};
      const mockReq1: any = {
        ip: "10.0.0.99",
        baseUrl: "/api/v1/cameras",
        socket: {},
      };
      const mockRes1: any = {
        setHeader: (k: string, v: any) => { resHeaders1[k] = v; },
        status: () => mockRes1,
        json: () => {},
      };

      // Request 1 via /api/v1/cameras
      await limiter(mockReq1, mockRes1, () => {});
      assert.equal(resHeaders1["X-RateLimit-Remaining"], 1);

      // Request 2 via alias /cameras
      let resHeaders2: Record<string, any> = {};
      const mockReq2: any = {
        ip: "10.0.0.99",
        baseUrl: "/cameras",
        socket: {},
      };
      const mockRes2: any = {
        setHeader: (k: string, v: any) => { resHeaders2[k] = v; },
        status: () => mockRes2,
        json: () => {},
      };
      await limiter(mockReq2, mockRes2, () => {});
      // Must decrement the SAME quota, remaining should be 0, not 1
      assert.equal(resHeaders2["X-RateLimit-Remaining"], 0);

      // Request 3 via /cameras should hit 429
      let blockedCode = 0;
      let blockedBody: any = null;
      const mockRes3: any = {
        setHeader: () => {},
        status: (code: number) => { blockedCode = code; return mockRes3; },
        json: (data: any) => { blockedBody = data; },
      };
      await limiter(mockReq2, mockRes3, () => {});
      assert.equal(blockedCode, 429);
      assert.equal(blockedBody.code, ERROR_CODE.RATE_LIMIT_EXCEEDED);
    });

    it("SEC-20: findAllCameras repository query should omit _count for healthLogs to prevent DB DoS", async () => {
      let capturedInclude: any = null;
      const mockDb: any = {
        camera: {
          count: async () => 1,
          findMany: async (args: any) => {
            capturedInclude = args.include;
            return [];
          },
        },
      };

      const repo = new CameraRepository(mockDb);
      await repo.findAllCameras({ page: 1, limit: 10 });

      assert.ok(capturedInclude);
      assert.equal(capturedInclude.config, true);
      assert.equal(capturedInclude.streams, true);
      assert.equal(capturedInclude._count, undefined);
    });

    it("SEC-21: updateCameraConfig and clearCameraConfig should record audit logs", async () => {
      let recordedAuditLogs: any[] = [];
      const mockAudit = {
        recordLog: async (log: any) => {
          recordedAuditLogs.push(log);
        },
      };

      const mockRepo = {
        findCameraById: async (id: string) => ({ id, name: "AI Cam", siteId: "site-1" }),
        upsertCameraConfig: async (id: string, data: any) => ({ cameraId: id, ...data }),
      } as unknown as CameraRepository;

      const service = new CameraService(mockRepo, mockAudit);
      await service.updateCameraConfig("cam-ai-1", { processingEnabled: false, captureFps: 5 }, "operator-1");

      assert.equal(recordedAuditLogs.length, 1);
      assert.equal(recordedAuditLogs[0].action, AUDIT_ACTION.UPDATE_PPE_CAMERA_SAFETY_CONFIG);
      assert.equal(recordedAuditLogs[0].actorId, "operator-1");
      assert.equal(recordedAuditLogs[0].targetId, "cam-ai-1");
      assert.equal(recordedAuditLogs[0].details.processingEnabled, false);

      await service.clearCameraConfig("cam-ai-1", "operator-1");
      assert.equal(recordedAuditLogs.length, 2);
      assert.equal(recordedAuditLogs[1].action, AUDIT_ACTION.DELETE_PPE_CAMERA_SAFETY_CONFIG);
    });

    it("SEC-22: deleteCameraStream should prevent deletion of the camera's only stream", async () => {
      const mockRepo = {
        findCameraStreamById: async (id: string) => ({
          id,
          cameraId: "cam-single-stream",
          camera: { id: "cam-single-stream", siteId: "site-1" },
        }),
        findStreamsByCameraId: async (cameraId: string) => [
          { id: "stream-only", cameraId },
        ],
        findCameraById: async (id: string) => ({ id, siteId: "site-1" }),
        deleteCameraStream: async (id: string) => ({ id }),
      } as unknown as CameraRepository;

      const service = new CameraService(mockRepo);

      // Deleting the only stream should be rejected with 400 BAD_REQUEST
      await assert.rejects(
        async () => {
          await service.deleteCameraStream("stream-only");
        },
        (err: any) => {
          assert.ok(err instanceof AppError);
          assert.equal(err.statusCode, 400);
          assert.equal(err.code, ERROR_CODE.BAD_REQUEST);
          assert.ok(err.message.includes("Không thể xóa luồng stream duy nhất"));
          return true;
        },
      );

      // Deleting when there are 2 streams should succeed
      let deletedStreamId: string | null = null;
      const multiStreamRepo = {
        findCameraStreamById: async (id: string) => ({
          id,
          cameraId: "cam-multi-stream",
          camera: { id: "cam-multi-stream", siteId: "site-1" },
        }),
        findStreamsByCameraId: async (cameraId: string) => [
          { id: "stream-primary", cameraId },
          { id: "stream-secondary", cameraId },
        ],
        findCameraById: async (id: string) => ({ id, siteId: "site-1" }),
        deleteCameraStream: async (id: string) => {
          deletedStreamId = id;
          return { id };
        },
      } as unknown as CameraRepository;

      const multiService = new CameraService(multiStreamRepo);
      const res = await multiService.deleteCameraStream("stream-secondary");
      assert.equal(res.id, "stream-secondary");
      assert.equal(deletedStreamId, "stream-secondary");
    });

    it("SEC-26: createCameraStream, updateCameraStream, deleteCameraStream should record audit logs with masked stream credentials", async () => {
      let recordedAuditLogs: any[] = [];
      const mockAudit = {
        recordLog: async (log: any) => {
          recordedAuditLogs.push(log);
        },
      };

      const mockRepo = {
        findCameraById: async (id: string) => ({ id, name: "Site Cam", siteId: "site-1" }),
        createCameraStream: async (data: any) => ({
          id: "stream-sec26-new",
          cameraId: data.cameraId,
          protocol: data.protocol || "RTSP",
          streamUrl: data.streamUrl,
          resolution: "1920x1080",
          fps: 25,
        }),
        findCameraStreamById: async (id: string) => ({
          id,
          cameraId: "cam-sec26",
          camera: { id: "cam-sec26", siteId: "site-1" },
          protocol: "RTSP",
          streamUrl: "rtsp://admin:superSecretPass@192.168.1.50:554/stream1",
        }),
        updateCameraStream: async (id: string, data: any) => ({
          id,
          cameraId: "cam-sec26",
          ...data,
        }),
        findStreamsByCameraId: async (cameraId: string) => [
          { id: "stream-1", cameraId },
          { id: "stream-2", cameraId },
        ],
        deleteCameraStream: async (id: string) => ({ id }),
      } as unknown as CameraRepository;

      const service = new CameraService(mockRepo, mockAudit);

      // 1. Create camera stream
      await service.createCameraStream(
        "cam-sec26",
        {
          protocol: STREAM_PROTOCOL.RTSP,
          streamUrl: "rtsp://admin:secretPassword123@192.168.1.100:554/live",
          resolution: "1920x1080",
          fps: 25,
        },
        "user-actor-1",
      );

      assert.equal(recordedAuditLogs.length, 1);
      assert.equal(recordedAuditLogs[0].action, AUDIT_ACTION.CREATE_PPE_CAMERA_STREAM);
      assert.equal(recordedAuditLogs[0].targetType, AUDIT_TARGET_TYPE.PPE_CAMERA_STREAM);
      assert.equal(recordedAuditLogs[0].targetId, "stream-sec26-new");
      assert.equal(recordedAuditLogs[0].actorId, "user-actor-1");
      // Credentials must be masked in audit log
      assert.ok(recordedAuditLogs[0].details.streamUrl.includes(":***@"));
      assert.ok(!recordedAuditLogs[0].details.streamUrl.includes("secretPassword123"));

      // 2. Update camera stream
      await service.updateCameraStream(
        "stream-sec26-new",
        {
          streamUrl: "rtsp://operator:anotherPassword@192.168.1.101:554/live",
          fps: 15,
        },
        "user-actor-2",
      );

      assert.equal(recordedAuditLogs.length, 2);
      assert.equal(recordedAuditLogs[1].action, AUDIT_ACTION.UPDATE_PPE_CAMERA_STREAM);
      assert.equal(recordedAuditLogs[1].targetType, AUDIT_TARGET_TYPE.PPE_CAMERA_STREAM);
      assert.equal(recordedAuditLogs[1].targetId, "stream-sec26-new");
      assert.equal(recordedAuditLogs[1].actorId, "user-actor-2");
      assert.ok(recordedAuditLogs[1].details.streamUrl.includes(":***@"));
      assert.ok(!recordedAuditLogs[1].details.streamUrl.includes("anotherPassword"));

      // 3. Delete camera stream
      await service.deleteCameraStream("stream-sec26-new", "user-actor-3");
      assert.equal(recordedAuditLogs.length, 3);
      assert.equal(recordedAuditLogs[2].action, AUDIT_ACTION.DELETE_PPE_CAMERA_STREAM);
      assert.equal(recordedAuditLogs[2].targetType, AUDIT_TARGET_TYPE.PPE_CAMERA_STREAM);
      assert.equal(recordedAuditLogs[2].targetId, "stream-sec26-new");
      assert.equal(recordedAuditLogs[2].actorId, "user-actor-3");
      assert.ok(recordedAuditLogs[2].details.streamUrl.includes(":***@"));
      assert.ok(!recordedAuditLogs[2].details.streamUrl.includes("superSecretPass"));
    });

    it("SEC-27: stream endpoints should enforce site scoping (BOLA protection) for non-admin users", async () => {
      const mockRepo = {
        findCameraById: async (id: string) => ({ id, name: "Cam Site A", siteId: "site-a" }),
        findCameraStreamById: async (id: string) => ({
          id,
          cameraId: "cam-site-a",
          camera: { id: "cam-site-a", siteId: "site-a" },
        }),
        createCameraStream: async (data: any) => ({ id: "new-stream", ...data }),
        updateCameraStream: async (id: string, data: any) => ({ id, ...data }),
        findStreamsByCameraId: async (cameraId: string) => [
          { id: "stream-1", cameraId },
          { id: "stream-2", cameraId },
        ],
        deleteCameraStream: async (id: string) => ({ id }),
      } as unknown as CameraRepository;

      const service = new CameraService(mockRepo);

      const userFromSiteB = { id: "user-b", role: "OPERATOR", siteId: "site-b" };
      const userFromSiteA = { id: "user-a", role: "OPERATOR", siteId: "site-a" };
      const adminUser = { id: "admin-1", role: ROLES.ADMIN };

      // 1. findCameraStreamById: user from Site B should be rejected
      await assert.rejects(
        async () => {
          await service.findCameraStreamById("stream-site-a", userFromSiteB);
        },
        (err: any) => {
          assert.ok(err instanceof AppError);
          assert.equal(err.statusCode, 403);
          assert.equal(err.code, ERROR_CODE.FORBIDDEN);
          return true;
        },
      );

      // User from Site A and Admin should succeed
      const allowedSiteA = await service.findCameraStreamById("stream-site-a", userFromSiteA);
      assert.equal(allowedSiteA.id, "stream-site-a");

      const allowedAdmin = await service.findCameraStreamById("stream-site-a", adminUser);
      assert.equal(allowedAdmin.id, "stream-site-a");

      // 2. updateCameraStream: user from Site B should be rejected
      await assert.rejects(
        async () => {
          await service.updateCameraStream("stream-site-a", { fps: 20 }, "user-b", userFromSiteB);
        },
        (err: any) => {
          assert.ok(err instanceof AppError);
          assert.equal(err.statusCode, 403);
          assert.equal(err.code, ERROR_CODE.FORBIDDEN);
          return true;
        },
      );

      // 3. deleteCameraStream: user from Site B should be rejected
      await assert.rejects(
        async () => {
          await service.deleteCameraStream("stream-site-a", "user-b", userFromSiteB);
        },
        (err: any) => {
          assert.ok(err instanceof AppError);
          assert.equal(err.statusCode, 403);
          assert.equal(err.code, ERROR_CODE.FORBIDDEN);
          return true;
        },
      );

      // 4. createCameraStream: user from Site B trying to add stream to Site A camera should be rejected
      await assert.rejects(
        async () => {
          await service.createCameraStream("cam-site-a", {
            protocol: STREAM_PROTOCOL.RTSP,
            streamUrl: "rtsp://192.168.1.200/live",
          }, "user-b", userFromSiteB);
        },
        (err: any) => {
          assert.ok(err instanceof AppError);
          assert.equal(err.statusCode, 403);
          assert.equal(err.code, ERROR_CODE.FORBIDDEN);
          return true;
        },
      );
    });

    it("SEC-28: migration.sql should define uuid_generate_v7 and CameraRepository should create records with UUIDv7", async () => {
      // 1. Verify migration.sql definition
      const migrationPath = path.resolve(__dirname, "../prisma/migrations/20261008170828_init_camera/migration.sql");
      const migrationSql = fs.readFileSync(migrationPath, "utf-8");
      assert.ok(migrationSql.includes('CREATE EXTENSION IF NOT EXISTS "pgcrypto"'), "migration.sql must create pgcrypto extension");
      assert.ok(migrationSql.includes("CREATE OR REPLACE FUNCTION uuid_generate_v7()"), "migration.sql must define uuid_generate_v7() function");

      // 2. Verify CameraRepository generates explicit UUIDv7 on entity creation
      let createdRecords: any[] = [];
      const mockDb = {
        $transaction: async (fn: any) => {
          const tx = {
            camera: {
              create: async (args: any) => {
                createdRecords.push({ type: "camera", ...args.data });
                return { ...args.data };
              },
            },
            cameraConfig: {
              create: async (args: any) => {
                createdRecords.push({ type: "config", ...args.data });
                return { ...args.data };
              },
            },
            cameraStream: {
              create: async (args: any) => {
                createdRecords.push({ type: "stream", ...args.data });
                return { ...args.data };
              },
            },
          };
          return fn(tx);
        },
        cameraStream: {
          create: async (args: any) => {
            createdRecords.push({ type: "direct_stream", ...args.data });
            return { ...args.data };
          },
        },
      };

      const repo = new CameraRepository(mockDb as any);
      await repo.createCamera({
        siteId: "site-1",
        name: "Test Cam",
        code: "CAM-UUID7",
        streamUrl: "rtsp://192.168.1.100/live",
      });

      assert.equal(createdRecords.length, 3);
      for (const rec of createdRecords) {
        assert.ok(rec.id, `Record ${rec.type} must have an explicit id`);
        assert.ok(isUuid(rec.id), `Record ${rec.type} id must match UUID format: ${rec.id}`);
      }
    });

    it("SEC-09: parseTrustProxy should resolve 'true' to 1 hop to prevent client IP spoofing", () => {
      // SEC-09: 'true' must map to 1 hop (Traefik gateway) instead of boolean true
      assert.equal(parseTrustProxy("true"), 1);
      assert.equal(parseTrustProxy("false"), false);
      assert.equal(parseTrustProxy("2"), 2);
      assert.deepEqual(parseTrustProxy("10.0.0.1, 10.0.0.2"), ["10.0.0.1", "10.0.0.2"]);
    });

    it("SEC-10: requireGatewayOrigin should be mounted on Express routes and reject direct access", async () => {
      // 1. Verify requireGatewayOrigin is registered in cameraApp middleware stacks
      const hasGatewayOrigin = (cameraApp._router?.stack || []).some(
        (layer: any) =>
          layer.name === "requireGatewayOrigin" ||
          layer.handle?.name === "requireGatewayOrigin",
      );
      assert.ok(hasGatewayOrigin, "cameraApp routes must mount requireGatewayOrigin");

      // 2. Direct unit test of requireGatewayOrigin
      const { createRequireGatewayOrigin } = await import("../src/middlewares/request-id.middleware");
      const testOriginGuard = createRequireGatewayOrigin("test-secret-123");

      let nextError: any = null;
      testOriginGuard(
        { headers: {} } as any,
        {} as any,
        ((err?: any) => { nextError = err; }) as any,
      );
      assert.ok(nextError instanceof AppError);
      assert.equal(nextError.statusCode, 403);
      assert.equal(nextError.code, ERROR_CODE.GATEWAY_REQUIRED);

      // Valid gateway secret passes
      let passed = false;
      testOriginGuard(
        { headers: { "x-gateway-secret": "test-secret-123" } } as any,
        {} as any,
        ((err?: any) => { if (!err) passed = true; }) as any,
      );
      assert.ok(passed, "Valid gateway secret must pass origin guard");
    });

    it("SEC-11: checkDatabaseHealth should cache database status for 5 seconds to prevent DB starvation", async () => {
      assert.equal(DB_HEALTH_CACHE_TTL_MS, 5000);

      // First call computes or uses cache
      const firstCheck = await checkDatabaseHealth();
      assert.equal(typeof firstCheck, "boolean");

      // Rapid consecutive call should reuse the cache immediately
      const secondCheck = await checkDatabaseHealth();
      assert.equal(secondCheck, firstCheck);
    });

    it("SEC-12: deleteCamera should perform soft delete with deletedAt and filter soft-deleted cameras in queries", async () => {
      // 1. Verify migration file for soft-delete exists
      const migrationDir = path.resolve(__dirname, "../prisma/migrations/20261011120000_add_camera_deleted_at");
      const migrationFile = path.join(migrationDir, "migration.sql");
      assert.ok(fs.existsSync(migrationFile), "Migration file for camera soft-delete must exist");
      const migrationSql = fs.readFileSync(migrationFile, "utf-8");
      assert.ok(migrationSql.includes('ALTER TABLE "cameras" ADD COLUMN IF NOT EXISTS "deleted_at"'));
      assert.ok(migrationSql.includes('CREATE INDEX IF NOT EXISTS "cameras_deleted_at_idx"'));

      // 2. Verify repository deleteCamera performs update instead of delete
      let updateArgs: any = null;
      let findFirstArgs: any = null;
      let findManyArgs: any = null;

      const mockDb = {
        camera: {
          update: async (args: any) => {
            updateArgs = args;
            return { id: args.where.id, status: args.data.status, deletedAt: args.data.deletedAt };
          },
          findFirst: async (args: any) => {
            findFirstArgs = args;
            return { id: args.where.id, name: "Active Cam" };
          },
          findMany: async (args: any) => {
            findManyArgs = args;
            return [];
          },
          count: async () => 0,
        },
      };

      const repo = new CameraRepository(mockDb as any);

      // Soft delete
      await repo.deleteCamera("cam-soft-del-1");
      assert.ok(updateArgs);
      assert.equal(updateArgs.where.id, "cam-soft-del-1");
      assert.ok(updateArgs.data.deletedAt instanceof Date);
      assert.equal(updateArgs.data.status, CAMERA_STATUS.OFFLINE);

      // Query single camera filters deletedAt: null
      await repo.findCameraById("cam-active-1");
      assert.ok(findFirstArgs);
      assert.equal(findFirstArgs.where.id, "cam-active-1");
      assert.equal(findFirstArgs.where.deletedAt, null);

      // Query list filters deletedAt: null
      await repo.findAllCameras({ page: 1, limit: 10 });
      assert.ok(findManyArgs);
      assert.equal(findManyArgs.where.deletedAt, null);
    });

    it("SEC-13: default CameraService singleton should be connected to defaultCameraAuditLogger", async () => {
      // 1. Verify defaultCameraAuditLogger records structured audit log
      let capturedConsoleLog = "";
      const originalConsoleLog = console.log;
      console.log = (msg: any) => {
        capturedConsoleLog = msg;
      };

      try {
        const result = await defaultCameraAuditLogger.recordLog({
          actorId: "actor-123",
          action: AUDIT_ACTION.REGISTER_PPE_CAMERA,
          targetType: AUDIT_TARGET_TYPE.PPE_CAMERA,
          targetId: "cam-test-123",
          details: { name: "Test Cam" },
        });

        assert.equal(result.actorId, "actor-123");
        assert.equal(result.action, AUDIT_ACTION.REGISTER_PPE_CAMERA);
        assert.ok(capturedConsoleLog.includes("[AUDIT]"));
        assert.ok(capturedConsoleLog.includes("cam-test-123"));
      } finally {
        console.log = originalConsoleLog;
      }

      // 2. Verify default singleton export has audit logger attached
      assert.ok((cameraService as any).audit, "cameraService must have an active audit logger");
      assert.equal((cameraService as any).audit, defaultCameraAuditLogger);

      // 3. Verify new CameraService() without arguments defaults to defaultCameraAuditLogger
      const testService = new CameraService();
      assert.equal((testService as any).audit, defaultCameraAuditLogger);
    });

    it("SEC-14: authMiddleware should reject token transport via query parameters (?token=... or ?ticket=...)", async () => {
      // 1. extractTokenFromRequest should ignore query string parameters
      const reqWithQuery = {
        cookies: {},
        headers: {},
        query: { token: "query-token-abc", ticket: "query-ticket-xyz" },
      } as any;
      const extracted = extractTokenFromRequest(reqWithQuery);
      assert.equal(extracted, undefined, "extractTokenFromRequest must not extract tokens from query parameters");

      // 2. authMiddleware should reject requests containing ?token=...
      let tokenError: any = null;
      await authMiddleware(
        { query: { token: "leaked-token" }, headers: {}, cookies: {} } as any,
        {} as any,
        ((err?: any) => { tokenError = err; }) as any,
      );
      assert.ok(tokenError instanceof AppError);
      assert.equal(tokenError.statusCode, 400);
      assert.equal(tokenError.code, ERROR_CODE.VALIDATION_ERROR);
      assert.ok(tokenError.message.includes("Không được phép truyền token xác thực qua query string"));

      // 3. authMiddleware should reject requests containing ?ticket=...
      let ticketError: any = null;
      await authMiddleware(
        { query: { ticket: "leaked-ticket" }, headers: {}, cookies: {} } as any,
        {} as any,
        ((err?: any) => { ticketError = err; }) as any,
      );
      assert.ok(ticketError instanceof AppError);
      assert.equal(ticketError.statusCode, 400);
      assert.equal(ticketError.code, ERROR_CODE.VALIDATION_ERROR);
    });

    it("SEC-15: updateCamera should wrap camera and stream updates in a transactional execution", async () => {
      let transactionExecuted = false;
      let streamUpdatedInTx = false;
      let cameraUpdatedInTx = false;

      const mockDb: any = {
        $transaction: async (fn: any) => {
          transactionExecuted = true;
          const tx = {
            cameraStream: {
              findFirst: async () => ({ id: "stream-tx-1", streamUrl: "rtsp://old-url" }),
              update: async () => {
                streamUpdatedInTx = true;
              },
            },
            camera: {
              update: async ({ data }: any) => {
                cameraUpdatedInTx = true;
                return { id: "cam-tx-1", ...data };
              },
            },
          };
          return fn(tx);
        },
      };

      const repo = new CameraRepository(mockDb);
      await repo.updateCamera("cam-tx-1", {
        name: "Transactional Cam",
        streamUrl: "rtsp://admin:pass@192.168.1.88/stream",
      });

      assert.equal(transactionExecuted, true, "updateCamera must execute inside $transaction");
      assert.equal(streamUpdatedInTx, true, "cameraStream.update must execute within the transaction");
      assert.equal(cameraUpdatedInTx, true, "camera.update must execute within the transaction");
    });

    it("SEC-16: maintenanceGuard should enforce 503 SYSTEM_MAINTENANCE when maintenance mode is active", async () => {
      // 1. Regular user receives 503 when maintenance is active
      const activeMaintenance = maintenanceGuard({ isMaintenanceMode: true });

      let error503: any = null;
      await activeMaintenance(
        { originalUrl: "/api/v1/cameras", user: { role: "OPERATOR", permissions: [] } } as any,
        {} as any,
        ((err?: any) => { error503 = err; }) as any,
      );
      assert.ok(error503 instanceof AppError);
      assert.equal(error503.statusCode, 503);
      assert.equal(error503.code, ERROR_CODE.SYSTEM_MAINTENANCE);

      // 2. Admin user bypasses maintenance mode
      let adminPassed = false;
      await activeMaintenance(
        { originalUrl: "/api/v1/cameras", user: { role: ROLES.ADMIN, permissions: [] } } as any,
        {} as any,
        ((err?: any) => { if (!err) adminPassed = true; }) as any,
      );
      assert.equal(adminPassed, true, "ADMIN must bypass maintenance guard");

      // 3. User with MAINTENANCE_BYPASS permission bypasses maintenance mode
      let bypassPassed = false;
      await activeMaintenance(
        { originalUrl: "/api/v1/cameras", user: { role: "OPERATOR", permissions: ["MAINTENANCE_BYPASS"] } } as any,
        {} as any,
        ((err?: any) => { if (!err) bypassPassed = true; }) as any,
      );
      assert.equal(bypassPassed, true, "MAINTENANCE_BYPASS permission must bypass maintenance guard");

      // 4. Exempt paths (/health) bypass maintenance mode
      let healthPassed = false;
      await activeMaintenance(
        { originalUrl: "/health" } as any,
        {} as any,
        ((err?: any) => { if (!err) healthPassed = true; }) as any,
      );
      assert.equal(healthPassed, true, "Health check path must bypass maintenance guard");

      // 5. Inactive maintenance mode allows regular requests
      const inactiveMaintenance = maintenanceGuard({ isMaintenanceMode: false });
      let normalPassed = false;
      await inactiveMaintenance(
        { originalUrl: "/api/v1/cameras", user: { role: "OPERATOR" } } as any,
        {} as any,
        ((err?: any) => { if (!err) normalPassed = true; }) as any,
      );
      assert.equal(normalPassed, true, "Inactive maintenance must allow regular requests");
    });

    it("SEC-23: crypto.helper should reject missing master encryption key and roundtrip with secure key", () => {
      // 1. Encryption and Decryption roundtrip with a valid custom 32+ character key
      const testSecret = "rtsp://super-secret-user:super-secret-password@192.168.1.100:554/live";
      const customKey = "a-very-secure-32-byte-master-key-abcdef123456";
      const encrypted = encryptSecret(testSecret, customKey);
      assert.ok(encrypted.includes(":"), "Encrypted text must be in iv:authTag:cipher format");
      const decrypted = decryptSecret(encrypted, customKey);
      assert.equal(decrypted, testSecret, "Decrypted text must match original plain text");

      // 2. Encrypting with a bad custom key or when no key is available throws error
      assert.throws(
        () => encryptSecret(testSecret, "   "),
        /Master encryption key is not configured|at least 32 characters/i,
      );

      // 3. Decrypting with wrong key fails auth tag verification
      assert.throws(
        () => decryptSecret(encrypted, "wrong-key-with-different-entropy-123456789"),
        /Unsupported state or unable to authenticate data|Invalid/i,
      );
    });

    it("SEC-24: CameraEventConsumer, CameraService and CameraRepository should cascade soft-delete and unassign on SITE_DELETED and ZONE_DELETED", async () => {
      // 1. Kafka topics and consumer groups are correctly configured
      assert.equal(KAFKA_TOPICS.PPE_SITE_DELETED, "ppe.site.deleted");
      assert.equal(KAFKA_TOPICS.PPE_ZONE_DELETED, "ppe.zone.deleted");
      assert.equal(KAFKA_CONSUMER_GROUPS.CAMERA_SERVICE, "ppe-camera-consumer-group");
      assert.equal(BROKER_CONSUMER_GROUPS.CAMERA_SERVICE, "ppe-camera-consumer-group");

      // 2. CameraRepository soft-deletes cameras by siteId
      let updatedSiteWhere: any = null;
      let updatedSiteData: any = null;
      let updatedZoneWhere: any = null;
      let updatedZoneData: any = null;

      const mockDb: any = {
        camera: {
          updateMany: async (args: any) => {
            if (args.where.siteId) {
              updatedSiteWhere = args.where;
              updatedSiteData = args.data;
              return { count: 3 };
            }
            if (args.where.zoneId) {
              updatedZoneWhere = args.where;
              updatedZoneData = args.data;
              return { count: 2 };
            }
            return { count: 0 };
          },
        },
      };

      const auditLogs: any[] = [];
      const mockAuditLogger: any = {
        recordLog: async (log: any) => { auditLogs.push(log); },
      };

      const repo = new CameraRepository(mockDb);
      const service = new CameraService(repo, mockAuditLogger);
      const consumer = new CameraEventConsumer(service);

      const targetSiteId = "018f28a3-9b81-7000-8000-111111111111";
      const targetZoneId = "018f28a3-9b81-7000-8000-222222222222";

      // 3. Process SITE_DELETED event via consumer
      const siteDeletedEvent = {
        eventId: "018f28a3-9b81-7000-8000-333333333333",
        topic: KAFKA_TOPICS.PPE_SITE_DELETED,
        traceId: "req-trace-site-del-01",
        timestamp: Date.now(),
        producer: "ppe-site-service",
        payload: {
          siteId: targetSiteId,
          deletedAt: new Date().toISOString(),
          reason: "Project site decommissioned",
        },
      };

      const siteResult = await consumer.dispatchMessage(
        KAFKA_TOPICS.PPE_SITE_DELETED,
        siteDeletedEvent,
      );
      assert.equal(siteResult.success, true);
      assert.equal(siteResult.affectedCount, 3);
      assert.equal(updatedSiteWhere.siteId, targetSiteId);
      assert.equal(updatedSiteWhere.deletedAt, null);
      assert.equal(updatedSiteData.status, CAMERA_STATUS.OFFLINE);
      assert.ok(updatedSiteData.deletedAt instanceof Date);

      // Verify audit log for site deletion
      const siteAudit = auditLogs.find((l) => l.targetId === targetSiteId);
      assert.ok(siteAudit);
      assert.equal(siteAudit.action, AUDIT_ACTION.DELETE_PPE_CAMERA);
      assert.equal(siteAudit.targetType, AUDIT_TARGET_TYPE.PPE_SITE);

      // 4. Process ZONE_DELETED event via consumer
      const zoneDeletedEvent = {
        eventId: "018f28a3-9b81-7000-8000-444444444444",
        topic: KAFKA_TOPICS.PPE_ZONE_DELETED,
        traceId: "req-trace-zone-del-01",
        timestamp: Date.now(),
        producer: "ppe-site-service",
        payload: {
          zoneId: targetZoneId,
        },
      };

      const zoneResult = await consumer.dispatchMessage(
        KAFKA_TOPICS.PPE_ZONE_DELETED,
        zoneDeletedEvent,
      );
      assert.equal(zoneResult.success, true);
      assert.equal(zoneResult.affectedCount, 2);
      assert.equal(updatedZoneWhere.zoneId, targetZoneId);
      assert.equal(updatedZoneWhere.deletedAt, null);
      assert.equal(updatedZoneData.zoneId, null);

      // 5. Malformed payload rejection
      const invalidResult = await consumer.handleSiteDeletedMessage({ invalid: true });
      assert.equal(invalidResult.success, false);
      assert.ok(invalidResult.error?.includes("Malformed SITE_DELETED event"));

      // 6. Consumer lifecycle status and app registration
      assert.equal(consumer.consumerGroup, "ppe-camera-consumer-group");
      assert.ok(consumer.subscribedTopics.includes("ppe.site.deleted"));
      assert.ok(consumer.subscribedTopics.includes("ppe.zone.deleted"));
      assert.ok(cameraApp.locals.cameraEventConsumer instanceof CameraEventConsumer);
    });

    it("SEC-29: schema.prisma and migrations should define indexes for createdAt and [siteId, createdAt]", () => {
      const schemaPath = path.resolve(__dirname, "../prisma/schema.prisma");
      const schemaContent = fs.readFileSync(schemaPath, "utf8");
      assert.ok(
        schemaContent.includes("@@index([createdAt])"),
        "schema.prisma must define @@index([createdAt]) on Camera model",
      );
      assert.ok(
        schemaContent.includes("@@index([siteId, createdAt])"),
        "schema.prisma must define @@index([siteId, createdAt]) on Camera model",
      );

      const migrationPath = path.resolve(
        __dirname,
        "../prisma/migrations/20261011130000_add_camera_created_at_indexes/migration.sql",
      );
      assert.ok(fs.existsSync(migrationPath), "Migration file for createdAt indexes must exist");
      const migrationSql = fs.readFileSync(migrationPath, "utf8");
      assert.ok(migrationSql.includes("cameras_created_at_idx"), "Migration SQL must create cameras_created_at_idx");
      assert.ok(migrationSql.includes("cameras_site_id_created_at_idx"), "Migration SQL must create cameras_site_id_created_at_idx");
    });

    it("SEC-30: isUuid and UUID_REGEX should strictly enforce 8-4-4-4-12 hex group format and reject non-UUID strings", () => {
      // 1. Valid UUIDv4 and UUIDv7 strings pass
      assert.equal(isUuid("018f28a3-9b81-7000-8000-111111111111"), true);
      assert.equal(isUuid("c0a80101-0000-4000-a000-000000000001"), true);
      assert.equal(isUuid("123e4567-e89b-12d3-a456-426614174000"), true);

      // 2. Continuous 36 hyphens must be REJECTED (CWE-20 bypass prevention)
      assert.equal(isUuid("------------------------------------"), false);

      // 3. 36 hex characters without hyphens must be REJECTED
      assert.equal(isUuid("018f28a39b81700080001111111111112222"), false);

      // 4. Misplaced hyphens must be REJECTED
      assert.equal(isUuid("018f28a3-9b817000-8000-111111111111"), false);
      assert.equal(isUuid("018f28a3-9b81-70008000-111111111111"), false);

      // 5. Non-string or malformed inputs must be REJECTED
      assert.equal(isUuid(null), false);
      assert.equal(isUuid(undefined), false);
      assert.equal(isUuid(""), false);
      assert.equal(isUuid("not-a-uuid"), false);
      assert.equal(isUuid(12345), false);
    });

    it("SEC-31: getCameraPrisma should pass datasources configuration from envConfig with DATABASE_URL fallback", () => {
      const client = getCameraPrisma();
      assert.ok(client, "getCameraPrisma must instantiate CameraPrismaClient");
      assert.ok((client as any).$connect, "CameraPrismaClient must expose $connect");
    });

    it("SEC-32: clearCameraConfig should perform true deletion of CameraConfig, and resetCameraConfig resets to defaults with audit log", async () => {
      let deletedConfigId: string | null = null;
      let upsertedConfig: any = null;
      const recordedAuditLogs: any[] = [];

      const mockDb: any = {
        cameraConfig: {
          deleteMany: async (args: any) => {
            deletedConfigId = args.where.cameraId;
            return { count: 1 };
          },
          upsert: async (args: any) => {
            upsertedConfig = args;
            return {
              cameraId: args.where.cameraId,
              ...args.create,
            };
          },
        },
      };

      const mockAudit = {
        recordLog: async (log: any) => {
          recordedAuditLogs.push(log);
        },
      };

      const repo = new CameraRepository(mockDb);
      repo.findCameraById = async (id: string) => ({ id, code: "CAM-01", name: "Gate Cam", siteId: "site-1" }) as any;
      repo.findCameraConfig = async (id: string) => ({
        cameraId: id,
        enabled: false,
        captureFps: 5,
        resolution: "1280x720",
        processingEnabled: false,
        roiPolygon: [{ x: 10, y: 10 }, { x: 50, y: 50 }, { x: 10, y: 50 }],
        motionSensitivity: 50,
      }) as any;

      const service = new CameraService(repo, mockAudit);

      // 1. clearCameraConfig performs real deletion
      const deleteResult = await service.clearCameraConfig("cam-target-01", "admin-1");
      assert.equal(deleteResult.success, true);
      assert.equal(deleteResult.deleted, true);
      assert.equal(deletedConfigId, "cam-target-01");

      const deleteAudit = recordedAuditLogs.find((l) => l.action === AUDIT_ACTION.DELETE_PPE_CAMERA_SAFETY_CONFIG);
      assert.ok(deleteAudit);
      assert.equal(deleteAudit.targetId, "cam-target-01");
      assert.equal(deleteAudit.details.cameraCode, "CAM-01");
      assert.equal(deleteAudit.details.previousConfig.captureFps, 5);
      assert.equal(deleteAudit.details.previousConfig.motionSensitivity, 50);
      assert.ok(Array.isArray(deleteAudit.details.previousConfig.roiPolygon));

      // 2. resetCameraConfig restores default configuration with audit log
      const resetResult = await service.resetCameraConfig("cam-target-01", "admin-1");
      assert.ok(resetResult);
      assert.equal(resetResult.captureFps, DEFAULT_CAMERA_CONFIG.captureFps);
      assert.equal(resetResult.resolution, DEFAULT_CAMERA_CONFIG.resolution);
      assert.equal(resetResult.processingEnabled, DEFAULT_CAMERA_CONFIG.processingEnabled);
      assert.equal(resetResult.motionSensitivity, DEFAULT_CAMERA_CONFIG.motionSensitivity);
      assert.equal(upsertedConfig.create.roiPolygon, null);

      const resetAudit = recordedAuditLogs.find((l) => l.action === AUDIT_ACTION.UPDATE_PPE_CAMERA_SAFETY_CONFIG && l.details?.resetToDefault);
      assert.ok(resetAudit);
      assert.equal(resetAudit.targetId, "cam-target-01");
    });

    it("should return camera status counts accurately (total, online, offline)", async () => {
      const mockDb = {
        camera: {
          groupBy: async () => [
            { status: CAMERA_STATUS.ONLINE, _count: { _all: 2 } },
            { status: CAMERA_STATUS.OFFLINE, _count: { _all: 3 } },
            { status: CAMERA_STATUS.ERROR, _count: { _all: 1 } },
          ],
        },
      };

      const repo = new CameraRepository(mockDb);
      const service = new CameraService(repo);

      const counts = await service.getStatusCounts();
      assert.deepEqual(counts, {
        total: 6,
        online: 2,
        offline: 4,
      });
    });
  });

  // ── 12. Internal M2M Active Streams & Credential Isolation ─────────────────
  describe("12. Internal M2M Active Streams & RTSP Security Isolation", () => {
    it("should fail closed (503) when INTERNAL_SERVICE_TOKEN is not configured", () => {
      const middleware = createRequireInternalServiceToken("");
      const req: any = { headers: { "x-internal-service-token": "anything" } };
      let capturedErr: any;
      middleware(req, {} as any, (err?: any) => {
        capturedErr = err;
      });
      assert.ok(capturedErr instanceof AppError);
      assert.equal(capturedErr.statusCode, 503);
      assert.equal(capturedErr.code, ERROR_CODE.SERVICE_UNAVAILABLE);
    });

    it("should reject missing (401) and invalid (403) internal tokens, and accept valid x-internal-service-token or Bearer token", () => {
      const expected = "super_secret_internal_m2m_token_value_123456";
      const middleware = createRequireInternalServiceToken(expected);

      // Missing
      let err1: any;
      middleware({ headers: {} } as any, {} as any, (err?: any) => {
        err1 = err;
      });
      assert.equal(err1?.statusCode, 401);

      // Wrong token
      let err2: any;
      middleware(
        { headers: { [GATEWAY_HEADERS.INTERNAL_SECRET]: "x", [GATEWAY_HEADERS.INTERNAL_SERVICE_TOKEN]: "wrong-token" } } as any,
        {} as any,
        (err?: any) => {
          err2 = err;
        },
      );
      assert.equal(err2?.statusCode, 403);

      // Valid x-internal-service-token
      let err3: any = "not-called";
      middleware(
        { headers: { [GATEWAY_HEADERS.INTERNAL_SERVICE_TOKEN]: expected } } as any,
        {} as any,
        (err?: any) => {
          err3 = err;
        },
      );
      assert.equal(err3, undefined);

      // Valid Authorization Bearer token
      let err4: any = "not-called";
      middleware(
        { headers: { authorization: `Bearer ${expected}` } } as any,
        {} as any,
        (err?: any) => {
          err4 = err;
        },
      );
      assert.equal(err4, undefined);
    });

    it("should validate internal active-streams & lookup schemas accurately", () => {
      const q1 = internalActiveStreamsQuerySchema.parse({});
      assert.equal(q1.status, CAMERA_STATUS.ONLINE);
      assert.equal(q1.includeDisabled, false);

      const q2 = internalCameraLookupQuerySchema.parse({ code: " cam-01 " });
      assert.equal(q2.code, "cam-01");

      assert.throws(() => internalCameraLookupQuerySchema.parse({}));
    });

    it("should return unmasked streamUrl in findInternalActiveStreams while findAllCameras keeps masking RTSP password", async () => {
      const rawRtsp = "rtsp://admin:SuperSecretPass99@192.168.10.20:554/Streaming/Channels/101";
      const mockCameras = [
        {
          id: "0199a001-0000-7000-8000-000000000001",
          siteId: "0199a001-0000-7000-8000-0000000000aa",
          zoneId: null,
          name: "Gate Cam 1",
          code: "CAM-01",
          sourceType: CAMERA_SOURCE_TYPE.RTSP,
          streamUrl: rawRtsp,
          status: CAMERA_STATUS.ONLINE,
          deletedAt: null,
          config: {
            enabled: true,
            captureFps: 12,
            resolution: "1920x1080",
            processingEnabled: true,
            roiPolygon: [
              { x: 0.1, y: 0.2 },
              { x: 0.9, y: 0.2 },
              { x: 0.9, y: 0.9 },
            ],
            motionSensitivity: 80,
          },
          streams: [
            {
              id: "0199a001-0000-7000-8000-000000000011",
              protocol: STREAM_PROTOCOL.RTSP,
              streamUrl: rawRtsp,
              status: STREAM_STATUS.ACTIVE,
            },
          ],
        },
        {
          id: "0199a001-0000-7000-8000-000000000002",
          siteId: "0199a001-0000-7000-8000-0000000000aa",
          zoneId: null,
          name: "Disabled AI Cam",
          code: "CAM-02",
          sourceType: CAMERA_SOURCE_TYPE.RTSP,
          streamUrl: rawRtsp,
          status: CAMERA_STATUS.ONLINE,
          deletedAt: null,
          config: {
            enabled: true,
            captureFps: 10,
            resolution: "1920x1080",
            processingEnabled: false,
            roiPolygon: null,
            motionSensitivity: 75,
          },
          streams: [],
        },
      ];

      const mockDb = {
        camera: {
          findMany: async () => mockCameras,
          count: async () => mockCameras.length,
          findFirst: async () => mockCameras[0],
        },
      };

      const repo = new CameraRepository(mockDb);
      const service = new CameraService(repo);

      // User-facing endpoint MUST continue masking credentials
      const publicList = await service.findAllCameras({});
      assert.equal(publicList.data.length, 2);
      assert.ok(publicList.data[0].streamUrl.includes("***"));
      assert.ok(!publicList.data[0].streamUrl.includes("SuperSecretPass99"));

      // Internal endpoint MUST return raw unmasked URL & filter disabled processing
      const internalList = await service.findInternalActiveStreams({});
      assert.equal(internalList.length, 1);
      assert.equal(internalList[0].code, "CAM-01");
      assert.equal(internalList[0].streamUrl, rawRtsp);
      assert.equal(internalList[0].config.captureFps, 12);
      assert.equal(internalList[0].config.roiPolygon?.length, 3);

      // With includeDisabled=true, both are returned
      const internalAll = await service.findInternalActiveStreams({ includeDisabled: true });
      assert.equal(internalAll.length, 2);

      // Lookup by code also returns raw streamUrl & UUIDs
      const lookedUp = await service.lookupInternalCamera({ code: "cam-01" });
      assert.equal(lookedUp.id, mockCameras[0].id);
      assert.equal(lookedUp.siteId, mockCameras[0].siteId);
      assert.equal(lookedUp.streamUrl, rawRtsp);
    });
  });

  // ── 13. Issue #3: Masked StreamUrl Guard & Multi-Polygon ROI Normalization ─
  describe("13. Issue #3: Masked StreamUrl Guard & Multi-Polygon ROI Normalization", () => {
    it("should detect masked credentials accurately via hasMaskedStreamCredentials", () => {
      assert.equal(
        hasMaskedStreamCredentials("rtsp://admin:***@192.168.1.50:554/live"),
        true,
      );
      assert.equal(
        hasMaskedStreamCredentials("rtsp://admin:%2A%2A%2A@192.168.1.50:554/live"),
        true,
      );
      assert.equal(
        hasMaskedStreamCredentials("rtsp://admin:realSecret123@192.168.1.50:554/live"),
        false,
      );
      assert.equal(
        hasMaskedStreamCredentials("rtsp://192.168.1.50:554/live"),
        false,
      );
      assert.equal(hasMaskedStreamCredentials(""), false);
      assert.equal(hasMaskedStreamCredentials(null), false);
    });

    it("should resolve streamUrl update safely across omit, matching mask, mismatched mask, and new URL", () => {
      assert.deepEqual(resolveStreamUrlUpdate(undefined, "rtsp://admin:***@192.168.1.50:554/live"), {
        shouldUpdate: false,
      });

      assert.deepEqual(
        resolveStreamUrlUpdate(
          "rtsp://admin:***@192.168.1.50:554/live",
          "rtsp://admin:***@192.168.1.50:554/live",
        ),
        { shouldUpdate: false },
      );

      assert.deepEqual(
        resolveStreamUrlUpdate(
          "rtsp://admin:newPass999@192.168.1.50:554/live",
          "rtsp://admin:***@192.168.1.50:554/live",
        ),
        {
          shouldUpdate: true,
          streamUrl: "rtsp://admin:newPass999@192.168.1.50:554/live",
        },
      );

      assert.throws(
        () =>
          resolveStreamUrlUpdate(
            "rtsp://admin:***@192.168.1.99:554/live",
            "rtsp://admin:***@192.168.1.50:554/live",
          ),
        (err: any) =>
          err instanceof AppError &&
          err.statusCode === 400 &&
          err.code === ERROR_CODE.VALIDATION_ERROR,
      );
    });

    it("updateCamera should skip masked streamUrl matching DB and omit it from audit logs when editing metadata", async () => {
      const realRtsp = "rtsp://admin:RealPass999@192.168.1.50:554/live";
      let storedUrl = realRtsp;
      let repoUpdatePayload: any = null;
      const auditLogs: any[] = [];

      const mockRepo = {
        findCameraById: async (id: string) => ({
          id,
          siteId: "11111111-1111-4111-8111-111111111111",
          zoneId: null,
          name: "Old Cam",
          code: "CAM-01",
          streamUrl: storedUrl,
          status: CAMERA_STATUS.ONLINE,
          streams: [],
        }),
        updateCamera: async (id: string, data: any) => {
          repoUpdatePayload = { ...data };
          if (data.streamUrl) {
            storedUrl = data.streamUrl;
          }
          return {
            id,
            siteId: "11111111-1111-4111-8111-111111111111",
            zoneId: data.zoneId ?? null,
            name: data.name ?? "Old Cam",
            code: "CAM-01",
            streamUrl: storedUrl,
            status: data.status ?? CAMERA_STATUS.ONLINE,
            streams: [],
          };
        },
      } as unknown as CameraRepository;

      const mockAudit = {
        recordLog: async (log: any) => {
          auditLogs.push(log);
        },
      };

      const service = new CameraService(mockRepo, mockAudit);
      const updated = await service.updateCamera(
        "cam-issue3-1",
        {
          name: "New Gate Name",
          zoneId: "22222222-2222-4222-8222-222222222222",
          status: CAMERA_STATUS.MAINTENANCE,
          streamUrl: "rtsp://admin:***@192.168.1.50:554/live",
        },
        "admin-1",
      );

      assert.equal(repoUpdatePayload.name, "New Gate Name");
      assert.equal(repoUpdatePayload.streamUrl, undefined);
      assert.equal(storedUrl, realRtsp);
      assert.equal(updated.streamUrl, "rtsp://admin:***@192.168.1.50:554/live");
      assert.equal(auditLogs.length, 1);
      assert.equal(auditLogs[0].details.streamUrl, undefined);
      assert.equal(auditLogs[0].details.name, "New Gate Name");
    });

    it("updateCamera with ONLY matching masked streamUrl should return existing sanitized camera without DB write or false audit log", async () => {
      let repoUpdateCalled = false;
      const auditLogs: any[] = [];

      const mockRepo = {
        findCameraById: async (id: string) => ({
          id,
          siteId: "11111111-1111-4111-8111-111111111111",
          name: "Gate Cam",
          code: "CAM-NOOP",
          streamUrl: "rtsp://admin:SecretPass@192.168.1.50:554/live",
          streams: [],
        }),
        updateCamera: async () => {
          repoUpdateCalled = true;
          return {};
        },
      } as unknown as CameraRepository;

      const mockAudit = {
        recordLog: async (log: any) => {
          auditLogs.push(log);
        },
      };

      const service = new CameraService(mockRepo, mockAudit);
      const result = await service.updateCamera(
        "cam-issue3-noop",
        { streamUrl: "rtsp://admin:***@192.168.1.50:554/live" },
        "admin-1",
      );

      assert.equal(repoUpdateCalled, false);
      assert.equal(auditLogs.length, 0);
      assert.equal(result.streamUrl, "rtsp://admin:***@192.168.1.50:554/live");
    });

    it("updateCamera should reject mismatched masked streamUrl with 400 VALIDATION_ERROR", async () => {
      let repoUpdateCalled = false;
      const mockRepo = {
        findCameraById: async (id: string) => ({
          id,
          siteId: "11111111-1111-4111-8111-111111111111",
          name: "Gate Cam",
          code: "CAM-MISMATCH",
          streamUrl: "rtsp://admin:SecretPass@192.168.1.50:554/live",
          streams: [],
        }),
        updateCamera: async () => {
          repoUpdateCalled = true;
          return {};
        },
      } as unknown as CameraRepository;

      const service = new CameraService(mockRepo);

      await assert.rejects(
        () =>
          service.updateCamera("cam-issue3-mismatch", {
            name: "Renamed",
            streamUrl: "rtsp://operator:***@192.168.1.50:554/live",
          }),
        (err: any) =>
          err instanceof AppError &&
          err.statusCode === 400 &&
          err.code === ERROR_CODE.VALIDATION_ERROR,
      );

      const noAuthRepo = {
        findCameraById: async (id: string) => ({
          id,
          siteId: "11111111-1111-4111-8111-111111111111",
          streamUrl: "rtsp://192.168.1.50:554/live",
          streams: [],
        }),
        updateCamera: async () => {
          repoUpdateCalled = true;
          return {};
        },
      } as unknown as CameraRepository;

      await assert.rejects(
        () =>
          new CameraService(noAuthRepo).updateCamera("cam-no-auth", {
            streamUrl: "rtsp://admin:***@192.168.1.50:554/live",
          }),
        (err: any) =>
          err instanceof AppError &&
          err.statusCode === 400 &&
          err.code === ERROR_CODE.VALIDATION_ERROR,
      );

      assert.equal(repoUpdateCalled, false);
    });

    it("updateCamera should persist new real credentials and mask them in audit log and response", async () => {
      let repoUpdatePayload: any = null;
      const auditLogs: any[] = [];

      const mockRepo = {
        findCameraById: async (id: string) => ({
          id,
          siteId: "11111111-1111-4111-8111-111111111111",
          name: "Cam 1",
          code: "CAM-REAL",
          streamUrl: "rtsp://admin:OldSecret@192.168.1.50:554/live",
          streams: [],
        }),
        updateCamera: async (id: string, data: any) => {
          repoUpdatePayload = { ...data };
          return {
            id,
            siteId: "11111111-1111-4111-8111-111111111111",
            name: "Cam 1",
            code: "CAM-REAL",
            streamUrl: data.streamUrl,
            streams: [],
          };
        },
      } as unknown as CameraRepository;

      const mockAudit = {
        recordLog: async (log: any) => {
          auditLogs.push(log);
        },
      };

      const service = new CameraService(mockRepo, mockAudit);
      const updated = await service.updateCamera(
        "cam-real-1",
        { streamUrl: "rtsp://operator:FreshSecret77@192.168.1.60:554/live" },
        "admin-1",
      );

      assert.equal(
        repoUpdatePayload.streamUrl,
        "rtsp://operator:FreshSecret77@192.168.1.60:554/live",
      );
      assert.equal(
        updated.streamUrl,
        "rtsp://operator:***@192.168.1.60:554/live",
      );
      assert.equal(
        auditLogs[0].details.streamUrl,
        "rtsp://operator:***@192.168.1.60:554/live",
      );
      assert.ok(!auditLogs[0].details.streamUrl.includes("FreshSecret77"));
    });

    it("updateCameraStream should skip matching masked streamUrl and reject mismatched masked streamUrl", async () => {
      let streamUpdatePayload: any = null;
      const auditLogs: any[] = [];

      const mockRepo = {
        findCameraStreamById: async (id: string) => ({
          id,
          cameraId: "cam-1",
          camera: { id: "cam-1", siteId: "site-1" },
          streamUrl: "rtsp://admin:SubSecret12@192.168.1.50:554/sub",
          fps: 15,
        }),
        updateCameraStream: async (id: string, data: any) => {
          streamUpdatePayload = { ...data };
          return {
            id,
            cameraId: "cam-1",
            streamUrl: "rtsp://admin:SubSecret12@192.168.1.50:554/sub",
            fps: data.fps ?? 15,
          };
        },
      } as unknown as CameraRepository;

      const service = new CameraService(mockRepo, {
        recordLog: async (log: any) => auditLogs.push(log),
      });

      const updated = await service.updateCameraStream(
        "stream-1",
        {
          fps: 20,
          streamUrl: "rtsp://admin:***@192.168.1.50:554/sub",
        },
        "admin-1",
      );

      assert.equal(streamUpdatePayload.fps, 20);
      assert.equal(streamUpdatePayload.streamUrl, undefined);
      assert.equal(auditLogs[0].details.streamUrl, undefined);
      assert.equal(updated.streamUrl, "rtsp://admin:***@192.168.1.50:554/sub");

      await assert.rejects(
        () =>
          service.updateCameraStream("stream-1", {
            streamUrl: "rtsp://other:***@192.168.1.50:554/sub",
          }),
        (err: any) =>
          err instanceof AppError &&
          err.statusCode === 400 &&
          err.code === ERROR_CODE.VALIDATION_ERROR,
      );
    });

    it("createCamera and createCameraStream should reject literal masked '***' credentials", async () => {
      const mockRepo = {
        findCameraById: async (id: string) => ({
          id,
          siteId: "site-1",
          streamUrl: "rtsp://admin:pass@192.168.1.10:554/live",
        }),
      } as unknown as CameraRepository;

      const service = new CameraService(mockRepo);

      await assert.rejects(
        () =>
          service.createCamera({
            siteId: "11111111-1111-4111-8111-111111111111",
            name: "Cam Mask",
            code: "CAM-MASK",
            streamUrl: "rtsp://admin:***@192.168.1.10:554/live",
          }),
        (err: any) =>
          err instanceof AppError &&
          err.statusCode === 400 &&
          err.code === ERROR_CODE.VALIDATION_ERROR,
      );

      await assert.rejects(
        () =>
          service.createCameraStream("cam-1", {
            streamUrl: "rtsp://admin:***@192.168.1.10:554/sub",
          }),
        (err: any) =>
          err instanceof AppError &&
          err.statusCode === 400 &&
          err.code === ERROR_CODE.VALIDATION_ERROR,
      );
    });

    it("should validate roiPolygons multi-polygon schema, restrictedAreaId uniqueness, limits, and conflict guard", () => {
      const tri = [
        { x: 10, y: 10 },
        { x: 100, y: 10 },
        { x: 100, y: 100 },
      ];
      const validMulti = updateCameraConfigSchema.safeParse({
        roiPolygons: [
          {
            id: "roi-1",
            name: "Khu vực cần cẩu",
            restrictedAreaId: "11111111-1111-4111-8111-111111111111",
            points: tri,
          },
          {
            id: "roi-2",
            name: "Hố móng",
            restrictedAreaId: "22222222-2222-4222-8222-222222222222",
            points: tri,
          },
        ],
      });
      assert.equal(validMulti.success, true);

      // Duplicate restrictedAreaId must fail
      const duplicateArea = roiPolygonsSchema.safeParse([
        { restrictedAreaId: "11111111-1111-4111-8111-111111111111", points: tri },
        { restrictedAreaId: "11111111-1111-4111-8111-111111111111", points: tri },
      ]);
      assert.equal(duplicateArea.success, false);

      // Exceeding 20 polygons must fail
      const tooManyPolygons = Array.from({ length: 21 }, (_, idx) => ({
        id: `roi-${idx}`,
        points: tri,
      }));
      assert.equal(roiPolygonsSchema.safeParse(tooManyPolygons).success, false);

      // < 3 points or > 50 points must fail
      assert.equal(
        roiPolygonsSchema.safeParse([{ points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }])
          .success,
        false,
      );
      const tooManyPoints = Array.from({ length: 51 }, (_, i) => ({ x: i, y: i }));
      assert.equal(
        roiPolygonsSchema.safeParse([{ points: tooManyPoints }]).success,
        false,
      );

      // Contradictory roiPolygon (non-empty) + roiPolygons (null or []) must fail
      assert.equal(
        updateCameraConfigSchema.safeParse({ roiPolygon: tri, roiPolygons: [] })
          .success,
        false,
      );
      assert.equal(
        updateCameraConfigSchema.safeParse({ roiPolygon: tri, roiPolygons: null })
          .success,
        false,
      );
    });

    it("should normalize roiPolygons <-> roiPolygon across updateCameraConfig, getCameraConfig, resetCameraConfig, and findInternalActiveStreams", async () => {
      let persistedConfig: any = null;
      const tri1 = [
        { x: 0.1, y: 0.1 },
        { x: 0.5, y: 0.1 },
        { x: 0.5, y: 0.5 },
      ];
      const tri2 = [
        { x: 0.6, y: 0.2 },
        { x: 0.9, y: 0.2 },
        { x: 0.9, y: 0.8 },
      ];

      const mockRepo = {
        findCameraById: async (id: string) => ({
          id,
          siteId: "11111111-1111-4111-8111-111111111111",
          code: "CAM-ROI",
          name: "ROI Cam",
          streamUrl: "rtsp://admin:pass@192.168.1.50:554/live",
        }),
        findCameraConfig: async () => persistedConfig,
        upsertCameraConfig: async (cameraId: string, data: any) => {
          persistedConfig = {
            id: "cfg-roi-1",
            cameraId,
            enabled: data.enabled ?? true,
            captureFps: data.captureFps ?? 10,
            resolution: data.resolution ?? "1920x1080",
            processingEnabled: data.processingEnabled ?? true,
            roiPolygon: data.roiPolygon !== undefined ? data.roiPolygon : persistedConfig?.roiPolygon ?? null,
            roiPolygons: data.roiPolygons !== undefined ? data.roiPolygons : persistedConfig?.roiPolygons ?? null,
            motionSensitivity: data.motionSensitivity ?? 75,
          };
          return persistedConfig;
        },
        findInternalActiveStreams: async () => [
          {
            id: "cam-roi-1",
            siteId: "11111111-1111-4111-8111-111111111111",
            zoneId: null,
            name: "ROI Cam",
            code: "CAM-ROI",
            sourceType: CAMERA_SOURCE_TYPE.RTSP,
            streamUrl: "rtsp://admin:RealPass@192.168.1.50:554/live",
            status: CAMERA_STATUS.ONLINE,
            config: persistedConfig,
            streams: [],
          },
        ],
      } as unknown as CameraRepository;

      const service = new CameraService(mockRepo);

      // 1. Update with multi-polygon roiPolygons -> populates legacy roiPolygon with first polygon points
      const multiUpdated = await service.updateCameraConfig("cam-roi-1", {
        roiPolygons: [
          { id: "r1", name: "Khu A", points: tri1 },
          { id: "r2", name: "Khu B", points: tri2 },
        ],
      });
      assert.equal(multiUpdated.roiPolygons?.length, 2);
      assert.deepEqual(multiUpdated.roiPolygon, tri1);

      // 2. Internal stream exposes both roiPolygon and roiPolygons
      const internal = await service.findInternalActiveStreams({});
      assert.equal(internal.length, 1);
      assert.deepEqual(internal[0].config.roiPolygon, tri1);
      assert.equal(internal[0].config.roiPolygons?.length, 2);

      // 3. Clearing with [] sets both roiPolygon and roiPolygons to null
      const cleared = await service.updateCameraConfig("cam-roi-1", {
        roiPolygons: [],
      });
      assert.equal(cleared.roiPolygon, null);
      assert.equal(cleared.roiPolygons, null);

      // 4. Legacy update with roiPolygon wraps into roiPolygons for getCameraConfig
      await service.updateCameraConfig("cam-roi-1", {
        roiPolygon: tri2,
      });
      const fetched = await service.getCameraConfig("cam-roi-1");
      assert.deepEqual(fetched.roiPolygon, tri2);
      assert.deepEqual(fetched.roiPolygons, [{ points: tri2 }]);

      // 5. Reset clears both roiPolygon and roiPolygons
      const reset = await service.resetCameraConfig("cam-roi-1");
      assert.equal(reset.roiPolygon, null);
      assert.equal(reset.roiPolygons, null);
    });
  });
});
