import { z } from "zod";
import {
  CAMERA_STATUS,
  CAMERA_SOURCE_TYPE,
  STREAM_PROTOCOL,
  STREAM_STATUS,
} from "../../common/constants/camera.constant";
import { isCloudMetadataOrLoopbackHost } from "../../common/helpers/url.helper";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const uuidSchema = z
  .string()
  .trim()
  .regex(UUID_REGEX, "ID phải là định dạng UUID hợp lệ");

export const cameraIdParamSchema = z.object({
  id: uuidSchema,
});

export const streamIdParamSchema = z.object({
  id: uuidSchema,
});

const CODE_REGEX = /^[A-Z0-9_-]+$/i;
const STREAM_URL_REGEX = /^(rtsp|rtsps|http|https|hls|ws|wss):\/\/.+/i;

export const streamUrlSchema = z
  .string({ required_error: "Đường dẫn stream là bắt buộc" })
  .trim()
  .min(3, "Đường dẫn stream phải có ít nhất 3 ký tự")
  .max(1000, "Đường dẫn stream không được vượt quá 1000 ký tự")
  .regex(
    STREAM_URL_REGEX,
    "Đường dẫn stream phải bắt đầu bằng giao thức hợp lệ (rtsp, rtsps, http, https, hls, ws, wss)",
  )
  .refine((url) => {
    try {
      const parsed = new URL(url);
      return !isCloudMetadataOrLoopbackHost(parsed.hostname);
    } catch {
      return false;
    }
  }, "Đường dẫn stream không được trỏ đến địa chỉ cloud metadata hoặc loopback");

// ── Camera Schemas ───────────────────────────────────────────────────────────
export const createCameraSchema = z.object({
  siteId: uuidSchema,
  zoneId: uuidSchema.nullable().optional(),
  name: z
    .string({ required_error: "Tên camera là bắt buộc" })
    .trim()
    .min(2, "Tên camera phải có ít nhất 2 ký tự")
    .max(150, "Tên camera không được vượt quá 150 ký tự"),
  code: z
    .string({ required_error: "Mã camera là bắt buộc" })
    .trim()
    .min(2, "Mã camera phải có ít nhất 2 ký tự")
    .max(50, "Mã camera không được vượt quá 50 ký tự")
    .regex(CODE_REGEX, "Mã camera chỉ gồm chữ cái, số, gạch dưới và gạch ngang"),
  sourceType: z
    .enum(
      [
        CAMERA_SOURCE_TYPE.RTSP,
        CAMERA_SOURCE_TYPE.HLS,
        CAMERA_SOURCE_TYPE.HTTP,
        CAMERA_SOURCE_TYPE.FILE,
      ],
      { errorMap: () => ({ message: "Loại nguồn stream không hợp lệ" }) },
    )
    .optional(),
  streamUrl: streamUrlSchema,
  status: z
    .enum(
      [
        CAMERA_STATUS.ONLINE,
        CAMERA_STATUS.OFFLINE,
        CAMERA_STATUS.CONNECTING,
        CAMERA_STATUS.ERROR,
        CAMERA_STATUS.MAINTENANCE,
      ],
      { errorMap: () => ({ message: "Trạng thái camera không hợp lệ" }) },
    )
    .optional(),
  location: z.string().trim().max(1000).nullable().optional(),
  description: z.string().trim().max(1000).nullable().optional(),
});

export const updateCameraSchema = createCameraSchema
  .omit({ siteId: true })
  .partial()
  .refine(
    (data) => Object.keys(data).length > 0,
    "Cần cung cấp ít nhất một trường để cập nhật",
  );

export const cameraQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(),
  siteId: uuidSchema.optional(),
  zoneId: uuidSchema.optional(),
  status: z
    .enum([
      CAMERA_STATUS.ONLINE,
      CAMERA_STATUS.OFFLINE,
      CAMERA_STATUS.CONNECTING,
      CAMERA_STATUS.ERROR,
      CAMERA_STATUS.MAINTENANCE,
    ])
    .optional(),
  sourceType: z
    .enum([
      CAMERA_SOURCE_TYPE.RTSP,
      CAMERA_SOURCE_TYPE.HLS,
      CAMERA_SOURCE_TYPE.HTTP,
      CAMERA_SOURCE_TYPE.FILE,
    ])
    .optional(),
  sortBy: z.enum(["name", "code", "createdAt", "status"]).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
});

