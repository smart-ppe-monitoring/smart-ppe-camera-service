import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import {
  errorMiddleware,
  notFoundMiddleware,
} from "./middlewares/error.middleware";
import {
  cameraRouter,
  cameraStreamRouter,
} from "./modules/camera/camera.route";
import { rateLimitMiddleware } from "./middlewares/rate-limit.middleware";
import { requestIdMiddleware } from "./middlewares/request-id.middleware";
import { maintenanceGuard } from "./middlewares/maintenance.middleware";
import { envConfig } from "./config/env.config";
import { cameraRepository } from "./modules/camera/camera.repository";

/**
 * Express Application cho Camera Management Microservice (:8892)
 *
 * Đảm nhiệm:
 * - REST API cho Camera domain (/api/v1/cameras/*)
 * - REST API cho Camera Streams (/api/v1/camera-streams/*)
 * - Quản lý cấu hình AI Camera (/api/v1/cameras/:id/config)
 * - Kiểm tra kết nối Camera Ping Probe (/api/v1/cameras/:id/ping)
 * - Health check cho Traefik Reverse Proxy load balancer
 */
const cameraApp = express();

cameraApp.set("trust proxy", envConfig.trustProxy);

// 1. Distributed Tracing & Security Headers
cameraApp.use(requestIdMiddleware);
cameraApp.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
      },
    },
  }),
);

// 2. CORS Handling
const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    const allowed = envConfig.cors.allowedOrigins.map((o) =>
      o.replace(/\/+$/, ""),
    );
    if (!origin) {
      callback(null, true);
      return;
    }
    const cleanOrigin = origin.replace(/\/+$/, "");
    if (allowed.includes("*")) {
      if (envConfig.nodeEnv !== "production") {
        callback(null, true);
        return;
      }
      console.error(
        "[CORS] CORS_ALLOWED_ORIGINS=* is not permitted in production.",
      );
      callback(null, false);
      return;
    }
    if (allowed.includes(cleanOrigin)) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  credentials: true,
};
cameraApp.use(cors(corsOptions));
cameraApp.use(morgan(envConfig.nodeEnv === "production" ? "combined" : "dev"));
cameraApp.use(express.json({ limit: "2mb" }));
cameraApp.use(express.urlencoded({ extended: true, limit: "2mb" }));
cameraApp.use(cookieParser());

// 3. Health check endpoints cho Traefik Gateway & Monitoring
const healthHandler = async (_req: express.Request, res: express.Response) => {
  const isHealthy = await cameraRepository.checkDatabaseHealth();
  const dbStatus = isHealthy ? "up" : "down";

  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? "ok" : "degraded",
    service: "camera-service",
    checks: {
      database: dbStatus,
    },
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
};

cameraApp.get("/health", healthHandler);
cameraApp.get("/health/live", (_req, res) => res.status(200).json({ status: "ok" }));
cameraApp.get("/api/v1/cameras/health", healthHandler);
cameraApp.get("/cameras/health", healthHandler);

// 4. Mount Camera & Stream Routes
// Hỗ trợ dual-mount cả prefix /api/v1/cameras và /cameras khi qua Gateway hoặc gọi trực tiếp
cameraApp.use(
  "/api/v1/cameras",
  rateLimitMiddleware,
  maintenanceGuard(),
  cameraRouter,
);
cameraApp.use("/cameras", rateLimitMiddleware, maintenanceGuard(), cameraRouter);

cameraApp.use(
  "/api/v1/camera-streams",
  rateLimitMiddleware,
  maintenanceGuard(),
  cameraStreamRouter,
);
cameraApp.use(
  "/camera-streams",
  rateLimitMiddleware,
  maintenanceGuard(),
  cameraStreamRouter,
);

// 5. Error & 404 Handlers
cameraApp.use(notFoundMiddleware);
cameraApp.use(errorMiddleware);

export default cameraApp;
