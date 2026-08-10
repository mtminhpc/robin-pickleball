# Thiết kế v0.8 “Linh động” và v0.9 “Trao quyền”

Ngày chốt: 10/08/2026. Tài liệu này là hợp đồng triển khai cho hai minor release
độc lập. Nếu mã và tài liệu lệch nhau, phải cập nhật Decision Log trước khi đổi
luật nghiệp vụ.

## Mục tiêu và ranh giới

- `v0.8.0 · Linh động`: sân có danh tính/tên ổn định, hoạt động theo nhiều khoảng
  vòng; người chơi có nhiều ca dự kiến và phải xác nhận hiện diện từng ca; thay
  đổi cấu trúc được preview rồi mới xếp lại phần lịch chưa bắt đầu.
- `v0.9.0 · Trao quyền`: ledger vai trò append-only, cờ liên kết Google có kiểm
  soát, cấp Phó theo ô người chơi, lời mời một lần và chuyển Chủ hai giai đoạn.
- Bảo toàn log, snapshot, sự kiện thật, `.data`, cookie ký và hàng đợi IndexedDB.
  Không migration ghi lại Google Sheet chỉ để nâng dữ liệu cũ.
- Mục tiêu vận hành: tối đa 40 người, 8 sân đồng thời; planner dưới 4 giây và toàn
  bộ request preview dưới 5 giây.
- Không thêm điểm live, email/push tự động, sửa lịch quá khứ hoặc xoá kết quả đã
  chơi. Thay đổi cấu trúc bắt buộc online; hàng đợi offline cũ chỉ tiếp tục phục
  vụ những lệnh đã hỗ trợ trước đây.

## v0.8 — Mô hình và bất biến

### Khoảng vòng

```ts
interface RoundSpan { from: number; to: number | null }
interface PlannedSpan extends RoundSpan { id: string }
```

Hai đầu cùng được tính; `to: null` nghĩa là đến cuối. Mọi khoảng được chuẩn hoá:
vòng bắt đầu từ 1, `to >= from`, tối đa 20 khoảng sau chuẩn hoá. Khoảng chồng hoặc
liền nhau tự gộp; ưu tiên giữ ID của khoảng đã xác nhận để lịch sử hiện diện không
mất liên kết.

`Player.availability` là danh sách `PlannedSpan`. `presence` vẫn là lịch sử thật.
Một người chỉ đủ điều kiện ở vòng R khi R nằm trong kế hoạch và trong một lần hiện
diện đã xác nhận tương ứng; nghỉ tạm/về rồi là trạng thái tức thời có ưu tiên cao
hơn kế hoạch. Người vào muộn bắt đầu với độ lệch công bằng bằng 0, không có cơ chế
đuổi kịp tự động.

### Sân

```ts
interface CourtLabelVersion {
  id: string;
  name: string;
  effectiveFromRound: number;
}

interface EventCourt {
  id: string;
  order: number;
  labels: CourtLabelVersion[];
  availability: RoundSpan[];
  archived: boolean;
}
```

Tên sân được trim, chuẩn hoá Unicode NFC, dài 1–40 ký tự. Tên được so không phân
biệt hoa/thường; hai sân không được có cùng tên trong những khoảng hoạt động chồng
nhau. Mỗi sân tối đa 20 khoảng và toàn sự kiện tối đa 8 sân hoạt động cùng lúc.
Đổi tên tạo version mới từ vòng hiệu lực; trận đang chơi/đã chốt giữ label version
cũ. Lưu trữ chỉ ngăn dùng về sau, không xoá sân khỏi lịch sử.

`Match` có `courtId` và `courtLabelId`; trường số `court` vẫn được duy trì để đọc
log/client cũ. `config.courts` chỉ là ước tính ban đầu và nguồn dựng sân legacy.
Snapshot/log cũ được fold xác định thành `court-1…court-N`, nhãn `Sân 1…N`, hoạt
động vòng 1–cuối; không ghi migration ngược ra kho.

### Thay đổi lịch

```ts
interface ScheduleChange {
  revision: number;
  effectiveRound: number;
  changedAt: string;
  actorLabel: string;
  kind: string;
}
```

