/**
 * Cookie giữ một lần đăng nhập đang dang dở.
 *
 * Giữa lúc bấm nút và lúc Google gọi ngược lại, máy chủ phải nhớ ba thứ: chuỗi
 * `state` để nhận ra đúng lượt của mình, `verifier` của PKCE, và trang cần quay
 * về. Không có phiên nào để cất vào — chính là chưa đăng nhập — nên chúng đi
 * theo một cookie ký HMAC, sống đúng mười phút.
 *
 * `state` là thứ ngăn kẻ khác đẩy một mã đăng nhập của **tài khoản họ** vào
 * trình duyệt của bạn. Không có nó, bạn đang đăng nhập yên lành thì bỗng thành
 * người khác, và mọi thứ bạn nhập sau đó rơi vào tài khoản kẻ đó.
 */

import { readPayload, signPayload } from "./hmac";

export const OAUTH_COOKIE = "rp_oauth";

/** Mười phút: đủ cho một lần chọn tài khoản, kể cả khi phải gõ mật khẩu Google. */
export const OAUTH_TTL_SECONDS = 10 * 60;

export interface OAuthTransaction {
  state: string;
  verifier: string;
  /** Đường dẫn nội bộ để quay về, đã lọc ở `safeNextPath`. */
  next: string;
  exp: number;
}

export function signTransaction(tx: OAuthTransaction, secret: string): string {
  return signPayload(tx, secret);
}

export function verifyTransaction(
  token: string | undefined,
  secret: string,
  now = Date.now(),
): OAuthTransaction | null {
  const tx = readPayload<OAuthTransaction>(token, secret);
  if (!tx) return null;
  if (typeof tx.state !== "string" || tx.state === "") return null;
  if (typeof tx.verifier !== "string" || tx.verifier === "") return null;
  if (typeof tx.exp !== "number" || tx.exp * 1000 <= now) return null;
  return tx;
}
