# VẼ ĐI! – Game vẽ & đoán chữ Việt (đa người chơi)

## Chạy thử nhanh (không cần database)
    npm install
    npm start            # mở http://localhost:3000, dùng kho từ trong db/words.seed.json

Mở 2 tab (hoặc 2 máy cùng mạng) rồi bấm "Chơi ngay". Ván bắt đầu khi có từ 2 người.

## Chạy với PostgreSQL (kho từ + đóng góp + kiểm duyệt)
    export DATABASE_URL=postgres://user:pass@localhost:5432/vedi
    export ADMIN_TOKEN=doi-mat-khau-nay
    npm run seed         # tạo bảng và nạp từ mẫu
    npm start

Kiểm duyệt từ do người chơi gửi:
    curl -H "x-admin-token: $ADMIN_TOKEN" localhost:3000/api/words/pending
    curl -X POST -H "x-admin-token: $ADMIN_TOKEN" localhost:3000/api/words/ID/approve   # hoặc reject

## Triển khai
Cần một host chạy Node.js lâu dài và hỗ trợ WebSocket (VPS, Render, Railway, Fly.io…). Đặt `PORT`, `DATABASE_URL`, `ADMIN_TOKEN`. Nên đặt sau HTTPS (nginx/Caddy).

## Luồng game
Vào phòng → (≥2 người) tự bắt đầu → người vẽ chọn 1 trong 3 từ (12 giây, quá giờ tự chọn) → vẽ, người khác đoán →
đoán nhanh được nhiều điểm, người vẽ được điểm cho mỗi người đoán đúng → ai đạt điểm mục tiêu thì thắng, 10 giây sau ván mới.
Đoán gần đúng (sai 1 ký tự) chỉ báo riêng cho người đó. Người đã đoán đúng chat riêng với người vẽ. Gõ có/không dấu đều được.

## Cấu trúc
- `server.js`  Express + Socket.IO: phòng, lượt chơi, điểm, nét vẽ, chat, giới hạn tần suất
- `words.js`   kho từ (PostgreSQL hoặc file seed)
- `db/`        schema.sql, seed.js, words.seed.json
- `public/`    giao diện web

## Chưa có (nên làm tiếp)
Tài khoản/đăng nhập, bỏ phiếu đuổi người chơi, báo cáo vi phạm, lọc từ ngữ chat, Redis để chạy nhiều máy chủ, lưu bảng xếp hạng, độ khó/vùng miền khi chọn từ.
