import { normalizeEmail } from "./account";
import type { EventState, Player } from "./types";
import type { EventStaffMember } from "../sheets/event-staff";

export type RoleSubject =
  | { kind: "account"; userId: string; email?: string; label: string }
  | { kind: "player"; playerId: string; label: string }
  | { kind: "pending-email"; email: string; label: string };

export type EventRoleActionType =
  | "grant-manager"
  | "accept-manager"
  | "expire-manager"
  | "revoke-manager"
  | "start-owner-transfer"
  | "accept-owner-transfer"
  | "expire-owner-transfer"
  | "cancel-owner-transfer"
  | "confirm-account-transfer"
  | "complete-account-transfer";

export interface EventRoleAction {
  id: string;
  eventCode: string;
  type: EventRoleActionType;
  roleId?: string;
  transferId?: string;
  inviteId?: string;
  subject?: RoleSubject;
  /** Chủ trước lúc khởi tạo; giúp replay đúng sau khi owner_user_id đã đổi. */
  previousOwner?: RoleSubject;
  tokenHash?: string;
  expiresAt?: number;
  confirmationSide?: "old" | "new";
  accountUserId?: string;
  actorLabel: string;
  /** Nội bộ; audit HTTP tuyệt đối không trả trường này. */
  actorRef?: string;
  at: number;
}

export interface EventManagerRole {
  roleId: string;
  subject: RoleSubject;
  status: "pending" | "active";
  inviteId: string | null;
  tokenHash: string | null;
  expiresAt: number | null;
  createdAt: number;
  source: "ledger" | "event_staff";
}

export interface PendingOwnershipTransfer {
  transferId: string;
  target: RoleSubject;
  inviteId: string | null;
  tokenHash: string | null;
  createdAt: number;
  expiresAt: number;
}

export interface AccountOwnershipTransfer {
  transferId: string;
  oldOwner: RoleSubject;
  newOwner: RoleSubject;
  oldConfirmed: boolean;
  newConfirmed: boolean;
  completedUserId: string | null;
}

export interface EventRoleState {
  revision: number;
  owner: RoleSubject | null;
  managers: EventManagerRole[];
  pendingTransfer: PendingOwnershipTransfer | null;
  accountTransfer: AccountOwnershipTransfer | null;
  actions: EventRoleAction[];
}

export interface RoleIdentity {
  userId: string | null;
  email?: string | null;
  me: Player | null;
}

/**
 * Fold ledger theo đúng thứ tự dòng Sheet. Hành động đến sau nhưng không còn hợp lệ
 * bị bỏ qua, nhờ vậy hai request đồng thời vẫn chỉ có một Chủ và tối đa năm Phó.
 */
