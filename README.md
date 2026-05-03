# FB Ads Multi-Account Auto Controller

Hệ thống tự động điều khiển quảng cáo Facebook cho nhiều tài khoản, tích hợp Claude AI và MongoDB.

## Yêu cầu

- Node.js 18+
- MongoDB (local hoặc MongoDB Atlas)
- Facebook Access Token (quyền `ads_management`, `pages_messaging`)
- Claude API Key (tuỳ chọn, để AI phân tích)

## Cài đặt

```bash
cd backend
npm install
```

## Cấu hình

Sửa file `backend/.env`:

```env
# MongoDB local
MONGO_URI=mongodb://localhost:27017/fb_ads_manager

# Hoặc MongoDB Atlas
MONGO_URI=mongodb+srv://user:password@cluster.mongodb.net/fb_ads_manager

PORT=3000

# Redis queue (BullMQ)
REDIS_URL=redis://127.0.0.1:6379
CAMPAIGN_DUPLICATE_QUEUE_CONCURRENCY=1
CAMPAIGN_DUPLICATE_JOB_ATTEMPTS=1
CAMPAIGN_SYNC_QUEUE_CONCURRENCY=1
CAMPAIGN_SYNC_JOB_ATTEMPTS=1
CAMPAIGN_SYNC_DAY_DELAY_MS=300
```

When Redis is enabled, `POST /api/campaigns/duplicate-exact` returns `202` with a `jobId`.
Check progress at `GET /api/queues/campaign-duplicates/jobs/:id`.
Send `"queue": false` in the request body to run the old inline behavior.
Campaign spend sync also uses BullMQ: `POST /api/campaigns/sync-history` returns a `jobId`,
and progress is available at `GET /api/campaigns/sync-history/:jobId`.

## Chạy

```bash
cd backend
node server.js
```

Mở trình duyệt: **http://localhost:3000**

## Tính năng

- ✅ Quản lý **nhiều tài khoản** quảng cáo FB
- ✅ Xem **tất cả chiến dịch hôm nay** theo từng tài khoản
- ✅ Hiển thị **số tin nhắn** và **chi phí/tin nhắn** cho mỗi camp
- ✅ **Tự động tắt** quảng cáo khi chi tiêu ≥ ngưỡng & không có tin nhắn
- ✅ **Tự động bật** lại khi có tin nhắn mới
- ✅ Tích hợp **Claude AI** phân tích chiến lược
- ✅ Lưu lịch sử vào **MongoDB**
- ✅ Nhật ký hoạt động theo thời gian thực

## Cấu trúc dữ liệu MongoDB

### Collection: accounts
- name, fbToken, adAccountId, claudeKey
- spendThreshold (ngưỡng tạm dừng)
- checkInterval (chu kỳ kiểm tra, giây)
- autoEnabled (bật/tắt tự động)
- status: connected | error | disconnected

### Collection: campaigns
- accountId (ref Account)
- campaignId, name, status
- spend, impressions, clicks
- messages (số tin nhắn từ camp)
- costPerMessage (chi phí/tin nhắn)
- date (YYYY-MM-DD)

### Collection: logs
- accountId, accountName, level, message, createdAt

## API Endpoints

| Method | Path | Mô tả |
|--------|------|-------|
| GET | /api/accounts | Danh sách tài khoản |
| POST | /api/accounts | Thêm tài khoản |
| PUT | /api/accounts/:id | Sửa tài khoản |
| DELETE | /api/accounts/:id | Xoá tài khoản |
| POST | /api/accounts/:id/toggle-auto | Bật/tắt tự động |
| POST | /api/accounts/:id/refresh | Làm mới dữ liệu |
| GET | /api/campaigns/today | Tất cả camp hôm nay |
| GET | /api/accounts/:id/campaigns | Camp của tài khoản |
| POST | /api/campaigns/:id/toggle | Tắt/bật camp |
| GET | /api/stats | Thống kê tổng hợp |
| GET | /api/logs | Nhật ký hoạt động |
