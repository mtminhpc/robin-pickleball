# Tiến độ dự án

Cập nhật: 08/08/2026 · nhánh `claude/pickleball-round-robin-app-fq8sja` · sau GĐ3
và một phiên dọn nốt phần còn lại

Tệp này để bạn (hoặc tôi ở phiên làm việc sau) mở ra là biết dự án đang ở đâu,
chạy thế nào, và việc gì còn dang dở. Hướng dẫn nối Google Sheet thật nằm riêng ở
[SETUP.md](SETUP.md).

---

## Bàn giao — đọc mục này trước

Viết cho phiên làm việc kế tiếp, có thể trên máy khác.

### Đang ở đâu

Mã nguồn **xong và đã kiểm chứng** tới hết GĐ3, cộng thêm bỏ gộp máy khỏi tài
khoản và đệm tổng kết. `npm test` 217 bài xanh, `npm run build` sạch. Không có
việc nào đang dở dang giữa chừng trong mã.

Bản nâng lên Next.js 16.3.0 nằm sẵn ở nhánh `claude/nang-next-16`, cố ý chưa gộp
— xem [mục dưới](#nhánh-claudenang-next-16--làm-xong-chờ-gộp).

Việc còn lại **không phải viết mã**, mà là **triển khai** — và nó đang chờ ba
thứ chỉ chủ dự án làm được, vì đều cần đăng nhập vào tài khoản riêng:

1. Tạo service account Google + chia sẻ một Google Sheet (**bắt buộc**, thiếu là
   bản thật từ chối khởi động)
2. Tạo OAuth client để bật đăng nhập (tuỳ chọn)
3. Đăng nhập Vercel

Từng bước ở [SETUP.md](SETUP.md), kèm mục *Thứ tự phụ thuộc* giải quyết cái vòng
lặp dễ vướng: redirect URI cần địa chỉ thật của bản deploy, mà địa chỉ đó chỉ có
sau lần deploy đầu.

### Bắt đầu lại trên máy mới

```powershell
npm install        # BẮT BUỘC chạy lại — xem lưu ý OneDrive bên dưới
npm test           # 217 bài, xác nhận máy mới chạy đúng
npm run dev
```

Ba thứ **không nằm trong git** nên máy mới sẽ không có, và đó là đúng:

| Thiếu gì | Hậu quả | Cách xử lý |
|---|---|---|
| `.env.local` | Chạy ở kho thử, không nối Google Sheet | Tạo lại theo [SETUP.md](SETUP.md). Chạy thử ở nhà thì không cần |
| `.data\` | Không có dữ liệu buổi đánh cũ | Bình thường — nó chỉ là dữ liệu bấm thử |
| `node_modules\` | Chưa cài | `npm install` |

### Bốn cái bẫy đã mất thời gian, đừng vấp lại

| Bẫy | Triệu chứng | Cách tránh |
|---|---|---|
| **Sửa tệp tiếng Việt bằng PowerShell** (`Get-Content -Raw` + `-replace` + ghi lại) | Toàn bộ dấu tiếng Việt biến thành `Tiáº¿n Ä‘á»™` | Chỉ dùng công cụ soạn thảo. PowerShell 5.1 đọc mặc định theo bảng mã ANSI nên hỏng mã hoá UTF-8 |
| **`npm run build` khi `npm run dev` đang chạy** | Trang mất sạch định dạng, chữ đen nền trắng | Dừng dev trước. Hai lệnh cùng ghi vào `.next` |
| **Ghi thẳng vào `.data\sheet.json` từ tiến trình khác** trong lúc máy chủ chạy | Kết quả lúc đạt lúc hỏng với cùng một đoạn mã | Đã sửa hẳn: kho nay đọc lại tệp trước mỗi thao tác. Nhưng vẫn còn lớp đệm 60 giây của Next cho câu lạc bộ và tài khoản |
| **`node_modules` nằm trong OneDrive** | Đồng bộ rất chậm, thỉnh thoảng hỏng tệp giữa chừng | Đừng chờ OneDrive đồng bộ `node_modules`. Máy mới cứ `npm install` lại từ đầu |

---

## Chạy trên máy — Windows

Không cần tài khoản Google, không cần cấu hình gì. Dữ liệu lưu vào tệp
`.data\sheet.json` ngay trong thư mục dự án.

### Lần đầu

1. **Cài Node.js.** Vào <https://nodejs.org>, tải bản có chữ **LTS** (đừng lấy
   "Current"), chạy tệp `.msi`, bấm Next hết. **Đóng hết cửa sổ PowerShell đang mở
   rồi mở lại** — không thì nó chưa nhận lệnh mới.

   Kiểm tra: mở PowerShell (phím Windows → gõ `powershell` → Enter), gõ `node -v`.
   Phải ra dạng `v20.x.x` hoặc cao hơn.

2. **Tải mã nguồn.** Vào
   <https://github.com/mtminhpc/robin-pickleball> → chọn nhánh
   `claude/pickleball-round-robin-app-fq8sja` → nút xanh **Code** → **Download ZIP**
   → giải nén ra Desktop.

   Có Git thì nhanh hơn:

   ```powershell
   git clone -b claude/pickleball-round-robin-app-fq8sja https://github.com/mtminhpc/robin-pickleball.git
   ```

3. **Cài và chạy:**

   ```powershell
   cd "$env:USERPROFILE\Desktop\robin-pickleball-claude-pickleball-round-robin-app-fq8sja"
   npm install
   npm run dev
   ```

   `npm install` mất 1–2 phút lần đầu. Nó in vài dòng vàng về "vulnerabilities" —
   xem mục [Cảnh báo bảo mật](#cảnh-báo-bảo-mật) bên dưới, không cản trở chạy thử.

   Xong khi thấy:

   ```
   ▲ Next.js 15.5.23
   - Local:  http://localhost:3000
   ✓ Ready in 2s
   ```

Mở trình duyệt vào **<http://localhost:3000>**.

### Lần sau

Chỉ cần `cd` vào thư mục rồi `npm run dev`. Không phải `npm install` lại.

| Việc | Lệnh |
|---|---|
| Dừng máy chủ | `Ctrl + C` trong PowerShell |
| Xoá sạch dữ liệu, chơi lại từ đầu | Xoá thư mục `.data` |
| Chạy bộ kiểm thử | `npm test` (217 bài, ~15 giây) |
| Soát cấu hình trước khi triển khai | `npm run check-env` |
| Sinh `APP_SECRET` mới | `npm run new-secret` |
| Quét công bằng 42 cấu hình | `npm run sim -- --matrix` |
| Mô phỏng một buổi cụ thể | `npm run sim -- --players 12 --courts 2 --rounds 16 --join 5 --leave 9` |
| Mở bằng điện thoại cùng wifi | `npm run dev -- -H 0.0.0.0`, lấy IP bằng `ipconfig`, vào `http://192.168.x.x:3000` |

> **Dùng `npm`.** Tệp khoá duy nhất của dự án là `package-lock.json`, và đừng
> thêm tệp khoá thứ hai — hai tệp khoá cho cùng một dự án thì sớm muộn cũng lệch
> nhau. Trên Windows việc cài `pnpm` cũng hay vướng chính sách chạy script của
> PowerShell, không đáng để mất thời gian.

---

## Thử theo thứ tự này

Khoảng 10 phút, đi qua gần hết những gì đã làm.

**1 · Câu lạc bộ** (bắt đầu từ đây, vì mọi thứ khác nối vào nó)
Trang chủ → tab **Câu lạc bộ** → điền tên câu lạc bộ và tên bạn → **Lập câu lạc bộ**.
Bấm **Mời thêm người** để xem mã QR và mã mời sáu ký tự.

Muốn giả làm nhiều người: mở **cửa sổ ẩn danh** (`Ctrl+Shift+N`), vào
`http://localhost:3000/c/<mã mời>/join`, gõ tên khác. Mỗi cửa sổ ẩn danh là một
"điện thoại" khác nhau.

**2 · Mời nhanh vào buổi đánh**
Trong trang câu lạc bộ → **Tạo buổi đánh cho câu lạc bộ** → đặt mật khẩu chủ sự
kiện `admin123`. Cả danh bạ vào sẵn ở trạng thái **đã mời**.

**3 · Xác nhận rồi bắt đầu**
Tab **Người chơi** → bấm xác nhận đi cho từng người → tab **Quản lý** → **Bắt đầu**.
Ai đã xác nhận thì vào thẳng, không phải duyệt. Cần ít nhất 4 người.

**4 · Nhập điểm**
Tab **Đang đánh** → **Nhập tỷ số** → bấm `+` → **Tiếp tục** → xem bước xác nhận
hiện to tên bốn người → **Đúng rồi, lưu**. Để ý băng xanh *"Đã lưu lúc…"* tự tắt
sau 3 giây.

**5 · Thử bấm nhầm**
Nhập `7 – 4` (không đúng mốc 11). Phải hiện cảnh báo vàng nhưng **vẫn cho lưu** —
trận dừng sớm vì hết giờ sân là chuyện thường.

**6 · Thử mất mạng** (chỗ tôi làm kỹ nhất)
`F12` → tab **Network** → đổi **No throttling** thành **Offline** → nhập 2–3 kết
quả → băng **đỏ** hiện lên và **không tự tắt**, tỷ số hiện mờ nhấp nháy → đổi lại
**No throttling** → tự gửi đi, băng chuyển xanh.

**7 · Dời lịch** *(vừa sửa lại toàn bộ ở phiên này)*
Tab **Lịch** → **▼ Muộn hơn** ở một trận → đọc kỹ hộp xác nhận: nó nói rõ hai vòng
sẽ **đổi chỗ cho nhau**, không ai thêm hay bớt trận nào, và cảnh báo ai sẽ phải
đánh liên tiếp mấy vòng. Bấm đi bấm lại vài lần — phải luôn làm được.

**8 · Công bằng**
Tab **Xếp hạng** → bấm dòng **CÔNG BẰNG** để mở bảng. Cột **Lệch** mới là thước
đo, không phải cột Trận.

**9 · Người vào giữa chừng** *(vừa đổi cách tính ở phiên này)*
Từ cửa sổ ẩn danh khác, vào `/e/<mã>/join`, xin vào. Chủ sân duyệt ở tab Người
chơi. Xem bảng Công bằng: người mới phải hiện **Lệch ≈ 0** lúc vừa vào, không phải
một con số dương to.

**10 · Tổng kết**
Tạo thêm một buổi nữa cho cùng câu lạc bộ, chơi vài trận, rồi vào
`/c/<mã>/summary`. Xem tab **Theo tuần** và **Theo tháng**.

**11 · Trang của tôi**
Trang chủ → nút **Của tôi** góc trên phải. Số liệu cộng dồn của chính máy bạn,
không cần tài khoản.

**12 · Đăng nhập Google** *(mới ở phiên này — cần cấu hình trước)*
Chưa điền `GOOGLE_OAUTH_CLIENT_ID` và `GOOGLE_OAUTH_CLIENT_SECRET` thì **không có
nút nào hiện ra**, và đó là đúng — bỏ qua bước này cũng được. Cách lấy hai biến
đó: [SETUP.md](SETUP.md#đăng-nhập-bằng-tài-khoản-google-tuỳ-chọn).

Điền rồi thì cuối trang chủ có nút **Đăng nhập bằng Google**. Bấm, chọn tài
khoản, quay về là thấy email của mình.

Phép thử đáng giá nhất nằm ở đây: mở **cửa sổ ẩn danh** — tức một "điện thoại"
hoàn toàn mới — đăng nhập cùng tài khoản đó, rồi vào trang câu lạc bộ. Phải thấy
tên mình sẵn trong danh bạ và vẫn là **người tạo**, không phải xin lại mã mời.
Đó là toàn bộ lý do giai đoạn này tồn tại.

---

## Đã làm xong

### GĐ0 — Nền móng
Thuật toán xếp lịch (luyện kim mô phỏng, cửa sổ 6 vòng), mô hình công bằng theo
**suất kỳ vọng**, tầng nghiệp vụ thuần hàm, tầng Google Sheet chống mất dữ liệu,
bộ mô phỏng dòng lệnh.

### GĐ1 — Mang ra sân dùng được
Tạo sự kiện, hai mật khẩu, mã QR tự tham gia, 96 ảnh đại diện, hàng chờ duyệt,
nhập điểm và khoá kết quả, banner trạng thái lưu, hàng đợi ngoại tuyến trong
IndexedDB, bảng xếp hạng, bảng Công bằng, dời lịch, huỷ trận, kết thúc sớm.

### GĐ2 — Câu lạc bộ và tổng kết
Danh bạ thành viên, mã mời + QR, mời nhanh cả danh bạ vào buổi đánh, xác nhận
đi/không đi, tổng kết tuần và tháng, trang `/me` theo thiết bị.

### GĐ3 — Tài khoản Google *(phiên này)*

Đăng nhập bằng Google viết tay theo luồng authorization code + PKCE, không thêm
thư viện xác thực nào. Cái máy đang cầm được gắn về tài khoản, kéo theo danh bạ
câu lạc bộ và quyền chủ câu lạc bộ. Trang `/me` gộp số liệu từ mọi máy.

Nguyên tắc giữ suốt: **tài khoản không thay thế thiết bị, nó gom các thiết bị
lại.** Người ra sân vẫn quét mã QR rồi gõ tên như cũ, không ai bị bắt đăng nhập.

Ba quyết định đáng ghi lại:

| Quyết định | Vì sao |
|---|---|
| Chưa cấu hình OAuth thì **ẩn hẳn nút đăng nhập** | Giống hệt cách thiếu biến Sheet thì tự chuyển sang kho chạy thử. Nút bấm vào ra trang lỗi tệ hơn không có nút |
| Đăng nhập gắn **cả danh bạ lẫn quyền chủ** trong một lô ghi | Làm nửa vời thì có lúc bạn là chủ theo bảng này mà không phải chủ theo bảng kia — và cách nhận ra thường là mất quyền với câu lạc bộ của chính mình |
| **Không kiểm chữ ký `id_token`** | Token nhận thẳng từ Google qua HTTPS kèm `client_secret`; kênh đó đã xác thực nguồn gốc. Vẫn kiểm `aud`, `iss`, `exp`, `email_verified` |

Cookie tài khoản `rp_user` là `httpOnly` (khác cookie thiết bị, cố ý để đọc được)
và sống 30 ngày — bắt đăng nhập lại mỗi buổi thì tài khoản thành phiền toái chứ
không phải tiện ích.

Đăng xuất **không xoá cookie thiết bị**: xoá là mất luôn quyền tự sửa tỷ số vừa
nhập và cả tên đang hiện trong buổi đang diễn ra giữa sân.

### Sáu lỗi tìm ra khi chạy thử GĐ3

Tất cả đều lộ ra từ một kịch bản chạy thật — *một tài khoản, hai điện thoại, một
buổi đánh có tỷ số* — chứ không phải từ đọc lại mã. Bốn cái đầu là lỗ hổng của
chính GĐ3, hai cái sau có sẵn từ trước và chỉ lộ ra khi bị đẩy tới.

| Lỗi | Ảnh hưởng |
|---|---|
| Người chơi kéo từ danh bạ **không mang `userId`** | Toàn bộ GĐ3 dừng ở cổng câu lạc bộ. Vào tới buổi đánh là tài khoản hết tác dụng |
| Trang tham gia **tự dò theo mã máy** | Đổi điện thoại giữa mùa thì mở buổi đánh lên không thấy mình đâu, phải gõ lại tên và ngồi chờ duyệt. Nay máy chủ trả lời bằng `myPlayerId` — trình duyệt không đọc nổi cookie tài khoản vì nó `httpOnly` |
| Nút **"Đây là tôi" hỏng hoàn toàn** | Gửi `UpdateProfile` + `MarkArrived`, mà `MarkArrived` chỉ chủ sự kiện gọi được → 403. Một trong ba đường vào của trang tham gia coi như không dùng được |
| Nhận ô tên xong **không gắn máy vào** | Kể cả qua được quyền, người vừa nhận mở lại app là app quên mất họ. Nay có lệnh `ClaimPlayer` làm gọn một lượt, và máy chủ tự điền danh tính chứ không tin trình duyệt |
| Trang **Của tôi trống trơn** trên máy mới | Danh sách mã buổi nằm ở `localStorage` của máy cũ. Nay người đã đăng nhập còn tìm được buổi qua câu lạc bộ mình là thành viên — vẫn không quét cả bảng sự kiện của mọi người |
| Kho chạy thử **đọc tệp đúng một lần** rồi giữ hết trong RAM | Phản bội hai câu trong chính tài liệu này: sửa tay `.data\sheet.json` thì bị đè im lặng, và xoá `.data` lúc máy chủ đang chạy thì **không có tác dụng gì** |

Lỗi cuối đáng nói thêm: nó chính là thứ làm bộ kiểm thử đầu tiên của tôi cho ra
kết quả lúc đạt lúc hỏng với cùng một đoạn mã. Kho giữ dữ liệu trong bộ nhớ nên
tiến trình khác ghi vào tệp là bị nuốt mất. Nay mỗi lần đọc hay ghi đều liếc qua
thời điểm sửa tệp, lệch thì nạp lại.

### Lỗi chặn ở lần đầu nối Google Sheet thật

Đáng đọc kỹ, vì nó cho thấy một khoảng mù của cả bộ kiểm thử.

`GoogleSheetsClient.batchGet` gửi mọi dải lên Google, kể cả dải thuộc **tab chưa
tồn tại**. Google trả `400 Unable to parse range`, và lỗi đó giết **cả lô** chứ
không riêng dải hỏng. `EventRepo.load` đọc chỉ mục sự kiện chung một lô với
`log__<mã>!A:A` — mà lúc `pickUnusedCode` đi tìm một mã chưa ai dùng thì tab nhật
ký đương nhiên chưa có.

Hệ quả: trên Sheet thật **không tạo được buổi đánh nào cả**. Ở nhà thì mọi thứ
trơn tru.

Vì sao 212 bài kiểm thử không bắt được: **không bài nào chạm tới
`GoogleSheetsClient`**. Mọi thứ khác chạy trên `FakeSheetsClient`, vốn trả dải
rỗng cho tab chưa có — đúng cái lệch mà chính dòng chú thích trong `batchGet` nói
là muốn tránh. Nay có `tests/google.test.ts` chặn `fetch` nên không cần mạng hay
tài khoản Google; gỡ phần sửa ra thì 3 trên 5 bài hỏng.

Bài học cho lần sau: **kho giả dễ tính hơn hàng thật ở đâu thì chỗ đó là điểm
mù.** Ở đây kho giả tha thứ cho tab chưa tồn tại, còn Google thì không.

### Đệm tổng kết, và tab `rollups` đã bỏ

Trang tổng kết trước đây gọi thẳng `getRepo().listByClub(...)`, tức là đi vòng
qua toàn bộ lớp đệm — hai mươi người cùng mở là hai mươi lần đọc, mà `listByClub`
đọc cả bảng sự kiện kèm ảnh chụp trạng thái tới 180 nghìn ký tự mỗi dòng. Nay có
`readClubEvents` trong `lib/sheets/cache.ts`, bọc nó vào `unstable_cache` 60 giây
theo đúng khuôn `readClub` đã có.

Buổi mới tạo cho câu lạc bộ thì xoá đệm ngay để nó hiện ra lập tức. **Cố ý không
xoá sau mỗi lần nhập tỷ số** — bắn hỏng đệm mỗi khi có người ghi điểm thì nó
chẳng đệm được gì, mà buổi đang đánh vốn đã được đánh dấu "số liệu còn chạy tiếp".

Tab `rollups` đã có sẵn trong bố cục Sheet nhưng chưa bao giờ được đọc hay ghi,
và nay **bỏ hẳn**. Ba lý do, ghi trong `lib/sheets/schema.ts` để lần sau không ai
dựng lại: Sheets không lọc được phía máy chủ nên đọc dòng của một câu lạc bộ là
đọc cả tab của mọi câu lạc bộ; đệm còn mới thì tốn 1 lời gọi y như không đệm, đệm
cũ thì tốn 3, mà mỗi lần nhập tỷ số là `seq` đổi nên suốt buổi đang đánh lần nào
cũng cũ; và ghi bằng `rowIndex` trên một tab dùng chung không có khoá thì hai máy
chủ tính cùng lúc sẽ đè lên dòng của nhau.

### Bỏ gộp một máy khỏi tài khoản

Trang **Của tôi** → bấm dòng *"Gộp số liệu từ N máy"* → danh sách các máy, mỗi
dòng một nút **Bỏ gộp**. Máy đang cầm không gỡ được, vì gỡ nó chỉ tạo ra trạng
thái vừa đang đăng nhập vừa không thuộc tài khoản nào, rồi lần đăng nhập sau tự
gắn lại — việc người dùng đang định làm là **Đăng xuất**.

Hai điều đáng ghi lại, vì cả hai đều dễ làm sai:

| | |
|---|---|
| **Việc này không cắt được cái điện thoại** | Cookie thiết bị nằm trong chính cái máy đó nên máy chủ không xoá được, và `ClubRepo.forDevice` vẫn nhận nó là thành viên câu lạc bộ theo mã máy. Thứ duy nhất bị cắt là **gộp số liệu**. Chữ trên nút và hộp xác nhận nói đúng chừng ấy — hứa hơn là hứa sai |
| **Phải chặn máy đã gỡ ghi ngược lại** | `rememberEvents` tìm dòng chỉ bằng mã máy. Cookie tài khoản sống 30 ngày và không có danh sách thu hồi, nên máy vừa bị gỡ chỉ cần mở trang Của tôi một lần là ghi lại đúng danh sách vừa xoá — rồi người đăng nhập kế tiếp trên máy đó thừa hưởng nó. Nay `rememberEvents` trả `false` khi dòng không thuộc tài khoản nào |

Khác `linkDevice` ở chỗ **xoá luôn danh sách buổi** của máy đó. Hai tín hiệu khác
nhau: điện thoại dùng chung mà người sau đăng nhập đè lên thì cả hai đều có mặt ở
những buổi ấy nên giữ là đúng; còn chủ máy chủ động bấm gỡ là đang nói *"đừng gộp
số liệu từ máy này nữa"*.

### Đổi mã mời câu lạc bộ

Mã mời không hết hạn và dùng được vô số lần — chiếu lên tường sân cho hai mươi
người cùng quét thì buộc phải như vậy. Cái giá là nó sống mãi: ai chụp màn hình
gửi lung tung, hay người đã rời nhóm, đều còn đường quay lại vô thời hạn.

Nay chủ câu lạc bộ có nút **Đổi mã mời** trong hộp thoại mời. Có bước xác nhận
nói rõ mã cũ chết ngay lập tức, kể cả tờ giấy đang dán ở sân. **Danh bạ giữ
nguyên** — đổi mã là chặn người mới vào, không phải đuổi người đang ở trong; gộp
hai việc lại thì chủ sân bấm một nút mà mất cả nhóm.

### Sửa lỗi ở phiên trước đó

Bốn lỗi thật tìm ra khi chạy thử end-to-end, không phải từ đọc mã:

| Lỗi | Ảnh hưởng |
|---|---|
| Nút "Sớm hơn / Muộn hơn" hỏng **22 trên 24 lần** | Yêu cầu số 4 coi như không dùng được. Thay bằng đổi chỗ cả hai vòng — luôn làm được |
| Màn hình Đang đánh **nhảy cóc qua vòng vừa bị ghim** | Người chơi mất hẳn một vòng khỏi màn hình chính |
| **Người về sớm vẫn còn tên trong trận đã ghim** | Cả sân đứng chờ một người không có mặt |
| Vòng vừa đổi chỗ **không đổi lại được nữa** | Chủ sự kiện bị khoá bởi chính thao tác mình vừa làm |

Ba lỗi sau cùng một gốc: `firstOpenRound` trả lời *"thuật toán còn xếp lại được
không"*, không phải *"vòng này đánh chưa"*. Nay tách thành `firstUnplayedRound`
và `roundIsPlayed`.

Và một quyết định bạn đã chốt: `catchUpFactor` từ 1 về **0**. Người vào giữa chừng
đánh cùng nhịp với mọi người thay vì được ưu tiên tới mức lấn suất người tới đúng
giờ (đo được: 16 người / 2 sân, hệ số 1 cho người tới muộn 7 trận trong khi người
tới đúng giờ chỉ còn 4–5).

---

## Kiểm chứng

| Loại | Kết quả |
|---|---|
| Kiểm thử tự động | **217 bài xanh** (`npm test`) — thêm 5 bài cho việc gỡ máy khỏi tài khoản và 5 bài cho kho Google Sheet |
| **Chạy thử trên Google Sheet THẬT** | **19 phép kiểm, 0 hỏng** — lập câu lạc bộ, tạo buổi, bốn người, xếp lịch, nhập tỷ số 11–7, tổng kết, rồi đọc lại từ một tiến trình khác để chắc dữ liệu nằm trên bảng tính |
| Kiểm tra kiểu | `npm run typecheck` sạch |
| Quét ma trận công bằng | **42 cấu hình, 0 cấu hình bị đánh dấu** |
| Chạy thử thật qua HTTP | **66 phép kiểm, 0 hỏng** — buổi đánh, câu lạc bộ, tổng kết, trang của tôi |
| Kịch bản một tài khoản hai điện thoại | **23 phép kiểm, 0 hỏng** — lập câu lạc bộ, đăng nhập, tạo buổi, nhận ô tên, đánh một trận, rồi mở tất cả từ máy mới |
| Bấm thử trên trình duyệt | Máy hoàn toàn mới chỉ có cookie tài khoản: mở `/e/<mã>/join` hiện thẳng "Minh · Đang chơi", không có form gõ tên |
| Biên dịch bản thật | `npm run build` sạch |
| Tải mới hoàn toàn | `git clone` → `npm install` → `npm run dev` chạy được, tạo được sự kiện và câu lạc bộ |

> Phần **duy nhất chưa chạy thử với hàng thật** là bước đổi mã với Google, vì nó
> cần OAuth client trong tài khoản Google Cloud của bạn. Mọi thứ hai bên bước đó
> đều đã kiểm: route `start` dựng đúng URL kèm PKCE và `state`, và toàn bộ đường
> đi sau khi có danh tính đã chạy thật qua HTTP.

---

## Lịch Whist — cặp lặp về 0 ở những cỡ nhóm kín sân

Với vài cỡ nhóm, bài toán "chia đôi sao cho ai cũng gặp nhiều người" có lời giải
hoàn hảo đã biết trong toán tổ hợp: **bắt cặp mỗi người đúng một lần, gặp mỗi
người đúng hai lần**. Điều kiện là mọi sân đều kín — `4×sân` người (ai cũng đánh
mọi vòng) hoặc `4×sân + 1` (mỗi vòng đúng một người nghỉ, xoay đủ vòng).

Bảng lịch nằm ở [lib/scheduler/whist.ts](../lib/scheduler/whist.ts), do
[scripts/whist-tables.mjs](../scripts/whist-tables.mjs) sinh ra và được
[tests/whist.test.ts](../tests/whist.test.ts) dựng lại kiểm từ đầu.

Đo trên 12 mã buổi mỗi cỡ, tính số lần một cặp phải đánh đôi lại với nhau:

| Người / sân / vòng | Trước | Sau |
|---|---|---|
| 8 / 2 / 7 | 3,33 | **0** |
| 9 / 2 / 9 | 3,00 | **0** |
| 12 / 3 / 11 | 5,42 | **0** |
| 13 / 3 / 13 | 6,08 | **0** |
| 16 / 4 / 15 | 7,83 | **0** |
| 6 / 1 và 7 / 1 | 0,50 | 0,50 (không có thiết kế cho cỡ này) |

Lệch suất kỳ vọng giữ nguyên 0,00 ở mọi cỡ — nó mua đa dạng chứ không đổi công
bằng lấy đa dạng.

### Ba cái bẫy đã sập trong lúc làm

1. **Để thiết kế đi thi với hàm chi phí thì nó luôn thua.** Hàm chi phí chỉ nhìn
   `lookaheadRounds` vòng, còn thiết kế tối ưu trên trọn chu kỳ 11–15 vòng. Cắt
   sáu vòng đầu ra so riêng thì bộ tìm kiếm trải đối thủ đều hơn — đúng trong cửa
   sổ, sai cho cả buổi. Đo được: 12 và 16 người **không bao giờ** dùng tới thiết
   kế, kể cả vòng đầu. Nên các trận Whist được đánh dấu **đông cứng**.
2. **Áp nửa vời còn tệ hơn không áp.** Nếu phần đầu buổi đã lệch khỏi thiết kế mà
   vẫn lấy phần đuôi của nó, thì cái đuôi chọn đúng những cặp mà thiết kế giả
   định là chưa dùng. Đo được: 16 người xấu đi từ 7,8 lên 9,6. Vì vậy có
   `followingDesign` — hễ một trận không sửa được nữa mà không khớp thiết kế thì
   bỏ hẳn.
3. **"Đông cứng" không phải điều kiện đúng.** Ở chế độ `rebuild`, một trận đã
   đánh xong KHÔNG bị đánh dấu đông cứng, nhưng `reduce` vẫn giữ nó lại. Lấy
   nhầm điều kiện thì đặt trận Whist chồng lên đúng cái sân ấy — bộ mẫu thử bắt
   được "vòng 4 xếp trùng sân 1, bốn người bị gọi ra hai trận". Điều kiện đúng là
   `roundsToKeep`: mọi vòng có trận mà `reduce` sẽ giữ lại.

### Bộ mẫu thử từng chấm một thuật toán yếu hơn thuật toán thật

Trong lúc làm việc này lộ ra một chuyện đáng kể hơn: `lib/testing/scenarios.ts`
đặt ngân sách tối ưu **6.000 lượt / 120ms** cho nhanh, trong khi ứng dụng thật
chạy tới 40.000 lượt / 400ms. Hậu quả không phải chậm hay nhanh mà là bảng số nói
về một phần mềm không tồn tại. Nó đã báo sai một lần: một kịch bản báo thiếu
**1,07 suất**, nhưng với ngân sách thật con số đó là **0,60**.

Đã bỏ hẳn phần bóp ngân sách. Bộ kiểm thử **không chậm đi thấy được** (~15 giây).

Cũng nhân đó phát hiện: bài kiểm thử ấy trước nay xanh là **do may**. Cho lần
lượt từng người trong chín người về sớm thì **1 trên 9** làm vỡ mức hứa 1,05 — ở
cả bản cũ lẫn bản mới, và chỉ ở ngân sách bị bóp. Kịch bản luôn chọn người đầu
danh sách, mà người đó tình cờ an toàn.

---

## Ảnh đại diện thật, và tài khoản Google làm đường vào

Ba việc đi cùng nhau vì chúng chung một sợi dây: `Player.userId`.

**Ảnh thật.** Ai đăng nhập thì đặt được ảnh của mình. Trình duyệt thu ảnh về
128×128 WebP (~3KB) *trước khi gửi* — xem [lib/avatars/resize.ts](../lib/avatars/resize.ts)
— rồi lưu base64 thẳng vào cột `prefs_json` của tab `accounts`, và
[/api/avatar/[userId]](../app/api/avatar/[userId]/route.ts) trả về. **Không thêm
kho tệp, không thêm biến môi trường, không thêm dịch vụ nào.** Một ô Sheets chứa
được 50.000 ký tự, chính giới hạn đã buộc bảng `events` phải cắt trạng thái ra
làm bốn ô — 3KB nằm gọn trong đó.

Ba nước dự phòng, và nước nào cũng phải chạy được: ảnh tự tải lên → ảnh tài khoản
Google (chuyển hướng, để CDN của Google tự lo) → biểu tượng suy từ tên như cũ.
Nước cuối mới là **trường hợp thường gặp**, vì phần lớn người ra sân không đăng
nhập bao giờ.

Một cái bẫy đã sập một lần trong lúc chạy thử: bản đầu *đổi* giữa ảnh và biểu
tượng, nên trong khoảng từ lúc bắt đầu tải tới lúc `onError` kêu lên — hàng chục
giây nếu máy chủ ảnh không phản hồi — người dùng nhìn thấy một vòng tròn màu rỗng
không. Nay biểu tượng luôn được vẽ và ảnh **nằm đè lên**, nên không còn khoảng
trống nào.

**Tài khoản Google là đường vào chính.** `ownerUserId` vốn đã được ghi từ lúc tạo
buổi nhưng chưa dùng để xét quyền; nay nó cho quyền chủ sự kiện trên mọi máy, và
đó cũng là câu trả lời cho *quên mật khẩu thì sao* — trước đây không có câu trả
lời nào, quên là buổi đánh thành chỉ-đọc vĩnh viễn.

Vai trò nay do đúng một hàm quyết định: `roleFor` trong
[lib/api/context.ts](../lib/api/context.ts). Nó được gọi từ **hai chỗ** —
`resolveContext` cho các route, và `app/e/[code]/layout.tsx` cho lượt dựng đầu ở
máy chủ. Để hai chỗ tự tính lấy thì màn hình sẽ vẽ lần đầu ở "chế độ xem" rồi
nháy sang "chủ sự kiện", và người dùng bấm hụt nút trong khoảnh khắc đó.

Phép so sánh trong `roleFor` có hai lá chắn trông như thừa:

```ts
if (userId && record.ownerUserId && userId === record.ownerUserId)
```

Chúng **không** thừa. `ownerUserId` là chuỗi rỗng với mọi buổi tạo lúc chưa đăng
nhập; bỏ chúng đi là chuỗi rỗng khớp chuỗi rỗng, và người lạ bất kỳ thành chủ mọi
buổi đánh cũ. Đã kiểm bằng cách xoá lá chắn và xác nhận bài kiểm thử đỏ lên.

**Đổi mật khẩu** ở [/api/events/[code]/password](../app/api/events/[code]/password/route.ts)
chỉ cho chủ-theo-tài-khoản, cố ý **không** cho người đang là admin nhờ biết mật
khẩu — người đó có thể là ai đó được nhờ nhập điểm hộ tối qua, và cho họ đổi mật
khẩu là cho họ khoá chính chủ ra ngoài. Đường ghi chỉ đụng đúng hai ô mật khẩu
chứ không ghi lại cả dòng: dòng sự kiện chứa cả ảnh chụp trạng thái, ghi đè cả
dòng là xoá mất tỷ số người khác vừa nhập.

**Đường về trang chủ.** Trước đây vào trong một sự kiện là không có lối ra: logo
là thẻ chữ thường, thanh dưới chỉ có năm mục trong sự kiện. Nay logo là liên kết,
và trên điện thoại có dòng `← Trang chủ` trong băng tiêu đề.

Và một phát hiện đáng nói: nút đăng nhập trước giờ **chỉ có ở trang chủ với trang
"Của tôi"** — hai chỗ người ra sân gần như không ghé. Người quét mã QR ở sân
không bao giờ nhìn thấy nó. Đó là lý do tính năng tài khoản dựng xong từ giai
đoạn trước mà gần như không ai dùng tới. Nay `AccountBar` có mặt ở màn hình tham
gia, và ô nhập mật khẩu có thêm dòng *"Bạn tạo buổi này mà quên mật khẩu?"*.

## Còn lại

### Việc nhỏ chưa làm

- **Triển khai Vercel.** Tôi không deploy hộ được vì cần tài khoản của bạn. Mã đã
  sẵn sàng: nối repo vào Vercel, dán bốn biến môi trường trong
  [SETUP.md](SETUP.md) là chạy. **Bắt buộc phải có biến Google** — kho tệp cục bộ
  không sống được trên Vercel, và ứng dụng cố ý báo lỗi ngay lúc khởi động thay vì
  âm thầm mất dữ liệu.

  > Phần Google Sheet **đã nối và chạy thật rồi**: service account, bảng tính,
  > `.env.local`, và 19 phép kiểm chạy trọn một buổi đánh trên Sheet thật. Còn
  > lại đúng phần Vercel.
- **Bật đăng nhập Google.** Cần OAuth client trong tài khoản Google Cloud của
  bạn nên tôi không làm hộ được. Mã đã sẵn sàng: điền hai biến trong
  [SETUP.md](SETUP.md#đăng-nhập-bằng-tài-khoản-google-tuỳ-chọn) là nút hiện ra.

  > Từ đợt ảnh đại diện thật, hai biến này quyết định **nhiều hơn trước**: thiếu
  > chúng thì không ai đăng nhập được, mà không đăng nhập thì không đặt được ảnh
  > thật và không lấy lại được quyền chủ khi quên mật khẩu. Mọi thứ vẫn chạy như
  > cũ, chỉ là ba tính năng đó nằm im.

### Đã cân nhắc và cố ý không làm

- **Mời đồng chủ sự kiện.** Quyền chủ hiện gắn với đúng một tài khoản
  (`ownerUserId`) cộng với mật khẩu. Việc cho phép chủ mời tài khoản khác cùng
  làm chủ — hữu ích khi hôm đó bận, nhờ người khác chạy buổi — đã được cân nhắc
  và bỏ, vì nó cần một bảng phân quyền riêng chứ không nhét thêm được vào một ô.
  Đừng dựng lại mà chưa hỏi lại: mật khẩu chủ sự kiện đã giải quyết được phần
  lớn tình huống ấy rồi.
- **Ảnh đại diện trong bảng Công bằng và hộp nhập tỷ số.** Bảng Công bằng là để
  quét mắt theo cột số, thêm ảnh vào làm nó chật. Riêng bước xác nhận trong hộp
  nhập tỷ số thì ảnh **sẽ có ích thật** — đó là chỗ bắt lỗi "nhập đúng tỷ số vào
  nhầm trận" — nhưng để dành, chưa làm.

### Nhánh `claude/nang-next-16` — làm xong, chờ gộp

Bản nâng lên **Next.js 16.3.0** đã làm xong và kiểm chứng, nhưng **cố ý chưa gộp**
vào nhánh chính. Lý do là thứ tự: nên deploy một bản Next 15 chạy thật trước, để
có mốc so sánh. Sau khi nâng, lỗi nào lộ ra trên Vercel cũng không biết quy cho
Next 16 hay cho lần đầu chạy thật — nhất là khi phần chưa kiểm được ở máy nhà
chính là hành vi lớp đệm của nền Vercel.

```powershell
git checkout claude/nang-next-16
```

Nội dung: `npm audit` về 0 lỗ hổng, `revalidateTag` sửa theo chữ ký mới của Next
16, `middleware.ts` đổi thành `proxy.ts`, gỡ script `next lint` đã chết. Chi tiết
và những cái bẫy ở mục [Nâng lên Next.js 16.3.0](#nâng-lên-nextjs-1630) trên
nhánh đó.

Sau khi deploy xong và chạy thật vài buổi thì gộp:

```powershell
git merge claude/nang-next-16
```

### Cảnh báo bảo mật

`npm audit` báo **3 lỗ hổng mức cao**, tất cả nằm trong thư viện `postcss` và
`sharp` mà Next.js 15 tự kéo theo, không phải mã của dự án này:

- `postcss` — chỉ khai thác được nếu ứng dụng biên dịch CSS do người dùng gửi lên.
  App này không có chỗ nào như vậy.
- `sharp`/`libvips` — chỉ dùng khi có `next/image` xử lý ảnh người dùng tải lên.
  App này không dùng `next/image`.

Nên **không chặn việc chạy thử hay dùng ở sân**.

**Đã dọn xong ở nhánh `claude/nang-next-16`** — gộp nhánh đó là `npm audit` về 0.
Một chỗ tài liệu này từng nói chưa đúng: bản vá là **≥ 16.3.0** chứ không phải
"Next 16" chung chung. Cả ba khuyến cáo đều trả `fixAvailable: next@16.3.0`, tức
16.0 tới 16.2 vẫn bị đánh dấu.

---

## Bố cục mã nguồn

```
app/              Trang và API (Next.js App Router)
  e/[code]/       Buổi đánh: đang đánh, lịch, xếp hạng, người chơi, quản lý, tham gia
  c/[id]/         Câu lạc bộ: danh bạ, tham gia, tổng kết
  me/             Số liệu của tôi
  api/auth/       Đăng nhập Google, phiên tài khoản
components/       Mảnh giao diện dùng lại
hooks/            Đồng bộ trạng thái, hàng đợi lưu, câu lạc bộ, tài khoản
lib/domain/       Kiểu dữ liệu, tập lệnh, suy trạng thái, xếp hạng, luật,
                  câu lạc bộ, tài khoản, tổng kết tuần/tháng
lib/scheduler/    Thuật toán xếp lịch, hàm chi phí, đo công bằng, kiểm tra dời lịch
lib/sheets/       Google Sheet thật, kho chạy thử, bộ nhớ đệm, bản in, câu lạc bộ,
                  tài khoản và sổ thiết bị
lib/auth/         Mật khẩu, cookie phiên, chặn dò, OAuth Google, ký HMAC
lib/testing/      Bộ khung chạy thử một sự kiện bằng lệnh
scripts/          Mô phỏng dòng lệnh, tạo sẵn tab trong Sheet
tests/            217 bài kiểm thử
```

Nguyên tắc giữ suốt dự án: `lib/domain` và `lib/scheduler` là **hàm thuần** —
không đọc đồng hồ, không gọi mạng, không sinh số ngẫu nhiên ngoài hạt giống cho
sẵn. Nhờ vậy phát lại nhật ký luôn cho ra đúng một kết quả, và toàn bộ luật
nghiệp vụ kiểm thử được mà không cần dựng Google Sheet.

---

## Vướng thì làm gì

| Triệu chứng | Cách xử lý |
|---|---|
| `node` không phải là lệnh | Chưa đóng mở lại PowerShell sau khi cài Node |
| `npm install` lỗi mạng | Chạy lại; nếu vẫn lỗi thì `npm cache clean --force` rồi thử lại |
| Cổng 3000 đã bị chiếm | `npm run dev -- -p 3001` |
| Trang trắng, lỗi lạ | Xoá thư mục `.next` rồi `npm run dev` lại |
| Mất hết định dạng, chữ đen trên nền trắng | Đã chạy `npm run build` trong lúc `npm run dev` đang chạy — hai lệnh cùng ghi vào `.next`. Dừng cả hai, xoá `.next`, chạy lại |
| Dữ liệu rối, muốn làm lại | Xoá thư mục `.data` |
| Không lập được câu lạc bộ | Trình duyệt đang chặn cookie — app cần cookie thiết bị để biết máy nào là ai |
| Không thấy nút đăng nhập Google | Chưa cấu hình OAuth. Cố ý ẩn nút chứ không phải lỗi — xem [SETUP.md](SETUP.md#đăng-nhập-bằng-tài-khoản-google-tuỳ-chọn) |

Vướng ở đâu thì chụp màn hình hoặc chép nguyên dòng lỗi trong PowerShell gửi tôi.
