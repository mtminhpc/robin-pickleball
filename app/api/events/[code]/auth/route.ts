/**
 * Nhập mật khẩu để lấy quyền nhập điểm hoặc quyền chủ sự kiện.
 *
 * Thử mật khẩu admin trước rồi mới tới mật khẩu người chơi, để chủ sân gõ một
 * lần là có quyền cao nhất, không phải chọn "tôi là chủ sân" trước.
 */

import { NextResponse, type NextRequest } from "next/server";
import { verifyPassword } from "@/lib/auth/passwords";
import { checkRateLimit, clearRateLimit } from "@/lib/auth/ratelimit";
import {
  SESSION_TTL_SECONDS,
  cookieName,
  newSession,
  sessionSecret,
  signSession,
} from "@/lib/auth/session";
import type { SessionRole } from "@/lib/auth/session";
import { fail, readJson } from "@/lib/api/context";
import { readEvent, readEventAuthVersion } from "@/lib/sheets/cache";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code: raw } = await params;
  const code = raw.toUpperCase();

  const parsed = await readJson<{ password?: string }>(request);
  if (!parsed.ok) return parsed.response;
  const password = parsed.body.password ?? "";

  const clientIp =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const limit = checkRateLimit(`${clientIp}:${code}`);
  if (!limit.allowed) {
    return fail(
      429,
      `Nhập sai nhiều lần. Thử lại sau ${limit.retryAfterSeconds} giây.`,
    );
  }

  const event = await readEvent(code);
  if (!event) return fail(404, `Không tìm thấy sự kiện có mã ${code}.`);

  let role: SessionRole | null = null;
  if (await verifyPassword(password, event.record.adminPassHash)) role = "admin";
  else if (
    event.record.playerPassHash &&
    (await verifyPassword(password, event.record.playerPassHash))
  ) {
    role = "player";
  }

  if (!role) {
    return fail(
      401,
      `Mật khẩu không đúng. Còn ${limit.remaining} lần thử trong phút này.`,
    );
  }

  // Gõ đúng thì xoá bộ đếm, để người lỡ gõ nhầm một lần không bị phạt tiếp.
  clearRateLimit(`${clientIp}:${code}`);

  const response = NextResponse.json({ role });
  response.cookies.set(
    cookieName(code),
    signSession(
      newSession(
        code,
        role,
        Date.now(),
        role === "admin" ? await readEventAuthVersion(code) : 0,
      ),
      sessionSecret(),
    ),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: SESSION_TTL_SECONDS,
      path: "/",
    },
  );
  return response;
}

/** Thoát quyền — hữu ích khi mượn điện thoại người khác để nhập hộ. */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const response = NextResponse.json({ role: "viewer" });
  response.cookies.delete(cookieName(code.toUpperCase()));
  return response;
}
