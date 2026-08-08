/**
 * Phiên đăng nhập bằng tài khoản Google.
 *
 * Khác hẳn cookie phiên của một sự kiện (`session.ts`) ở ba chỗ, và cả ba đều có
 * lý do:
 *
 * - **Một cookie cho cả ứng dụng**, không phải mỗi sự kiện một cái. Tài khoản
 *   không gắn với buổi đánh nào cả.
 * - **`httpOnly`**. Cookie thiết bị cố ý để trình duyệt đọc được vì nó chỉ dùng
 *   để hiển thị; cookie này thì là chứng chỉ xác thực thật, mã trên trang không
 *   có việc gì phải đụng tới nó.
 * - **Sống 30 ngày**, không phải 12 tiếng. Phiên sự kiện ngắn vì nó cấp quyền
 *   sửa kết quả của cả nhóm; phiên tài khoản chỉ nói "cái máy này là ai", và bắt
 *   đăng nhập lại mỗi buổi thì tài khoản trở thành phiền toái chứ không phải
 *   tiện ích.
 */

import type { UserId } from "../domain/account";
import { readPayload, signPayload } from "./hmac";

export const USER_COOKIE = "rp_user";

export const USER_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface UserSession {
  uid: UserId;
  /** Chỉ để hiện lên màn hình; mọi quyết định về quyền đều đi qua `uid`. */
  email: string;
  /** Thời điểm hết hạn, tính bằng giây. */
  exp: number;
}

export function newUserSession(
  uid: UserId,
  email: string,
  now = Date.now(),
): UserSession {
  return { uid, email, exp: Math.floor(now / 1000) + USER_SESSION_TTL_SECONDS };
}

export function signUserSession(session: UserSession, secret: string): string {
  return signPayload(session, secret);
}

export function verifyUserSession(
  token: string | undefined,
  secret: string,
  now = Date.now(),
): UserSession | null {
  const payload = readPayload<UserSession>(token, secret);
  if (!payload) return null;
  if (typeof payload.uid !== "string" || payload.uid === "") return null;
  if (typeof payload.exp !== "number" || payload.exp * 1000 <= now) return null;
  return payload;
}