export function foldEventRoles(input: {
  eventCode: string;
  ownerUserId: string;
  ownerLabel?: string;
  state?: Pick<EventState, "players">;
  legacyStaff?: readonly EventStaffMember[];
  actions: readonly EventRoleAction[];
}): EventRoleState {
  const originalOwner = input.actions.find(
    (action) => action.type === "start-owner-transfer" && action.previousOwner,
  )?.previousOwner;
  let owner: RoleSubject | null = originalOwner ?? (input.ownerUserId
    ? { kind: "account", userId: input.ownerUserId, label: input.ownerLabel || "Chủ sự kiện" }
    : null);
  const managers = new Map<string, EventManagerRole>();
  const sameIdentity = (a: RoleSubject | null, b: RoleSubject | null) =>
    subjectsReferToSameIdentity(input.state, a, b);
  for (const member of input.legacyStaff ?? []) {
    if (member.status === "revoked") continue;
    const subject: RoleSubject = member.userId
      ? {
          kind: "account",
          userId: member.userId,
          email: member.email,
          label: member.displayName || member.email,
        }
      : {
          kind: "pending-email",
          email: normalizeEmail(member.email),
          label: member.displayName || member.email,
        };
    if (
      managers.size >= 5 ||
      sameIdentity(owner, subject) ||
      [...managers.values()].some((manager) => sameIdentity(manager.subject, subject))
    ) continue;
    managers.set(`staff:${member.staffId}`, {
      roleId: `staff:${member.staffId}`,
      subject,
      status: member.status === "active" ? "active" : "pending",
      inviteId: null,
      tokenHash: null,
      expiresAt: null,
      createdAt: member.createdAt,
      source: "event_staff",
    });
  }

  let pendingTransfer: PendingOwnershipTransfer | null = null;
  let accountTransfer: AccountOwnershipTransfer | null = null;
  const accepted: EventRoleAction[] = [];

  for (const action of input.actions) {
    if (action.eventCode.toUpperCase() !== input.eventCode.toUpperCase()) continue;
    switch (action.type) {
      case "grant-manager": {
        if (!action.roleId || !action.subject || managers.has(action.roleId)) break;
        if (
          managers.size >= 5 ||
          sameIdentity(owner, action.subject) ||
          [...managers.values()].some((manager) => sameIdentity(manager.subject, action.subject!))
        ) break;
        managers.set(action.roleId, {
          roleId: action.roleId,
          subject: action.subject,
          status: action.tokenHash ? "pending" : "active",
          inviteId: action.inviteId ?? null,
          tokenHash: action.tokenHash ?? null,
          expiresAt: action.expiresAt ?? null,
          createdAt: action.at,
          source: "ledger",
        });
        accepted.push(action);
        break;
      }
      case "accept-manager": {
        const role = action.roleId ? managers.get(action.roleId) : null;
        if (!role || role.status !== "pending" || role.inviteId !== action.inviteId) break;
        managers.set(role.roleId, {
          ...role,
          status: "active",
          tokenHash: null,
        });
        accepted.push(action);
        break;
      }
      case "expire-manager": {
        const role = action.roleId ? managers.get(action.roleId) : null;
        if (!role || role.status !== "pending" || (action.inviteId && role.inviteId !== action.inviteId)) break;
        managers.delete(role.roleId);
        accepted.push(action);
        break;
      }
      case "revoke-manager": {
        if (!action.roleId || !managers.delete(action.roleId)) break;
        accepted.push(action);
        break;
      }
      case "start-owner-transfer": {
        if (pendingTransfer || !owner || !action.transferId || !action.subject || !action.expiresAt) break;
        if (sameIdentity(owner, action.subject)) break;
        // Chủ cũ sẽ trở thành Phó khi chấp nhận, nên phải chừa sẵn một vị trí.
        if (
          managers.size >= 5 &&
          ![...managers.values()].some((manager) => sameIdentity(manager.subject, action.subject!))
        ) break;
        pendingTransfer = {
          transferId: action.transferId,
          target: action.subject,
          inviteId: action.inviteId ?? null,
          tokenHash: action.tokenHash ?? null,
          createdAt: action.at,
          expiresAt: action.expiresAt,
        };
        accepted.push(action);
        break;
      }
      case "accept-owner-transfer": {
        if (!pendingTransfer || action.transferId !== pendingTransfer.transferId || !owner) break;
        const oldOwner = owner;
        owner = pendingTransfer.target;
        for (const [roleId, manager] of managers) {
          if (sameIdentity(manager.subject, owner)) managers.delete(roleId);
        }
        managers.set(`former-owner:${pendingTransfer.transferId}`, {
          roleId: `former-owner:${pendingTransfer.transferId}`,
          subject: oldOwner,
          status: "active",
          inviteId: null,
          tokenHash: null,
          expiresAt: null,
          createdAt: action.at,
          source: "ledger",
        });
        accountTransfer = {
          transferId: pendingTransfer.transferId,
          oldOwner,
          newOwner: owner,
          oldConfirmed: false,
          newConfirmed: false,
          completedUserId: null,
        };
        pendingTransfer = null;
        accepted.push(action);
        break;
      }
      case "expire-owner-transfer": {
        if (!pendingTransfer || action.transferId !== pendingTransfer.transferId) break;
        pendingTransfer = null;
        accepted.push(action);
        break;
      }
      case "cancel-owner-transfer": {
        if (!pendingTransfer || action.transferId !== pendingTransfer.transferId) break;
        pendingTransfer = null;
        accepted.push(action);
        break;
      }
      case "confirm-account-transfer": {
        if (!accountTransfer || action.transferId !== accountTransfer.transferId) break;
        if (action.confirmationSide === "old") accountTransfer.oldConfirmed = true;
        else if (action.confirmationSide === "new") accountTransfer.newConfirmed = true;
        else break;
        accepted.push(action);
        break;
      }
      case "complete-account-transfer": {
        if (
          !accountTransfer ||
          action.transferId !== accountTransfer.transferId ||
          !accountTransfer.oldConfirmed ||
          !accountTransfer.newConfirmed ||
          !action.accountUserId ||
          accountTransfer.completedUserId !== null
        ) break;
        accountTransfer.completedUserId = action.accountUserId;
        accepted.push(action);
        break;
      }
    }
  }

  return {
    revision: roleRevision(input.actions, input.legacyStaff ?? []),
    owner,
    managers: [...managers.values()],
    pendingTransfer,
    accountTransfer,
    actions: accepted,
  };
}

