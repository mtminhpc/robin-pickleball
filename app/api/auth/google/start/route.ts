/**
 * Bấm "Đăng nhập bằng Google" thì rơi vào đây.
 *
 * Việc duy nhất của route này là dựng một chuyến đi: sinh `state` và `verifier`,
 * cất vào cookie mười phút, rồi đẩy người dùng sang Google. Không đọc Sheet,
 * không ghi gì — mọi thứ thật sự xảy ra ở `callback`.
 */

import { NextResponse, type NextRequest } from "next/server";
import {
  authorizeUrl,
  challengeOf,
  googleOAuthConfig,
  newState,
  newVerifier,
  redirectUri,
  safeNextPath,
} from "@/lib/auth/google-oauth";
import {
  OAUTH_COOKIE,
  OAUTH_TTL_SECONDS,
  signTransaction,
} from "@/lib/auth/oauth-cookie";
import { sessionSecret } from "@/lib/auth/session";

export async function GET(request: NextRequest) {
  const config = googleOAuthConfig();
  if (!config) {
    return NextResponse.json(
      {
        error:
          "Đăng nhập Google chưa được cấu hình trên máy chủ này. " +
          "Cần GOOGLE_OAUTH_CLIENT_ID và GOOGLE_OAUTH_CLIENT_SECRET — xem docs/SETUP.md.",
      },
      { status: 501 },
    );
  }

  const state = newState();
  const verifier = newVerifier();
  const next = safeNextPath(request.nextUrl.searchParams.get("next"));

  const response = NextResponse.redirect(
    authorizeUrl({
      clientId: config.clientId,
      redirectUri: redirectUri(request.url),
      state,
      codeChallenge: challengeOf(verifier),
    }),
  );

  response.cookies.set(
    OAUTH_COOKIE,
    signTransaction(
      { state, verifier, next, exp: Math.floor(Date.now() / 1000) + OAUTH_TTL_SECONDS },
      sessionSecret(),
    ),
    {
      httpOnly: true,
      // `lax` chứ không phải `strict`: Google chuyển hướng người dùng từ tên
      // miền khác về đây, mà `strict` thì trình duyệt không gửi cookie trong
      // chính lượt đó — và lần đăng nhập nào cũng hỏng.
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: OAUTH_TTL_SECONDS,
      path: "/",
    },
  );
  return response;
}