Scheduler nhận danh sách ID sân hoạt động theo từng vòng. Nó lọc người theo kế
hoạch, lần xác nhận hiện diện, trạng thái tức thời và các trận đã đông cứng. Thứ
tự ưu tiên không đổi: lấp tối đa sân an toàn → trần chuỗi → suất kỳ vọng → tránh
nghỉ lâu → đa dạng cặp.

Mốc hiệu lực có thể là vòng logic hiện tại nếu không chạm trận đang chơi; nếu có
xung đột, máy chủ đề xuất vòng sớm nhất an toàn. Từ mốc đó, xếp lại toàn bộ trận
`scheduled` chưa bắt đầu; giữ `playing`, `submitted`, `cancelled`, `abandoned` và
mọi trận `pinned`. Xung đột pinned là lỗi chặn và không tự bỏ ghim.

Đóng sân đang bận kết thúc khoảng hoạt động nhưng giữ trận hiện tại như ngoại lệ,
với trạng thái UI “Đóng sau trận này”. Không có sân hoạt động là trạng thái hợp lệ:
sự kiện vẫn `running`, scheduler không sinh trận và UI báo tạm dừng.

Chuyển sân chỉ áp dụng cho trận `scheduled` hoặc `playing`, giữ nguyên `matchId`,
cặp đấu, trạng thái, `startedAt`, điểm và lịch sử chỉnh sửa. Sân đích phải trống;
có thể tạo sân mới và/hoặc đóng sân nguồn trong cùng intent. Trận đã chốt không
được chuyển.

## v0.8 — Lệnh, preview và HTTP

Các intent cấu trúc gồm: thêm/sửa/lưu trữ/đổi thứ tự/đặt ca sân; đặt ca người;
xác nhận đến/quay lại; chuyển trận. Lệnh cũ `CreateEvent`, `SetSchedule`,
`PromoteMatch`, `ReorderMatch`, `DeclareAvailability` vẫn replay được và được ánh
xạ xác định sang mô hình mới. Lệnh mới không được đưa vào hàng đợi offline.

`POST /api/events/[code]/structure/preview` nhận `{ baseProcessed, intent }`.
Máy chủ kiểm quyền/capacity, fold state hiện tại, tìm mốc an toàn và chạy planner;
response gồm diff trước–sau, mốc, cảnh báo/block và token. Token chứa kế hoạch chính
xác đã preview, `processed`, quyền cần kiểm lại, thời điểm hết hạn 5 phút và nonce;
token ký HMAC bằng khoá dẫn xuất có namespace từ `APP_SECRET` hiện có.

`POST /api/events/[code]/structure/confirm` chỉ nhận token. Máy chủ kiểm chữ ký,
hạn, quyền hiện tại và `processed` chưa đổi. Intent cùng `SetSchedule` được append
trong một batch. Nếu state đổi, trả `409 stale-preview`; client tải lại và yêu cầu
người dùng xác nhận preview mới, không tự áp kế hoạch khác.

Tên/ảnh hồ sơ không làm thay đổi capacity nên không cần preview. Mọi thay đổi sân,
ca người hay hiện diện có thể thay lịch đều phải qua hai endpoint trên.

## v0.8 — Giao diện

- Form tạo giữ số sân, thêm vùng mở rộng đặt tên từng sân.
- Quản trị có `CourtManager`: tên/version, thứ tự ↑↓, chip khoảng, trạng thái
  mở/đóng/đóng-sau-trận/lưu trữ.
- Lịch có thao tác nhanh thêm sân (tên bắt buộc), đóng sân, chuyển trận sang sân
  trống/sân mới và checkbox đóng sân nguồn.
- Người chơi được nhóm thành Chờ duyệt, Đang trong ca, Sắp tới, Ngoài ca/Nghỉ tạm,
  Đã về. Editor dùng hai dropdown Từ vòng/Đến vòng hoặc Đến cuối, hiển thị chip
  Thêm/Sửa/Xoá, không dùng ô số tự do.
- Người chơi tự sửa kế hoạch của mình; Chủ/Phó sửa mọi người; điều hành mật khẩu
  chỉ thao tác hiện diện tức thời.
- `EventShell` báo “Lịch đã cập nhật từ vòng R”; revision đã xem lưu cục bộ theo
  sự kiện, không ảnh hưởng dữ liệu máy chủ.

