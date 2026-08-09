# Claude Code — bắt đầu ở đây

Trước khi sửa bất kỳ thứ gì, hãy đọc đầy đủ:

1. `AGENTS.md` — các bất biến, ranh giới giao diện, dữ liệu cần bảo toàn và quy
   trình Git/Vercel.
2. Phần **Bàn giao — đọc mục này trước** trong `docs/TIEN-DO.md` — trạng thái và
   lịch sử kỹ thuật chi tiết.

Không coi một `git push` là đã phát hành: nhánh tính năng chỉ tạo Vercel Preview,
còn Production đi từ `main` và phải được kiểm lại qua alias công khai. Không sửa
hay commit tệp `Mobile app design-handoff.zip` của người dùng.

## Trạng thái cuối phiên 09/08/2026

- Runtime hiện tại là `v0.4.0`; tag `v0.4.0` và `origin/main` cùng trỏ commit
  `9d223f0`. Production `https://robin-pickleball.vercel.app` đã trả HTTP 200 với
  đúng huy hiệu `v0.4.0 · 9d223f0`; Vercel deployment
  `dpl_2ZKxmvrcRFfJWvjm3Heqe6rc8GmD` ở trạng thái `Ready`.
- Nhánh mặc định `claude/pickleball-round-robin-app-fq8sja` có thêm các commit tài
  liệu bàn giao sau `9d223f0`. Đây không phải mã runtime còn dang dở và không cần
  đẩy chúng vào `main` chỉ để đồng bộ lịch sử.
- Đã chạy `npm test`: 492/492 xanh; `npm run scenarios`: 152 lượt thực chiến
  4–11 người, 0 vấn đề; `npm run build` và `npm run typecheck` đều sạch.
- Các lỗi đã sửa tập trung vào người tới trễ, người về/quay lại, nghỉ tạm/quay lại,
  mẫu số lịch sử, lượt nghỉ giả, rebuild giữ nợ đội hình cũ, huỷ/bỏ dở bị lấp lại
  sân và nguy cơ xếp một người hai trận cùng vòng. Chi tiết và test hồi quy nằm ở
  mục bàn giao `v0.4.0` trong `docs/TIEN-DO.md`.
- Kho thử bền vững là `.data/test-sandbox.json`. Chạy `npm run dev:test`, vào sân
  `TEST11`; mật khẩu người chơi `test1234`, quản trị `admin1234`. Trên máy hiện tại
  CLB là `CLB TEST ROBIN`, mã mời `H9DFHG`, có 11 người TEST. Seed chạy lại không
  reset/nhân đôi và không đụng Google Sheet.
- Không xoá cả `.data`; muốn làm lại kho mặc định chỉ xoá `.data/sheet.json` và giữ
  `.data/test-sandbox.json`. Không có tính năng nào đang làm dở cuối phiên.
