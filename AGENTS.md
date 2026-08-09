# Chỉ dẫn cho AI tiếp tục Robin Pickleball

Đọc tệp này trước khi làm việc, sau đó đọc phần **Bàn giao — đọc mục này trước**
trong `docs/TIEN-DO.md`. Tệp tiến độ là nhật ký đầy đủ; tệp này chỉ giữ những
điều dễ làm hỏng dự án nếu một phiên mới không biết.

## Trạng thái đã chốt

- Phiên bản phát hành: `v0.4.0`, tag Git `v0.4.0`, commit mã phát hành `9d223f0`.
- Production: https://robin-pickleball.vercel.app
- Vercel deployment đã kiểm `Ready`: `dpl_2ZKxmvrcRFfJWvjm3Heqe6rc8GmD`.
- HTML production trả HTTP 200 và có đúng `v0.4.0 · 9d223f0`.
- Bản `v0.4.0` là đợt kiểm định công bằng 4–11 người: 152 lượt mô phỏng, 0 vấn đề;
  toàn bộ 492 bài test xanh, `npm run typecheck` và `npm run build` sạch.
- Kho thử bền vững nằm ở `.data/test-sandbox.json`: chạy `npm run dev:test`, vào mã
  `TEST11`, mật khẩu người chơi `test1234`, quản trị `admin1234`. Chạy lại không
  reset dữ liệu và không đụng Google Sheet.
- Trên máy này CLB TEST có mã mời `H9DFHG`, 11 người TEST; SHA-256 của kho sau hai
  lần seed liên tiếp cùng là `239CF611EF64F9F19AE5A03926C66ABA426105602E7927993F8C1C725DCEA909`.
- Nhánh mặc định có các commit tài liệu bàn giao sau commit/tag production. Chênh
  lệch tài liệu đó với `main` là có chủ ý, không phải mã runtime còn làm dở.
- Không có mã tính năng đang làm dở sau v0.4.0.

## Những ranh giới không được vô tình phá

1. Trang chủ `/` dùng xanh emerald `#087a55` + đen, slogan **“Linh hoạt, công
   bằng, nhanh gọn.”**, nút `Setting`, và dòng **Maico Jack Sun** + cờ Việt Nam +
   `mtminhpc@gmail.com`.
2. Các màn hình sâu hơn (`/e/**`, `/c/**`, `/me`) giữ hệ Modernist cam–đen hiện
   có. Không đổi `accent` toàn cục sang xanh chỉ để sửa trang chủ.
3. Luật nghiệp vụ nằm ở `lib/domain` và `lib/scheduler`; hai thư mục này phải là
   hàm thuần và giữ khả năng phát lại nhật ký cho cùng một kết quả.
4. Dữ liệu thật nằm trong Google Sheet ở Production. Không xoá Sheet, `.data`,
   tài khoản, sự kiện hay CLB nếu người dùng không yêu cầu rõ.
5. `Mobile app design-handoff.zip` là tệp người dùng để ngoài Git. Không sửa,
   xoá hay commit tệp đó.

## Quy tắc làm mới dữ liệu khi phát hành

Mỗi bản có thay đổi chạy thật phải tăng version trong cả `package.json` và
`package-lock.json`. `ClientDataRefresh` dùng version này để dọn dữ liệu tạm và
tải lại đúng một lần.

Luôn bảo toàn:

- `rp_profile`, `rp_recent_events`, `rp_recent_clubs` trong localStorage;
- cookie thiết bị `rp_device` và cookie đăng nhập;
- hàng đợi lệnh `rp_queue_*` trong IndexedDB (có thể chứa tỷ số chưa gửi).

Không dùng `localStorage.clear()`, không xoá IndexedDB và không xoá cookie để
“chữa cache”. Xem `lib/client-data-version.ts`, `components/ClientDataRefresh.tsx`
và `tests/client-data-version.test.ts`.

## Kiểm thử an toàn trên máy này

Workspace nằm trong OneDrive. `.next` rất dễ hỏng nếu hai tiến trình cùng chạm
vào nó.

1. Dừng `npm run dev`/`next start` nếu đang chạy.
2. Chạy `npm test`.
3. Chạy `npm run build` và chờ xong hoàn toàn.
4. Chạy `npm run typecheck` sau build; không chạy song song với build.
5. Nếu `.next` báo `EINVAL`, `EBUSY` hoặc thiếu tệp, chỉ dọn/move đúng thư mục
   `.next`, tuyệt đối không đụng `.data`.

## Git và Vercel

- GitHub hiện đặt `claude/pickleball-round-robin-app-fq8sja` làm default branch.
- Vercel Production Branch là `main`.
- Push nhánh khác `main` chỉ tạo Preview. Muốn phát hành Production phải
  fast-forward/merge commit đã kiểm vào `main` rồi push `main`.
- Sau push không kết luận đã deploy. Phải chạy
  `vercel inspect https://robin-pickleball.vercel.app`, đợi `target production`
  + `status Ready`, rồi kiểm HTML có đúng `vX.Y.Z · <7 ký tự commit>`.
- Giữ nhánh `claude/nang-next-16` tách riêng. Nó nâng Next.js 16.3.0 nhưng cố ý
  chưa gộp; đọc mục tương ứng trong `docs/TIEN-DO.md` trước khi quyết định.

## Tệp nên đọc theo thứ tự

1. `AGENTS.md` (tệp này)
2. `docs/TIEN-DO.md`
3. `README.md`
4. `docs/SETUP.md` khi đụng Google/Vercel/OAuth