function roleRevision(
  actions: readonly EventRoleAction[],
  staff: readonly EventStaffMember[],
): number {
  let hash = actions.length + 1;
  for (const member of staff) {
    const value = `${member.staffId}:${member.status}:${member.userId}:${member.email}`;
    for (let index = 0; index < value.length; index++) {
      hash = Math.imul(hash ^ value.charCodeAt(index), 16_777_619) >>> 0;
    }
  }
  return hash;
}

export function subjectMatches(subject: RoleSubject | null, identity: RoleIdentity): boolean {
  if (!subject) return false;
  if (subject.kind === "account") {
    return Boolean(identity.userId && identity.userId === subject.userId);
  }
  if (subject.kind === "player") return identity.me?.id === subject.playerId;
  return Boolean(
    identity.email && normalizeEmail(identity.email) === normalizeEmail(subject.email),
  );
}

export function roleForIdentity(
  roles: EventRoleState,
  identity: RoleIdentity,
): "owner" | "manager" | null {
  if (subjectMatches(roles.owner, identity)) return "owner";
  return roles.managers.some(
    (manager) => manager.status === "active" && subjectMatches(manager.subject, identity),
  )
    ? "manager"
    : null;
}

export function subjectLabel(subject: RoleSubject): string {
  return subject.label || (subject.kind === "pending-email" ? subject.email : "Người điều hành");
}

export function subjectPlayer(state: EventState, subject: RoleSubject): Player | null {
  return subject.kind === "player"
    ? state.players.find((player) => player.id === subject.playerId) ?? null
    : null;
}

export function subjectEquals(a: RoleSubject | null, b: RoleSubject | null): boolean {
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === "account" && b.kind === "account") return a.userId === b.userId;
  if (a.kind === "player" && b.kind === "player") return a.playerId === b.playerId;
  if (a.kind === "pending-email" && b.kind === "pending-email") {
    return normalizeEmail(a.email) === normalizeEmail(b.email);
  }
  return false;
}

/** So khớp cùng người kể cả một phía là account và phía kia là ô đã liên kết account đó. */
export function subjectsReferToSameIdentity(
  state: Pick<EventState, "players"> | undefined,
  a: RoleSubject | null,
  b: RoleSubject | null,
): boolean {
  if (subjectEquals(a, b)) return true;
  if (!a || !b) return false;
  const keys = (subject: RoleSubject): string[] => {
    if (subject.kind === "account") {
      return [
        `user:${subject.userId}`,
        ...(subject.email ? [`email:${normalizeEmail(subject.email)}`] : []),
      ];
    }
    if (subject.kind === "pending-email") return [`email:${normalizeEmail(subject.email)}`];
    const linked = state?.players.find((player) => player.id === subject.playerId)?.userId;
    return [`player:${subject.playerId}`, ...(linked ? [`user:${linked}`] : [])];
  };
  const left = new Set(keys(a));
  return keys(b).some((key) => left.has(key));
}
