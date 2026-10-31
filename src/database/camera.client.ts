import { PrismaClient as CameraPrismaClient } from "@prisma/client-camera";
import { envConfig } from "../config/env.config";

/**
 * Cấu hình timeout mặc định cho interactive transactions của Camera Service
 */
export const DEFAULT_CAMERA_TRANSACTION_OPTIONS = {
  maxWait: 10000,
  timeout: 15000,
} as const;

let _cameraPrisma: CameraPrismaClient | null = null;

export function getCameraPrisma(): CameraPrismaClient {
  if (!_cameraPrisma) {
    // SEC-31: Đảm bảo CameraPrismaClient nhận datasource URL từ envConfig (có fallback DATABASE_URL)
    const connectionUrl =
      envConfig.database?.cameraUrl ||
      process.env.CAMERA_DATABASE_URL ||
      process.env.DATABASE_URL;

    _cameraPrisma = new CameraPrismaClient({
      datasources: connectionUrl
        ? {
            db: {
              url: connectionUrl,
            },
          }
        : undefined,
      log:
        envConfig.nodeEnv === "development"
          ? ["query", "error", "warn"]
          : ["error", "warn"],
    });
  }
  return _cameraPrisma;
}

export const cameraPrisma = new Proxy({} as CameraPrismaClient, {
  get(_target, prop) {
    return (getCameraPrisma() as any)[prop];
  },
});
