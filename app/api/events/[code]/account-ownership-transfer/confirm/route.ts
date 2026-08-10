import { NextResponse, type NextRequest } from "next/server";
import { fail, isResponse, resolveContext } from "@/lib/api/context";
import { freshRoleState, roleAction } from "@/lib/api/event-roles";
import { isGuestUser } from "@/lib/domain/account";
import { DEFAULT_EVENT_LIMIT, isAppAdminEmail } from "@/lib/domain/app-admin";
import { subjectMatches, type RoleSubject } from "@/lib/domain/event-roles";
import {
  excludeDeletedEvents,
  getAccountRepo,
  getAppEventLimitRepo,
  getEventCreationReservationRepo,
  getEventRoleRepo,
  getRepo,
  invalidateEvent,
  invalidateEventRoles,
  withAccountLock,
  withEventLock,
} from "@/lib/sheets/cache";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const code = (await params).code.toUpperCase();
  const ctx = await resolveContext(request, code);
  if (isResponse(ctx)) return ctx;
  if (!ctx.userId || !ctx.accountEmail || isGuestUser(ctx.userId)) {
    return fail(401, "Hãy liên kết và đăng nhập Google để xác nhận chuyển quyền tài khoản.");
  }

  return withEventLock(`roles:${code}`, async () => {
    let roles = await freshRoleState(ctx);
    const transfer = roles.accountTransfer;
    if (!transfer) return fail(404, "Chưa có lần chuyển Chủ vận hành cần hoàn tất tài khoản.");
    if (transfer.completedUserId) {
      return NextResponse.json({ completed: true, repeated: true });
    }
    const identity = { userId: ctx.userId, email: ctx.accountEmail, me: ctx.me };
    const side = subjectMatches(transfer.oldOwner, identity)
      ? "old"
      : subjectMatches(transfer.newOwner, identity)
        ? "new"
        : null;
    if (!side) return fail(403, "Chỉ Chủ cũ hoặc Chủ vận hành mới được xác nhận bước này.");
    const already = side === "old" ? transfer.oldConfirmed : transfer.newConfirmed;
    if (!already) {
      await getEventRoleRepo().append(
        roleAction(ctx, "confirm-account-transfer", {
          transferId: transfer.transferId,
          confirmationSide: side,
        }),
      );
      invalidateEventRoles(code);
      roles = await freshRoleState(ctx);
    }
    const current = roles.accountTransfer;
    if (!current?.oldConfirmed || !current.newConfirmed) {
      return NextResponse.json({
        completed: false,
        waitingFor: !current?.oldConfirmed ? "old" : "new",
      });
    }

    const targetUserId = await googleUserIdForSubject(current.newOwner, ctx);
    if (!targetUserId) {
      return fail(409, "Chủ vận hành mới chưa liên kết tài khoản Google thật với ô người chơi.");
    }
    const account = await getAccountRepo().byId(targetUserId);
    if (!account || !account.email || isGuestUser(account.userId)) {
      return fail(409, "Không tìm thấy tài khoản Google của Chủ vận hành mới.");
    }

    return withAccountLock(targetUserId, async () => {
      const repo = getRepo();
      const currentEvent = await repo.load(code);
      if (currentEvent?.record.ownerUserId === targetUserId) {
        return NextResponse.json({ completed: true, repeated: true });
      }
      const consumesQuota = currentEvent?.state.status !== "finished";
      const owned = await excludeDeletedEvents(await repo.listByOwner(targetUserId));
      const used = owned.filter((item) => item.state.status !== "finished").length;
      const override = isAppAdminEmail(account.email)
        ? null
        : await getAppEventLimitRepo().byEmail(account.email);
      const limit = isAppAdminEmail(account.email)
        ? null
        : override?.limit ?? DEFAULT_EVENT_LIMIT;
      if (consumesQuota && limit !== null && used >= limit) {
        return fail(409, `Tài khoản Chủ mới đang dùng ${used}/${limit} sự kiện. Quyền vận hành vẫn giữ nguyên; hãy giải phóng quota rồi thử lại.`);
      }
      const reservations = getEventCreationReservationRepo();
      const reservation = limit === null || !consumesQuota
        ? null
        : await reservations.acquire(targetUserId, limit - used, Date.now());
      if (consumesQuota && limit !== null && !reservation) {
        return fail(409, "Một yêu cầu đồng thời vừa dùng vị trí quota cuối cùng. Quyền vận hành vẫn giữ nguyên.");
      }
      const refreshedUsed = (await excludeDeletedEvents(await repo.listByOwner(targetUserId)))
        .filter((item) => item.state.status !== "finished").length;
      if (consumesQuota && limit !== null && refreshedUsed >= limit) {
        if (reservation) await reservations.finish(reservation, "released", Date.now());
        return fail(409, `Tài khoản Chủ mới đang dùng ${refreshedUsed}/${limit} sự kiện. Quyền vận hành vẫn giữ nguyên.`);
      }
      const action = roleAction(ctx, "complete-account-transfer", {
        transferId: current.transferId,
        accountUserId: targetUserId,
      });
      const result = await getEventRoleRepo().completeAccountOwnership({
        code,
        expectedOwnerUserId: ctx.event.record.ownerUserId,
        newOwnerUserId: targetUserId,
        action,
      });
      if (result === "owner-changed" || result === "not-found") {
        if (reservation) await reservations.finish(reservation, "released", Date.now());
        return fail(409, "Ô sở hữu tài khoản đã thay đổi; quyền vận hành không bị đảo. Hãy tải lại.");
      }
      if (reservation) {
        await reservations.finish(
          reservation,
          result === "completed" ? "consumed" : "released",
          Date.now(),
        );
      }
      invalidateEventRoles(code);
      invalidateEvent(code);
      return NextResponse.json({ completed: true, repeated: result === "already-completed" });
    });
  });
}

async function googleUserIdForSubject(
  subject: RoleSubject,
  ctx: Extract<Awaited<ReturnType<typeof resolveContext>>, { role: string }>,
): Promise<string | null> {
  if (subject.kind === "account") return isGuestUser(subject.userId) ? null : subject.userId;
  if (subject.kind === "pending-email") {
    const account = await getAccountRepo().byEmail(subject.email);
    return account && !isGuestUser(account.userId) ? account.userId : null;
  }
  const player = ctx.event.state.players.find((item) => item.id === subject.playerId);
  return player?.userId && !isGuestUser(player.userId) ? player.userId : null;
}
