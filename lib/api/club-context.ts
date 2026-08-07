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
import { memberForDevice } from "../domain/club";
import { DEVICE_COOKIE } from "../identity/device";
import { readClub } from "../sheets/cache";
import type { LoadedClub } from "../sheets/clubs";
import { fail } from "./context";

export type ClubRole = "owner" | "member" | "guest";

export interface ClubContext {
  loaded: LoadedClub;
  deviceId: string;
  role: ClubRole;
  /** Dòng danh bạ của chính thiết bị này, nếu đã vào câu lạc bộ. */
  me: ClubMember | null;
}

export async function resolveClub(
  request: NextRequest,
  clubId: string,
): Promise<ClubContext | NextResponse> {
  const loaded = await readClub(clubId);
  if (!loaded) return fail(404, "Không tìm thấy câu lạc bộ này.");

  const deviceId = request.cookies.get(DEVICE_COOKIE)?.value ?? "";
  const me = memberForDevice(loaded.members, deviceId);
  const role: ClubRole =
    deviceId !== "" && loaded.club.ownerRef === deviceId
      ? "owner"
      : me
        ? "member"
        : "guest";

  return { loaded, deviceId, role, me };
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
