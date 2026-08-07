# Cài đặt

Hai chế độ, chuyển qua lại chỉ bằng biến môi trường:

| Chế độ | Khi nào dùng | Cần chuẩn bị |
|---|---|---|
| **Chạy thử trên máy** | Bấm thử, xem giao diện, tập dùng trước buổi đánh | Không cần gì |
| **Google Sheet thật** | Mang ra sân dùng | Google Cloud + một bảng tính |

---

## Chạy thử trên máy (2 phút)

```bash
pnpm install
pnpm dev
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
pnpm bootstrap-sheet
```

Lệnh này tạo các tab dùng chung và dòng tiêu đề, đồng thời xác nhận cấu hình đúng.
Sai ở đâu nó sẽ nói rõ ở đó.

### 7. Chạy

```bash
pnpm dev
```

Mở bảng tính bên cạnh mà xem: mỗi buổi đánh sinh ra hai tab riêng —
`log__<mã>` (nhật ký từng lệnh) và `view__<mã>` (bản in dễ đọc: lịch, tỷ số,
bảng xếp hạng, bảng công bằng).

---

## Triển khai lên Vercel

1. Đẩy mã lên GitHub
2. Vào <https://vercel.com/new>, chọn repo. Vercel tự nhận ra Next.js.
3. Mở **Environment Variables**, dán đúng bốn biến ở bước 5 vào
   (chọn cả ba môi trường Production, Preview, Development)
4. **Deploy**

Nếu quên biến nào, bản triển khai sẽ báo lỗi rõ ràng lúc khởi động thay vì chạy
rồi mất dữ liệu.

**Múi giờ:** máy chủ Vercel chạy theo UTC, còn giao diện đã cố định hiển thị theo
giờ Việt Nam. Không cần cấu hình gì thêm.

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
