/**
 * Ký và đọc lại một mẩu dữ liệu nhỏ đặt trong cookie.
 *
 * Dùng chung cho hai loại phiên: phiên một sự kiện (`session.ts`) và phiên tài
 * khoản Google (`user-session.ts`). Cả hai đều chỉ chứa vài trường do máy chủ tự
 * sinh, nên HMAC-SHA256 rồi so bằng `timingSafeEqual` là đủ — không phải gánh
 * thêm một thư viện JWT chỉ để làm đúng ba dòng này.
 *
 * Đây là **ký**, không phải **mã hoá**: nội dung ai đọc cũng được, cái được bảo
 * đảm là không ai sửa được mà chữ ký vẫn đúng.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export function signPayload(payload: unknown, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

/**
 * Đọc lại nội dung đã ký. Trả `null` cho mọi thứ không tin được.
 *
 * Chỉ kiểm chữ ký và cú pháp. Hạn dùng và các trường bên trong thì người gọi tự
 * kiểm, vì mỗi loại phiên có luật riêng.
 */
export function readPayload<T>(token: string | undefined, secret: string): T | null {
  if (!token) return null;

  const dot = token.lastIndexOf(".");
  if (dot === -1) return null;

  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!constantTimeEqual(signature, sign(body, secret))) return null;

  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
