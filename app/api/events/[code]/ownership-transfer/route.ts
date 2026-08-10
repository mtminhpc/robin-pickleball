import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { fail, isResponse, readJson, resolveContext } from "@/lib/api/context";
import {
  ROLE_INVITATION_TTL_MS,
  appendRoleAction,
  freshRoleState,
  publicRoleState,
  roleAction,
  subjectFromInput,
} from "@/lib/api/event-roles";
import { hashRoleInvitation, newRoleInvitationToken } from "@/lib/auth/role-invitations";
import { subjectEquals, subjectsReferToSameIdentity } from "@/lib/domain/event-roles";
import { withEventLock } from "@/lib/sheets/cache";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const code = (await params).code.toUpperCase();
  const ctx = await resolveContext(request, code);
  if (isResponse(ctx)) return ctx;
  if (!ctx.capabilities.canManageRoles || ctx.role !== "owner") {
    return fail(403, "Chỉ Chủ vận hành hiện tại được khởi tạo chuyển Chủ.");
  }
  if (ctx.event.state.status === "finished") return fail(409, "Không chuyển Chủ sau khi sự kiện kết thúc.");
  const parsed = await readJson<{ playerId?: unknown; email?: unknown }>(request);
  if (!parsed.ok) return parsed.response;
  const target = await subjectFromInput(ctx, parsed.body);
  if ("error" in target) return fail(400, target.error);

  return withEventLock(`roles:${code}`, async () => {
    const before = await freshRoleState(ctx);
    if (!before.owner || !subjectEquals(before.owner, ctx.roleState.owner)) {
      return fail(409, "Chủ vận hành đã thay đổi. Hãy tải lại.");
    }
    if (subjectsReferToSameIdentity(ctx.event.state, before.owner, target.subject)) {
      return fail(409, "Người này đã là Chủ sự kiện.");
    }
    if (before.pendingTransfer) return fail(409, "Đang có một yêu cầu chuyển Chủ chờ chấp nhận.");
    const targetIsManager = before.managers.some((manager) =>
      subjectsReferToSameIdentity(ctx.event.state, manager.subject, target.subject)
    );
    if (before.managers.length >= 5 && !targetIsManager) {
      return fail(409, "Cần chừa một vị trí Phó để Chủ cũ nhận sau khi chuyển.");
    }
    const transferId = randomUUID();
    const inviteId = target.claimed ? undefined : randomUUID();
    const rawToken = target.claimed ? undefined : newRoleInvitationToken();
    const expiresAt = Date.now() + ROLE_INVITATION_TTL_MS;
    const after = await appendRoleAction(
      ctx,
      roleAction(ctx, "start-owner-transfer", {
        transferId,
        subject: target.subject,
        previousOwner: before.owner,
        inviteId,
        tokenHash: rawToken ? hashRoleInvitation(rawToken) : undefined,
        expiresAt,
      }),
    );
    if (after.pendingTransfer?.transferId !== transferId) {
      return fail(409, "Một yêu cầu chuyển Chủ khác đã được tạo đồng thời.");
    }
    return NextResponse.json({
      transfer: publicRoleState(after).pendingTransfer,
      invitation: rawToken && inviteId
        ? {
            inviteId,
            token: rawToken,
            expiresAt,
            url: `${request.nextUrl.origin}/e/${code}?ownerInvite=${encodeURIComponent(inviteId)}&ownerToken=${encodeURIComponent(rawToken)}`,
          }
        : null,
    }, { status: 201 });
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const code = (await params).code.toUpperCase();
  const ctx = await resolveContext(request, code);
  if (isResponse(ctx)) return ctx;
  if (!ctx.capabilities.canManageRoles || ctx.role !== "owner") {
    return fail(403, "Chỉ Chủ vận hành hiện tại được huỷ chuyển Chủ.");
  }
  return withEventLock(`roles:${code}`, async () => {
    const before = await freshRoleState(ctx);
    if (!before.pendingTransfer) return fail(404, "Không có yêu cầu chuyển Chủ đang chờ.");
    const transferId = before.pendingTransfer.transferId;
    const after = await appendRoleAction(
      ctx,
      roleAction(ctx, "cancel-owner-transfer", { transferId }),
    );
    return after.pendingTransfer
      ? fail(409, "Yêu cầu đã được chấp nhận đồng thời, không thể huỷ.")
      : NextResponse.json({ cancelled: true });
  });
}
