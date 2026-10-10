-- CreateTable
CREATE TABLE "cameras" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "site_id" UUID NOT NULL,
    "zone_id" UUID,
    "name" VARCHAR(150) NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "source_type" VARCHAR(30) NOT NULL DEFAULT 'RTSP',
    "stream_url" TEXT NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'OFFLINE',
    "location" TEXT,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cameras_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "camera_streams" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "camera_id" UUID NOT NULL,
    "protocol" VARCHAR(30) NOT NULL DEFAULT 'RTSP',
    "stream_url" TEXT NOT NULL,
    "resolution" VARCHAR(30) NOT NULL DEFAULT '1920x1080',
    "fps" INTEGER NOT NULL DEFAULT 25,
    "status" VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
    "last_connected_at" TIMESTAMP(3),
    "last_disconnected_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "camera_streams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "camera_configs" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "camera_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "capture_fps" INTEGER NOT NULL DEFAULT 10,
    "resolution" VARCHAR(30) NOT NULL DEFAULT '1920x1080',
    "processing_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "camera_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "camera_health_logs" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "camera_id" UUID NOT NULL,
    "status" VARCHAR(30) NOT NULL,
    "checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "latency_ms" INTEGER,
    "error_message" TEXT,

    CONSTRAINT "camera_health_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cameras_code_key" ON "cameras"("code");

-- CreateIndex
CREATE INDEX "cameras_site_id_status_idx" ON "cameras"("site_id", "status");

-- CreateIndex
CREATE INDEX "camera_streams_camera_id_idx" ON "camera_streams"("camera_id");

-- CreateIndex
CREATE UNIQUE INDEX "camera_configs_camera_id_key" ON "camera_configs"("camera_id");

-- CreateIndex
CREATE INDEX "camera_health_logs_camera_id_checked_at_idx" ON "camera_health_logs"("camera_id", "checked_at");

-- AddForeignKey
ALTER TABLE "camera_streams" ADD CONSTRAINT "camera_streams_camera_id_fkey" FOREIGN KEY ("camera_id") REFERENCES "cameras"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "camera_configs" ADD CONSTRAINT "camera_configs_camera_id_fkey" FOREIGN KEY ("camera_id") REFERENCES "cameras"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "camera_health_logs" ADD CONSTRAINT "camera_health_logs_camera_id_fkey" FOREIGN KEY ("camera_id") REFERENCES "cameras"("id") ON DELETE CASCADE ON UPDATE CASCADE;
