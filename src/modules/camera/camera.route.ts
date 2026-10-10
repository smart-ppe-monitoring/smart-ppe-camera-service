import { Router } from "express";
import { cameraController } from "./camera.controller";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { requirePermission } from "../../middlewares/permission.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { PERMISSIONS } from "../../common/constants/permission.constant";
import {
  cameraIdParamSchema,
  streamIdParamSchema,
  createCameraSchema,
  updateCameraSchema,
  cameraQuerySchema,
  createCameraStreamSchema,
  createCameraStreamDirectSchema,
  updateCameraStreamSchema,
  updateCameraConfigSchema,
  cameraHealthLogQuerySchema,
} from "./camera.validation";

// ── Camera Routes (/api/v1/cameras) ──────────────────────────────────────────
export const cameraRouter = Router();

cameraRouter.get(
  "/",
  authMiddleware,
  requirePermission(PERMISSIONS.PPE_CAMERA_READ),
  validate(cameraQuerySchema, "query"),
  cameraController.findAllCameras,
);

cameraRouter.post(
  "/",
  authMiddleware,
  requirePermission(PERMISSIONS.PPE_CAMERA_MANAGE),
  validate(createCameraSchema),
  cameraController.createCamera,
);

cameraRouter.get(
  "/:id",
  authMiddleware,
  requirePermission(PERMISSIONS.PPE_CAMERA_READ),
  validate(cameraIdParamSchema, "params"),
  cameraController.findCameraById,
);

cameraRouter.put(
  "/:id",
  authMiddleware,
  requirePermission(PERMISSIONS.PPE_CAMERA_MANAGE),
  validate(cameraIdParamSchema, "params"),
  validate(updateCameraSchema),
  cameraController.updateCamera,
);

cameraRouter.delete(
  "/:id",
  authMiddleware,
  requirePermission(PERMISSIONS.PPE_CAMERA_MANAGE),
  validate(cameraIdParamSchema, "params"),
  cameraController.deleteCamera,
);

// Camera Config
cameraRouter.get(
  "/:id/config",
  authMiddleware,
  requirePermission(PERMISSIONS.PPE_CAMERA_READ),
  validate(cameraIdParamSchema, "params"),
  cameraController.getCameraConfig,
);

cameraRouter.put(
  "/:id/config",
  authMiddleware,
  requirePermission(PERMISSIONS.PPE_CAMERA_MANAGE),
  validate(cameraIdParamSchema, "params"),
  validate(updateCameraConfigSchema),
  cameraController.updateCameraConfig,
);

// Camera Streams (Nested)
cameraRouter.get(
  "/:id/streams",
  authMiddleware,
  requirePermission(PERMISSIONS.PPE_CAMERA_READ),
  validate(cameraIdParamSchema, "params"),
  cameraController.getCameraStreams,
);

cameraRouter.post(
  "/:id/streams",
  authMiddleware,
  requirePermission(PERMISSIONS.PPE_CAMERA_MANAGE),
  validate(cameraIdParamSchema, "params"),
  validate(createCameraStreamSchema.omit({ cameraId: true })),
  cameraController.createCameraStream,
);

// Camera Health & Ping
cameraRouter.get(
  "/:id/health-logs",
  authMiddleware,
  requirePermission(PERMISSIONS.PPE_CAMERA_READ),
  validate(cameraIdParamSchema, "params"),
  validate(cameraHealthLogQuerySchema, "query"),
  cameraController.getCameraHealthLogs,
);

cameraRouter.post(
  "/:id/ping",
  authMiddleware,
  requirePermission(PERMISSIONS.PPE_CAMERA_MANAGE),
  validate(cameraIdParamSchema, "params"),
  cameraController.pingCamera,
);

// ── Camera Stream Direct Routes (/api/v1/camera-streams) ─────────────────────
export const cameraStreamRouter = Router();

cameraStreamRouter.post(
  "/",
  authMiddleware,
  requirePermission(PERMISSIONS.PPE_CAMERA_MANAGE),
  validate(createCameraStreamDirectSchema),
  cameraController.createCameraStreamDirect,
);

cameraStreamRouter.get(
  "/:id",
  authMiddleware,
  requirePermission(PERMISSIONS.PPE_CAMERA_READ),
  validate(streamIdParamSchema, "params"),
  cameraController.findCameraStreamById,
);

cameraStreamRouter.put(
  "/:id",
  authMiddleware,
  requirePermission(PERMISSIONS.PPE_CAMERA_MANAGE),
  validate(streamIdParamSchema, "params"),
  validate(updateCameraStreamSchema),
  cameraController.updateCameraStream,
);

cameraStreamRouter.delete(
  "/:id",
  authMiddleware,
  requirePermission(PERMISSIONS.PPE_CAMERA_MANAGE),
  validate(streamIdParamSchema, "params"),
  cameraController.deleteCameraStream,
);
