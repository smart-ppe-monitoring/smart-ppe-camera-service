-- Migration: 20261011120000_add_camera_deleted_at
-- Description: Bổ sung trường deleted_at và index phục vụ xóa mềm (soft delete) cho bảng cameras (SEC-12)

-- AlterTable
ALTER TABLE "cameras" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "cameras_deleted_at_idx" ON "cameras"("deleted_at");
