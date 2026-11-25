export const CAMERA_STATUS = {
  ONLINE: "ONLINE",
  OFFLINE: "OFFLINE",
  CONNECTING: "CONNECTING",
  ERROR: "ERROR",
  MAINTENANCE: "MAINTENANCE",
} as const;

export type CameraStatus = (typeof CAMERA_STATUS)[keyof typeof CAMERA_STATUS];

export const CAMERA_SOURCE_TYPE = {
  RTSP: "RTSP",
  HLS: "HLS",
  HTTP: "HTTP",
  FILE: "FILE",
} as const;

export type CameraSourceType =
  (typeof CAMERA_SOURCE_TYPE)[keyof typeof CAMERA_SOURCE_TYPE];

export const STREAM_PROTOCOL = {
  RTSP: "RTSP",
  HLS: "HLS",
  WEBRTC: "WEBRTC",
} as const;

export type StreamProtocol =
  (typeof STREAM_PROTOCOL)[keyof typeof STREAM_PROTOCOL];

export const STREAM_STATUS = {
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
} as const;

export type StreamStatus = (typeof STREAM_STATUS)[keyof typeof STREAM_STATUS];

export const MASKED_STREAM_PASSWORD = "***" as const;

export const CAMERA_ROI_LIMITS = {
  MIN_POINTS: 3,
  MAX_POINTS: 50,
  MAX_POLYGONS: 20,
  MIN_COORD: 0,
  MAX_COORD: 10000,
} as const;

export const DEFAULT_CAMERA_CONFIG = {
  CAPTURE_FPS: 10,
  RESOLUTION: "1920x1080",
  ENABLED: true,
  PROCESSING_ENABLED: true,
  MOTION_SENSITIVITY: 75,

  captureFps: 10,
  resolution: "1920x1080",
  enabled: true,
  processingEnabled: true,
  motionSensitivity: 75,
} as const;
