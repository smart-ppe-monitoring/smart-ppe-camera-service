-- Migration: 20261011130000_add_camera_created_at_indexes
-- Description: Bổ sung chỉ mục trên created_at và [site_id, created_at] phục vụ tối ưu hóa phân trang (SEC-29)

-- CreateIndex
CREATE INDEX IF NOT EXISTS "cameras_created_at_idx" ON "cameras"("created_at");
CREATE INDEX IF NOT EXISTS "cameras_site_id_created_at_idx" ON "cameras"("site_id", "created_at");
