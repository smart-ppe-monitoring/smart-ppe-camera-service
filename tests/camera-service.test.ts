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
  });
});
