import type { EventRoleAction, RoleSubject } from "../domain/event-roles";
import type { SheetsClient } from "./client";
import { indexToColumn } from "./client";
import { HEADERS, TABS } from "./schema";

const COLUMNS = HEADERS[TABS.eventRoles];
const C = Object.fromEntries(COLUMNS.map((name, index) => [name, index])) as Record<
  (typeof COLUMNS)[number],
  number
>;
const EVENT_COLUMNS = HEADERS[TABS.events];
const EVENT_C = Object.fromEntries(EVENT_COLUMNS.map((name, index) => [name, index])) as Record<
  (typeof EVENT_COLUMNS)[number],
  number
>;

export class EventRoleRepo {
  constructor(private readonly sheets: SheetsClient) {}

  async bootstrap(): Promise<void> {
    await this.sheets.ensureTab(TABS.eventRoles, COLUMNS);
  }

  async list(eventCode: string): Promise<EventRoleAction[]> {
    return (await this.all()).filter(
      (action) => action.eventCode.toUpperCase() === eventCode.toUpperCase(),
    );
  }

  async all(): Promise<EventRoleAction[]> {
    await this.bootstrap();
    const [range] = await this.sheets.batchGet([
      `${TABS.eventRoles}!A:${indexToColumn(COLUMNS.length - 1)}`,
    ]);
    return (range?.values ?? [])
      .slice(1)
      .map(toAction)
      .filter((action): action is EventRoleAction => action !== null);
  }

  async append(action: EventRoleAction): Promise<void> {
    return this.appendMany([action]);
  }

  async appendMany(actions: readonly EventRoleAction[]): Promise<void> {
    if (actions.length === 0) return;
    await this.bootstrap();
    await this.sheets.batch([
      { kind: "append", tab: TABS.eventRoles, values: actions.map(rowFor) },
    ]);
  }

  /**
   * Ghi mốc hoàn tất ledger và đổi `owner_user_id` trong cùng một lô Sheets.
   * Fold ledger vẫn là nguồn quyết định Chủ vận hành; ô events chỉ quyết định quota/
   * danh sách sở hữu tài khoản.
   */
  async completeAccountOwnership(input: {
    code: string;
    expectedOwnerUserId: string;
    newOwnerUserId: string;
    action: EventRoleAction;
  }): Promise<"completed" | "already-completed" | "owner-changed" | "not-found"> {
    await this.bootstrap();
    const [index] = await this.sheets.batchGet([
      `${TABS.events}!A:${indexToColumn(EVENT_COLUMNS.length - 1)}`,
    ]);
    const rows = index?.values ?? [];
    const rowIndex = rows.findIndex(
      (row, index) => index > 0 && (row[EVENT_C.code] ?? "").toUpperCase() === input.code.toUpperCase(),
    );
    if (rowIndex < 0) return "not-found";
    const current = rows[rowIndex]?.[EVENT_C.owner_user_id] ?? "";
    if (current === input.newOwnerUserId) return "already-completed";
    if (current !== input.expectedOwnerUserId) return "owner-changed";
    const ownerColumn = indexToColumn(EVENT_C.owner_user_id);
    await this.sheets.batch([
      { kind: "append", tab: TABS.eventRoles, values: [rowFor(input.action)] },
      {
        kind: "update",
        range: `${TABS.events}!${ownerColumn}${rowIndex + 1}`,
        values: [[input.newOwnerUserId]],
      },
    ]);
    return "completed";
  }
}

function rowFor(action: EventRoleAction): string[] {
  const row = new Array<string>(COLUMNS.length).fill("");
  row[C.event_code] = action.eventCode.toUpperCase();
  row[C.action_id] = action.id;
  row[C.action] = action.type;
  row[C.role_id] = action.roleId ?? "";
  row[C.transfer_id] = action.transferId ?? "";
  row[C.invite_id] = action.inviteId ?? "";
  row[C.subject_kind] = action.subject?.kind ?? "";
  row[C.subject_ref] = subjectRef(action.subject);
  row[C.subject_label] = action.subject?.label ?? "";
  row[C.token_hash] = action.tokenHash ?? "";
  row[C.expires_at] = action.expiresAt ? String(action.expiresAt) : "";
  row[C.details_json] = JSON.stringify({
    email: action.subject && "email" in action.subject ? action.subject.email : undefined,
    confirmationSide: action.confirmationSide,
    accountUserId: action.accountUserId,
    previousOwner: action.previousOwner,
  });
  row[C.actor_label] = action.actorLabel;
  row[C.actor_ref] = action.actorRef ?? "";
  row[C.created_at] = String(action.at);
  return row;
}

function toAction(row: string[]): EventRoleAction | null {
  const type = row[C.action] as EventRoleAction["type"];
  if (
    ![
      "grant-manager",
      "accept-manager",
      "expire-manager",
      "revoke-manager",
      "start-owner-transfer",
      "accept-owner-transfer",
      "expire-owner-transfer",
      "cancel-owner-transfer",
      "confirm-account-transfer",
      "complete-account-transfer",
    ].includes(type)
  ) return null;
  let details: {
    email?: string;
    confirmationSide?: "old" | "new";
    accountUserId?: string;
    previousOwner?: RoleSubject;
  } = {};
  try {
    details = JSON.parse(row[C.details_json] || "{}") as typeof details;
  } catch {
    details = {};
  }
  const subject = parseSubject(
    row[C.subject_kind] ?? "",
    row[C.subject_ref] ?? "",
    row[C.subject_label] ?? "",
    details.email,
  );
  return {
    id: row[C.action_id] ?? "",
    eventCode: (row[C.event_code] ?? "").toUpperCase(),
    type,
    roleId: row[C.role_id] || undefined,
    transferId: row[C.transfer_id] || undefined,
    inviteId: row[C.invite_id] || undefined,
    subject: subject ?? undefined,
    tokenHash: row[C.token_hash] || undefined,
    expiresAt: row[C.expires_at] ? Number(row[C.expires_at]) : undefined,
    confirmationSide: details.confirmationSide,
    accountUserId: details.accountUserId,
    previousOwner: details.previousOwner,
    actorLabel: row[C.actor_label] ?? "Hệ thống",
    actorRef: row[C.actor_ref] || undefined,
    at: Number(row[C.created_at] ?? 0),
  };
}

function subjectRef(subject?: RoleSubject): string {
  if (!subject) return "";
  if (subject.kind === "account") return subject.userId;
  if (subject.kind === "player") return subject.playerId;
  return subject.email;
}

function parseSubject(kind: string, ref: string, label: string, email?: string): RoleSubject | null {
  if (kind === "account" && ref) return { kind, userId: ref, email, label };
  if (kind === "player" && ref) return { kind, playerId: ref, label };
  if (kind === "pending-email" && ref) return { kind, email: ref, label };
  return null;
}