## v0.9 — Ledger quyền và danh tính

Tab `event_roles` append-only là nguồn sự thật mới; `event_staff` cũ chỉ làm seed
tương thích khi fold, không migration ghi và không xoá. Chủ thể vai trò:

- `account`: tài khoản Google/email đã xác thực;
- `player`: ô người chơi có thể được nhận bằng cookie thiết bị ký hoặc Google;
- `pending-email`: lời mời ngoài roster.

Luôn đúng một Chủ vận hành và tối đa 5 Phó kể cả pending. Chỉ Chủ cấp/thu Phó,
tạo lời mời hoặc khởi tạo chuyển Chủ. Ô đang giữ quyền hoặc là target chuyển Chủ
pending không được xoá trước khi thu hồi/hủy.

Capability mới: `canManageStructure` và `canManagePlayerPlans` cho Chủ/Phó;
`canViewIdentityFlags` cho Chủ/Phó; `canManageRoles` chỉ Chủ. Self-service kế hoạch
đi đường riêng. App admin không nhận bất kỳ capability sự kiện mới nào.

`googleLinkedPlayerIds` chỉ chứa player ID có tài khoản Google thật, loại tiền tố
guest `g-…`; chỉ xuất hiện trong `/state` cho Chủ/Phó. Không trả email, `userId`,
`deviceId` hay actor ref. ETag bao gồm revision ledger quyền.

### Lời mời không-Google

Ô đã được nhận có thể kích hoạt quyền ngay. Ô chưa nhận sinh link/QR một lần; raw
token chỉ trả trong response tạo, Sheet chỉ lưu hash. Token gắn event/invite/player,
hết hiệu lực sau lần dùng đầu, khi thu hồi hoặc khi sự kiện kết thúc. Nhận ô và kích
hoạt role phải idempotent; resolver chỉ cấp quyền nếu cookie ký khớp ô đã nhận.
Đổi/mất máy không tự chuyển quyền—Chủ phải xác minh ngoài đời rồi cấp lại.

### Chuyển Chủ

Luồng vận hành là `pending → accepted | cancelled | expired`. Target phải chấp nhận
bằng đúng danh tính. Trước khi tạo phải còn một suất Phó cho Chủ cũ. Khi nhận, một
hành động ledger nguyên tử đặt target làm Chủ duy nhất và Chủ cũ làm Phó.

Chủ device-only có đầy đủ quyền trong buổi nhưng không tự nhận quyền tài khoản như
danh sách sở hữu, quota, sao chép hoặc xoá. Hoàn tất chuyển quyền tài khoản là luồng
riêng: Chủ vận hành mới liên kết Google, hai phía xác nhận, server kiểm quota rồi ghi
hành động hoàn tất và cập nhật `owner_user_id` idempotent trong cùng batch. Nếu quota
đầy/ghi lỗi, vai trò vận hành không bị đảo. Sau hoàn tất, tài khoản cũ mất quyền cấp
tài khoản nhưng vẫn là Phó.

### API và audit

- `GET/POST /api/events/[code]/roles`
- `DELETE /api/events/[code]/roles/[roleId]`
- `POST /api/events/[code]/role-invitations/[inviteId]/accept`
- `POST/DELETE /api/events/[code]/ownership-transfer`
- `POST /api/events/[code]/ownership-transfer/accept`
- `POST /api/events/[code]/account-ownership-transfer/confirm`
- `GET /api/events/[code]/audit`

`/staff` cũ tiếp tục qua adapter. Audit chỉ Chủ/Phó, phân trang 50 mục; hợp nhất
intent sân/người và ledger vai trò, chỉ trả actor label, thời gian, loại, mốc vòng
và tóm tắt—không actor ref, email hoặc token.

## Sao chép và dữ liệu cũ

Sao chép sự kiện giữ tên/thứ tự sân nhưng reset availability sân về vòng 1–cuối.
Giữ roster nhưng reset kế hoạch người, presence và mọi vai trò. Không sao chép
điểm, lịch, giải hay mật khẩu như trước. Mọi hàm mặc định/migration phải thuần và
idempotent; đọc lại cùng log luôn ra cùng state.

## Kế hoạch kiểm định

### v0.8

