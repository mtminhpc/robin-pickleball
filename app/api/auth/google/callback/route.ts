/**
 * Google gọi ngược về đây sau khi người dùng đồng ý.
 *
 * Đây là chỗ tài khoản thật sự được lập và cái điện thoại đang cầm được nhận về
 * tài khoản đó. Thứ tự bốn việc dưới đây có chủ ý: nếu bước gắn danh bạ hỏng thì
 * người dùng vẫn đăng nhập được, chỉ là lần sau mở câu lạc bộ mới thấy tên mình
 * — hỏng nhẹ. Còn nếu đảo lại, danh bạ đã mang mã tài khoản mà cookie chưa đặt
 * được thì có những dòng trỏ tới một tài khoản không ai vào được.
 *
 * Mọi lỗi đều quay về trang trước kèm `?dangnhap=loi`, không phải một trang JSON
 * trắng. Người bấm nút đang đứng ở sân, họ cần nhìn thấy màn hình quen thuộc và
 * một câu tiếng Việt, chứ không phải dấu ngoặc nhọn.
 */

import { NextResponse, type NextRequest } from "next/server";
import { derivedAvatar } from "@/lib/avatars/presets";
import {
  exchangeCode,
  googleOAuthConfig,
  redirectUri,
  safeNextPath,
} from "@/lib/auth/google-oauth";
import { OAUTH_COOKIE, verifyTransaction } from "@/lib/auth/oauth-cookie";
import { sessionSecret } from "@/lib/auth/session";
import {
  newUserSession,
  signUserSession,
  USER_COOKIE,
  USER_SESSION_TTL_SECONDS,
} from "@/lib/auth/user-session";
import { DEVICE_COOKIE } from "@/lib/identity/device";
import {
  getAccountRepo,
  getClubRepo,
  invalidateAccount,
  invalidateClub,
} from "@/lib/sheets/cache";

export async function GET(request: NextRequest) {
  const config = googleOAuthConfig();
  if (!config) return back(request, "/", "chuacaidat");

  const secret = sessionSecret();
  const tx = verifyTransaction(request.cookies.get(OAUTH_COOKIE)?.value, secret);
  const next = safeNextPath(tx?.next);

  // Người dùng bấm "Huỷ" ở màn hình Google. Không phải lỗi, đừng làm họ hoảng.
  if (request.nextUrl.searchParams.get("error")) return back(request, next, "huy");

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  if (!tx || !code || !state || state !== tx.state) {
    // Hết mười phút, mở lại đường dẫn cũ, hoặc ai đó đẩy mã lạ vào. Ba trường
    // hợp rất khác nhau nhưng cách xử lý giống nhau: bắt đầu lại từ đầu.
    return back(request, next, "hethan");
  }

  try {
    const identity = await exchangeCode({
      config,
      code,
      redirectUri: redirectUri(request.url),
      codeVerifier: tx.verifier,
    });

    const at = Date.now();
    const accounts = getAccountRepo();
    const account = await accounts.upsertByEmail({
      email: identity.email,
      displayName: identity.displayName,
      avatarId: derivedAvatar(identity.displayName).id,
      prefs: identity.picture ? { picture: identity.picture } : {},
      at,
    });

    const deviceId = request.cookies.get(DEVICE_COOKIE)?.value ?? "";
    if (deviceId) {
      await accounts.linkDevice({
        deviceId,
        userId: account.userId,
        displayName: account.displayName,
        avatarId: account.avatarId,
        at,
      });
      await claimClubs(deviceId, account.userId);
    }
    invalidateAccount(account.userId);

    const response = back(request, next, "ok");
    response.cookies.set(
      USER_COOKIE,
      signUserSession(newUserSession(account.userId, account.email, at), secret),
      {
        // Khác cookie thiết bị: cái này là chứng chỉ xác thực thật, mã chạy trên
        // trang không có việc gì phải đọc được nó.
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: USER_SESSION_TTL_SECONDS,
        path: "/",
      },
    );
    response.cookies.delete(OAUTH_COOKIE);
    return response;
  } catch (error) {
    console.error("[robin-pickleball] đăng nhập Google hỏng:", error);
    return back(request, next, "loi");
  }
}

/**
 * Gắn danh bạ và quyền chủ câu lạc bộ của thiết bị này về tài khoản vừa đăng nhập.
 *
 * Hỏng ở đây thì nuốt lỗi: người dùng vẫn đăng nhập được, chỉ là chưa nhận diện
 * được trên máy khác. Lần đăng nhập sau chạy lại đúng bước này và tự chữa.
 */
async function claimClubs(deviceId: string, userId: string): Promise<void> {
  try {
    const clubs = getClubRepo();
    const claimed = await clubs.claimForDevice(deviceId, userId);
    if (claimed.members === 0 && claimed.clubs === 0) return;
    for (const club of await clubs.forUser(userId)) invalidateClub(club.id);
  } catch (error) {
    console.error("[robin-pickleball] không gắn được danh bạ vào tài khoản:", error);
  }
}

function back(request: NextRequest, next: string, status: string): NextResponse {
  const url = new URL(next, request.url);
  url.searchParams.set("dangnhap", status);
  return NextResponse.redirect(url);
}
