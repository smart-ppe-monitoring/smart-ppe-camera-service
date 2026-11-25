import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type http from "node:http";
import type { AddressInfo } from "node:net";
import jwt from "jsonwebtoken";
import cameraApp from "../src/camera.app";
import { cameraCountsBySiteQuerySchema } from "../src/modules/camera/camera.validation";
import { CameraRepository } from "../src/modules/camera/camera.repository";
import { CameraService } from "../src/modules/camera/camera.service";
import { cameraRouter } from "../src/modules/camera/camera.route";
import { buildOpenApiSpec } from "../src/config/openapi/openapi.registry";
import { cameraPrisma } from "../src/database/camera.client";
import { jwtConfig } from "../src/config/jwt.config";
import { envConfig } from "../src/config/env.config";
import { CAMERA_STATUS } from "../src/common/constants/camera.constant";
import { ROLES } from "../src/common/constants/role.constant";
import { PERMISSIONS } from "../src/common/constants/permission.constant";
import { ERROR_CODE } from "../src/common/errors/error-code";
import { GATEWAY_HEADERS } from "../src/common/constants/gateway.constant";
import { JWT_ALGORITHM, JWT_PURPOSE } from "../src/common/constants/jwt.constant";
import { AppError } from "../src/common/errors/app-error";

