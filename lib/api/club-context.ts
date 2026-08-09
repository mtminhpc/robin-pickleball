/**
 * Phần dùng chung của các route câu lạc bộ.
 *
 * Quyền ở đây đơn giản hơn sự kiện rất nhiều, và cố ý như vậy: câu lạc bộ chỉ là
 * cuốn danh bạ, không có gì để tranh chấp. Chủ câu lạc bộ sửa được mọi thứ, thành
 * viên sửa được đúng dòng của mình, người lạ chỉ đọc.
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { ClubMember } from "../domain/club";
import { isClubOwner, memberForDevice, memberForUser } from "../domain/club";
import { deviceIdFromRequest } from "../identity/device-token";
import { readClub } from "../sheets/cache";
import type { LoadedClub } from "../sheets/clubs";
import { fail } from "./context";
import { currentUserId } from "./user";

export type ClubRole = "owner" | "member" | "guest";

export interface ClubContext {
  loaded: LoadedClub;
  deviceId: string;
  /** Tài khoản đang đăng nhập, `null` với phần lớn người ra sân. */
  userId: string | null;
  role: ClubRole;
  /** Dòng danh bạ của người gửi yêu cầu, tìm qua tài khoản trước rồi tới máy. */
  me: ClubMember | null;
}

export async function resolveClub(
  request: NextRequest,
  clubId: string,
): Promise<ClubContext | NextResponse> {
  const loaded = await readClub(clubId);
  if (!loaded) return fail(404, "Không tìm thấy câu lạc bộ này.");

  const deviceId = deviceIdFromRequest(request);
  // Chỉ đọc cookie, không đọc bảng tài khoản: mã tài khoản đã nằm sẵn trong
  // cookie đã ký, mà route này chạy ở mọi lượt mở trang câu lạc bộ.
  const userId = currentUserId(request);

  // Tài khoản trước, vì nó đúng trên mọi máy; thiết bị là đường lui cho người
  // chưa đăng nhập bao giờ — phần lớn người ra sân.
  const me =
    memberForUser(loaded.members, userId ?? "") ??
    memberForDevice(loaded.members, deviceId);

  const role: ClubRole = isClubOwner(loaded.club, { deviceId, userId })
    ? "owner"
    : me
      ? "member"
      : "guest";

  return { loaded, deviceId, userId, role, me };
}

/**
 * Ai được sửa dòng danh bạ này.
 *
 * Ai cũng sửa được tên và ảnh của chính mình mà không cần hỏi ai — đó là mục 11
 * trong yêu cầu. Sửa của người khác thì phải là chủ câu lạc bộ.
 */
export function canEditMember(ctx: ClubContext, memberId: string): boolean {
  if (ctx.role === "owner") return true;
  return ctx.me?.memberId === memberId;
}
