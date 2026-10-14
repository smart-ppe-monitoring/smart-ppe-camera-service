import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { jwtConfig } from "../config/jwt.config";
import { envConfig } from "../config/env.config";
import { AppError } from "../common/errors/app-error";
import { ERROR_CODE } from "../common/errors/error-code";
import { JWT_PURPOSE, JWT_ALGORITHM } from "../common/constants/jwt.constant";
import { PERMISSIONS } from "../common/constants/permission.constant";
import { ROLES } from "../common/constants/role.constant";
import { isTrustedGatewayRequest } from "./request-id.middleware";

export function extractTokenFromRequest(req: Request): string | undefined {
  let token = req.cookies?.accessToken;
  if (!token) {
    const authHeader = req.headers?.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.split(" ")[1];
    }
  }

  const cleanPath = (
    (req.baseUrl || "") + (req.path || req.originalUrl || "")
  ).split("?")[0];
  const isAllowedQueryTokenEndpoint =
    cleanPath.endsWith("/stream") || cleanPath.endsWith("/download");

  if (!token && isAllowedQueryTokenEndpoint) {
    const queryToken = req.query?.ticket || req.query?.token;
    if (typeof queryToken === "string") {
      token = queryToken;
    }
  }
  return token;
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const cleanPath = (
    (req.baseUrl || "") + (req.path || req.originalUrl || "")
  ).split("?")[0];
  const isAllowedQueryTokenEndpoint =
    cleanPath.endsWith("/stream") || cleanPath.endsWith("/download");

  if (!isAllowedQueryTokenEndpoint && req.query?.token) {
    next(
      new AppError(
        "Không được phép truyền token xác thực qua query string trên API thông thường để tránh rò rỉ qua log và browser history",
        400,
        ERROR_CODE.VALIDATION_ERROR,
      ),
    );
    return;
  }

  const token = extractTokenFromRequest(req);

  if (!token) {
    const gatewaySecret = envConfig.gateway.internalSecret;
    if (gatewaySecret && isTrustedGatewayRequest(req, gatewaySecret)) {
      req.user = {
        id: "system-internal-service",
        email: "system@internal.ppe.local",
        role: ROLES.ADMIN,
        permissions: Object.values(PERMISSIONS),
      };
      return next();
    }

    next(new AppError("Unauthorized", 401, ERROR_CODE.UNAUTHORIZED));
    return;
  }

  try {
    const secret = jwtConfig.publicKey || jwtConfig.accessSecret;
    const payload = jwt.verify(token, secret, {
      algorithms: [JWT_ALGORITHM.RS256, JWT_ALGORITHM.HS256],
    }) as any;

    if (!payload || typeof payload !== "object") {
      next(new AppError("Token không hợp lệ", 401, ERROR_CODE.UNAUTHORIZED));
      return;
    }

    req.user = {
      id: payload.id || payload.sub,
      email: payload.email,
      role: payload.role,
      roleId: payload.roleId,
      permissions: Array.isArray(payload.permissions) ? payload.permissions : [],
    };

    next();
  } catch (error) {
    next(new AppError("Token xác thực không hợp lệ hoặc đã hết hạn", 401, ERROR_CODE.UNAUTHORIZED));
  }
}