describe("Issue #4: GET /api/v1/cameras/counts-by-site", () => {
  const site1 = "11111111-1111-4111-8111-111111111111";
  const site2 = "22222222-2222-4222-8222-222222222222";
  const site3 = "33333333-3333-4333-8333-333333333333";

  describe("1. Validation Schema (cameraCountsBySiteQuerySchema)", () => {
    it("should accept empty query or empty string as undefined siteIds", () => {
      assert.strictEqual(
        cameraCountsBySiteQuerySchema.parse({}).siteIds,
        undefined,
      );
      assert.strictEqual(
        cameraCountsBySiteQuerySchema.parse({ siteIds: "" }).siteIds,
        undefined,
      );
      assert.strictEqual(
        cameraCountsBySiteQuerySchema.parse({ siteIds: "  ,  " }).siteIds,
        undefined,
      );
    });

    it("should parse single UUID, comma-separated UUIDs, and repeated query array with deduplication", () => {
      assert.deepStrictEqual(
        cameraCountsBySiteQuerySchema.parse({ siteIds: site1 }),
        { siteIds: [site1] },
      );
      assert.deepStrictEqual(
        cameraCountsBySiteQuerySchema.parse({
          siteIds: ` ${site1} , ${site2}, ${site1} `,
        }),
        { siteIds: [site1, site2] },
      );
      assert.deepStrictEqual(
        cameraCountsBySiteQuerySchema.parse({
          siteIds: [site1, `${site2},${site1}`],
        }),
        { siteIds: [site1, site2] },
      );
    });

    it("should reject invalid UUIDs and lists exceeding 100 siteIds", () => {
      assert.throws(() =>
        cameraCountsBySiteQuerySchema.parse({ siteIds: "not-a-uuid" }),
      );
      assert.throws(() =>
        cameraCountsBySiteQuerySchema.parse({
          siteIds: `${site1},invalid-uuid`,
        }),
      );
      assert.throws(() =>
        cameraCountsBySiteQuerySchema.parse({
          siteIds: [site1, "bad-uuid"],
        }),
      );

      const tooMany = Array.from({ length: 101 }, () => crypto.randomUUID());
      assert.throws(() =>
        cameraCountsBySiteQuerySchema.parse({ siteIds: tooMany }),
      );
    });
  });

  describe("2. CameraRepository.getCountsBySite", () => {
    it("should execute a single groupBy query and aggregate online, offline, error, and total per site sorted by siteId", async () => {
      let capturedArgs: any = null;
      let groupByCallCount = 0;

      const mockDb = {
        camera: {
          groupBy: async (args: any) => {
            groupByCallCount += 1;
            capturedArgs = args;
            return [
              { siteId: site2, status: CAMERA_STATUS.ONLINE, _count: { _all: 3 } },
              { siteId: site1, status: CAMERA_STATUS.ONLINE, _count: { _all: 2 } },
              { siteId: site1, status: CAMERA_STATUS.OFFLINE, _count: { _all: 1 } },
              { siteId: site1, status: CAMERA_STATUS.ERROR, _count: { _all: 2 } },
              { siteId: site1, status: CAMERA_STATUS.CONNECTING, _count: { _all: 1 } },
              { siteId: site1, status: CAMERA_STATUS.MAINTENANCE, _count: { _all: 1 } },
            ];
          },
        },
      };

      const repo = new CameraRepository(mockDb);
      const result = await repo.getCountsBySite({ siteIds: [site2, site1] });

      assert.strictEqual(groupByCallCount, 1);
      assert.deepStrictEqual(capturedArgs.by, ["siteId", "status"]);
      assert.deepStrictEqual(capturedArgs.where, {
        deletedAt: null,
        siteId: { in: [site2, site1] },
      });
      assert.deepStrictEqual(capturedArgs._count, { _all: true });

      assert.deepStrictEqual(result, [
        {
          siteId: site1,
          total: 7,
          online: 2,
          offline: 3, // OFFLINE(1) + CONNECTING(1) + MAINTENANCE(1)
          error: 2,
        },
        {
          siteId: site2,
          total: 3,
          online: 3,
          offline: 0,
          error: 0,
        },
      ]);

      for (const item of result) {
        assert.strictEqual(item.online + item.offline + item.error, item.total);
      }
    });

    it("should return empty array when no cameras match", async () => {
      const mockDb = {
        camera: {
          groupBy: async (args: any) => {
            assert.deepStrictEqual(args.where, { deletedAt: null });
            return [];
          },
        },
      };

      const repo = new CameraRepository(mockDb);
      const result = await repo.getCountsBySite();
      assert.deepStrictEqual(result, []);
    });
  });

  describe("3. CameraService.getCountsBySite Site Tenancy Scoping", () => {
    it("should allow ADMIN unrestricted access and pass optional requested siteIds", async () => {
      const capturedFilters: any[] = [];
      const mockRepo = {
        getCountsBySite: async (filter?: any) => {
          capturedFilters.push(filter);
          return [{ siteId: site1, total: 2, online: 2, offline: 0, error: 0 }];
        },
      } as unknown as CameraRepository;

      const service = new CameraService(mockRepo);
      const adminUser = { id: "admin-1", role: ROLES.ADMIN, siteIds: [site1] };

      const allRes = await service.getCountsBySite(undefined, adminUser);
      assert.strictEqual(allRes.length, 1);
      assert.strictEqual(capturedFilters[0], undefined);

      await service.getCountsBySite([site1, site2, site1], adminUser);
      assert.deepStrictEqual(capturedFilters[1], { siteIds: [site1, site2] });
    });

    it("should scope non-ADMIN without query filter strictly to JWT allowed siteIds", async () => {
      let capturedFilter: any = null;
      const mockRepo = {
        getCountsBySite: async (filter?: any) => {
          capturedFilter = filter;
          return [
            { siteId: site1, total: 1, online: 1, offline: 0, error: 0 },
            { siteId: site2, total: 2, online: 1, offline: 1, error: 0 },
          ];
        },
      } as unknown as CameraRepository;

      const service = new CameraService(mockRepo);
      const managerUser = {
        id: "mgr-1",
        role: ROLES.SAFETY_MANAGER,
        siteId: site1,
        siteIds: [site1, site2],
      };

      const res = await service.getCountsBySite(undefined, managerUser);
      assert.strictEqual(res.length, 2);
      assert.deepStrictEqual(capturedFilter, { siteIds: [site1, site2] });
    });

    it("should allow non-ADMIN requesting an authorized subset of siteIds", async () => {
      let capturedFilter: any = null;
      const mockRepo = {
        getCountsBySite: async (filter?: any) => {
          capturedFilter = filter;
          return [{ siteId: site2, total: 2, online: 1, offline: 1, error: 0 }];
        },
      } as unknown as CameraRepository;

      const service = new CameraService(mockRepo);
      const officerUser = {
        id: "off-1",
        role: ROLES.SAFETY_OFFICER,
        siteIds: [site1, site2],
      };

      const res = await service.getCountsBySite([site2], officerUser);
      assert.strictEqual(res.length, 1);
      assert.deepStrictEqual(capturedFilter, { siteIds: [site2] });
    });

    it("should reject non-ADMIN requesting any unauthorized siteId with 403 FORBIDDEN without querying DB", async () => {
      let repoCalled = false;
      const mockRepo = {
        getCountsBySite: async () => {
          repoCalled = true;
          return [];
        },
      } as unknown as CameraRepository;

      const service = new CameraService(mockRepo);
      const officerUser = {
        id: "off-1",
        role: ROLES.SAFETY_OFFICER,
        siteIds: [site1],
      };

      await assert.rejects(
        () => service.getCountsBySite([site1, site3], officerUser),
        (err: any) => {
          assert.ok(err instanceof AppError);
          assert.strictEqual(err.statusCode, 403);
          assert.strictEqual(err.code, ERROR_CODE.FORBIDDEN);
          return true;
        },
      );
      assert.strictEqual(repoCalled, false);
    });

    it("should handle unassigned non-ADMIN user safely (empty [] when omitted, 403 when explicit siteIds)", async () => {
      let repoCalled = false;
      const mockRepo = {
        getCountsBySite: async () => {
          repoCalled = true;
          return [];
        },
      } as unknown as CameraRepository;

      const service = new CameraService(mockRepo);
      const unassignedUser = {
        id: "off-2",
        role: ROLES.SAFETY_OFFICER,
        siteIds: [],
      };

      const emptyRes = await service.getCountsBySite(undefined, unassignedUser);
      assert.deepStrictEqual(emptyRes, []);
      assert.strictEqual(repoCalled, false);

      await assert.rejects(
        () => service.getCountsBySite([site1], unassignedUser),
        (err: any) => {
          assert.ok(err instanceof AppError);
          assert.strictEqual(err.statusCode, 403);
          assert.strictEqual(err.code, ERROR_CODE.FORBIDDEN);
          return true;
        },
      );
      assert.strictEqual(repoCalled, false);
    });
  });

  describe("4. Route Ordering & OpenAPI Specification", () => {
    it("should mount GET /counts-by-site before /:id param route in cameraRouter", () => {
      const getPaths = (cameraRouter.stack || [])
        .filter((layer: any) => layer.route?.methods?.get)
        .map((layer: any) => layer.route.path);

      const countsIdx = getPaths.indexOf("/counts-by-site");
      const idIdx = getPaths.indexOf("/:id");

      assert.ok(countsIdx !== -1, "GET /counts-by-site route must be registered");
      assert.ok(idIdx !== -1, "GET /:id route must be registered");
      assert.ok(
        countsIdx < idIdx,
        `GET /counts-by-site (${countsIdx}) must precede /:id (${idIdx})`,
      );
    });

    it("should expose /cameras/counts-by-site with siteIds query param and response fields in OpenAPI spec", () => {
      const spec = buildOpenApiSpec();
      const op = spec.paths?.["/cameras/counts-by-site"]?.get;
      assert.ok(op, "GET /cameras/counts-by-site must exist in OpenAPI spec");

      const siteIdsParam = (op.parameters || []).find(
        (p: any) => p.name === "siteIds",
      );
      assert.ok(siteIdsParam, "siteIds query parameter must be documented");
      assert.strictEqual(siteIdsParam.in, "query");
      assert.strictEqual(siteIdsParam.required, false);

      const itemProps =
        op.responses?.["200"]?.content?.["application/json"]?.schema?.properties
          ?.data?.items?.properties;
      assert.ok(itemProps?.siteId, "200 response item must include siteId");
      assert.ok(itemProps?.total, "200 response item must include total");
      assert.ok(itemProps?.online, "200 response item must include online");
      assert.ok(itemProps?.offline, "200 response item must include offline");
      assert.ok(itemProps?.error, "200 response item must include error");
    });
  });

  describe("5. Live HTTP + PostgreSQL Integration Tests", () => {
    let server: http.Server | null = null;
    let baseUrl = "";
    let dbAvailable = false;
    let originalPublicKey = "";
    let adminToken = "";
    let siteAManagerToken = "";
    const createdCameraIds: string[] = [];
    const liveSiteA = crypto.randomUUID();
    const liveSiteB = crypto.randomUUID();

    function buildHeaders(token: string): Record<string, string> {
      const headers: Record<string, string> = {
        authorization: `Bearer ${token}`,
      };
      if (envConfig.gateway.internalSecret) {
        headers[GATEWAY_HEADERS.INTERNAL_SECRET] =
          envConfig.gateway.internalSecret;
      }
      return headers;
    }

    async function requestJson(path: string, token: string) {
      const res = await fetch(`${baseUrl}${path}`, {
        method: "GET",
        headers: buildHeaders(token),
      });
      const text = await res.text();
      return {
        status: res.status,
        body: text ? JSON.parse(text) : null,
      };
    }

    before(async () => {
      try {
        await cameraPrisma.$queryRaw`SELECT 1`;
        dbAvailable = true;
      } catch {
        dbAvailable = false;
        return;
      }

      const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
        modulusLength: 2048,
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
      });

      originalPublicKey = jwtConfig.publicKey;
      (jwtConfig as any).publicKey = publicKey;

      adminToken = jwt.sign(
        {
          id: "0199a002-0000-7000-8000-00000000aaaa",
          email: "admin-counts@smartppe.local",
          role: ROLES.ADMIN,
          permissions: [PERMISSIONS.PPE_CAMERA_READ],
          purpose: JWT_PURPOSE.ACCESS,
        },
        privateKey,
        { algorithm: JWT_ALGORITHM.RS256, expiresIn: "10m" },
      );

      siteAManagerToken = jwt.sign(
        {
          id: "0199a002-0000-7000-8000-00000000bbbb",
          email: "manager-a@smartppe.local",
          role: ROLES.SAFETY_MANAGER,
          siteId: liveSiteA,
          siteIds: [liveSiteA],
          permissions: [PERMISSIONS.PPE_CAMERA_READ],
          purpose: JWT_PURPOSE.ACCESS,
        },
        privateKey,
        { algorithm: JWT_ALGORITHM.RS256, expiresIn: "10m" },
      );

      const suffix = crypto.randomBytes(3).toString("hex").toUpperCase();
      const seedRows = [
        { siteId: liveSiteA, status: CAMERA_STATUS.ONLINE, deletedAt: null },
        { siteId: liveSiteA, status: CAMERA_STATUS.ONLINE, deletedAt: null },
        { siteId: liveSiteA, status: CAMERA_STATUS.OFFLINE, deletedAt: null },
        { siteId: liveSiteA, status: CAMERA_STATUS.ERROR, deletedAt: null },
        { siteId: liveSiteA, status: CAMERA_STATUS.ONLINE, deletedAt: new Date() },
        { siteId: liveSiteB, status: CAMERA_STATUS.ONLINE, deletedAt: null },
        { siteId: liveSiteB, status: CAMERA_STATUS.MAINTENANCE, deletedAt: null },
      ];

      for (let i = 0; i < seedRows.length; i++) {
        const id = crypto.randomUUID();
        createdCameraIds.push(id);
        await cameraPrisma.camera.create({
          data: {
            id,
            siteId: seedRows[i].siteId,
            name: `Counts Test Cam ${i + 1}`,
            code: `CNT-${suffix}-${i + 1}`,
            streamUrl: `rtsp://192.168.10.${10 + i}:554/live`,
            status: seedRows[i].status,
            deletedAt: seedRows[i].deletedAt,
          },
        });
      }

      server = await new Promise<http.Server>((resolve) => {
        const s = cameraApp.listen(0, "127.0.0.1", () => resolve(s));
      });
      const addr = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${addr.port}`;
    });

    after(async () => {
      if (createdCameraIds.length > 0 && dbAvailable) {
        await cameraPrisma.camera
          .deleteMany({ where: { id: { in: createdCameraIds } } })
          .catch(() => {});
      }
      if (server) {
        await new Promise<void>((resolve) => {
          server!.close(() => resolve());
        });
      }
      if (originalPublicKey !== undefined) {
        (jwtConfig as any).publicKey = originalPublicKey;
      }
    });

    it("should return aggregated counts for multiple sites in 1 request as ADMIN", async (t) => {
      if (!dbAvailable) {
        t.skip("PostgreSQL ppe_camera_db is unavailable");
        return;
      }

      const res = await requestJson(
        `/api/v1/cameras/counts-by-site?siteIds=${liveSiteA},${liveSiteB}`,
        adminToken,
      );
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);

      const expectedSorted = [
        { siteId: liveSiteA, total: 4, online: 2, offline: 1, error: 1 },
        { siteId: liveSiteB, total: 2, online: 1, offline: 1, error: 0 },
      ].sort((a, b) => a.siteId.localeCompare(b.siteId));

      assert.deepStrictEqual(res.body.data, expectedSorted);
    });

    it("should enforce JWT siteIds scoping for non-ADMIN and reject cross-site queries with 403", async (t) => {
      if (!dbAvailable) {
        t.skip("PostgreSQL ppe_camera_db is unavailable");
        return;
      }

      const scopedRes = await requestJson(
        "/api/v1/cameras/counts-by-site",
        siteAManagerToken,
      );
      assert.strictEqual(scopedRes.status, 200);
      assert.deepStrictEqual(scopedRes.body.data, [
        { siteId: liveSiteA, total: 4, online: 2, offline: 1, error: 1 },
      ]);

      const forbiddenRes = await requestJson(
        `/api/v1/cameras/counts-by-site?siteIds=${liveSiteA},${liveSiteB}`,
        siteAManagerToken,
      );
      assert.strictEqual(forbiddenRes.status, 403);
      assert.strictEqual(forbiddenRes.body.code, ERROR_CODE.FORBIDDEN);
    });

    it("should reject invalid UUID in siteIds query with 422 VALIDATION_ERROR", async (t) => {
      if (!dbAvailable) {
        t.skip("PostgreSQL ppe_camera_db is unavailable");
        return;
      }

      const res = await requestJson(
        "/api/v1/cameras/counts-by-site?siteIds=invalid-uuid",
        adminToken,
      );
      assert.strictEqual(res.status, 422);
      assert.strictEqual(res.body.code, ERROR_CODE.VALIDATION_ERROR);
    });
  });
});
