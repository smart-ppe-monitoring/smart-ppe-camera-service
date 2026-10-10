import {
  CameraStatus,
  CameraSourceType,
  StreamProtocol,
  StreamStatus,
} from "../../common/constants/camera.constant";

import {
  PaginationMeta,
  PaginatedResult,
} from "../../common/types/pagination.type";

export type { PaginationMeta };
export type PaginatedResultDto<T> = PaginatedResult<T>;

// ── Camera DTOs ──────────────────────────────────────────────────────────────
export interface CreateCameraDto {
  siteId: string;
  zoneId?: string | null;
  name: string;
  code: string;
  sourceType?: CameraSourceType;
  streamUrl: string;
  status?: CameraStatus;
  location?: string;
  description?: string;
}

export interface UpdateCameraDto {
  zoneId?: string | null;
  name?: string;
  code?: string;
  sourceType?: CameraSourceType;
  streamUrl?: string;
  status?: CameraStatus;
  location?: string | null;
  description?: string | null;
}

export interface CameraQueryDto {
  page?: number;
  limit?: number;
  search?: string;
  siteId?: string;
  zoneId?: string;
  status?: CameraStatus;
  sourceType?: CameraSourceType;
  sortBy?: "name" | "code" | "createdAt" | "status";
  sortOrder?: "asc" | "desc";
}

// ── Camera Stream DTOs ───────────────────────────────────────────────────────
export interface CreateCameraStreamDto {
  cameraId: string;
  protocol?: StreamProtocol;
  streamUrl: string;
  resolution?: string;
  fps?: number;
  status?: StreamStatus;
}

export interface UpdateCameraStreamDto {
  protocol?: StreamProtocol;
  streamUrl?: string;
  resolution?: string;
  fps?: number;
  status?: StreamStatus;
}

// ── Camera Config DTOs ───────────────────────────────────────────────────────
export interface UpdateCameraConfigDto {
  enabled?: boolean;
  captureFps?: number;
  resolution?: string;
  processingEnabled?: boolean;
}

// ── Camera Health & Ping DTOs ────────────────────────────────────────────────
export interface CreateCameraHealthLogDto {
  cameraId: string;
  status: CameraStatus;
  latencyMs?: number | null;
  errorMessage?: string | null;
}

export interface CameraHealthLogQueryDto {
  page?: number;
  limit?: number;
  cameraId?: string;
  status?: CameraStatus;
  sortBy?: "checkedAt";
  sortOrder?: "asc" | "desc";
}

export interface PingCameraResultDto {
  cameraId: string;
  status: CameraStatus;
  latencyMs: number | null;
  success: boolean;
  errorMessage?: string | null;
  checkedAt: string | Date;
}