- Unit: chuẩn hoá/gộp khoảng, khoá quá khứ, đến cuối; version tên/trùng tên/order/
  archive; mapping log cũ; xác nhận từng ca; 0 sân/đóng sân bận; chuyển sân giữ dữ
  liệu; pinned conflict; token preview sửa/hết hạn/stale/quyền sai.
- Property/replay: cùng log cho cùng state/lịch.
- Ma trận 4–40 người và 0–8 sân thay đổi theo vòng: không trùng người/sân, không
  xếp ngoài ca, giữ hard streak và công bằng theo suất kỳ vọng.
- Benchmark planner <4 giây ở 40×8; request preview <5 giây.
- Redaction: không phát dữ liệu danh tính hoặc nội dung token.

### v0.9

- Phân biệt Google thật/guest; cờ chỉ Chủ/Phó; token một lần và mọi trạng thái vô
  hiệu; seed `event_staff`; giới hạn 5 Phó dưới cạnh tranh.
- Chuyển Chủ chỉ một target thắng, Chủ cũ thành Phó; device-only đúng quyền trong
  buổi và không có quyền account.
- Chuyển owner account: hai xác nhận, quota đầy, retry/crash/reconcile/idempotent.
- Audit không lộ ID/token.

### Cổng phát hành

Mỗi minor tăng `package.json`, lockfile và `APP_CODENAME`; chạy tuần tự:
`npm test` → `npm run scenarios` → `npm run build` → `npm run typecheck`.
Không chạy lint. Seed idempotent chỉ thêm `TESTV8`/`TESTV9`, không sửa/xoá
`TEST11`, `TESTV5`, `TESTV6`, `UPC3YR`.

Mỗi bản đi qua nhánh riêng, Vercel Preview và smoke Chrome mobile/Edge desktop.
Không đưa v0.9 lên Production trước khi v0.8 đã smoke Production. Hai nợ cũ—xoá/
đổi thứ tự tài trợ và xoá/khôi phục sự kiện—phải được người có tài khoản phù hợp
bấm thật trước cổng v0.8.

## Decision Log

| ID | Quyết định đã chốt | Lý do/hệ quả |
|---|---|---|
| D01 | Hai minor độc lập: v0.8 rồi v0.9 | Tách rủi ro scheduler khỏi rủi ro danh tính/quyền |
| D02 | Sân/người dùng nhiều khoảng vòng, hai đầu inclusive | Diễn tả đúng việc tăng/giảm công suất giữa buổi |
| D03 | ID sân và label version ổn định | Đổi tên/chuyển sân không sửa lịch sử |
| D04 | Preview bắt buộc, token exact-plan 5 phút | Người dùng thấy diff; chống TOCTOU và tự áp kế hoạch mới |
| D05 | Xếp lại từ mốc an toàn, giữ mọi trận đã bắt đầu/chốt/ghim | Không sửa quá khứ và không mất điểm |
| D06 | 0 sân là pause hợp lệ | Sự cố/hết giờ không buộc kết thúc sự kiện |
| D07 | Kế hoạch × hiện diện thực tế mới là đủ điều kiện | Mỗi ca phải xác nhận; kế hoạch không giả làm điểm danh |
| D08 | Người đến muộn có deficit ban đầu bằng 0 | Giữ định nghĩa công bằng theo suất kỳ vọng hiện tại |
| D09 | Ledger append-only và seed từ `event_staff` | Tương thích dữ liệu cũ, chịu cạnh tranh Google Sheet |
| D10 | Vai trò device-only gắn ô người chơi, token chỉ lưu hash | Không biến link thành quyền vĩnh viễn hoặc lộ bí mật trong Sheet |
| D11 | Chủ vận hành tách khỏi owner account | Cho chuyển quyền tại sân mà không lách quota/sở hữu tài khoản |
| D12 | Không yêu cầu lý do cho sân/người/Chủ | Audit vẫn đủ actor/time/diff; giảm ma sát vận hành |
| D13 | App admin không nhận quyền sự kiện mới | Giữ ranh giới bảo mật đã chốt từ v0.5/v0.6 |
| D14 | Lệnh cấu trúc mới online-only; queue cũ tiếp tục gửi | Không làm token preview hết hạn hoặc xếp lịch ngầm khi offline |

