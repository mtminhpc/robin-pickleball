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
  { params }: { params: Promise<{ code: string }> },
) {
  const code = (await params).code.toUpperCase();
  const parsed = await readJson<{ token?: unknown }>(request);
  if (!parsed.ok) return parsed.response;
  const token = typeof parsed.body.token === "string" ? parsed.body.token : "";
  const ctx = await resolveContext(request, code);
  if (isResponse(ctx)) return ctx;
  if (ctx.event.state.status === "finished") return fail(410, "Yêu cầu chuyển Chủ đã hết hiệu lực.");

  return withEventLock(`roles:${code}`, async () => {
    const before = await freshRoleState(ctx, { expire: false });
    const pending = before.pendingTransfer;
    if (!pending) {
      return ctx.role === "owner"
        ? NextResponse.json({ accepted: true, repeated: true })
        : fail(404, "Không có yêu cầu chuyển Chủ đang chờ.");
    }
    if (pending.expiresAt <= Date.now()) return fail(410, "Yêu cầu chuyển Chủ đã hết hạn.");

    let matches = subjectMatches(pending.target, {
      userId: ctx.userId,
      email: ctx.accountEmail,
      me: ctx.me,
    });
    if (!matches && pending.target.kind === "player" && pending.tokenHash) {
      const invitationStatus = roleInvitationStatus(token, pending.tokenHash, pending.expiresAt);
      if (invitationStatus === "expired") return fail(410, "Yêu cầu chuyển Chủ đã hết hạn.");
      if (invitationStatus === "invalid") return fail(403, "Mã chuyển Chủ không đúng.");
      const claimed = await claimPlayerForRole(ctx, pending.target.playerId);
      if (!claimed.ok) return fail(409, claimed.error);
      matches = true;
    }
    if (!matches) return fail(403, "Hãy chấp nhận bằng đúng tài khoản hoặc ô người chơi được chọn.");

    const after = await appendRoleAction(
      ctx,
      roleAction(ctx, "accept-owner-transfer", { transferId: pending.transferId }),
    );
    return after.owner && after.pendingTransfer === null
      ? NextResponse.json({ accepted: true, transferId: pending.transferId })
      : fail(409, "Một thay đổi đồng thời khiến yêu cầu không còn hợp lệ.");
  });
}
