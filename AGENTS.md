# Chỉ dẫn cho AI tiếp tục Robin Pickleball

Đọc tệp này trước khi làm việc, sau đó đọc phần **Bàn giao — đọc mục này trước**
trong `docs/TIEN-DO.md`. Tệp tiến độ là nhật ký đầy đủ; tệp này chỉ giữ những
điều dễ làm hỏng dự án nếu một phiên mới không biết.

> **Việc còn nợ:** luồng bấm nút *Xóa sự kiện* (v0.6.1) chưa ai chạy qua trên giao
> diện, kể cả Production. Tầng hàm và đường đọc HTTP đã kiểm thật; phần bấm nút thì
> chưa, vì kho thử gắn buổi vào `userId` giả `test-owner`. Xem mục **Chưa kiểm —
> việc đầu tiên của phiên sau** trong `docs/TIEN-DO.md`.

## Trạng thái đã chốt

- Phiên bản mã hiện tại: `v0.6.2`, nhánh phát hành
  `codex/v0.6.1-unlimited-sponsors-event-delete`. Tag/Production phải cùng trỏ bản
  đã qua cổng kiểm định; xem huy hiệu dưới phải giao diện để biết commit đang chạy.
- Production: https://robin-pickleball.vercel.app
- `v0.6.1` đã phát hành (tag `v0.6.1` = `e648329`). `v0.6.2` là bản vá cuộc đua
  `ensureTab` phát hiện ngay ở lượt deploy đó (tag `v0.6.2` = `a30a0ab`) — xem mục dưới.
- Huy hiệu Production hiện commit **mới nhất của `main`**, nên commit chỉ-sửa-tài-liệu
  cũng làm phần hash đổi trong khi mã chạy không đổi. Đối chiếu phần `v0.6.x` trước,
  hash sau; muốn biết mã nào đang chạy thì so với tag.
- Mốc Production trước đợt v0.6.0 là `v0.5.1 · a54125f`; sau khi đẩy `main` phải kiểm
  alias và huy hiệu lại, không coi push nhánh tính năng là đã phát hành.
- **`ensureTab` không nguyên tử, và từ v0.6.1 điều đó quan trọng.** Tab mới nay có thể
  được tạo từ `readEvent`, đường mà mọi trang và API đều đi qua, nên nhiều hàm
  serverless dễ cùng tạo một lúc. Lượt deploy v0.6.1 đầu tiên đã trả 500 vì vậy.
  Từ v0.6.2, `addSheet` hỏng mà đọc lại thấy tab đã có thì coi như xong. Khi thêm tab
  mới, đừng cho rằng lần chạy đầu là tuần tự.
- Bản `v0.6.1` bỏ trần 2 logo ở mọi hạng tài trợ và thêm **xóa mềm sự kiện**. Xóa chỉ
  ghi cờ vào tab append-only `event_deletions`; **không** xóa dòng `events`, snapshot,
  nhật ký tỷ số hay ảnh. Chủ xóa được buổi `draft`/`finished` của chính mình, App admin
  xóa được cả hai trạng thái đó của bất kỳ ai, và **không ai xóa được buổi `running`**.
  Chỉ App admin khôi phục. Mọi đường đọc lọc mã đã xóa: `readEvent` trả `null`,
  `resolveContext` trả `410`, và `excludeDeletedEvents` bọc các chỗ gọi thẳng
  `listByOwner`/`listByCodes` (danh sách, quota, gần đây, `/api/me`, nhận lại buổi cũ).
  Thêm một đường đọc thô mới thì phải bọc nó, nếu không buổi đã xóa sẽ hồi sinh.
- Bản `v0.6.0` có 1 Chủ + tối đa 5 Phó + mật khẩu điều hành giới hạn; phân quyền
  tập trung bằng capability. `event_staff`/`event_auth` là append-only. Chủ/Phó sửa
  điểm đã chốt phải có lý do; sau khi kết thúc chỉ Chủ được sửa.
- Lịch nay dời một trận bằng `PromoteMatch`, không còn nút đổi cả vòng. Máy chủ kiểm
  trùng người/sân, hiện diện, logical round, chuỗi liên tiếp và chênh số trận; log cũ
  `SwapRounds` vẫn phát lại. Mỗi mutation có điều kiện đích trong log để hai Vercel
  instance cùng sửa một trận chỉ có một lệnh thắng.
- Form tách tên/địa chỉ, có ước tính số trận/thời lượng. Sự kiện finished sao chép
  cấu hình/roster/tài trợ với idempotency nhưng không chép điểm, giải, lịch, quyền hay
  mật khẩu. Media dùng editor chung 256×256; avatar mới nằm trong `account_assets`.
- `EventProvider` sống xuyên tab, cache công khai đã lược trong IndexedDB, ETag/304,
  BroadcastChannel và poll thích ứng. Không cache API quyền bằng service worker.
