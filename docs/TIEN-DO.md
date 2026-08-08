# Tiến độ dự án

Cập nhật: 08/08/2026 · nhánh `claude/pickleball-round-robin-app-fq8sja` · commit `75c088b`

Tệp này để bạn (hoặc tôi ở phiên làm việc sau) mở ra là biết dự án đang ở đâu,
chạy thế nào, và việc gì còn dang dở. Hướng dẫn nối Google Sheet thật nằm riêng ở
[SETUP.md](SETUP.md).

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
| Chạy bộ kiểm thử | `npm test` (172 bài, ~20 giây) |
| Quét công bằng 42 cấu hình | `npm run sim -- --matrix` |
| Mô phỏng một buổi cụ thể | `npm run sim -- --players 12 --courts 2 --rounds 16 --join 5 --leave 9` |
| Mở bằng điện thoại cùng wifi | `npm run dev -- -H 0.0.0.0`, lấy IP bằng `ipconfig`, vào `http://192.168.x.x:3000` |

> **Dùng `npm` chứ không phải `pnpm`.** Repo có `pnpm-lock.yaml` nhưng `npm` chạy
> tốt, và trên Windows việc cài `pnpm` hay vướng chính sách chạy script của
> PowerShell — không đáng để mất thời gian cho một lần chạy thử.

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

### Sửa lỗi ở phiên gần nhất

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
| Kiểm thử tự động | **172 bài xanh** (`npm test`) |
| Quét ma trận công bằng | **42 cấu hình, 0 cấu hình bị đánh dấu** |
| Chạy thử thật qua HTTP | **66 phép kiểm, 0 hỏng** — buổi đánh, câu lạc bộ, tổng kết, trang của tôi |
| Biên dịch bản thật | `npm run build` sạch |
| Tải mới hoàn toàn | `git clone` → `npm install` → `npm run dev` chạy được, tạo được sự kiện và câu lạc bộ |

---

## Còn lại

### GĐ3 — Tài khoản Google (chưa bắt đầu)
Đăng nhập, đồng bộ đa thiết bị, thống kê xuyên thiết bị. Tab `accounts` trong
Sheet đã có sẵn bố cục, chỉ chờ nối.

### Việc nhỏ chưa làm

- **Triển khai Vercel.** Tôi không deploy hộ được vì cần tài khoản của bạn. Mã đã
  sẵn sàng: nối repo vào Vercel, dán bốn biến môi trường trong
  [SETUP.md](SETUP.md) là chạy. **Bắt buộc phải có biến Google** — kho tệp cục bộ
  không sống được trên Vercel, và ứng dụng cố ý báo lỗi ngay lúc khởi động thay vì
  âm thầm mất dữ liệu.
- **Đổi mã mời câu lạc bộ.** Hiện mã mời cố định. Muốn "khoá cửa" lại khi có người
  lạ vào thì cần nút đổi mã.
- **Tab `devices` và `rollups`** đã có trong bố cục Sheet nhưng chưa dùng. Tổng
  kết đang tính lại mỗi lần đọc; khi nào câu lạc bộ có vài trăm buổi mới cần đệm
  vào `rollups`.

### Cảnh báo bảo mật

`npm audit` báo **3 lỗ hổng mức cao**, tất cả nằm trong thư viện `postcss` và
`sharp` mà Next.js 15 tự kéo theo, không phải mã của dự án này:

- `postcss` — chỉ khai thác được nếu ứng dụng biên dịch CSS do người dùng gửi lên.
  App này không có chỗ nào như vậy.
- `sharp`/`libvips` — chỉ dùng khi có `next/image` xử lý ảnh người dùng tải lên.
  App này không dùng `next/image`.

Nên **không chặn việc chạy thử hay dùng ở sân**. Muốn dọn sạch thì phải nâng lên
Next.js 16, là thay đổi phá vỡ tương thích — làm được, nhưng nên làm riêng một
lần rồi chạy lại toàn bộ kiểm thử, không gộp vào phiên đang thêm tính năng.

---

## Bố cục mã nguồn

```
app/              Trang và API (Next.js App Router)
  e/[code]/       Buổi đánh: đang đánh, lịch, xếp hạng, người chơi, quản lý, tham gia
  c/[id]/         Câu lạc bộ: danh bạ, tham gia, tổng kết
  me/             Số liệu của riêng máy này
components/       Mảnh giao diện dùng lại
hooks/            Đồng bộ trạng thái, hàng đợi lưu, câu lạc bộ
lib/domain/       Kiểu dữ liệu, tập lệnh, suy trạng thái, xếp hạng, luật,
                  câu lạc bộ, tổng kết tuần/tháng
lib/scheduler/    Thuật toán xếp lịch, hàm chi phí, đo công bằng, kiểm tra dời lịch
lib/sheets/       Google Sheet thật, kho chạy thử, bộ nhớ đệm, bản in, câu lạc bộ
lib/auth/         Mật khẩu, cookie phiên, chặn dò
lib/testing/      Bộ khung chạy thử một sự kiện bằng lệnh
scripts/          Mô phỏng dòng lệnh, tạo sẵn tab trong Sheet
tests/            172 bài kiểm thử
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
| Dữ liệu rối, muốn làm lại | Xoá thư mục `.data` |
| Không lập được câu lạc bộ | Trình duyệt đang chặn cookie — app cần cookie thiết bị để biết máy nào là ai |

Vướng ở đâu thì chụp màn hình hoặc chép nguyên dòng lỗi trong PowerShell gửi tôi.
