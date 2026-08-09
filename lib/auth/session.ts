/**
 * Phiên đăng nhập vào một sự kiện.
 *
 * Một cookie ký HMAC cho mỗi sự kiện, thay vì một phiên chung. Nhờ vậy chủ sân
 * mở đồng thời sự kiện tối nay với sự kiện tuần trước không bị đá quyền lẫn
 * nhau, và huỷ quyền một sự kiện không ảnh hưởng sự kiện khác.
 *
 * Không dùng thư viện JWT: nội dung chỉ có ba trường và tất cả đều do máy chủ
 * sinh ra, nên ký HMAC-SHA256 rồi so bằng `timingSafeEqual` là đủ và không phải
 * gánh thêm phụ thuộc nào. Phần ký nằm ở `hmac.ts`, dùng chung với phiên tài
 * khoản.
 */

import type { Role } from "../domain/commands";
import { readPayload, signPayload } from "./hmac";
export { sessionSecret } from "./secret";

export interface SessionPayload {
  code: string;
  role: Role;
  /** Thời điểm hết hạn, tính bằng giây. */
  exp: number;
}

/** Phiên sống 12 tiếng: đủ cho một buổi đánh dài nhất mà không phải nhập lại. */
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

export function cookieName(code: string): string {
  return `rp_e_${code}`;
}

export function signSession(payload: SessionPayload, secret: string): string {
  return signPayload(payload, secret);
}

/**
 * Đọc cookie. Trả `null` cho mọi trường hợp không tin được: chữ ký sai, hết hạn,
 * hoặc mã sự kiện trong cookie không khớp sự kiện đang xem.
 *
 * Kiểm cả mã sự kiện là để một cookie hợp lệ của sự kiện A không dùng được cho
 * sự kiện B — chữ ký đúng nhưng nội dung sai chỗ.
 */
export function verifySession(
  token: string | undefined,
  code: string,
  secret: string,
  now = Date.now(),
): SessionPayload | null {
  const payload = readPayload<SessionPayload>(token, secret);
  if (!payload) return null;

  if (payload.code !== code) return null;
  if (payload.exp * 1000 <= now) return null;
  if (payload.role !== "player" && payload.role !== "admin") return null;
  return payload;
}

export function newSession(code: string, role: Role, now = Date.now()): SessionPayload {
  return {
    code,
    role,
    exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS,
  };
}
