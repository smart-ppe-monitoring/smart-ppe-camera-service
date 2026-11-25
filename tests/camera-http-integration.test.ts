import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type http from "node:http";
import type { AddressInfo } from "node:net";
import jwt from "jsonwebtoken";
import cameraApp from "../src/camera.app";
import { cameraPrisma } from "../src/database/camera.client";
import { jwtConfig } from "../src/config/jwt.config";
import { envConfig } from "../src/config/env.config";
import {
  CAMERA_STATUS,
  CAMERA_SOURCE_TYPE,
  STREAM_PROTOCOL,
} from "../src/common/constants/camera.constant";
import { ROLES } from "../src/common/constants/role.constant";
import { PERMISSIONS } from "../src/common/constants/permission.constant";
import { ERROR_CODE } from "../src/common/errors/error-code";
import { GATEWAY_HEADERS } from "../src/common/constants/gateway.constant";
import { JWT_ALGORITHM, JWT_PURPOSE } from "../src/common/constants/jwt.constant";

describe("HTTP Integration Tests (Live Express + PostgreSQL) — Issue #3", () => {
  let server: http.Server | null = null;
  let baseUrl = "";
  let dbAvailable = false;
  let accessToken = "";
  let internalToken = "";

  let originalPublicKey = "";
  let originalInternalToken = "";
  const createdCameraIds: string[] = [];

  function buildAuthHeaders(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`,
    };
    if (envConfig.gateway.internalSecret) {
      headers[GATEWAY_HEADERS.INTERNAL_SECRET] = envConfig.gateway.internalSecret;
    }
    return extra ? { ...headers, ...extra } : headers;
  }

  function buildInternalHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      [GATEWAY_HEADERS.INTERNAL_SERVICE_TOKEN]: internalToken,
    };
    if (envConfig.gateway.internalSecret) {
      headers[GATEWAY_HEADERS.INTERNAL_SECRET] = envConfig.gateway.internalSecret;
    }
    return headers;
  }

  async function requestJson(
    path: string,
    init: {
      method?: string;
      headers?: Record<string, string>;
      body?: unknown;
    } = {},
  ): Promise<{ status: number; body: any }> {
    const response = await fetch(`${baseUrl}${path}`, {
      method: init.method || "GET",
      headers: init.headers ?? buildAuthHeaders(),
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    const text = await response.text();
    let parsed: any = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { status: response.status, body: parsed };
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

    originalInternalToken = envConfig.internalService.token;
    internalToken = crypto.randomBytes(24).toString("hex");
    (envConfig.internalService as any).token = internalToken;

    accessToken = jwt.sign(
      {
        id: "0199a001-0000-7000-8000-00000000aaaa",
        email: "integration-admin@smartppe.local",
        role: ROLES.ADMIN,
        permissions: [PERMISSIONS.PPE_CAMERA_READ, PERMISSIONS.PPE_CAMERA_MANAGE],
        purpose: JWT_PURPOSE.ACCESS,
      },
      privateKey,
      { algorithm: JWT_ALGORITHM.RS256, expiresIn: "10m" },
    );

    server = await new Promise<http.Server>((resolve) => {
      const s = cameraApp.listen(0, "127.0.0.1", () => resolve(s));
    });
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    if (createdCameraIds.length > 0 && dbAvailable) {
      await cameraPrisma.camera
        .deleteMany({
          where: { id: { in: createdCameraIds } },
        })
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
    if (originalInternalToken !== undefined) {
      (envConfig.internalService as any).token = originalInternalToken;
    }

    await cameraPrisma.$disconnect().catch(() => {});
  });

  it("GET /health and /openapi.json should report live DB up and updated OpenAPI contracts", async (t) => {
    if (!dbAvailable) {
      t.skip("PostgreSQL ppe_camera_db is unavailable");
      return;
    }

    const health = await requestJson("/health", { headers: {} });
    assert.equal(health.status, 200);
    assert.equal(health.body.status, "ok");
    assert.equal(health.body.checks?.database, "up");

    const spec = await requestJson("/openapi.json", { headers: {} });
    assert.equal(spec.status, 200);
    assert.ok(spec.body.paths?.["/cameras/{id}"]?.put?.description?.includes(":***@"));
    assert.equal(spec.body.paths?.["/camera-streams/{id}"]?.put?.deprecated, true);
  });

  it("POST /api/v1/cameras should reject literal masked '***' credentials with 400 VALIDATION_ERROR", async (t) => {
    if (!dbAvailable) {
      t.skip("PostgreSQL ppe_camera_db is unavailable");
      return;
    }

    const uniqueSuffix = Date.now().toString(36).toUpperCase();
    const res = await requestJson("/api/v1/cameras", {
      method: "POST",
      body: {
        siteId: "11111111-1111-4111-8111-111111111111",
        name: "Invalid Masked Cam",
        code: `IT-MASK-${uniqueSuffix}`,
        sourceType: CAMERA_SOURCE_TYPE.RTSP,
        streamUrl: "rtsp://admin:***@192.168.55.10:554/live",
      },
    });

    assert.equal(res.status, 400);
    assert.equal(res.body.code, ERROR_CODE.VALIDATION_ERROR);
  });

  it("PUT /api/v1/cameras/:id should preserve real DB RTSP password on masked streamUrl, reject mismatch, and allow real rotation", async (t) => {
    if (!dbAvailable) {
      t.skip("PostgreSQL ppe_camera_db is unavailable");
      return;
    }

    const siteId = "11111111-1111-4111-8111-111111111111";
    const uniqueSuffix = `${Date.now().toString(36)}-${crypto.randomBytes(2).toString("hex")}`.toUpperCase();
    const realUrl = "rtsp://admin:LiveRealSecret88@192.168.55.10:554/live";
    const maskedUrl = "rtsp://admin:***@192.168.55.10:554/live";

    // 1. Create camera via live HTTP
    const createRes = await requestJson("/api/v1/cameras", {
      method: "POST",
      body: {
        siteId,
        name: "Live Integration Cam",
        code: `IT-CAM-${uniqueSuffix}`,
        sourceType: CAMERA_SOURCE_TYPE.RTSP,
        streamUrl: realUrl,
        status: CAMERA_STATUS.ONLINE,
      },
    });
    assert.equal(createRes.status, 201);
    const cameraId = createRes.body.data.id as string;
    createdCameraIds.push(cameraId);
    assert.equal(createRes.body.data.streamUrl, maskedUrl);

    // 2. GET camera returns masked URL
    const getRes = await requestJson(`/api/v1/cameras/${cameraId}`);
    assert.equal(getRes.status, 200);
    assert.equal(getRes.body.data.streamUrl, maskedUrl);

    // 3. Edit metadata + echo masked streamUrl -> DB MUST keep real password
    const editRes = await requestJson(`/api/v1/cameras/${cameraId}`, {
      method: "PUT",
      body: {
        name: "Live Integration Cam Updated",
        description: "Metadata edited with masked URL echoed from modal",
        streamUrl: maskedUrl,
      },
    });
    assert.equal(editRes.status, 200);
    assert.equal(editRes.body.data.name, "Live Integration Cam Updated");
    assert.equal(editRes.body.data.streamUrl, maskedUrl);

    const dbCam = await cameraPrisma.camera.findUnique({
      where: { id: cameraId },
      include: { streams: true },
    });
    assert.equal(dbCam?.streamUrl, realUrl);
    assert.equal(dbCam?.streams[0]?.streamUrl, realUrl);

    const internalRes = await requestJson(
      `/api/v1/cameras/internal/active-streams?siteId=${siteId}`,
      { headers: buildInternalHeaders() },
    );
    assert.equal(internalRes.status, 200);
    const matchedInternal = (internalRes.body.data as any[]).find(
      (c) => c.id === cameraId,
    );
    assert.equal(matchedInternal?.streamUrl, realUrl);

    // 4. Mismatched masked URL must fail with 400 VALIDATION_ERROR and NOT touch DB
    const mismatchRes = await requestJson(`/api/v1/cameras/${cameraId}`, {
      method: "PUT",
      body: {
        name: "Should Reject Mismatch",
        streamUrl: "rtsp://operator:***@192.168.55.10:554/live",
      },
    });
    assert.equal(mismatchRes.status, 400);
    assert.equal(mismatchRes.body.code, ERROR_CODE.VALIDATION_ERROR);

    const dbCamAfterMismatch = await cameraPrisma.camera.findUnique({
      where: { id: cameraId },
    });
    assert.equal(dbCamAfterMismatch?.streamUrl, realUrl);
    assert.equal(dbCamAfterMismatch?.name, "Live Integration Cam Updated");

    // 5. Rotating to a new real password updates both camera and primary stream
    const rotatedUrl = "rtsp://operator:RotatedPass99@192.168.55.11:554/live";
    const rotateRes = await requestJson(`/api/v1/cameras/${cameraId}`, {
      method: "PUT",
      body: { streamUrl: rotatedUrl },
    });
    assert.equal(rotateRes.status, 200);
    assert.equal(
      rotateRes.body.data.streamUrl,
      "rtsp://operator:***@192.168.55.11:554/live",
    );

    const dbCamRotated = await cameraPrisma.camera.findUnique({
      where: { id: cameraId },
      include: { streams: true },
    });
    assert.equal(dbCamRotated?.streamUrl, rotatedUrl);
    assert.equal(dbCamRotated?.streams[0]?.streamUrl, rotatedUrl);
  });

  it("Sub-streams and multi-polygon ROI config should enforce guards and persist accurately in PostgreSQL", async (t) => {
    if (!dbAvailable) {
      t.skip("PostgreSQL ppe_camera_db is unavailable");
      return;
    }

    const siteId = "11111111-1111-4111-8111-111111111111";
    const uniqueSuffix = `${Date.now().toString(36)}-${crypto.randomBytes(2).toString("hex")}`.toUpperCase();

    const createRes = await requestJson("/api/v1/cameras", {
      method: "POST",
      body: {
        siteId,
        name: "ROI & SubStream Live Cam",
        code: `IT-ROI-${uniqueSuffix}`,
        sourceType: CAMERA_SOURCE_TYPE.RTSP,
        streamUrl: "rtsp://admin:MainSecret11@192.168.55.20:554/main",
        status: CAMERA_STATUS.ONLINE,
      },
    });
    assert.equal(createRes.status, 201);
    const cameraId = createRes.body.data.id as string;
    createdCameraIds.push(cameraId);

    // 1. Create auxiliary sub-stream
    const subRealUrl = "rtsp://subuser:SubSecret22@192.168.55.20:554/sub";
    const subMaskedUrl = "rtsp://subuser:***@192.168.55.20:554/sub";
    const createSubRes = await requestJson(`/api/v1/cameras/${cameraId}/streams`, {
      method: "POST",
      body: {
        protocol: STREAM_PROTOCOL.RTSP,
        streamUrl: subRealUrl,
        resolution: "1280x720",
        fps: 15,
      },
    });
    assert.equal(createSubRes.status, 201);
    const subStreamId = createSubRes.body.data.id as string;
    assert.equal(createSubRes.body.data.streamUrl, subMaskedUrl);

    // Update fps with matching masked sub-stream URL -> preserves subRealUrl
    const updateSubOk = await requestJson(`/api/v1/camera-streams/${subStreamId}`, {
      method: "PUT",
      body: { fps: 20, streamUrl: subMaskedUrl },
    });
    assert.equal(updateSubOk.status, 200);
    assert.equal(updateSubOk.body.data.fps, 20);
    assert.equal(updateSubOk.body.data.streamUrl, subMaskedUrl);

    const dbSub = await cameraPrisma.cameraStream.findUnique({
      where: { id: subStreamId },
    });
    assert.equal(dbSub?.streamUrl, subRealUrl);

    // Update sub-stream with mismatched mask -> 400 VALIDATION_ERROR
    const updateSubMismatch = await requestJson(
      `/api/v1/camera-streams/${subStreamId}`,
      {
        method: "PUT",
        body: { streamUrl: "rtsp://wronguser:***@192.168.55.20:554/sub" },
      },
    );
    assert.equal(updateSubMismatch.status, 400);
    assert.equal(updateSubMismatch.body.code, ERROR_CODE.VALIDATION_ERROR);

    // 2. Multi-polygon ROI save, read, internal feed, validation conflicts, clear, and reset
    const area1 = "22222222-2222-4222-8222-222222222201";
    const area2 = "22222222-2222-4222-8222-222222222202";
    const poly1 = [
      { x: 0.1, y: 0.1 },
      { x: 0.4, y: 0.1 },
      { x: 0.4, y: 0.4 },
    ];
    const poly2 = [
      { x: 0.6, y: 0.2 },
      { x: 0.9, y: 0.2 },
      { x: 0.9, y: 0.8 },
    ];

    const putRoiRes = await requestJson(`/api/v1/cameras/${cameraId}/config`, {
      method: "PUT",
      body: {
        captureFps: 15,
        roiPolygons: [
          { id: "zone-a", name: "Khu cần cẩu", restrictedAreaId: area1, points: poly1 },
          { id: "zone-b", name: "Khu hố móng", restrictedAreaId: area2, points: poly2 },
        ],
      },
    });
    assert.equal(putRoiRes.status, 200);
    assert.equal(putRoiRes.body.data.roiPolygons.length, 2);
    assert.deepEqual(putRoiRes.body.data.roiPolygon, poly1);

    const dbConfig = await cameraPrisma.cameraConfig.findUnique({
      where: { cameraId },
    });
    assert.equal((dbConfig?.roiPolygons as any[])?.length, 2);
    assert.deepEqual(dbConfig?.roiPolygon, poly1);

    const getRoiRes = await requestJson(`/api/v1/cameras/${cameraId}/config`);
    assert.equal(getRoiRes.status, 200);
    assert.equal(getRoiRes.body.data.roiPolygons.length, 2);

    const internalLookup = await requestJson(
      `/api/v1/cameras/internal/lookup?id=${cameraId}`,
      { headers: buildInternalHeaders() },
    );
    assert.equal(internalLookup.status, 200);
    assert.equal(internalLookup.body.data.config.roiPolygons.length, 2);
    assert.deepEqual(internalLookup.body.data.config.roiPolygon, poly1);

    // Duplicate restrictedAreaId -> Zod middleware rejects with 422 VALIDATION_ERROR
    const dupAreaRes = await requestJson(`/api/v1/cameras/${cameraId}/config`, {
      method: "PUT",
      body: {
        roiPolygons: [
          { restrictedAreaId: area1, points: poly1 },
          { restrictedAreaId: area1, points: poly2 },
        ],
      },
    });
    assert.equal(dupAreaRes.status, 422);
    assert.equal(dupAreaRes.body.code, ERROR_CODE.VALIDATION_ERROR);

    // Contradictory roiPolygon (non-empty) + roiPolygons ([]) -> 422 VALIDATION_ERROR
    const conflictRes = await requestJson(`/api/v1/cameras/${cameraId}/config`, {
      method: "PUT",
      body: {
        roiPolygon: poly1,
        roiPolygons: [],
      },
    });
    assert.equal(conflictRes.status, 422);
    assert.equal(conflictRes.body.code, ERROR_CODE.VALIDATION_ERROR);

    // Clear with [] clears both columns in PostgreSQL
    const clearRoiRes = await requestJson(`/api/v1/cameras/${cameraId}/config`, {
      method: "PUT",
      body: { roiPolygons: [] },
    });
    assert.equal(clearRoiRes.status, 200);
    assert.equal(clearRoiRes.body.data.roiPolygon, null);
    assert.equal(clearRoiRes.body.data.roiPolygons, null);

    // Reset keeps both null
    const resetRes = await requestJson(`/api/v1/cameras/${cameraId}/config/reset`, {
      method: "POST",
    });
    assert.equal(resetRes.status, 200);
    assert.equal(resetRes.body.data.roiPolygon, null);
    assert.equal(resetRes.body.data.roiPolygons, null);
  });
});
