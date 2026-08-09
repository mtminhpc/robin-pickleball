# Robin Pickleball

Ứng dụng xếp lịch và tính điểm cho buổi đánh pickleball theo thể thức **Americano**
(xoay đôi), tính điểm theo **hiệu số**, thiết kế cho thực tế sân bãi: người đến trễ,
người về sớm, khách đột xuất, mưa phải bỏ trận, sóng yếu, nhiều người cùng nhập điểm.

> **Phiên bản v0.3.0 · Trạng thái: giai đoạn 3 — dùng được cả mùa, trên nhiều thiết bị.** Ứng dụng
> chạy đầy đủ: tạo buổi đánh, quét QR tự tham gia, nhập điểm và khoá kết quả,
> bảng xếp hạng, huỷ trận, kết thúc sớm, danh bạ câu lạc bộ, mời nhanh, tổng kết
> tuần và tháng, đăng nhập bằng tài khoản Google. Xem [lộ trình](#lộ-trình).

## Chạy thử ngay

Không cần tài khoản Google, không cần cấu hình gì:

```bash
npm install
npm run dev        # mở http://localhost:3000
```

Dữ liệu lưu vào `.data/sheet.json`; xoá thư mục đó là chơi lại từ đầu. Khi nào sẵn
sàng dùng thật thì điền biến môi trường Google và ứng dụng tự chuyển sang Google
Sheet — xem [docs/SETUP.md](docs/SETUP.md).

```bash
npm test                  # 404 bài kiểm thử
npm run sim -- --matrix   # quét 42 cấu hình từ 6 tới 20 người, 1 tới 4 sân
```

Mô phỏng một buổi cụ thể, kể cả có người vào giữa chừng và người về sớm:

```bash
npm run sim -- --players 12 --courts 2 --rounds 16 --join 5 --leave 9
```

> **Dự án dùng `npm`**, và tệp khoá duy nhất là `package-lock.json`. Đừng thêm
> tệp khoá thứ hai: hai tệp khoá cho cùng một dự án thì sớm muộn cũng lệch nhau,
> và khi đó máy này cài ra một bộ thư viện còn máy kia ra bộ khác.

**Hướng dẫn từng bước cho Windows, kịch bản bấm thử, và tình trạng dự án:**
[docs/TIEN-DO.md](docs/TIEN-DO.md).

## Dùng ở sân thế nào

1. Chủ sân tạo buổi đánh, đặt hai mật khẩu: một cho người chơi (nhập điểm), một
   cho mình (xếp lịch, duyệt người, mở khoá).
2. Chiếu mã QR ở trang Quản lý. Mọi người quét, gõ tên, chọn ảnh đại diện.
3. Bấm **Bắt đầu** → hệ thống xếp lịch. Từ lúc này ai vào thêm đều phải chờ duyệt.
4. Đánh xong mỗi trận thì bấm nhập tỷ số. Có bước xác nhận hiện to tên bốn người
   để không nhập nhầm trận. Lưu xong là khoá lại.
5. Bấm nhầm thì tự sửa được trong 2 phút; sau đó cần mật khẩu chủ sân. Mọi lần
   sửa hiện công khai trên thẻ trận.

## Công bằng được định nghĩa thế nào

Yêu cầu số một là "công bằng chính xác nhất có thể". Chia đều số trận **không phải**
là công bằng khi có người đến trễ hoặc về sớm — người đến vòng thứ năm mà bị coi là
đang thiếu bốn trận thì họ sẽ đánh dồn, còn người khác mất suất.

Thước đo dùng trong toàn bộ ứng dụng là **suất kỳ vọng**. Mỗi vòng có mặt, một người
đáng được `min(1, 4 × số trận / số người có mặt)` lượt đánh. Cộng dồn qua các vòng
người đó *có mặt*, trừ đi số trận thực đánh, ra `deficit` — ai dương là đang bị thiệt.

Hệ quả quan trọng: người tới vòng thứ chín **không nợ tám trận**, họ chỉ chưa có mặt.
Nên lúc vừa đặt chân tới sân, cột Lệch của họ bằng 0 và từ đó họ đánh cùng nhịp với
mọi người. Ai muốn cho người tới muộn được ưu tiên đuổi kịp thì chỉnh `catchUpFactor`,
nhưng nên biết cái giá: đo với 16 người trên 2 sân, hệ số 1 cho người tới muộn 7 trận
trong khi người tới đúng giờ chỉ còn 4–5. Suất đó lấy từ đâu thì lấy của họ.

Ba tình huống khó tự xử lý đúng nhờ định nghĩa này, không cần luật riêng nào:

| Tình huống | Kết quả |
|---|---|
| Vào từ vòng 5 | Không bị tính là thiếu 4 trận. Đánh cùng nhịp với mọi người từ lúc vào |
| Về sau vòng 9 | Không bị tính là "được ưu ái". Kết quả đã đánh giữ nguyên trong bảng xếp hạng |
| Trận bị huỷ | Suất kỳ vọng của cả nhóm giảm theo, nên không ai chịu thiệt |

Ví dụ thật, 12 người / 2 sân / 16 vòng, một người vào ở vòng 5 và một người về ở vòng 9:

```
Người    Trận  Kỳ vọng  Lệch   Nghỉ  Chuỗi   Trạng thái
Giang    11    10.5     -0.54  5     3       đang chơi
Nam      10    10.5     +0.46  6     2       đang chơi
Ngọc      7     7.8     +0.79  5     2       đang chơi   <- vào giữa chừng
An        5     5.1     +0.13  3     2       đã về       <- về sớm
```

Số trận thô lệch từ 5 tới 11, nhưng mức thiệt thòi thực chỉ trong khoảng ±0.79 trận.
Đó mới là con số đáng nhìn.

### Xếp lịch

`lib/scheduler/` — thuần TypeScript, không phụ thuộc Next.js.

Sinh tham lam một phương án khởi đầu, rồi tinh chỉnh bằng luyện kim mô phỏng trên cửa
sổ sáu vòng phía trước. Mọi định nghĩa công bằng nằm gọn trong hàm chi phí ở
[`lib/scheduler/cost.ts`](lib/scheduler/cost.ts), xếp theo thứ tự ưu tiên:

1. Không ai vượt trần số vòng đánh liên tiếp (gần như ràng buộc cứng)
2. Ai cũng được đánh đúng suất của mình
3. Không ai phải ngồi chờ quá lâu
4. Càng nhiều bạn đôi và đối thủ khác nhau càng tốt

### Dời lịch bằng tay

Nút **Sớm hơn / Muộn hơn** đổi chỗ **cả hai vòng** cho nhau chứ không nhấc riêng một
trận sang chỗ khác. Lý do là số học: lịch round robin thì vòng nào cũng kín sân, nên
nhét thêm bốn người vào một vòng là có kẻ phải đánh hai trận — đo trên lịch thật thì
cách dời từng trận hỏng 22 trên 24 lần. Đổi cả vòng thì luôn làm được, và không ai
thêm hay bớt trận nào, không ai đổi bạn đôi; chỉ thứ tự trước sau thay đổi.

Trước khi đổi, hộp xác nhận chạy `validateRoundSwap` ngay trên trình duyệt và nói rõ
ai sẽ phải đánh liên tiếp mấy vòng. Vượt trần chỉ là **cảnh báo**, không phải chặn:
trần chuỗi là mức thuật toán cố giữ chứ không phải luật chơi, mà chủ sự kiện có lý do
ngoài sân mà phần mềm không biết.

Hai vòng gần nhất được coi là đã chốt và không đổi nữa — người chơi nhìn lịch để canh
giờ nghỉ, nên nó phải đứng yên. Các vòng xa hơn được xếp lại mỗi lần để tin tức mới
(ai vừa vào, ai vừa về) kịp phản ánh.

Khi ràng buộc bất khả thi về mặt toán học — 16 người trên 4 sân thì không ai nghỉ
được — ứng dụng **nói thẳng** thay vì im lặng vi phạm, và tự nhắm tới mức tốt nhất
còn đạt được. Kết quả quét toàn dải: mọi cấu hình từ 6 tới 20 người trên 1 tới 4 sân
đều đạt **đúng mức tối ưu lý thuyết** về chuỗi liên tiếp, số trận chênh nhau không
quá 1, và hầu hết cấu hình không lặp lại cặp đôi nào.

### Chống mất dữ liệu trên Google Sheet

Google Sheet không có giao dịch và cũng không có phép so-sánh-rồi-ghi nguyên tử. Hai
người cùng bấm Lưu mà ghi thẳng vào ô thì một kết quả biến mất, không báo lỗi, không
ai biết. Kiến trúc ở đây dựa vào tính chất duy nhất Sheet thật sự bảo đảm — **nối thêm
dòng thì không mất**:

- Tab nhật ký **chỉ ghi thêm** là nguồn sự thật. Hai lệnh đồng thời thành hai dòng
  khác nhau. Không kết quả nào biến mất.
- Ô ảnh chụp trạng thái chỉ là bộ nhớ đệm. Nó có thể bị ghi đè, và điều đó chấp nhận
  được: mỗi lần đọc đều so số dòng nhật ký với số dòng ảnh chụp đã đọc qua, lệch thì
  dựng lại từ nhật ký.
- Xung đột nghiệp vụ thật (hai người cùng nhập một trận) được phân xử khi phát lại:
  lệnh thứ hai bị từ chối và **được báo lại**, chứ không biến mất lặng lẽ.
- Mỗi lệnh tốn đúng một lời gọi đọc và một lời gọi ghi. Hạn mức Sheets là 60 request
  mỗi phút cho cả tài khoản dịch vụ, nên đây là ràng buộc thật chứ không phải tối ưu
  cho vui.

Mỗi lệnh mang một `clientCommandId` sinh ở trình duyệt, nên hàng đợi ngoại tuyến gửi
lại bao nhiêu lần cũng không nhân đôi kết quả.

## Mất mạng thì sao

Sân pickleball hay mất sóng, và người dùng sợ nhất là "tưởng đã lưu mà chưa lưu".
Nên ba trạng thái lưu khác nhau rõ về màu và, quan trọng hơn, khác nhau về việc
**có tự biến mất hay không**:

| Trạng thái | Hiển thị |
|---|---|
| Đang lưu | Băng xám có vòng xoay |
| Đã lưu | Băng xanh kèm giờ cụ thể, tự ẩn sau 3 giây |
| Chưa lưu | Băng **đỏ, không tự ẩn**, kèm nút thử lại |

Ứng dụng **chỉ báo "đã lưu" sau khi máy chủ xác nhận đã ghi xong**, không bao giờ
báo lạc quan. Trong lúc chờ, tỷ số hiện mờ kèm chấm nhấp nháy — nhìn thẻ trận là
biết cái nào chắc chắn.

Lệnh chưa gửi được nằm trong IndexedDB nên đóng tab hay hết pin vẫn còn, tự gửi
lại khi có sóng. Sửa lại tỷ số khi lệnh cũ chưa gửi thì lệnh mới **thay thế** lệnh
cũ, không xếp thành hai — ý định mới nhất luôn thắng.

## Bố cục mã nguồn

```
app/              Trang và API (Next.js App Router)
components/       Mảnh giao diện dùng lại
hooks/            Đồng bộ trạng thái, hàng đợi lưu
lib/domain/       Kiểu dữ liệu, tập lệnh, hàm suy trạng thái, xếp hạng, luật,
                  câu lạc bộ, tài khoản, tổng kết tuần/tháng
lib/scheduler/    Thuật toán xếp lịch, hàm chi phí, đo công bằng
lib/sheets/       Google Sheet thật, kho chạy thử, bộ nhớ đệm, bản in, câu lạc bộ,
                  tài khoản và sổ thiết bị
lib/auth/         Mật khẩu, cookie phiên, chặn dò, đăng nhập Google
lib/testing/      Bộ khung chạy thử một sự kiện bằng lệnh
scripts/          Mô phỏng dòng lệnh, tạo sẵn tab trong Sheet
tests/            404 bài kiểm thử
```

Nguyên tắc: `lib/domain` và `lib/scheduler` là hàm thuần, không đọc đồng hồ, không gọi
mạng, không sinh số ngẫu nhiên ngoài hạt giống cho sẵn. Nhờ vậy phát lại nhật ký luôn
cho ra đúng một kết quả, và toàn bộ luật nghiệp vụ kiểm thử được mà không cần dựng
Google Sheet.

## Lộ trình

- [x] **GĐ0 — Nền móng.** Thuật toán, tầng nghiệp vụ, tầng dữ liệu, bộ kiểm thử,
      công cụ mô phỏng.
- [x] **GĐ1 — Dùng được tại sân.** Tạo sự kiện, hai mật khẩu, mã QR tự tham gia,
      ảnh đại diện, hàng chờ duyệt, nhập điểm và khoá kết quả, banner trạng thái
      lưu, hàng đợi ngoại tuyến, bảng xếp hạng, bảng Công bằng, dời lịch, huỷ trận,
      kết thúc sớm, Google Sheet thật, sẵn sàng triển khai Vercel.
- [x] **GĐ2 — Câu lạc bộ và tổng kết.** Danh bạ thành viên, mã mời và QR, mời
      nhanh cả danh bạ vào buổi đánh, xác nhận đi/không đi, tổng kết tuần và
      tháng, trang `/me` theo thiết bị.
- [x] **GĐ3 — Tài khoản Google.** Đăng nhập, gộp nhiều thiết bị về một tài
      khoản, danh bạ và quyền chủ câu lạc bộ theo tài khoản, thống kê xuyên
      thiết bị ở trang `/me`.

## Câu lạc bộ và tổng kết

Nhóm chơi cố định mười lăm người thì tuần nào chủ sân cũng gõ lại mười lăm cái tên.
Câu lạc bộ là cuốn danh bạ để khỏi phải làm việc đó: mọi người quét mã QR vào một
lần, từ đó mỗi buổi mới chỉ là một cú bấm.

| Việc | Ở đâu |
|---|---|
| Lập câu lạc bộ, vào bằng mã mời | Trang chủ → tab **Câu lạc bộ** |
| Danh bạ, mã QR mời, sửa tên và ảnh | `/c/[mã]` |
| Đổi mã mời khi cần khoá cửa lại | `/c/[mã]` → Mời thêm người → Đổi mã mời |
| Tạo buổi đánh với cả danh bạ điền sẵn | Nút trong trang câu lạc bộ |
| Tổng kết tuần và tháng | `/c/[mã]/summary` |
| Số liệu của riêng máy mình | `/me` |

Người được mời vào buổi đánh ở trạng thái **đã mời**, không phải **đang chơi**:
hôm nay ai đi ai không thì phải hỏi, đoán sai là xếp lịch cho người không có mặt và
cả sân đứng chờ. Ai bấm xác nhận đi thì lúc chủ sự kiện bấm **Bắt đầu** là vào
thẳng, không qua duyệt; ai tới sau vẫn phải chờ duyệt.

Câu lạc bộ **không dùng nhật ký lệnh** như sự kiện, và đó là quyết định chứ không
phải cắt xén. Sự kiện cần nhật ký vì hai mươi người cùng nhập điểm giữa sân, mất
một dòng là mất một kết quả có thật. Danh bạ thì mỗi tháng đổi vài lần. Điều duy
nhất bắt buộc phải giữ là *thêm thành viên thì không được mất*, và cái đó có sẵn
nhờ nối thêm dòng.

Tổng kết chia kỳ theo **giờ Việt Nam**, tuần bắt đầu từ thứ hai. Nghe vụn vặt
nhưng đây là chỗ dễ sai nhất: máy chủ Vercel chạy giờ UTC, nên buổi đánh 6 giờ
sáng thứ hai sẽ rơi nhầm về tuần trước nếu để nó tự đoán — và người dùng chỉ phát
hiện ra khi hỏi "sao tuần này tôi đi hai buổi mà chỉ hiện một".

Trang `/me` chạy được mà không cần tài khoản: máy nhớ mã các buổi đã mở, máy chủ
tính số liệu rồi trả về. Nói thẳng ngay trên trang rằng dữ liệu bám theo máy —
xoá dữ liệu trình duyệt hay đổi điện thoại là mất.

## Tài khoản Google

Chính vì câu cuối ở trên mà có mục này. Danh tính theo thiết bị đủ dùng ở sân
nhưng thua ở một chỗ: đổi điện thoại là mất sạch, và người dùng chỉ phát hiện ra
đúng lúc họ đã mất.

Nguyên tắc: **tài khoản không thay thế thiết bị, nó gom các thiết bị lại.** Không
ai bị bắt đăng nhập. Quét mã QR rồi gõ tên vẫn là đường chính ở sân và không đổi
một ly. Ai đăng nhập thì cái máy đang cầm được gắn về tài khoản, và từ đó:

| | Chưa đăng nhập | Đã đăng nhập |
|---|---|---|
| Đổi điện thoại | Mất lịch sử | Đăng nhập là thấy lại đủ |
| Vào lại câu lạc bộ trên máy mới | Xin mã mời, gõ lại tên | Tên đã sẵn trong danh bạ |
| Mở buổi đang đánh trên máy mới | Không thấy mình đâu, gõ lại tên rồi chờ duyệt | Vào thẳng, đúng chỗ của mình |
| Trang `/me` | Số liệu của riêng máy này | Gộp số liệu mọi máy |

Hàng thứ ba là hàng khó nhất, và cũng là hàng dễ bỏ sót nhất: **trình duyệt không
tự trả lời được câu "ai trong danh sách này là tôi"**. Cookie tài khoản là
`httpOnly` nên mã trên trang không đọc nổi, mà cái máy mới thì cũng chẳng có mã
máy nào từng xuất hiện trong buổi đánh để dò. Nên máy chủ trả lời hộ, bằng
`myPlayerId` kèm trong mỗi lần đọc trạng thái.

Ba quyết định đáng nói:

- **Chưa cấu hình OAuth thì nút đăng nhập không xuất hiện**, y như cách thiếu
  biến Google Sheet thì tự chuyển sang kho chạy thử. Hiện một nút bấm vào là ra
  trang lỗi thì tệ hơn hẳn không hiện nút nào.
- **Đăng nhập gắn luôn cả quyền chủ câu lạc bộ về tài khoản**, trong cùng một lô
  ghi với danh bạ. Làm nửa vời thì có lúc bạn là chủ theo bảng này mà không phải
  chủ theo bảng kia — và cách nhận biết thường là mất quyền với câu lạc bộ của
  chính mình đúng vào lúc vừa đăng nhập.
- **Không kiểm chữ ký `id_token`.** Token nhận thẳng từ điểm cuối token của Google
  qua HTTPS trong lời gọi máy-chủ-tới-máy-chủ có kèm `client_secret`; kênh đó đã
  xác thực nguồn gốc, và tài liệu của Google nói rõ trường hợp này không cần. Vẫn
  kiểm `aud`, `iss`, `exp`, `email_verified` vì chúng rẻ và bắt được cấu hình sai.

Cách bật: [docs/SETUP.md](docs/SETUP.md#đăng-nhập-bằng-tài-khoản-google-tuỳ-chọn).

## Nối Google Sheet thật

Xem [docs/SETUP.md](docs/SETUP.md) — hướng dẫn từng bước, kèm bảng khắc phục các
sự cố hay gặp.
