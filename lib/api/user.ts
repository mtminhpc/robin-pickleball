/**
 * "Ai đang gửi yêu cầu này?" — phần tài khoản.
 *
 * Tách khỏi `context.ts` vì hai câu hỏi khác nhau: ở đó là *người này được làm
 * gì trong sự kiện đang mở*, còn ở đây là *cái máy này thuộc về ai*. Trộn vào
 * nhau thì mọi route đều phải trả giá đọc thêm bảng tài khoản, kể cả những
 * route chỉ cần biết vai trò trong một buổi đánh.
 *
 * Trả `null` là trạng thái bình thường, không phải lỗi: phần lớn người ra sân
 * không đăng nhập bao giờ, và toàn bộ ứng dụng phải chạy được như vậy.
 */

import type { NextRequest } from "next/server";
import type { Account, DeviceLink } from "../domain/account";
import { sessionSecret } from "../auth/session";
import { USER_COOKIE, verifyUserSession } from "../auth/user-session";
import { readAccount } from "../sheets/cache";

export interface CurrentUser {
  account: Account;
  /** Mọi máy đã nhận là của tài khoản này, kể cả cái đang cầm. */
  devices: DeviceLink[];
}

/** Mã tài khoản trong cookie. Không đọc Sheet, nên gọi thoải mái. */
export function currentUserId(request: NextRequest): string | null {
  const session = verifyUserSession(
    request.cookies.get(USER_COOKIE)?.value,
    sessionSecret(),
  );
  return session?.uid ?? null;
}

/**
 * Tài khoản đầy đủ kèm danh sách thiết bị. Có đệm 60 giây ở `readAccount`.
 *
 * Cookie còn hạn mà tài khoản không còn trong Sheet thì trả `null`: coi như chưa
 * đăng nhập, chứ không phải lỗi máy chủ. Chuyện này xảy ra khi người ta xoá tay
 * một dòng trong Google Sheet, và ứng dụng phải sống sót qua điều đó.
 */
export async function currentUser(
  request: NextRequest,
): Promise<CurrentUser | null> {
  const uid = currentUserId(request);
  if (!uid) return null;
  return readAccount(uid);
}
