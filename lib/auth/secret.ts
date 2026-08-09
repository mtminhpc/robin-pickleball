/**
 * Khoá ký dùng chung cho mọi cookie do máy chủ phát hành.
 *
 * Tệp này không nhập API Node nào để middleware Edge cũng đọc được. Phần ký
 * phiên thông thường vẫn nằm ở `hmac.ts`; middleware dùng Web Crypto nhưng cùng
 * một khoá và cùng khuôn chữ ký.
 */
export function sessionSecret(): string {
  const secret = process.env.APP_SECRET;
  if (secret && secret.length >= 16) return secret;

  if (process.env.NODE_ENV === "production" || process.env.VERCEL === "1") {
    throw new Error(
      "Thiếu APP_SECRET (cần ít nhất 16 ký tự). Không có nó thì ai cũng tự ký được " +
        "quyền chủ sự kiện. Sinh một chuỗi ngẫu nhiên và đặt vào biến môi trường.",
    );
  }
  return "khoa-chi-dung-khi-phat-trien-tren-may";
}
