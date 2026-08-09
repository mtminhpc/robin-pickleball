# Cài đặt

Hai chế độ, chuyển qua lại chỉ bằng biến môi trường:

| Chế độ | Khi nào dùng | Cần chuẩn bị |
|---|---|---|
| **Chạy thử trên máy** | Bấm thử, xem giao diện, tập dùng trước buổi đánh | Không cần gì |
| **Google Sheet thật** | Mang ra sân dùng | Google Cloud + một bảng tính |

Và một phần **tuỳ chọn, độc lập hẳn**: [đăng nhập bằng tài khoản
Google](#đăng-nhập-bằng-tài-khoản-google-tuỳ-chọn). Không cấu hình thì nút đăng
nhập không xuất hiện và mọi thứ khác chạy y nguyên.

---

## Chạy thử trên máy (2 phút)

```bash
npm install
npm run dev
```

Mở `http://localhost:3000`. Dữ liệu lưu vào `.data/sheet.json` — mở tệp đó ra xem
được, xoá đi là làm lại từ đầu.

Muốn giả nhiều người chơi cùng lúc thì mở thêm cửa sổ ẩn danh: mỗi cửa sổ được
cấp một mã thiết bị riêng nên ứng dụng coi là những người khác nhau.

> **Kho chạy thử không dùng được khi triển khai thật.** Trên Vercel hệ tệp không
> giữ lại giữa các lần gọi hàm, nên dữ liệu sẽ biến mất. Ứng dụng chủ động báo
> lỗi và không khởi động nếu chạy ở môi trường thật mà thiếu biến Google — thà
> không chạy được còn hơn âm thầm mất kết quả cả buổi.

---

## Nối Google Sheet thật

### 1. Tạo project trên Google Cloud

1. Vào <https://console.cloud.google.com/> → **Select a project** → **New project**
2. Đặt tên bất kỳ, ví dụ `robin-pickleball` → **Create**

### 2. Bật Google Sheets API

1. Trong project vừa tạo, mở **APIs & Services** → **Library**
2. Tìm **Google Sheets API** → **Enable**

Bỏ bước này là mọi thứ khác vẫn chạy cho tới lúc gọi API thì báo lỗi 403.

### 3. Tạo Service Account

Service account là một "người dùng máy" mà ứng dụng đóng vai để ghi vào bảng tính.
Nhờ nó, ứng dụng không cần đăng nhập bằng tài khoản Google cá nhân của bạn.

1. **APIs & Services** → **Credentials** → **Create credentials** → **Service account**
2. Đặt tên, ví dụ `robin-writer` → **Create and continue** → **Done**
   (phần chọn vai trò bỏ trống được — quyền sẽ cấp trực tiếp trên bảng tính)
3. Bấm vào service account vừa tạo → tab **Keys** → **Add key** → **Create new key**
   → chọn **JSON** → **Create**. Trình duyệt tải về một tệp JSON.

**Giữ tệp này cẩn thận.** Ai có nó thì ghi được vào bảng tính của bạn.

Trong tệp JSON có hai giá trị cần dùng:

```json
{
  "client_email": "robin-writer@....iam.gserviceaccount.com",   ← GOOGLE_SERVICE_ACCOUNT_EMAIL
  "private_key": "-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n"   ← GOOGLE_PRIVATE_KEY
}
```

### 4. Tạo bảng tính và chia sẻ cho service account

1. Tạo một Google Sheet mới (bảng trống là được)
2. Bấm **Share**, dán giá trị `client_email` ở trên vào, chọn quyền **Editor**, **Send**
   (Google sẽ cảnh báo không gửi được email cho địa chỉ này — bỏ qua, quyền vẫn được cấp)
3. Lấy `SHEET_ID` từ đường dẫn:

```
https://docs.google.com/spreadsheets/d/  1a2B3cD4eF5gH6iJ7kL8mN9oP0qR  /edit
                                         └──────────── đây ────────────┘
```

**Không chia sẻ ở bước 2 là lỗi hay gặp nhất.** Triệu chứng: mọi biến đều đúng
nhưng Google trả về 403.

### 5. Điền biến môi trường

Tạo tệp `.env.local` ở thư mục gốc:

```bash
GOOGLE_SERVICE_ACCOUNT_EMAIL="robin-writer@....iam.gserviceaccount.com"
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n"
SHEET_ID="1a2B3cD4eF5gH6iJ7kL8mN9oP0qR"
APP_SECRET="một-chuỗi-ngẫu-nhiên-dài-ít-nhất-16-ký-tự"
```

Về `GOOGLE_PRIVATE_KEY`: chép **nguyên văn** giá trị trong tệp JSON, giữ cả các
ký tự `\n`, và bọc trong dấu nháy kép. Ứng dụng tự xử lý phần xuống dòng bị thoát.

Sinh `APP_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

`APP_SECRET` là khoá ký cookie phân quyền. Ai đoán được nó thì tự cấp cho mình
quyền chủ sự kiện của mọi buổi đánh. Đừng dùng lại giữa dự án khác, đừng đưa vào git.

### 6. Tạo sẵn các tab

```bash
npm run bootstrap-sheet
```

Lệnh này tạo các tab dùng chung và dòng tiêu đề, đồng thời xác nhận cấu hình đúng.
Sai ở đâu nó sẽ nói rõ ở đó.

### 7. Chạy

```bash
npm run dev
```

Mở bảng tính bên cạnh mà xem: mỗi buổi đánh sinh ra hai tab riêng —
`log__<mã>` (nhật ký từng lệnh) và `view__<mã>` (bản in dễ đọc: lịch, tỷ số,
bảng xếp hạng, bảng công bằng).

---

## Đăng nhập bằng tài khoản Google (tuỳ chọn)

Phần này **không liên quan gì** tới service account ở trên, dù cùng nằm trên
Google Cloud. Service account là để ứng dụng ghi vào bảng tính; phần dưới đây là
để **người chơi** đăng nhập, nhằm giữ số liệu khi họ đổi điện thoại.

Bỏ qua hẳn cũng được: thiếu hai biến này thì nút đăng nhập không hiện ra, không
ai bị bắt tạo tài khoản, và toàn bộ ứng dụng chạy đúng như trước.

> **Google đã đổi giao diện.** Phần này giờ nằm ở **Google Auth Platform**, không
> còn ở *APIs & Services → OAuth consent screen* như trước. Đường dẫn thẳng:
> `console.cloud.google.com/auth/overview`. Nếu bạn thấy màn hình *"Google Auth
> Platform not configured yet"* thì đang đúng chỗ.

### 1. Màn hình đồng ý — bấm **Get started**

Google hỏi bốn màn hình ngắn:

| Màn hình | Điền gì |
|---|---|
| **App Information** | Tên ứng dụng và email hỗ trợ |
| **Audience** | Chọn **External** |
| **Contact Information** | Email của bạn |
| **Finish** | Tích đồng ý điều khoản → **Create** |

Không cần logo. **Không cần đụng tới Scopes** — ứng dụng chỉ xin `openid`,
`email`, `profile`, cả ba đều là mặc định và Google không bắt xét duyệt.

Xong thì vào mục **Audience** ở cột trái, phần **Test users** → thêm email của
bạn và của những người trong nhóm.

> Bước test user **không bỏ được**. Ở chế độ **Testing**, chỉ email trong danh
> sách đó mới đăng nhập được — kể cả chính bạn — và Google báo lỗi không nói rõ
> nguyên nhân. Nhóm chơi cố định thì thêm hết vào là xong. Muốn mở cho mọi người
> thì bấm **Publish app** ở mục Overview.

### 2. Tạo OAuth client

1. Mục **Clients** ở cột trái → **Create client**
2. **Application type**: chọn **Web application**
3. **Authorized redirect URIs** → **Add URI**, thêm đúng những dòng sau,
   **từng ký tự một**:

```
http://localhost:3000/api/auth/google/callback
https://<tên-miền-của-bạn>/api/auth/google/callback
```

4. **Create**. Google hiện ra **Client ID** và **Client secret**.

Chạy thử ở máy thì chỉ cần dòng `localhost`. Khi deploy thì quay lại **thêm**
dòng tên miền thật chứ không thay thế — để cả hai cùng chạy được.

**Sai một ký tự ở redirect URI là lỗi hay gặp nhất** của cả mục này. Triệu chứng
rất rõ: Google hiện `Error 400: redirect_uri_mismatch` ngay trước khi bạn kịp
chọn tài khoản. Chép nguyên văn, kể cả dấu `/` cuối (không có).

Đường dẫn này do [`CALLBACK_PATH`](../lib/auth/google-oauth.ts) quy định. Đổi nó
trong mã thì phải đổi cả trên Google, và ngược lại.

### 3. Điền biến môi trường

Thêm vào `.env.local`:

```bash
GOOGLE_OAUTH_CLIENT_ID="....apps.googleusercontent.com"
GOOGLE_OAUTH_CLIENT_SECRET="GOCSPX-...."
```

Chạy sau proxy hoặc tên miền riêng thì thêm cả:

```bash
APP_URL="https://tên-miền-của-bạn"
```

Không có `APP_URL` thì ứng dụng tự suy địa chỉ từ yêu cầu, và đằng sau proxy nó
sẽ suy ra địa chỉ nội bộ — `redirect_uri` khi đó không khớp với khai báo trên
Google.

`APP_SECRET` cũng được dùng để ký cookie đăng nhập, nên nếu chưa đặt thì đặt luôn
(xem bước 5 ở mục trên).

### 4. Thử

Mở trang chủ. Cuối trang phải có nút **Đăng nhập bằng Google**. Bấm vào, chọn tài
khoản, quay về là xong — email của bạn hiện ở chỗ nút vừa bấm.

Kiểm thứ đáng kiểm nhất: mở **cửa sổ ẩn danh** (một "điện thoại" khác), đăng nhập
cùng tài khoản đó, rồi vào trang câu lạc bộ. Phải thấy tên mình sẵn trong danh bạ
mà không phải quét lại mã mời.

### Nó thay đổi những gì

| | Chưa đăng nhập | Đã đăng nhập |
|---|---|---|
| Nhận ra bạn bằng | Cookie thiết bị | Tài khoản, gộp mọi thiết bị |
| Đổi điện thoại | Mất lịch sử | Đăng nhập là thấy lại đủ |
| Vào lại câu lạc bộ trên máy mới | Phải xin mã mời, gõ lại tên | Tên đã sẵn trong danh bạ |
| Trang **Của tôi** | Số liệu của riêng máy này | Gộp số liệu mọi máy |
| Nhập điểm ở sân | Như nhau | Như nhau |

Hàng cuối là quan trọng nhất: **người ra sân không phải đăng nhập**. Quét mã QR
rồi gõ tên vẫn là đường chính, và nó không đổi.

---

## Triển khai lên Vercel

1. Đẩy mã lên GitHub
2. Vào <https://vercel.com/new>, chọn repo. Vercel tự nhận ra Next.js.
3. Mở **Environment Variables**, dán đúng bốn biến ở bước 5 vào
   (chọn cả ba môi trường Production, Preview, Development). Muốn bật đăng nhập
   thì dán thêm `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` và
   `APP_URL`.
4. **Deploy**

Nếu quên biến nào, bản triển khai sẽ báo lỗi rõ ràng lúc khởi động thay vì chạy
rồi mất dữ liệu.

**Múi giờ:** máy chủ Vercel chạy theo UTC, còn giao diện đã cố định hiển thị theo
giờ Việt Nam. Không cần cấu hình gì thêm.

### Soát lại trước khi bấm Deploy

```bash
npm run check-env
```

Lệnh này đọc `.env.local` và nói ra từng chỗ sai bằng tiếng Việt: thiếu biến nào,
`SHEET_ID` có bị dán cả đường dẫn không, `APP_SECRET` đã đủ dài chưa, và in ra
đúng dòng redirect URI cần khai trên Google Cloud. **Không in ra giá trị của biến
nào** — chép khoá riêng ra màn hình là cách làm lộ nó nhanh nhất.

Sinh `APP_SECRET` mới:

```bash
npm run new-secret
```

### Thứ tự phụ thuộc

Ba việc dưới đây phải làm đúng thứ tự, vì việc sau cần kết quả của việc trước.
Bỏ qua thứ tự là chỗ mất thời gian nhất.

| # | Việc | Bắt buộc? | Không có thì sao |
|---|---|---|---|
| 1 | Service account + Google Sheet | **Bắt buộc** | Bản thật không khởi động được. Cố ý — kho tệp cục bộ không sống nổi trên Vercel |
| 2 | `APP_SECRET` | **Bắt buộc** | Bản thật không khởi động được |
| 3 | OAuth client | Tuỳ chọn | Nút đăng nhập không hiện, mọi thứ khác chạy y nguyên |

Riêng bước 3 có một vòng lặp nhỏ dễ vướng: redirect URI cần địa chỉ thật của bản
triển khai, mà địa chỉ đó chỉ có sau lần deploy đầu. Nên làm thế này:

1. Deploy với bước 1 và 2 thôi. Vercel cấp cho bạn một địa chỉ dạng
   `https://<tên-dự-án>.vercel.app`.
2. Quay lại Google Cloud, khai redirect URI theo đúng địa chỉ đó.
3. Thêm `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` và `APP_URL` vào
   Environment Variables.
4. **Redeploy** — biến môi trường mới chỉ có hiệu lực ở lần dựng sau, không áp
   vào bản đang chạy.

Bước 4 là chỗ hay quên nhất: thêm biến xong, mở trang, vẫn không thấy nút đăng
nhập, và tưởng mình làm sai ở đâu đó.

---

## Hạn mức Google Sheets

Đây là ràng buộc thật, không phải chuyện lý thuyết. Google cho **60 request mỗi
phút** cho một tài khoản dịch vụ.

Ứng dụng được thiết kế quanh con số đó:

- **Đọc** đi qua bộ nhớ đệm 5 giây dùng chung giữa các hàm. Hai mươi người cùng
  mở app và hỏi lại mỗi 3 giây vẫn chỉ tốn tối đa 12 lần đọc mỗi phút cho mỗi buổi.
- **Ghi** gom vào một lời gọi cho mỗi thao tác, kể cả khi thao tác đó sinh ra hai
  lệnh (nhập điểm xong thì phải xếp thêm vòng mới).

Thực tế chịu được khoảng **bốn buổi đánh chạy song song**. Đông hơn thì bắt đầu
gặp lỗi 429; ứng dụng tự chờ rồi thử lại, nhưng thao tác sẽ chậm thấy rõ.

Cần nhiều hơn thì thay `lib/sheets/repo.ts` bằng Postgres (Neon hoặc Supabase,
đều có gói miễn phí trên Vercel). Phần `lib/domain` và `lib/scheduler` không phải
sửa một dòng nào — ranh giới đó được giữ sạch từ đầu chính vì lý do này.

---

## Khắc phục sự cố

| Triệu chứng | Nguyên nhân thường gặp |
|---|---|
| `403` từ Google | Chưa chia sẻ bảng tính cho email service account, hoặc chưa bật Sheets API |
| `404` từ Google | `SHEET_ID` sai — lấy đoạn giữa `/d/` và `/edit` |
| `invalid_grant` khi lấy token | `GOOGLE_PRIVATE_KEY` mất phần xuống dòng. Chép lại nguyên văn từ tệp JSON |
| `429` lúc đông người | Chạm hạn mức. Ứng dụng tự thử lại; nếu thường xuyên thì xem mục hạn mức ở trên |
| Thiếu APP_SECRET | Chỉ báo lỗi ở môi trường thật. Ở máy cá nhân dùng khoá mặc định để đỡ phải cấu hình |
| Dữ liệu mất sau khi deploy | Đang chạy ở kho thử. Kiểm tra lại ba biến Google trên Vercel |
| Không thấy nút đăng nhập Google | Thiếu `GOOGLE_OAUTH_CLIENT_ID` hoặc `GOOGLE_OAUTH_CLIENT_SECRET`. Cố ý ẩn nút thay vì để bấm vào rồi ra trang lỗi |
| `Error 400: redirect_uri_mismatch` | Redirect URI khai trên Google chưa khớp từng ký tự. Đằng sau proxy thì đặt thêm `APP_URL` |
| `Error 403: access_denied` khi đăng nhập | Màn hình đồng ý đang ở chế độ Testing mà email đó chưa nằm trong danh sách test user |
| Đăng nhập xong vẫn phải gõ lại tên trong câu lạc bộ | Dòng danh bạ cũ tạo từ máy khác. Đăng nhập một lần trên **đúng cái máy cũ** là nó tự gắn về tài khoản |
