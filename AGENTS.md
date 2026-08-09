# Chỉ dẫn cho AI tiếp tục Robin Pickleball

Đọc tệp này trước khi làm việc, sau đó đọc phần **Bàn giao — đọc mục này trước**
trong `docs/TIEN-DO.md`. Tệp tiến độ là nhật ký đầy đủ; tệp này chỉ giữ những
điều dễ làm hỏng dự án nếu một phiên mới không biết.

## Trạng thái đã chốt

- Phiên bản phát hành: `v0.4.1`, tag Git `v0.4.1`, commit mã phát hành `6ae181f`.
- Production: https://robin-pickleball.vercel.app
- Vercel deployment đã kiểm `Ready`: `dpl_DANZBkMLZyJ7aGY3JNFWx215eeNs`.
- HTML production trả HTTP 200 và có đúng `v0.4.1 · 6ae181f`.
- Bản `v0.4.1` ký HMAC cookie thiết bị, lược mã máy khỏi mọi trạng thái HTTP/RSC,
  sửa cột đuổi kịp và thêm `nosniff` cho ảnh. Toàn bộ 498 bài test xanh; 152 lượt
  mô phỏng 4–11 người/0 vấn đề; `npm run typecheck` và `npm run build` sạch.
- Kho thử bền vững nằm ở `.data/test-sandbox.json`: chạy `npm run dev:test`, vào mã
  `TEST11`, mật khẩu người chơi `test1234`, quản trị `admin1234`. Chạy lại không
  reset dữ liệu và không đụng Google Sheet.
- Trên máy này CLB TEST có mã mời `H9DFHG`, 11 người TEST; SHA-256 hiện tại là
  `401186052ECD8F279A3F413AD30818760DA95BD79A5D2E2F668026B2C720CE76`. Bốn probe
  cũ của phiên đánh giá bảo mật đã nằm trong log; probe v0.4.1 bị 403 và không ghi thêm.
- Nhánh mặc định có các commit tài liệu bàn giao sau commit/tag production. Chênh
  lệch tài liệu đó với `main` là có chủ ý, không phải mã runtime còn làm dở.
- Không có mã tính năng đang làm dở sau v0.4.1.

## Bất biến bảo mật danh tính từ v0.4.1

- `rp_device` là token HMAC `httpOnly`; mọi API phải đọc qua
  `deviceIdFromRequest`, không đọc thẳng `request.cookies`.
- Cookie UUID trần của v0.4.0 trở về trước **không được ký lại**. Nó từng bị phát
  công khai, nên phải thay bằng danh tính mới. Dữ liệu trong Sheet không bị xoá;
  tài khoản Google vẫn nhận qua `userId`, danh tính chỉ-ẩn-danh có thể cần nhận tên lại.
- Không trả thẳng `EventState` ở route, mutation response hay Server Component.
  Luôn đi qua `publicEventSnapshot`/`redactEventState`; cả `Player.deviceId`,
  `submittedBy.ref` và `edits[].by.ref` đều là dữ liệu nội bộ.

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
- cookie thiết bị đã ký `rp_device` và cookie đăng nhập (không tự xoá; middleware
  chỉ chủ động thay cookie **cũ không ký** trong lần chuyển sang v0.4.1);
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
- `claude/nang-next-16` là bản thí nghiệm lịch sử từ mốc `d24f924`, cũ hơn bốn
  bản phát hành và đụng các tệp bảo mật vừa đổi. **Không merge nhánh đó.** Muốn
  nâng Next 16 phải tạo nhánh mới từ `v0.4.1` và làm lại có kiểm định.

## Tệp nên đọc theo thứ tự

1. `AGENTS.md` (tệp này)
2. `docs/TIEN-DO.md`
3. `README.md`
4. `docs/SETUP.md` khi đụng Google/Vercel/OAuth
