/**
 * Băm mật khẩu sự kiện.
 *
 * Dùng `scrypt` của `node:crypto` thay vì bcrypt: không cần phụ thuộc biên dịch
 * native (thứ hay hỏng trên môi trường serverless), và scrypt vốn được thiết kế
 * để tốn bộ nhớ nên chống dò bằng phần cứng chuyên dụng tốt hơn bcrypt.
 *
 * Đây là mật khẩu chia sẻ cho cả nhóm chơi, không phải mật khẩu tài khoản cá
 * nhân — nhưng vẫn không có lý do gì để lưu thô, vì cả bảng tính sẽ nằm trong
 * Google Drive của ai đó.
 */

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

/** Trả về chuỗi `salt:hash` dạng base64url, lưu thẳng vào một ô trong Sheet. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await scryptAsync(password, salt, KEY_LENGTH);
  return `${salt.toString("base64url")}:${key.toString("base64url")}`;
}

/**
 * So sánh mật khẩu. Luôn dùng `timingSafeEqual` để độ dài thời gian phản hồi
 * không tiết lộ được bao nhiêu ký tự đầu đã đúng.
 */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  if (!stored) return false;

  const parts = stored.split(":");
  if (parts.length !== 2) return false;
  const [saltPart, hashPart] = parts as [string, string];
  if (!saltPart || !hashPart) return false;

  try {
    const salt = Buffer.from(saltPart, "base64url");
    const expected = Buffer.from(hashPart, "base64url");

    // Bắt buộc đúng độ dài chứ không so theo độ dài đọc được từ chuỗi lưu.
    // Một ô trong Google Sheet bị sửa tay thành "a:b" sẽ cho phần băm dài đúng
    // một byte, và khi đó phép so sánh chỉ còn một byte — đoán mò là trúng. Ô
    // hỏng phải làm mật khẩu không dùng được, chứ không phải mở toang cửa.
    if (salt.length !== SALT_LENGTH || expected.length !== KEY_LENGTH) return false;

    const actual = await scryptAsync(password, salt, KEY_LENGTH);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/**
 * Mã sự kiện sáu ký tự, đọc và gõ lại được qua điện thoại.
 *
 * Cố ý bỏ các chữ và số dễ nhìn nhầm khi đọc to cho nhau ở sân: 0/O, 1/I/L, 5/S,
 * 8/B. Với 28 ký tự thì sáu vị trí cho khoảng 480 triệu tổ hợp, quá đủ.
 */
const CODE_ALPHABET = "ACDEFGHJKMNPQRTUVWXY234679";

export function generateEventCode(): string {
  const bytes = randomBytes(6);
  let out = "";
  for (let i = 0; i < 6; i++) {
    out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  }
  return out;
}
