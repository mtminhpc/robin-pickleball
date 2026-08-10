import { randomUUID } from "node:crypto";
import type { RequestContext } from "./context";
import { foldEventRoles, subjectMatches, type EventRoleAction, type EventRoleState, type RoleSubject } from "../domain/event-roles";
import { normalizeEmail } from "../domain/account";
import {
  getAccountRepo,
  getEventRoleRepo,
  getEventStaffRepo,
  getRepo,
  invalidateEvent,
  invalidateEventRoles,
} from "../sheets/cache";
import type { CommandEnvelope } from "../domain/commands";

export const MAX_EVENT_MANAGERS = 5;
export const ROLE_INVITATION_TTL_MS = 24 * 60 * 60 * 1000;

export async function freshRoleState(
  ctx: RequestContext,
  options: { expire?: boolean; now?: number } = {},
): Promise<EventRoleState> {
  const repo = getEventRoleRepo();
  const [actions, legacyStaff] = await Promise.all([
    repo.list(ctx.code),
    getEventStaffRepo().list(ctx.code),
  ]);
  const fold = (input: readonly EventRoleAction[]) => foldEventRoles({
    eventCode: ctx.code,
    ownerUserId: ctx.event.record.ownerUserId,
    state: ctx.event.state,
    legacyStaff,
    actions: input,
  });
  const state = fold(actions);
  if (options.expire === false) return state;
  const now = options.now ?? Date.now();
  const eventEnded = ctx.event.state.status === "finished";
  const expired: EventRoleAction[] = state.managers.flatMap((manager) =>
    manager.status === "pending" && (eventEnded || (manager.expiresAt !== null && manager.expiresAt <= now))
      ? [{
          id: randomUUID(), eventCode: ctx.code, type: "expire-manager" as const,
          roleId: manager.roleId, inviteId: manager.inviteId ?? undefined,
          actorLabel: "Hệ thống", at: now,
        }]
      : [],
  );
  if (state.pendingTransfer && (eventEnded || state.pendingTransfer.expiresAt <= now)) {
    expired.push({
      id: randomUUID(), eventCode: ctx.code, type: "expire-owner-transfer",
      transferId: state.pendingTransfer.transferId, actorLabel: "Hệ thống", at: now,
    });
  }
  if (expired.length === 0) return state;
  await repo.appendMany(expired);
  invalidateEventRoles(ctx.code);
  return fold([...actions, ...expired]);
}

export async function appendRoleAction(ctx: RequestContext, action: EventRoleAction) {
  await getEventRoleRepo().append(action);
  invalidateEventRoles(ctx.code);
  return freshRoleState(ctx);
}

export function roleAction(
  ctx: RequestContext,
  type: EventRoleAction["type"],
  extra: Omit<EventRoleAction, "id" | "eventCode" | "type" | "actorLabel" | "actorRef" | "at">,
  at = Date.now(),
): EventRoleAction {
  return {
    id: randomUUID(),
    eventCode: ctx.code,
    type,
    actorLabel: ctx.actor.label,
    actorRef: ctx.actor.ref,
    at,
    ...extra,
  };
}

export async function subjectFromInput(
  ctx: RequestContext,
  input: { playerId?: unknown; email?: unknown },
): Promise<{ subject: RoleSubject; claimed: boolean } | { error: string }> {
  const playerId = typeof input.playerId === "string" ? input.playerId : "";
  if (playerId) {
    const player = ctx.event.state.players.find((item) => item.id === playerId);
    if (!player) return { error: "Không tìm thấy người chơi được chọn." };
    return {
      subject: { kind: "player", playerId: player.id, label: player.name },
      claimed: Boolean(player.deviceId || player.userId),
    };
  }
  const email = normalizeEmail(typeof input.email === "string" ? input.email : "");
  if (!/^\S+@\S+\.\S+$/.test(email)) return { error: "Email lời mời không hợp lệ." };
  const account = await getAccountRepo().byEmail(email);
  return account
    ? {
        subject: {
          kind: "account",
          userId: account.userId,
          email: account.email,
          label: account.displayName,
        },
        claimed: true,
      }
    : {
        subject: { kind: "pending-email", email, label: email },
        claimed: true,
      };
}

