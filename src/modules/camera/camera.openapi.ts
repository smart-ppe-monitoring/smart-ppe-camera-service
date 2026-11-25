import { openapiRegistry } from "../../config/openapi/openapi.registry";
import {
  createCameraSchema,
  updateCameraSchema,
  cameraQuerySchema,
  cameraIdParamSchema,
  createCameraStreamSchema,
  createCameraStreamDirectSchema,
  updateCameraStreamSchema,
  streamIdParamSchema,
  updateCameraConfigSchema,
  cameraHealthLogQuerySchema,
  cameraStatusCountsQuerySchema,
} from "./camera.validation";
import { z } from "zod";

const createNestedCameraStreamSchema = createCameraStreamSchema.omit({
  cameraId: true,
});

export function registerCameraOpenApi(): void {
  openapiRegistry.register("CreateCameraRequest", createCameraSchema);
  openapiRegistry.register("UpdateCameraRequest", updateCameraSchema);
  openapiRegistry.register("UpdateCameraConfigRequest", updateCameraConfigSchema);
  openapiRegistry.register("CreateCameraStreamRequest", createNestedCameraStreamSchema);
  openapiRegistry.register("CreateCameraStreamDirectRequest", createCameraStreamDirectSchema);
  openapiRegistry.register("UpdateCameraStreamRequest", updateCameraStreamSchema);

  // ── Cameras ────────────────────────────────────────────────────────────────
  openapiRegistry.registerPath({
    method: "get",
    path: "/cameras/status-counts",
    tags: ["Cameras"],
    summary: "Đếm số lượng camera theo trạng thái kết nối (total, online, offline)",
    security: [{ BearerAuth: [] }],
    request: { query: cameraStatusCountsQuerySchema },
    responses: {
      200: {
        description: "Lấy số lượng trạng thái camera thành công",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean(),
              data: z.object({
                total: z.number(),
                online: z.number(),
                offline: z.number(),
              }),
            }),
          },
        },
      },
    },
  });

  openapiRegistry.registerPath({
    method: "get",
    path: "/cameras",
    tags: ["Cameras"],
    summary: "Danh sách camera giám sát (phân trang & tìm kiếm)",
    security: [{ BearerAuth: [] }],
    request: { query: cameraQuerySchema },
    responses: {
      200: {
        description: "Lấy danh sách camera thành công",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean(),
              data: z.array(z.any()),
              meta: z.object({
                total: z.number(),
                page: z.number(),
                limit: z.number(),
                totalPages: z.number(),
              }),
            }),
          },
        },
      },
    },
  });

  openapiRegistry.registerPath({
    method: "post",
    path: "/cameras",
    tags: ["Cameras"],
    summary: "Thêm camera giám sát mới",
    security: [{ BearerAuth: [] }],
    request: {
      body: {
        content: {
          "application/json": { schema: createCameraSchema },
        },
      },
    },
    responses: {
      201: {
        description: "Tạo camera thành công",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean(),
              data: z.any(),
            }),
          },
        },
      },
    },
  });

  openapiRegistry.registerPath({
    method: "get",
    path: "/cameras/{id}",
    tags: ["Cameras"],
    summary: "Chi tiết camera theo ID",
    security: [{ BearerAuth: [] }],
    request: { params: cameraIdParamSchema },
    responses: {
      200: {
        description: "Lấy chi tiết camera thành công",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean(),
              data: z.any(),
            }),
          },
        },
      },
    },
  });

  openapiRegistry.registerPath({
    method: "put",
    path: "/cameras/{id}",
    tags: ["Cameras"],
    summary: "Cập nhật thông tin camera",
    description:
      "Cập nhật metadata hoặc streamUrl của camera. Nếu streamUrl chứa mật khẩu che giấu (:***@) khớp với URL hiện tại sau khi che, hệ thống sẽ tự động bỏ qua để bảo toàn mật khẩu gốc trong DB; nếu URL chứa '***' nhưng không khớp sẽ trả về lỗi 400 VALIDATION_ERROR.",
    security: [{ BearerAuth: [] }],
    request: {
      params: cameraIdParamSchema,
      body: {
        content: {
          "application/json": { schema: updateCameraSchema },
        },
      },
    },
    responses: {
      200: {
        description: "Cập nhật camera thành công",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean(),
              data: z.any(),
            }),
          },
        },
      },
    },
  });

  openapiRegistry.registerPath({
    method: "delete",
    path: "/cameras/{id}",
    tags: ["Cameras"],
    summary: "Xóa camera",
    security: [{ BearerAuth: [] }],
    request: { params: cameraIdParamSchema },
    responses: {
      200: {
        description: "Xóa camera thành công",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean(),
              data: z.any(),
            }),
          },
        },
      },
    },
  });

  // Config
  openapiRegistry.registerPath({
    method: "get",
    path: "/cameras/{id}/config",
    tags: ["Cameras"],
    summary: "Xem cấu hình AI của camera",
    description:
      "Trả về cấu hình AI của camera, bao gồm cả danh sách đa giác ROI (roiPolygons với tùy chọn liên kết restrictedAreaId) và trường tương thích ngược roiPolygon.",
    security: [{ BearerAuth: [] }],
    request: { params: cameraIdParamSchema },
    responses: {
      200: {
        description: "Lấy cấu hình AI của camera thành công",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean(),
              data: z.any(),
            }),
          },
        },
      },
    },
  });

  openapiRegistry.registerPath({
    method: "put",
    path: "/cameras/{id}/config",
    tags: ["Cameras"],
    summary: "Cập nhật cấu hình AI (FPS, Resolution, ROI Polygons, Enabled)",
    description:
      "Cập nhật cấu hình AI. Hỗ trợ mảng đa giác roiPolygons (kèm restrictedAreaId tùy chọn) và tự động đồng bộ hai chiều với trường đơn roiPolygon để giữ tương thích ngược cho AI Vision Engine và các client cũ.",
    security: [{ BearerAuth: [] }],
    request: {
      params: cameraIdParamSchema,
      body: {
        content: {
          "application/json": { schema: updateCameraConfigSchema },
        },
      },
    },
    responses: {
      200: {
        description: "Cập nhật cấu hình AI thành công",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean(),
              data: z.any(),
            }),
          },
        },
      },
    },
  });

  openapiRegistry.registerPath({
    method: "delete",
    path: "/cameras/{id}/config",
    tags: ["Cameras"],
    summary: "Xóa cấu hình AI tùy chỉnh của camera",
    security: [{ BearerAuth: [] }],
    request: {
      params: cameraIdParamSchema,
    },
    responses: {
      200: {
        description: "Xóa cấu hình AI tùy chỉnh thành công",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean(),
              data: z.any(),
            }),
          },
        },
      },
    },
  });

  openapiRegistry.registerPath({
    method: "post",
    path: "/cameras/{id}/config/reset",
    tags: ["Cameras"],
    summary: "Đặt lại cấu hình camera về giá trị mặc định",
    security: [{ BearerAuth: [] }],
    request: {
      params: cameraIdParamSchema,
    },
    responses: {
      200: {
        description: "Đặt lại cấu hình mặc định thành công",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean(),
              data: z.any(),
            }),
          },
        },
      },
    },
  });

  // Streams
  openapiRegistry.registerPath({
    method: "get",
    path: "/cameras/{id}/streams",
    tags: ["Cameras"],
    summary: "Danh sách luồng stream của camera",
    description:
      "Quản lý các sub-stream phụ trợ đa giao thức (HLS, WebRTC, RTSP dự phòng) gắn với camera. AI Live Engine chính luôn đọc camera.streamUrl thông qua /cameras/internal/active-streams (chỉ fallback sang CameraStream active đầu tiên khi camera.streamUrl trống).",
    security: [{ BearerAuth: [] }],
    request: { params: cameraIdParamSchema },
    responses: {
      200: {
        description: "Lấy danh sách luồng stream thành công",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean(),
              data: z.array(z.any()),
            }),
          },
        },
      },
    },
  });

  openapiRegistry.registerPath({
    method: "post",
    path: "/cameras/{id}/streams",
    tags: ["Cameras"],
    summary: "Thêm luồng stream phụ cho camera",
    description:
      "Tạo sub-stream phụ trợ (HLS/WebRTC preview hoặc RTSP dự phòng). Luồng RTSP chính phục vụ AI Live Engine được quản lý qua streamUrl trên /cameras/{id}.",
    security: [{ BearerAuth: [] }],
    request: {
      params: cameraIdParamSchema,
      body: {
        content: {
          "application/json": { schema: createNestedCameraStreamSchema },
        },
      },
    },
    responses: {
      201: {
        description: "Tạo luồng stream thành công",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean(),
              data: z.any(),
            }),
          },
        },
      },
    },
  });

  // Health probe & ping
  openapiRegistry.registerPath({
    method: "post",
    path: "/cameras/{id}/ping",
    tags: ["Cameras"],
    summary: "Kiểm tra kết nối và cập nhật trạng thái camera tức thời",
    security: [{ BearerAuth: [] }],
    request: { params: cameraIdParamSchema },
    responses: {
      200: {
        description: "Kiểm tra kết nối camera thành công",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean(),
              data: z.object({
                cameraId: z.string().uuid(),
                status: z.string(),
                latencyMs: z.number().nullable(),
                success: z.boolean(),
                errorMessage: z.string().nullable(),
                checkedAt: z.string().datetime(),
              }),
            }),
          },
        },
      },
    },
  });

  openapiRegistry.registerPath({
    method: "get",
    path: "/cameras/{id}/health-logs",
    tags: ["Cameras"],
    summary: "Lịch sử kiểm tra kết nối camera",
    security: [{ BearerAuth: [] }],
    request: {
      params: cameraIdParamSchema,
      query: cameraHealthLogQuerySchema,
    },
    responses: {
      200: {
        description: "Lấy lịch sử kết nối thành công",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean(),
              data: z.array(z.any()),
              meta: z.object({
                total: z.number(),
                page: z.number(),
                limit: z.number(),
                totalPages: z.number(),
              }),
            }),
          },
        },
      },
    },
  });

  // ── Camera Streams Direct ──────────────────────────────────────────────────
  openapiRegistry.registerPath({
    method: "post",
    path: "/camera-streams",
    tags: ["Camera Streams"],
    deprecated: true,
    summary: "Thêm luồng stream trực tiếp cho camera",
    description:
      "Endpoint legacy cho sub-stream phụ trợ (không dùng trong AI Live pipeline chính). Vui lòng dùng PUT /cameras/{id} cho stream chính hoặc POST /cameras/{id}/streams cho sub-stream.",
    security: [{ BearerAuth: [] }],
    request: {
      body: {
        content: {
          "application/json": { schema: createCameraStreamDirectSchema },
        },
      },
    },
    responses: {
      201: {
        description: "Tạo luồng stream thành công",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean(),
              data: z.any(),
            }),
          },
        },
      },
    },
  });

  openapiRegistry.registerPath({
    method: "get",
    path: "/camera-streams/{id}",
    tags: ["Camera Streams"],
    deprecated: true,
    summary: "Chi tiết luồng stream",
    description:
      "Endpoint legacy cho sub-stream phụ trợ (không dùng trong AI Live pipeline chính).",
    security: [{ BearerAuth: [] }],
    request: { params: streamIdParamSchema },
    responses: {
      200: {
        description: "Lấy chi tiết luồng stream thành công",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean(),
              data: z.any(),
            }),
          },
        },
      },
    },
  });

  openapiRegistry.registerPath({
    method: "put",
    path: "/camera-streams/{id}",
    tags: ["Camera Streams"],
    deprecated: true,
    summary: "Cập nhật luồng stream",
    description:
      "Endpoint legacy cho sub-stream phụ trợ (không dùng trong AI Live pipeline chính). Hỗ trợ chống ghi đè mật khẩu che giấu (:***@).",
    security: [{ BearerAuth: [] }],
    request: {
      params: streamIdParamSchema,
      body: {
        content: {
          "application/json": { schema: updateCameraStreamSchema },
        },
      },
    },
    responses: {
      200: {
        description: "Cập nhật luồng stream thành công",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean(),
              data: z.any(),
            }),
          },
        },
      },
    },
  });

  openapiRegistry.registerPath({
    method: "delete",
    path: "/camera-streams/{id}",
    tags: ["Camera Streams"],
    deprecated: true,
    summary: "Xóa luồng stream",
    description:
      "Endpoint legacy cho sub-stream phụ trợ (không dùng trong AI Live pipeline chính).",
    security: [{ BearerAuth: [] }],
    request: { params: streamIdParamSchema },
    responses: {
      200: {
        description: "Xóa luồng stream thành công",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean(),
              data: z.any(),
            }),
          },
        },
      },
    },
  });

  // ── Diagnostics & Health Endpoints ─────────────────────────────────────────
  openapiRegistry.registerPath({
    method: "get",
    path: "/cameras/health",
    tags: ["Cameras"],
    summary: "Kiểm tra trạng thái hoạt động của Camera Service",
    responses: {
      200: {
        description: "Dịch vụ hoạt động bình thường",
        content: {
          "application/json": {
            schema: z.object({
              status: z.string().openapi({ example: "ok" }),
              service: z.string().openapi({ example: "camera-service" }),
              checks: z.object({
                database: z.string().openapi({ example: "up" }),
              }),
              timestamp: z.string().datetime(),
              uptime: z.number(),
            }),
          },
        },
      },
    },
  });
}
