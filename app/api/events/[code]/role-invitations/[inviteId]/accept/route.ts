import { NextResponse, type NextRequest } from "next/server";
import { fail, isResponse, readJson, resolveContext } from "@/lib/api/context";
import {
  appendRoleAction,
  claimPlayerForRole,
  freshRoleState,
  roleAction,
} from "@/lib/api/event-roles";
import { roleInvitationStatus } from "@/lib/auth/role-invitations";
import { subjectMatches } from "@/lib/domain/event-roles";
import { withEventLock } from "@/lib/sheets/cache";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ code: string; inviteId: string }> },
) {
  const { code: raw, inviteId } = await params;
  const code = raw.toUpperCase();
  const parsed = await readJson<{ token?: unknown }>(request);
  if (!parsed.ok) return parsed.response;
  const token = typeof parsed.body.token === "string" ? parsed.body.token : "";
  const ctx = await resolveContext(request, code);
  if (isResponse(ctx)) return ctx;
  if (ctx.event.state.status === "finished") return fail(410, "Lời mời hết hiệu lực khi sự kiện kết thúc.");

  return withEventLock(`roles:${code}`, async () => {
    const before = await freshRoleState(ctx, { expire: false });
    const manager = before.managers.find((item) => item.inviteId === inviteId);
    if (!manager) return fail(404, "Không tìm thấy lời mời hoặc lời mời đã bị thu hồi.");
    if (manager.status === "active") {
      const matches = subjectMatches(manager.subject, {
        userId: ctx.userId,
        email: ctx.accountEmail,
        me: ctx.me,
      });
      return matches
        ? NextResponse.json({ accepted: true, repeated: true })
        : fail(409, "Lời mời này đã được dùng trên danh tính khác.");
    }
    const invitationStatus = roleInvitationStatus(token, manager.tokenHash ?? "", manager.expiresAt);
    if (invitationStatus === "invalid") {
      return fail(403, "Mã lời mời không đúng.");
    }
    if (invitationStatus === "expired") {
      return fail(410, "Lời mời đã hết hạn.");
    }
    if (manager.subject.kind !== "player") return fail(409, "Lời mời không gắn với ô người chơi.");
    const claimed = await claimPlayerForRole(ctx, manager.subject.playerId);
    if (!claimed.ok) return fail(409, claimed.error);
    const after = await appendRoleAction(
      ctx,
      roleAction(ctx, "accept-manager", {
        roleId: manager.roleId,
        inviteId,
      }),
    );
    const active = after.managers.find((item) => item.roleId === manager.roleId)?.status === "active";
    return active
      ? NextResponse.json({ accepted: true })
      : fail(409, "Lời mời đã được dùng hoặc thu hồi đồng thời.");
  });
}
