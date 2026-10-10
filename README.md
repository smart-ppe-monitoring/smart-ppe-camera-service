# smart-ppe-camera-service

> **Camera Management Microservice** cho Hệ thống Giám sát An toàn Lao động Thông minh (**Smart PPE Monitoring System**), phụ trách quản lý thiết bị camera, luồng truyền tải video RTSP/HLS, cấu hình xử lý AI (FPS, Resolution) và kiểm tra sức khỏe/độ trễ kết nối (Health Probes) theo chuẩn **D08.pdf (Mục 3.5 & Task BE-05)**.

---

## 🏛️ Trách nhiệm nghiệp vụ

- **Quản lý Camera (`/api/v1/cameras`)**: CRUD thông tin camera, vị trí lắp đặt, liên kết công trường/phân khu.
- **Quản lý Luồng Stream (`CameraStream`)**: Hỗ trợ nhiều luồng (RTSP, HLS, WebRTC), tự động che giấu mật khẩu thông tin đăng nhập trong URL stream (CWE-200 / Credential Masking).
- **Cấu hình xử lý AI (`CameraConfig`)**: Quản lý FPS tối ưu (mặc định 10 FPS để tiết kiệm 60-70% tải GPU), độ phân giải (1080p), bật/tắt xử lý AI theo thời gian thực.
- **Giám sát kết nối & Health Probe (`/api/v1/cameras/:id/ping`)**: Đo đạc độ trễ mạng latency, ghi nhận nhật ký kiểm toán trạng thái kết nối (`CameraHealthLog`), tự động bảo toàn trạng thái `MAINTENANCE` khi kỹ thuật viên đang sửa chữa.

---

## 🚀 Khởi chạy cục bộ (Local Development)

```bash
# 1. Cài đặt dependencies
pnpm install

# 2. Cấu hình biến môi trường
cp .env.example .env

# 3. Sinh Prisma Client từ schema
pnpm run prisma:generate

# 4. Khởi chạy chế độ phát triển
pnpm run dev
# Server lắng nghe tại http://localhost:8892
```

---

## 🧪 Kiểm thử tự động (Unit Tests)

```bash
pnpm test
```

---

## 🐳 Triển khai Docker

```bash
docker build -t smart-ppe-camera-service .
docker run -p 8892:8892 --env-file .env smart-ppe-camera-service
```
