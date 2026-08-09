/**
 * Ảnh đại diện thật do người dùng tải lên: giới hạn, kiểm tra, và phép cắt khung.
 *
 * Tệp này cố ý **không đụng gì của trình duyệt lẫn của Node**. Nó được cả ba nơi
 * dùng chung — hàm thu nhỏ chạy trên máy người dùng, route nhận ảnh, và route trả
 * ảnh — nên một hằng số lệch nhau giữa ba chỗ là một lớp lỗi rất khó thấy: ảnh
 * lọt qua kiểm tra ở trình duyệt rồi bị máy chủ từ chối, mà người dùng chỉ thấy
 * "không lưu được" không rõ vì sao.
 *
 * Vì sao lưu ảnh thẳng vào bảng tính thay vì một kho tệp riêng: mỗi ô Sheets chứa
 * được 50.000 ký tự — chính giới hạn đã buộc bảng `events` phải cắt trạng thái ra
 * thành `state_1..state_4`. Một tấm 128×128 nén WebP chỉ khoảng 3–5KB, tức
 * 4–7 nghìn ký tự sau khi mã base64. Thoải mái. Đổi lại là không thêm dịch vụ
 * nào phải cấu hình, không thêm khoá bí mật nào phải giữ, và chạy y hệt nhau ở
 * máy cục bộ lẫn trên Vercel.
 */

/** Cạnh ảnh sau khi thu nhỏ. Đủ nét cho ô 64px trên màn hình gấp đôi điểm ảnh. */
export const PHOTO_BOX = 128;

/**
 * Trần độ dài data URI được nhận.
 *
 * Rộng gấp nhiều lần một tấm 128×128 thật, vì nó không ở đây để chặn người dùng
 * bình thường — nó chặn ảnh gửi thẳng bằng `curl` không qua bước thu nhỏ. Vẫn
 * chừa dư địa lớn dưới mức 50.000 ký tự của một ô Sheets cho phần còn lại của
 * `prefs_json`.
 */
export const MAX_PHOTO_CHARS = 32_768;

/**
 * Định dạng được nhận.
 *
 * Cố ý không nhận SVG: SVG là tài liệu chạy được kịch bản, và ảnh đại diện thì
 * hiện trên màn hình của mọi người trong buổi đánh chứ không riêng người tải lên.
 * GIF cũng không, vì ảnh động trong danh sách trận làm rối chỗ cần đọc nhanh.
 */
export const PHOTO_MIMES = ["image/webp", "image/jpeg", "image/png"] as const;

export type PhotoMime = (typeof PHOTO_MIMES)[number];

export type PhotoCheck =
  | { ok: true; mime: PhotoMime; base64: string }
  | { ok: false; error: string };

const DATA_URI = /^data:([a-z0-9/+.-]+);base64,([A-Za-z0-9+/]*={0,2})$/;

/**
 * Kiểm một data URI trước khi cho nó chạm tới bảng tính.
 *
 * Trả về phần base64 chứ không trả byte đã giải mã: bên nhận là route chạy trên
 * Node và tự dùng `Buffer` được, còn ở đây mà gọi `Buffer` thì tệp này hết dùng
 * chung được với mã chạy trên trình duyệt.
 *
 * Mọi câu lỗi đều viết để hiện thẳng lên màn hình cho người vừa bấm nút.
 */
export function checkPhotoDataUri(value: unknown): PhotoCheck {
  if (typeof value !== "string" || value === "") {
    return { ok: false, error: "Chưa có ảnh nào được gửi lên." };
  }
  if (value.length > MAX_PHOTO_CHARS) {
    return { ok: false, error: "Ảnh nặng quá. Chọn ảnh nhỏ hơn rồi thử lại." };
  }

  const match = DATA_URI.exec(value);
  if (!match) {
    return { ok: false, error: "Tệp gửi lên không phải ảnh hợp lệ." };
  }

  const [, mime, base64] = match;
  if (!isPhotoMime(mime)) {
    return { ok: false, error: "Chỉ nhận ảnh JPG, PNG hoặc WebP." };
  }
  // Base64 luôn đi theo nhóm bốn ký tự. Chuỗi lẻ nhóm là dữ liệu đã hỏng dọc
  // đường, và giải mã nó ra sẽ cho một tấm ảnh vỡ mà không ai báo lỗi.
  if (base64!.length === 0 || base64!.length % 4 !== 0) {
    return { ok: false, error: "Dữ liệu ảnh bị hỏng trên đường truyền." };
  }

  return { ok: true, mime, base64: base64! };
}

function isPhotoMime(value: string | undefined): value is PhotoMime {
  return PHOTO_MIMES.includes(value as PhotoMime);
}

export interface CropBox {
  sx: number;
  sy: number;
  size: number;
}

/**
 * Ô vuông lớn nhất nằm giữa một tấm ảnh bất kỳ.
 *
 * Cắt giữa chứ không co méo: ảnh đại diện là khuôn mặt, mà mặt bị kéo giãn thì
 * trông sai ngay lập tức dù không ai chỉ ra được sai chỗ nào. Cắt giữa cũng là
 * điều người ta ngầm mong đợi — ảnh chân dung điện thoại luôn có mặt ở giữa.
 */
export function coverBox(width: number, height: number): CropBox {
  const size = Math.max(1, Math.floor(Math.min(width, height)));
  return {
    sx: Math.floor((width - size) / 2),
    sy: Math.floor((height - size) / 2),
    size,
  };
}