- Quyền quản lý người chơi không cho phép sửa ảnh hồ sơ Google toàn cục của người
  khác; đội điều hành chỉ được đặt ảnh hộ tài khoản vãng lai.
- Bản `v0.5.0` dựng sát handoff Claude Design v3: trang chủ bốn tab, danh sách
  sự kiện theo tài khoản, quota, tài trợ ba hình dạng, Bảng vàng/trao giải và
  kết thúc bình thường. Toàn bộ 513 bài test xanh; 152 lượt mô phỏng 4–11
  người/0 vấn đề; `npm run typecheck` và `npm run build` sạch.
- Bản `v0.5.1` gộp “Gần đây” qua các thiết bị cùng Gmail, tách cache React Query
  theo `userId`, và không chuyển lịch sử khi Gmail khác nhận cùng một trình duyệt.
  Buổi legacy có `owner_user_id` rỗng được nhận lại bằng mật khẩu chủ; sổ
  `event_owner_claims` append-only phân xử đồng thời, và chỉ đúng ô chủ tài khoản
  được ghi. Hai ô giờ/ngày thay `datetime-local`. Cổng cuối: 524 bài test,
  152 lượt công bằng, build và typecheck sạch.
- Kho thử bền vững nằm ở `.data/test-sandbox.json`: chạy `npm run dev:test`, vào mã
  `TEST11` để thử công bằng, `TESTV5` để xem tài trợ/Bảng vàng hoặc `TESTV6` để thử
  đội điều hành/media/dời trận; mật khẩu người chơi `test1234`, điều hành
  `admin1234`. Chạy lại không reset dữ liệu và
  không đụng Google Sheet.
- Trên máy này CLB TEST có mã mời `H9DFHG`, 11 người TEST; SHA-256 sau khi thêm
  `TESTV6` là `6DD0194AE0FC81784CEA39301D8DD372B7AFD9FDCE738243088CCB5D5A20754D`. Bốn probe
  cũ của phiên đánh giá bảo mật đã nằm trong log; probe v0.4.1 bị 403 và không ghi thêm.
- Cổng v0.6.0: 560/560 test, 152 lượt công bằng/0 vấn đề, typecheck/build sạch;
  Chrome điện thoại và Edge desktop tải TESTV6 đúng, ETag 304, public state không
  phát `userId`/`deviceId` và kho TEST không đổi SHA.
- Cổng v0.6.2: 579/579 test (thêm 4 bài cuộc đua `ensureTab` trong `tests/google.test.ts`;
  bài chính đã xác nhận fail nếu gỡ bản vá), 152 lượt công bằng/0 vấn đề, build và
  typecheck sạch.
- Cổng v0.6.1: 575/575 test, 152 lượt công bằng/0 vấn đề, typecheck/build sạch. Smoke
  cục bộ trên `npm run dev:test`: `TESTV5` bị đặt cờ xóa thì `/api/events/TESTV5/state`
  và `/mutate` trả `410`, `/e/TESTV5` và các trang con trả `404`, `TESTV6` không đổi;
  sau khi khôi phục, `TESTV5` trở lại đủ 6 người/9 logo/3 giải. Các route mới trả
  `401`/`403` khi chưa đăng nhập. Tab `event_deletions` trong `.data/test-sandbox.json`
  còn lại đúng một cặp delete+restore của lần smoke đó — đó là nhật ký, không phải rác.
- Nhánh mặc định có các commit tài liệu bàn giao sau commit/tag production. Chênh
  lệch tài liệu đó với `main` là có chủ ý, không phải mã runtime còn làm dở.
- `EventState.presentation` chỉ giữ metadata/`assetId`; byte logo/cúp nằm trong
  tab `event_assets`; avatar mới nằm trong `account_assets`. Quota nằm ở
  `app_event_limits`; vé chống tạo đồng thời nằm ở `app_event_reservations`.
- App admin chỉ quản quota **và** xóa/khôi phục sự kiện: `mtminhpc@gmail.com`,
  `prolathevt02@gmail.com`. Ngoài hai việc đó, tuyệt đối không dùng cờ app admin để
  cấp quyền vào sự kiện người khác. Ô tra mã ở `/me` cố ý chỉ trả mã, tên, trạng thái,
  ngày, số người và cờ đã-xóa — không email chủ, không mật khẩu, không tỷ số.

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
5. `Mobile app design-handoff.zip` và `Mobile app design request-handoff_v3.zip`
   là tệp người dùng để ngoài Git. Không sửa, xoá hay commit hai tệp đó.

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
  nâng Next 16 phải tạo nhánh mới từ `v0.5.0` và làm lại có kiểm định.

## Tệp nên đọc theo thứ tự

1. `AGENTS.md` (tệp này)
2. `docs/TIEN-DO.md`
3. `README.md`
4. `docs/SETUP.md` khi đụng Google/Vercel/OAuth
