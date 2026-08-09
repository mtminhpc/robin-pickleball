# Claude Code — bắt đầu ở đây

Trước khi sửa bất kỳ thứ gì, hãy đọc đầy đủ:

1. `AGENTS.md` — các bất biến, ranh giới giao diện, dữ liệu cần bảo toàn và quy
   trình Git/Vercel.
2. Phần **Bàn giao — đọc mục này trước** trong `docs/TIEN-DO.md` — trạng thái và
   lịch sử kỹ thuật chi tiết.

Không coi một `git push` là đã phát hành: nhánh tính năng chỉ tạo Vercel Preview,
còn Production đi từ `main` và phải được kiểm lại qua alias công khai. Không sửa
hay commit tệp `Mobile app design-handoff.zip` của người dùng.

## Trạng thái cuối phiên 09/08/2026 — v0.4.1

- Runtime hiện tại là `v0.4.1`; tag `v0.4.1` và `origin/main` cùng trỏ commit
  `6ae181f`. Production `https://robin-pickleball.vercel.app` đã trả HTTP 200 với
  đúng huy hiệu `v0.4.1 · 6ae181f`; Vercel deployment
  `dpl_DANZBkMLZyJ7aGY3JNFWx215eeNs` ở trạng thái `Ready`.
- Nhánh mặc định `claude/pickleball-round-robin-app-fq8sja` có thêm các commit tài
  liệu bàn giao sau `6ae181f`. Đây không phải mã runtime còn dang dở và không cần
  đẩy chúng vào `main` chỉ để đồng bộ lịch sử.
- Đã chạy `npm test`: 498/498 xanh; `npm run scenarios`: 152 lượt thực chiến
  4–11 người, 0 vấn đề; `npm run build` và `npm run typecheck` đều sạch.
- Đợt v0.4.1 xác nhận báo cáo bảo mật của Claude là đúng: UUID thiết bị từng vừa
  là giấy thông hành vừa nằm trong `/state`. Nay cookie được ký HMAC + `httpOnly`,
  mọi API xác minh tập trung, và mọi trạng thái HTTP/RSC lược mã ở người chơi,
  người nhập điểm lẫn lịch sử sửa. Probe cookie sao chép bị HTTP 403; Production
  cũng đã kiểm không còn chuỗi `deviceId` trong `/state`.
- Cột ưu tiên `GrantCatchUp` nay phản ánh đúng phần tín dụng còn tác động dù lệnh
  được cấp sau khi đã chơi; ảnh tài khoản có `X-Content-Type-Options: nosniff`.
- Cookie cũ không ký bắt buộc đổi sang danh tính mới; không có dữ liệu nào bị xoá.
  Người có Google vẫn khớp qua `userId`; người chỉ dùng ẩn danh có thể nhận tên lại.
- Kho thử bền vững là `.data/test-sandbox.json`. Chạy `npm run dev:test`, vào sân
  `TEST11`; mật khẩu người chơi `test1234`, quản trị `admin1234`. Trên máy hiện tại
  CLB là `CLB TEST ROBIN`, mã mời `H9DFHG`, có 11 người TEST. Seed chạy lại không
  reset/nhân đôi và không đụng Google Sheet. SHA hiện tại:
  `401186052ECD8F279A3F413AD30818760DA95BD79A5D2E2F668026B2C720CE76`.
- Không xoá cả `.data`; muốn làm lại kho mặc định chỉ xoá `.data/sheet.json` và giữ
  `.data/test-sandbox.json`. Không có tính năng nào đang làm dở cuối phiên.
- Không merge `claude/nang-next-16`: nhánh đó dựa trên `d24f924` và đã cũ hơn các
  thay đổi danh tính/cache/middleware hiện tại. Muốn nâng Next phải dựng lại từ
  `v0.4.1`. `npm audit` hiện vẫn báo 3 high qua Next 15 (`postcss`, `sharp`), nhưng
  app không nhận CSS đầu vào và không dùng `next/image`; bản sửa là nâng major 16.3.0.
