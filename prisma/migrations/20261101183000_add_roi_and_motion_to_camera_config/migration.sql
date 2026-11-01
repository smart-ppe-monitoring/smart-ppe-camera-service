-- Migration: 20261101183000_add_roi_and_motion_to_camera_config
-- Description: Bổ sung roi_polygon và motion_sensitivity vào bảng camera_configs phục vụ cấu hình vùng nhận diện và độ nhạy chuyển động

ALTER TABLE "camera_configs" ADD COLUMN IF NOT EXISTS "roi_polygon" JSONB;
ALTER TABLE "camera_configs" ADD COLUMN IF NOT EXISTS "motion_sensitivity" INTEGER DEFAULT 75;

