/**
 * Phiên đăng nhập vào một sự kiện.
 *
 * Một cookie ký HMAC cho mỗi sự kiện, thay vì một phiên chung. Nhờ vậy chủ sân
 * mở đồng thời sự kiện tối nay với sự kiện tuần trước không bị đá quyền lẫn
 * nhau, và huỷ quyền một sự kiện không ảnh hưởng sự kiện khác.
 *
 * Không dùng thư viện JWT: nội dung chỉ có ba trường và tất cả đều do máy chủ
 * sinh ra, nên ký HMAC-SHA256 rồi so bằng `timingSafeEqual` là đủ và không phải
 * gánh thêm phụ thuộc nào.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { Role } from "../domain/commands";

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
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${sign(body, secret)}`;
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
  if (!token) return null;

  const dot = token.lastIndexOf(".");
  if (dot === -1) return null;

  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!constantTimeEqual(signature, sign(body, secret))) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as SessionPayload;

    if (payload.code !== code) return null;
    if (payload.exp * 1000 <= now) return null;
    if (payload.role !== "player" && payload.role !== "admin") return null;
    return payload;
  } catch {
    return null;
  }
}

export function newSession(code: string, role: Role, now = Date.now()): SessionPayload {
  return {
    code,
    role,
    exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS,
  };
}

/**
 * Khoá ký. Bắt buộc phải đặt khi chạy thật.
 *
 * Ở chế độ phát triển thì dùng một khoá cố định để khỏi phải cấu hình gì —
 * nhưng chạy thật mà thiếu thì phải dừng hẳn, vì khoá đoán được nghĩa là ai cũng
 * tự ký được quyền chủ sự kiện cho mình.
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

// ---------------------------------------------------------------------------

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
