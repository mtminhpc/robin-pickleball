/**
 * Đăng nhập bằng Google, viết tay theo đúng luồng authorization code + PKCE.
 *
 * Không thêm thư viện xác thực nào, cùng lý do đã chọn ở `session.ts`: phần việc
 * thật sự chỉ là dựng một URL, đổi mã lấy token, rồi đọc ba trường trong
 * `id_token`. Một thư viện đăng nhập kéo theo mô hình phiên riêng của nó, mà ứng
 * dụng này đã có mô hình phiên riêng rồi — ghép hai cái vào nhau tốn công hơn là
 * tự viết bốn mươi dòng.
 *
 * **Vì sao không kiểm chữ ký `id_token`.** Token ở đây nhận thẳng từ điểm cuối
 * token của Google qua HTTPS, trong một lời gọi máy-chủ-tới-máy-chủ có kèm
 * `client_secret`. Kênh đó đã xác thực nguồn gốc rồi; chính tài liệu của Google
 * nói rõ trường hợp này không cần kiểm chữ ký. Kiểm chữ ký là bắt buộc khi token
 * đi qua tay trình duyệt — luồng đó chúng ta không dùng. Vẫn kiểm `aud`, `iss`,
 * `exp` và `email_verified` vì chúng rẻ và bắt được cấu hình sai.
 *
 * **Chưa cấu hình thì ứng dụng chạy y như cũ.** Giống hệt cách `factory.ts` đối
 * xử với Google Sheet: thiếu biến môi trường thì phần đăng nhập biến mất khỏi
 * giao diện, mọi thứ khác không đổi một ly. Tài khoản là thứ thêm vào, không
 * phải cửa ải mới dựng trước mặt người ra sân.
 */

import { createHash, randomBytes } from "node:crypto";
import { displayNameFrom, normalizeEmail } from "../domain/account";

const AUTHORIZE_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

/** Đường dẫn Google gọi ngược lại. Phải khớp từng ký tự với cấu hình trên Google. */
export const CALLBACK_PATH = "/api/auth/google/callback";

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
}

export function googleOAuthConfig(): GoogleOAuthConfig | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function oauthEnabled(): boolean {
  return googleOAuthConfig() !== null;
}

/**
 * Địa chỉ gốc của ứng dụng, để dựng `redirect_uri`.
 *
 * Ưu tiên `APP_URL` vì đằng sau proxy thì địa chỉ trong yêu cầu là địa chỉ nội
 * bộ, mà `redirect_uri` sai một ký tự là Google từ chối thẳng — kèm thông báo
 * lỗi không nói ra chỗ sai.
 */
export function appOrigin(requestUrl: string): string {
  const configured = process.env.APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return new URL(requestUrl).origin;
}

export function redirectUri(requestUrl: string): string {
  return `${appOrigin(requestUrl)}${CALLBACK_PATH}`;
}

// ---------------------------------------------------------------------------
// PKCE
// ---------------------------------------------------------------------------

export function newVerifier(): string {
  return randomBytes(32).toString("base64url");
}

export function challengeOf(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function newState(): string {
  return randomBytes(16).toString("base64url");
}

export function authorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL(AUTHORIZE_ENDPOINT);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  // Người dùng chung máy phải chọn được tài khoản khác; không có cái này Google
  // lặng lẽ đăng nhập lại đúng tài khoản cũ và họ tưởng nút bị hỏng.
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

// ---------------------------------------------------------------------------
// Đổi mã lấy danh tính
// ---------------------------------------------------------------------------

export interface GoogleIdentity {
  email: string;
  displayName: string;
  picture: string;
}

export async function exchangeCode(input: {
  config: GoogleOAuthConfig;
  code: string;
  redirectUri: string;
  codeVerifier: string;
  now?: number;
}): Promise<GoogleIdentity> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: input.code,
      client_id: input.config.clientId,
      client_secret: input.config.clientSecret,
      redirect_uri: input.redirectUri,
      grant_type: "authorization_code",
      code_verifier: input.codeVerifier,
    }),
  });

  if (!response.ok) {
    // Chép nguyên văn lời Google nói vào nhật ký máy chủ: gần như mọi lần hỏng ở
    // bước này là `redirect_uri` chưa khai báo, và Google nói đúng điều đó.
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Google từ chối đổi mã đăng nhập (${response.status}). ${detail.slice(0, 300)}`,
    );
  }

  const body = (await response.json()) as { id_token?: string };
  if (!body.id_token) throw new Error("Google không trả về id_token.");

  return readIdentity(body.id_token, input.config.clientId, input.now ?? Date.now());
}

/**
 * Đọc `id_token` và kiểm những gì đáng kiểm.
 *
 * `aud` là chỗ quan trọng nhất: token cấp cho ứng dụng khác mà lọt vào đây thì
 * người ta đăng nhập được bằng danh tính do một ứng dụng khác chứng nhận.
 */
export function readIdentity(
  idToken: string,
  clientId: string,
  now = Date.now(),
): GoogleIdentity {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("id_token không đúng định dạng.");

  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8"));
  } catch {
    throw new Error("Không đọc được nội dung id_token.");
  }

  if (claims.aud !== clientId) {
    throw new Error("id_token cấp cho ứng dụng khác.");
  }
  if (typeof claims.iss !== "string" || !ISSUERS.includes(claims.iss)) {
    throw new Error("id_token không phải do Google cấp.");
  }
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= now) {
    throw new Error("id_token đã hết hạn.");
  }

  const email = normalizeEmail(String(claims.email ?? ""));
  if (email === "") throw new Error("Tài khoản Google này không có email.");
  // Email chưa xác minh thì bất kỳ ai cũng khai được, mà email chính là khoá
  // nhận ra người quay lại. Nhận nó vào là mở cửa cho việc chiếm tài khoản.
  if (claims.email_verified === false) {
    throw new Error("Email của tài khoản Google này chưa được xác minh.");
  }

  return {
    email,
    displayName: displayNameFrom(String(claims.name ?? ""), email),
    picture: typeof claims.picture === "string" ? claims.picture : "",
  };
}

/**
 * Chỉ nhận đường dẫn nội bộ khi quay về sau đăng nhập.
 *
 * Không có bước này thì `?next=https://trang-gia-mao` biến nút đăng nhập của
 * chúng ta thành bàn đạp chuyển hướng cho người khác.
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}
