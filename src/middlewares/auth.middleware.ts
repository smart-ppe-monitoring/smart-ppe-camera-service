import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { jwtConfig } from "../config/jwt.config";
import { AppError } from "../common/errors/app-error";
import { ERROR_CODE } from "../common/errors/error-code";
import { JWT_PURPOSE, JWT_ALGORITHM } from "../common/constants/jwt.constant";

export function extractTokenFromRequest(req: Request): string | undefined {
  let token = req.cookies?.accessToken;
  if (!token) {
    const authHeader = req.headers?.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.split(" ")[1];
    }
  }
  return token;
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // SEC-14: Nghiêm cấm truyền token qua query string (?token=... hoặc ?ticket=...) trên toàn bộ microservice
  // nhằm triệt tiêu rò rỉ JWT token vào nhật ký truy cập (access logs), browser history và proxy logs (CWE-598)
  if (req.query?.token || req.query?.ticket) {
    next(
      new AppError(
        "Không được phép truyền token xác thực qua query string để tránh rò rỉ qua log và browser history",
        400,
        ERROR_CODE.VALIDATION_ERROR,
      ),
    );
    return;
  }

  const token = extractTokenFromRequest(req);

  if (!token) {
    next(new AppError("Unauthorized", 401, ERROR_CODE.UNAUTHORIZED));
    return;
  }

  try {
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || typeof decoded !== "object" || !decoded.header) {
      next(new AppError("Token không hợp lệ", 401, ERROR_CODE.UNAUTHORIZED));
      return;
    }

    const { alg } = decoded.header;
    let payload: any;

    if (alg !== JWT_ALGORITHM.RS256) {
      next(
        new AppError(
          `Thuật toán '${alg}' không được chấp nhận. Hệ thống chỉ hỗ trợ RS256.`,
          401,
          ERROR_CODE.UNAUTHORIZED,
        ),
      );
      return;
    }

    if (!jwtConfig.publicKey) {
      next(
        new AppError(
          "Cấu hình khóa công khai RS256 chưa sẵn sàng",
          500,
          ERROR_CODE.INTERNAL_SERVER_ERROR,
        ),
      );
      return;
    }

    payload = jwt.verify(token, jwtConfig.publicKey, {
      algorithms: [JWT_ALGORITHM.RS256],
    });

    if (!payload || typeof payload !== "object") {
      next(new AppError("Token không hợp lệ", 401, ERROR_CODE.UNAUTHORIZED));
      return;
    }

    // SEC-02: Isolate purpose claims - reject 2FA temp tokens on business endpoints
    if (payload.purpose && payload.purpose !== JWT_PURPOSE.ACCESS) {
      next(
        new AppError(
          "Token không có quyền truy cập API nghiệp vụ",
          401,
          ERROR_CODE.UNAUTHORIZED,
        ),
      );
      return;
    }

    // SEC-06: Chặn token có cờ mustChangePassword truy cập satellite services
    const jwtPayload = payload as any;
    if (
      jwtPayload.mustChangePassword === true ||
      jwtPayload.mustChangePassword === "true"
    ) {
      next(
        new AppError(
          "Bạn bắt buộc phải đổi mật khẩu trước khi thực hiện các thao tác khác trên hệ thống",
          403,
          ERROR_CODE.FORBIDDEN,
        ),
      );
      return;
    }

    req.user = {
      id: payload.id || payload.sub,
      email: payload.email,
      role: payload.role,
      roleId: payload.roleId,
      siteId: typeof jwtPayload.siteId === "string" ? jwtPayload.siteId : undefined,
      siteIds: Array.isArray(jwtPayload.siteIds)
        ? (jwtPayload.siteIds as string[])
        : undefined,
      permissions: Array.isArray(payload.permissions) ? payload.permissions : [],
    };

    next();
  } catch (error) {
    next(new AppError("Token xác thực không hợp lệ hoặc đã hết hạn", 401, ERROR_CODE.UNAUTHORIZED));
  }
}
