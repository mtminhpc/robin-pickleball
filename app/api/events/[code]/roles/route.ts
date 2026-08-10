import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { fail, isResponse, readJson, resolveContext } from "@/lib/api/context";
import {
  MAX_EVENT_MANAGERS,
  ROLE_INVITATION_TTL_MS,
  appendRoleAction,
  freshRoleState,
  publicRoleState,
  roleAction,
  subjectFromInput,
} from "@/lib/api/event-roles";
import { subjectsReferToSameIdentity } from "@/lib/domain/event-roles";
import { hashRoleInvitation, newRoleInvitationToken } from "@/lib/auth/role-invitations";
import { withEventLock } from "@/lib/sheets/cache";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const code = (await params).code.toUpperCase();
  const ctx = await resolveContext(request, code);
  if (isResponse(ctx)) return ctx;
  if (!ctx.capabilities.canViewIdentityFlags) {
    return fail(403, "Chỉ Chủ hoặc Phó sự kiện được xem đội quản lý.");
  }
  return NextResponse.json(publicRoleState(await freshRoleState(ctx)));
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const code = (await params).code.toUpperCase();
  const ctx = await resolveContext(request, code);
  if (isResponse(ctx)) return ctx;
  if (!ctx.capabilities.canManageRoles || ctx.role !== "owner") {
    return fail(403, "Chỉ Chủ vận hành hiện tại được cấp quyền Phó sự kiện.");
  }
  if (ctx.event.state.status === "finished") {
    return fail(409, "Sự kiện đã kết thúc nên không thể tạo thêm lời mời quản lý.");
  }
  const parsed = await readJson<{ playerId?: unknown; email?: unknown }>(request);
  if (!parsed.ok) return parsed.response;
  const target = await subjectFromInput(ctx, parsed.body);
  if ("error" in target) return fail(400, target.error);

  return withEventLock(`roles:${code}`, async () => {
    const before = await freshRoleState(ctx);
    if (before.managers.some((manager) =>
      subjectsReferToSameIdentity(ctx.event.state, manager.subject, target.subject)
    )) {
      return fail(409, "Người này đã có trong đội quản lý.");
    }
    if (subjectsReferToSameIdentity(ctx.event.state, before.owner, target.subject)) {
      return fail(409, "Người này đang là Chủ sự kiện.");
    }
    if (before.managers.length >= MAX_EVENT_MANAGERS) {
      return fail(409, `Mỗi sự kiện chỉ có tối đa ${MAX_EVENT_MANAGERS} Phó, kể cả lời mời đang chờ.`);
    }

    const roleId = randomUUID();
    const inviteId = target.claimed ? undefined : randomUUID();
    const rawToken = target.claimed ? undefined : newRoleInvitationToken();
    const expiresAt = rawToken ? Date.now() + ROLE_INVITATION_TTL_MS : undefined;
    const after = await appendRoleAction(
      ctx,
      roleAction(ctx, "grant-manager", {
        roleId,
        subject: target.subject,
        inviteId,
        tokenHash: rawToken ? hashRoleInvitation(rawToken) : undefined,
        expiresAt,
      }),
    );
    const accepted = after.managers.find((manager) => manager.roleId === roleId);
    if (!accepted) {
      return fail(409, "Một yêu cầu đồng thời vừa dùng vị trí Phó cuối cùng. Hãy tải lại.");
    }
    return NextResponse.json(
      {
        role: publicRoleState(after).managers.find((manager) => manager.roleId === roleId),
        invitation: rawToken && inviteId
          ? {
              inviteId,
              token: rawToken,
              expiresAt,
              url: `${request.nextUrl.origin}/e/${code}?roleInvite=${encodeURIComponent(inviteId)}&roleToken=${encodeURIComponent(rawToken)}`,
            }
          : null,
      },
      { status: 201 },
    );
  });
}
