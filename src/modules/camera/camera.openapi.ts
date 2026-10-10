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
    summary: "Cập nhật cấu hình AI (FPS, Resolution, Enabled)",
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

  // Streams
  openapiRegistry.registerPath({
    method: "get",
    path: "/cameras/{id}/streams",
    tags: ["Cameras"],
    summary: "Danh sách luồng stream của camera",
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
    summary: "Thêm luồng stream trực tiếp cho camera",
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
    summary: "Chi tiết luồng stream",
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
    summary: "Cập nhật luồng stream",
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
    summary: "Xóa luồng stream",
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
}
