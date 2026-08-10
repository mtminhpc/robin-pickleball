# Thiết kế v0.10.0 — Tròn vòng

## Mục tiêu

Cho Chủ hoặc Phó chuyển một sự kiện đang chạy từ Americano linh hoạt sang một
chiến dịch round robin cá nhân. Mọi trận đã thực sự ra sân được giữ nguyên và
tính vào độ phủ; phần lịch chưa bắt đầu được dựng lại để mỗi người trong nhóm
mục tiêu từng làm đồng đội với mọi người còn lại ít nhất một lần.

Round robin là mục tiêu độ phủ đồng đội cứng. Trong các phương án cùng phủ đủ,
planner ưu tiên ít trận/lặp mới, suất kỳ vọng, chuỗi đánh-nghỉ, độ đều đối thủ,
sân và mức xáo trộn lịch. Lịch sử đã lặp không bị sửa.

## Decision log

- Nhóm được chốt từ người `active` và đủ điều kiện tại vòng hiệu lực; người đến
  sau vẫn chơi nhưng nằm ngoài mục tiêu.
- `playing`, `submitted` và `abandoned` được tính là đã thi đấu; `cancelled`
  trước khi bắt đầu không tính.
- Chủ/Phó chọn vòng bằng dropdown; máy chủ nâng tới mốc an toàn nếu cần.
- Người nghỉ/về vẫn thuộc nhóm cho tới khi Chủ/Phó loại họ bằng một preview mới.
- Không huỷ chiến dịch đang chạy. Chỉ sau khi hoàn tất mới chuyển lại Americano;
  Chủ vẫn có lối Kết thúc sớm và chiến dịch khi đó mang trạng thái `incomplete`.
- Preview dự báo toàn bộ số trận/vòng/thời lượng nhưng chỉ ghi cửa sổ rolling để
  không vượt giới hạn ô nhật ký Google Sheet.
- Giao diện hiện tiến độ và danh sách cặp thiếu, không dựng ma trận đầy đủ.

## Mô hình và lệnh

`EventState` có `scheduleMode` và `roundRobinCampaign`. Chiến dịch giữ ID, trạng
thái, nhóm mục tiêu, vòng hiệu lực, actor label, các `matchId` đã thật sự thi đấu
và mốc hoàn tất. Ba lệnh append-only là `StartRoundRobinCampaign`,
`RemoveRoundRobinPlayer` và `ResumeAmericano`.

Snapshot cũ mặc định Americano. Snapshot mới được nén deflate/base64 có prefix;
đường đọc vẫn nhận JSON cũ. Nhật ký là nguồn thật và không dòng cũ nào bị viết lại.

## Planner và preview

Planner dùng one-factorization để liệt kê mỗi cặp đồng đội đúng một lần, bỏ các
cặp lịch sử đã phủ, ghép hai cạnh thiếu rời nhau vào cùng một trận và chỉ dùng
cặp phụ lặp khi không còn cách ghép hai cạnh thiếu. Đối thủ được chọn theo số lần
gặp thấp nhất rồi toàn bộ kế hoạch được đặt vào sân/vòng có xét ca, trận đông
cứng, deficit và chuỗi.

`structure/preview` nhận ba intent `start-round-robin`,
`remove-round-robin-player`, `resume-americano`; token HMAC/stale check và confirm
all-or-nothing giữ nguyên. Response có thêm tóm tắt nhóm, độ phủ, cặp thiếu,
trận/vòng/phút còn lại và cảnh báo.

## Nghiệm thu

- Replay xác định; không sửa trận đã bắt đầu/ghim; người/sân không trùng vòng.
- Mọi cỡ 4–40 người, 0–8 sân hoàn tất đủ cặp khi điều kiện cho phép.
- Người tạm vắng làm chiến dịch chờ chứ không mất mục tiêu; người đến sau không
  tự làm nhóm nở ra nhưng vẫn nhận suất theo thiếu hụt mà không chặn tiến độ nhóm.
- 0 sân là trạng thái tạm dừng hợp lệ; mở sân lại thì planner tiếp tục đúng phần thiếu.
- Planner 40×8 dưới 4 giây, tổng preview dưới 5 giây.
- Seed `TESTV10` idempotent; không sửa các mã TEST/UPC hiện hữu.
- Phát hành sau smoke v0.8 và v0.9, qua test → scenarios → build → typecheck.
