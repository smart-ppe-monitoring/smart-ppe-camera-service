import "dotenv/config";
import dns from "node:dns";

// Force IPv4-first resolution in Node.js runtime to prevent ENETUNREACH on platforms without IPv6 routing
try {
  dns.setDefaultResultOrder("ipv4first");
} catch {
  // Graceful fallback if not supported in runtime
}

import cameraApp from "./camera.app";
import { envConfig } from "./config/env.config";
import { cameraPrisma } from "./database/camera.client";

const PORT = envConfig.camera.port || 8892;

/**
 * Camera Microservice Process (:8892)
 *
 * Chịu trách nhiệm độc quyền:
 * 1. Phục vụ HTTP API cho Camera, Multi-streams, AI Config và Health logs
 * 2. Tương tác trực tiếp với cơ sở dữ liệu ppe_camera_db
 * 3. Hoạt động sau Traefik reverse proxy hoặc Standalone
 */
export const server = cameraApp.listen(PORT, () => {
  console.log(
    `[Camera Service] Running on http://localhost:${PORT} in ${envConfig.nodeEnv} mode`,
  );
  console.log(
    `[Camera Service] ✅ Listening for cameras, streams and health probes on port ${PORT}`,
  );
});

let isShuttingDown = false;

export async function handleCameraShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(
    `\n[Camera Service] Received ${signal}. Starting graceful shutdown...`,
  );

  const forceExitTimer = setTimeout(() => {
    console.error(
      "[Camera Service] Graceful shutdown timed out (10s). Forcing termination.",
    );
    process.exit(1);
  }, 10000);
  forceExitTimer.unref();

  try {
    // 1. Close idle HTTP connections
    if (typeof server.closeIdleConnections === "function") {
      server.closeIdleConnections();
    }

    // 2. Stop accepting new HTTP requests
    await new Promise<void>((resolve) => {
      server.close((err) => {
        if (err) {
          console.error("[Camera Service] Error closing HTTP server:", err);
        } else {
          console.log("[Camera Service] Closed HTTP server successfully.");
        }
        resolve();
      });
    });

    // 3. Disconnect database client
    await cameraPrisma.$disconnect().catch((err: any) => {
      console.warn(
        "[Camera Service] Error disconnecting cameraPrisma:",
        err.message,
      );
    });
    console.log("[Camera Service] Disconnected from camera database.");

    clearTimeout(forceExitTimer);
    console.log("[Camera Service] Graceful shutdown completed.");
    process.exit(0);
  } catch (error) {
    console.error("[Camera Service] Error during graceful shutdown:", error);
    clearTimeout(forceExitTimer);
    process.exit(1);
  }
}

process.on("SIGTERM", () => void handleCameraShutdown("SIGTERM"));
process.on("SIGINT", () => void handleCameraShutdown("SIGINT"));
