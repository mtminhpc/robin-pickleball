# Claude Code — bắt đầu ở đây

Trước khi sửa bất kỳ thứ gì, hãy đọc đầy đủ:

1. `AGENTS.md` — các bất biến, ranh giới giao diện, dữ liệu cần bảo toàn và quy
   trình Git/Vercel.
2. Phần **Bàn giao — đọc mục này trước** trong `docs/TIEN-DO.md` — trạng thái và
   lịch sử kỹ thuật chi tiết.

Không coi một `git push` là đã phát hành: nhánh tính năng chỉ tạo Vercel Preview,
còn Production đi từ `main` và phải được kiểm lại qua alias công khai. Không sửa
hay commit hai ZIP handoff của người dùng.

## Trạng thái cuối phiên Codex 09/08/2026 — v0.6.0

- Nhánh phát hành: `codex/v0.6.0-media-cache-copy`, dựng từ tag `v0.5.1`.
- Điều hành: đúng một Chủ, tối đa năm Phó mời bằng Gmail và mật khẩu điều hành dự
  phòng. Quyền nằm trong ma trận capability tập trung; đổi mật khẩu tăng version và
  vô hiệu phiên mật khẩu cũ, không ảnh hưởng phiên Google Chủ/Phó.
- Sửa sai: Chủ/Phó sửa hoặc hoàn tác kết quả đã chốt với lý do bắt buộc; sau khi
  finished chỉ Chủ được sửa. Log công khai chỉ có nhãn vai trò/tên, không có email,
  user ID, device ID hoặc actor ref.
- Tạo buổi tách tên/địa chỉ, có số người dự kiến và ước tính số trận/thời lượng.
  Chủ sao chép buổi finished bằng idempotency key; bản sao không mang lịch, điểm,
  giải, ngày giờ, quyền hay mật khẩu và phải qua quota.
- Editor ảnh dùng chung cho tài trợ/cúp/avatar: contain/cover, kéo/pinch, zoom, xoay,
  trim và preview theo khung; chỉ lưu đầu ra 256×256 đã xử lý + metadata. Logo/cúp ở
  `event_assets`, avatar mới ở `account_assets`; dữ liệu ảnh legacy vẫn đọc được.
- `EventProvider` tồn tại xuyên năm tab, IndexedDB cache snapshot đã lược quyền, ETag,
  BroadcastChannel, poll thích ứng và hàng đợi offline. Các lệnh quan trọng gửi ngay;
  banner nói rõ đang xử lý/lưu/đã lưu/đồng bộ/xung đột/mất mạng.
- `PromoteMatch` đưa một trận tương lai hợp lệ lên lượt sân bổ sung, không dời cả
  vòng và không cho cưỡng ép. `StartMatch` kiểm lại trùng người/sân. Precondition được
  ghi cùng log giúp nhiều Vercel instance phân xử cùng tỷ số/vị trí mà không chặn
  các lệnh độc lập.
- Kho test giữ `TEST11`, `TESTV5`, CLB/sân/11 người và thêm `TESTV6`; seed chạy lại
  không reset hoặc nhân đôi. SHA local sau seed:
  `6DD0194AE0FC81784CEA39301D8DD372B7AFD9FDCE738243088CCB5D5A20754D`. Cổng phát hành:
  560/560 test, 152 lượt công bằng/0 vấn đề, typecheck và build sạch. Smoke test
  Chrome 390×844 + Edge 1440×1000; ETag trả 304 và public state không có
  `userId`/`deviceId`.

## Trạng thái cuối phiên Codex 09/08/2026 — v0.5.1

- Nhánh phát hành là `codex/v0.5.1-cross-device-history`, dựng tiếp từ tag
  `v0.5.0`; không sửa lại giao diện/tài trợ/Bảng vàng đã chạy tốt.
- `HY62PJ · Test sân` đã được kiểm trực tiếp trên Production và vẫn tồn tại. Lý
  do hai máy khác nhau là mục “Gần đây” trước đây chỉ nằm trong localStorage;
  dữ liệu sự kiện trên Google Sheet không bị xoá.
- `POST /api/events/recent` nay chép lịch sử thiết bị lên tài khoản rồi gộp các
  thiết bị cùng Gmail. Khoá `rp_recent_events_account` ngăn Gmail tiếp theo trên
  máy dùng chung thừa hưởng lịch sử Gmail trước; dữ liệu legacy được nhận vào
  Gmail đầu tiên để cứu danh sách cũ.
- `POST /api/events/[code]/ownership` nhận buổi có `owner_user_id` rỗng sau khi
  đăng nhập và nhập lại đúng mật khẩu chủ. Tab `event_owner_claims` append-only
  chọn ứng viên đầu tiên; quota vẫn áp dụng với buổi chưa kết thúc. Không dùng
  app-admin để vào buổi của người khác và không ghi lại snapshot/tỷ số.
- Form tạo buổi có hai ô Giờ bắt đầu (`HH:mm`) rồi Ngày diễn ra
  (`DD/MM/YYYY`), ghép theo múi giờ thiết bị; phải nhập đủ cả hai hoặc để trống.
- Kho TEST/`TEST11`/`TESTV5` giữ nguyên. Cổng cuối: 524/524 test, 152
  lượt công bằng/0 vấn đề, build và typecheck sạch.

## Trạng thái cuối phiên Codex 09/08/2026 — v0.5.0

- Mã v0.5.0 nằm trên `codex/design-handoff-v3-v0.5.0`, dựng từ handoff Claude
  Design v3; trang chủ xanh–đen có đúng 4 tab và cụm đăng nhập/Setting. Các màn
  hình sâu vẫn Modernist cam–đen.
- Chỉ tài khoản Google tạo sự kiện. Mặc định tối đa 3 sự kiện chưa kết thúc;
  `finished` trả lại lượt. Hai app admin là `mtminhpc@gmail.com` và
  `prolathevt02@gmail.com`, chỉ quản lý hạn mức 3–100/vô hạn trong Setting.
- Tài trợ: Kim cương/Vàng/Bạc/Đồng hành đều tối đa 2; hạng tự đặt không giới hạn;
  đủ vuông/tròn/nền trong, sửa/xoá/sắp xếp và dải trên mọi tab sự kiện.
- Giải thưởng chỉ trao sau khi kết thúc: giải chuẩn/tự đặt, đồng giải, một người
  nhiều giải, cúp mặc định/ảnh tải lên; Bảng vàng đứng trước xếp hạng và hàng xếp
  hạng có cúp nhỏ.
- Snapshot cũ tự bổ sung `scheduledAt`/`presentation`; ảnh tách vào
  `event_assets`, có magic-byte + MIME + `nosniff`. Lớp danh tính v0.4.1 giữ nguyên.
- Cổng cuối: 19 tệp, 513/513 test; 152 lượt kịch bản công bằng/0 vấn đề; build và
  typecheck sạch. `TEST11` được giữ; `TESTV5` là fixture tài trợ/Bảng vàng.
- SHA-256 kho TEST trên máy sau khi thêm `TESTV5`:
  `FAF9167333BA9C5CD1C72065C82F06393650F133F90B7000D2EEA099565254DA`.
- Nếu tiếp tục: đọc `AGENTS.md` và đầu `docs/TIEN-DO.md`; không sửa lại phần đã
  xanh nếu không có bằng chứng lỗi. Hai ZIP handoff vẫn untracked có chủ ý.

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
