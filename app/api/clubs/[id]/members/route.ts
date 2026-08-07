/**
 * Vào danh bạ, sửa dòng của mình, và gỡ người khỏi danh bạ.
 *
 * `POST` cố ý không cần quyền gì: ai có mã mời thì vào được, đúng như cách người
 * ta chia sẻ mã QR cho nhau ở sân. Muốn kín hơn thì đổi mã mời — rẻ và dễ hiểu
 * hơn nhiều so với dựng một hàng chờ duyệt cho cuốn danh bạ.
 */

import { NextResponse, type NextRequest } from "next/server";
import { activeMembers, checkMemberName, nameIsTaken } from "@/lib/domain/club";
import { getClubRepo, invalidateClub } from "@/lib/sheets/cache";
import { canEditMember, resolveClub } from "@/lib/api/club-context";
import { fail, isResponse, readJson } from "@/lib/api/context";

interface JoinBody {
  displayName?: string;
  avatarId?: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ctx = await resolveClub(request, id);
  if (isResponse(ctx)) return ctx;

  const parsed = await readJson<JoinBody>(request);
  if (!parsed.ok) return parsed.response;

  const displayName = parsed.body.displayName ?? "";
  const error = checkMemberName(displayName);
  if (error) return fail(400, error);

  const member = await getClubRepo().addMember(
    ctx.loaded.club.id,
    {
      displayName,
      avatarId: parsed.body.avatarId ?? "e01-c01",
      deviceId: ctx.deviceId,
    },
    Date.now(),
  );
  invalidateClub(ctx.loaded.club.id);

  return NextResponse.json({
    member,
    // Báo lại để giao diện nhắc "câu lạc bộ đã có một người tên Nam" — trùng tên
    // giữa sân là lúc người ta nhập nhầm điểm cho nhau.
    duplicateName: nameIsTaken(ctx.loaded.members, displayName, member.memberId),
  });
}

interface PatchBody {
  memberId?: string;
  displayName?: string;
  avatarId?: string;
  remove?: boolean;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ctx = await resolveClub(request, id);
  if (isResponse(ctx)) return ctx;

  const parsed = await readJson<PatchBody>(request);
  if (!parsed.ok) return parsed.response;
  const { memberId, displayName, avatarId, remove } = parsed.body;

  if (!memberId) return fail(400, "Thiếu mã thành viên.");
  if (!canEditMember(ctx, memberId)) {
    return fail(403, "Chỉ sửa được dòng của chính mình, trừ khi bạn tạo câu lạc bộ.");
  }

  const repo = getClubRepo();
  if (remove) {
    // Người tạo mà tự gỡ mình thì câu lạc bộ mất chủ, không ai sửa được nữa.
    if (ctx.role === "owner" && ctx.me?.memberId === memberId) {
      return fail(400, "Người tạo câu lạc bộ không tự gỡ mình được.");
    }
    const ok = await repo.removeMember(ctx.loaded.club.id, memberId);
    if (!ok) return fail(404, "Không tìm thấy thành viên này.");
    invalidateClub(ctx.loaded.club.id);
    return NextResponse.json({ removed: true });
  }

  if (displayName !== undefined) {
    const error = checkMemberName(displayName);
    if (error) return fail(400, error);
  }

  const updated = await repo.updateMember(ctx.loaded.club.id, memberId, {
    ...(displayName !== undefined ? { displayName } : {}),
    ...(avatarId !== undefined ? { avatarId } : {}),
  });
  if (!updated) return fail(404, "Không tìm thấy thành viên này.");
  invalidateClub(ctx.loaded.club.id);

  return NextResponse.json({
    member: updated,
    duplicateName: nameIsTaken(ctx.loaded.members, updated.displayName, memberId),
    members: activeMembers(ctx.loaded.members),
  });
}