export function requestMatchesSubject(ctx: RequestContext, subject: RoleSubject): boolean {
  return subjectMatches(subject, {
    userId: ctx.userId,
    email: ctx.accountEmail,
    me: ctx.me,
  });
}

/**
 * Token của một ô chưa nhận cho phép đúng thiết bị hiện tại nhận ô đó. Lệnh gắn danh
 * tính đi vào log sự kiện trước; nếu tiến trình dừng giữa chừng, retry cùng token sẽ
 * hoàn tất ledger mà không nhân đôi danh tính.
 */
export async function claimPlayerForRole(
  ctx: RequestContext,
  playerId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const player = ctx.event.state.players.find((item) => item.id === playerId);
  if (!player) return { ok: false, error: "Không tìm thấy ô người chơi của lời mời." };
  if (!ctx.deviceId && !ctx.userId) {
    return { ok: false, error: "Thiết bị chưa có cookie danh tính hợp lệ." };
  }
  if (player.userId && player.userId !== ctx.userId) {
    return { ok: false, error: "Ô người chơi này đã thuộc tài khoản khác." };
  }
  if (player.deviceId && player.deviceId !== ctx.deviceId && !ctx.userId) {
    return { ok: false, error: "Ô người chơi này đã được nhận trên thiết bị khác." };
  }
  if (
    (ctx.userId && player.userId === ctx.userId) ||
    (ctx.deviceId && player.deviceId === ctx.deviceId)
  ) return { ok: true };

  const envelope: CommandEnvelope = {
    id: `role-claim:${ctx.code}:${playerId}:${randomUUID()}`,
    at: Date.now(),
    actor: ctx.actor,
    command: {
      type: "LinkAccount",
      playerId,
      userId: ctx.userId ?? undefined,
      deviceId: ctx.deviceId || undefined,
    },
  };
  const result = await getRepo().commit(ctx.code, envelope);
  if (!result.ok) return { ok: false, error: result.error };
  invalidateEvent(ctx.code);
  return { ok: true };
}

export function publicRoleSubject(subject: RoleSubject) {
  if (subject.kind === "player") {
    return { kind: subject.kind, playerId: subject.playerId, label: subject.label };
  }
  if (subject.kind === "pending-email") {
    return { kind: subject.kind, email: subject.email, label: subject.label };
  }
  return { kind: subject.kind, email: subject.email ?? "", label: subject.label };
}

export function publicRoleState(state: EventRoleState) {
  return {
    revision: state.revision,
    maxManagers: MAX_EVENT_MANAGERS,
    owner: state.owner ? publicRoleSubject(state.owner) : null,
    managers: state.managers.map((manager) => ({
      roleId: manager.roleId,
      subject: publicRoleSubject(manager.subject),
      status: manager.status,
      inviteId: manager.inviteId,
      expiresAt: manager.expiresAt,
      createdAt: manager.createdAt,
      source: manager.source,
    })),
    pendingTransfer: state.pendingTransfer
      ? {
          transferId: state.pendingTransfer.transferId,
          target: publicRoleSubject(state.pendingTransfer.target),
          expiresAt: state.pendingTransfer.expiresAt,
          inviteId: state.pendingTransfer.inviteId,
        }
      : null,
    accountTransfer: state.accountTransfer
      ? {
          transferId: state.accountTransfer.transferId,
          oldConfirmed: state.accountTransfer.oldConfirmed,
          newConfirmed: state.accountTransfer.newConfirmed,
          completed: Boolean(state.accountTransfer.completedUserId),
        }
      : null,
  };
}