// ── Camera Stream Schemas ────────────────────────────────────────────────────
export const createCameraStreamSchema = z.object({
  cameraId: uuidSchema.optional(),
  protocol: z
    .enum([STREAM_PROTOCOL.RTSP, STREAM_PROTOCOL.HLS, STREAM_PROTOCOL.WEBRTC], {
      errorMap: () => ({ message: "Giao thức stream không hợp lệ" }),
    })
    .optional(),
  streamUrl: streamUrlSchema,
  resolution: z
    .string()
    .trim()
    .regex(/^\d+x\d+$/, "Độ phân giải phải theo định dạng WxH (vd: 1920x1080)")
    .optional(),
  fps: z.coerce.number().int().min(1).max(60).optional(),
  status: z
    .enum([STREAM_STATUS.ACTIVE, STREAM_STATUS.INACTIVE], {
      errorMap: () => ({ message: "Trạng thái stream không hợp lệ" }),
    })
    .optional(),
});

export const createCameraStreamDirectSchema = createCameraStreamSchema.extend({
  cameraId: uuidSchema,
});

export const updateCameraStreamSchema = createCameraStreamSchema
  .omit({ cameraId: true })
  .partial()
  .refine(
    (data) => Object.keys(data).length > 0,
    "Cần cung cấp ít nhất một trường để cập nhật",
  );

// ── Camera Config Schemas ────────────────────────────────────────────────────
export const roiPointSchema = z.object({
  x: z
    .number({ required_error: "Tọa độ X là bắt buộc" })
    .finite("Tọa độ X phải là số hữu hạn")
    .min(0, "Tọa độ X không được âm")
    .max(10000, "Tọa độ X không được vượt quá 10000"),
  y: z
    .number({ required_error: "Tọa độ Y là bắt buộc" })
    .finite("Tọa độ Y phải là số hữu hạn")
    .min(0, "Tọa độ Y không được âm")
    .max(10000, "Tọa độ Y không được vượt quá 10000"),
});

export const roiPolygonSchema = z
  .union([
    z
      .array(roiPointSchema)
      .min(3, "Đa giác ROI cần ít nhất 3 điểm tọa độ (x, y)")
      .max(50, "Đa giác ROI không được vượt quá 50 điểm tọa độ"),
    z.array(roiPointSchema).length(0),
  ])
  .nullable()
  .optional();

export const updateCameraConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    captureFps: z.coerce
      .number()
      .int()
      .min(1, "Capture FPS tối thiểu là 1")
      .max(30, "Capture FPS tối đa là 30")
      .optional(),
    resolution: z
      .string()
      .trim()
      .regex(/^\d+x\d+$/, "Độ phân giải phải theo định dạng WxH (vd: 1920x1080)")
      .optional(),
    processingEnabled: z.boolean().optional(),
    roiPolygon: roiPolygonSchema,
    motionSensitivity: z.coerce
      .number()
      .int("Độ nhạy chuyển động phải là số nguyên")
      .min(1, "Độ nhạy chuyển động tối thiểu là 1")
      .max(100, "Độ nhạy chuyển động tối đa là 100")
      .optional(),
  })
  .refine(
    (data) => Object.keys(data).length > 0,
    "Cần cung cấp ít nhất một trường để cập nhật",
  );

// ── Camera Health Log Schemas ────────────────────────────────────────────────
export const cameraHealthLogQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cameraId: uuidSchema.optional(),
  status: z
    .enum([
      CAMERA_STATUS.ONLINE,
      CAMERA_STATUS.OFFLINE,
      CAMERA_STATUS.CONNECTING,
      CAMERA_STATUS.ERROR,
      CAMERA_STATUS.MAINTENANCE,
    ])
    .optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
});
