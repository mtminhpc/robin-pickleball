/**
 * Một câu lạc bộ: đọc danh bạ, đổi tên và cấu hình mặc định.
 *
 * `id` nhận cả mã câu lạc bộ lẫn mã mời, vì người quét mã QR chỉ có mã mời trong
 * tay còn người bấm từ trang chủ thì có mã câu lạc bộ. Bắt họ phân biệt hai thứ
 * đó là bắt họ hiểu chuyện nội bộ của phần mềm.
 */

import { NextResponse, type NextRequest } from "next/server";
import { activeMembers, checkClubName } from "@/lib/domain/club";
import { memberForDevice } from "@/lib/domain/club";
import { DEVICE_COOKIE } from "@/lib/identity/device";
import { getClubRepo, invalidateClub, readClub } from "@/lib/sheets/cache";
import { resolveClub } from "@/lib/api/club-context";
import { fail, isResponse, readJson } from "@/lib/api/context";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const deviceId = request.cookies.get(DEVICE_COOKIE)?.value ?? "";

  const loaded = (await readClub(id)) ?? (await getClubRepo().byInviteCode(id));
  if (!loaded) return fail(404, "Không tìm thấy câu lạc bộ này.");

  const me = memberForDevice(loaded.members, deviceId);
  return NextResponse.json({
    club: loaded.club,
    members: activeMembers(loaded.members),
    me,
    role: loaded.club.ownerRef === deviceId && deviceId ? "owner" : me ? "member" : "guest",
  });
}

interface PatchBody {
  name?: string;
  defaultCourts?: number;
  defaultPointsTo?: number;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ctx = await resolveClub(request, id);
  if (isResponse(ctx)) return ctx;
  if (ctx.role !== "owner") {
    return fail(403, "Chỉ người tạo câu lạc bộ mới sửa được phần này.");
  }

  const parsed = await readJson<PatchBody>(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  if (body.name !== undefined) {
    const error = checkClubName(body.name);
    if (error) return fail(400, error);
  }

  const settings = { ...ctx.loaded.club.settings };
  if (body.defaultCourts !== undefined) {
    settings.defaultCourts = clamp(body.defaultCourts, 1, 8);
  }
  if (body.defaultPointsTo !== undefined) {
    settings.defaultPointsTo = clamp(body.defaultPointsTo, 5, 50);
  }

  const updated = await getClubRepo().updateClub(ctx.loaded.club.id, {
    ...(body.name !== undefined ? { name: body.name } : {}),
    settings,
  });
  invalidateClub(ctx.loaded.club.id);
  return NextResponse.json({ club: updated });
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.round(n)));
}
