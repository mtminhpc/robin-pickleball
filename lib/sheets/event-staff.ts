import { randomUUID } from "node:crypto";
import { normalizeEmail } from "../domain/account";
import type { SheetsClient } from "./client";
import { indexToColumn } from "./client";
import { HEADERS, TABS } from "./schema";

const COLUMNS = HEADERS[TABS.eventStaff];
const C = Object.fromEntries(COLUMNS.map((name, index) => [name, index])) as Record<
  (typeof COLUMNS)[number],
  number
>;

export interface EventStaffMember {
  staffId: string;
  eventCode: string;
  email: string;
  userId: string;
  displayName: string;
  status: "pending" | "active" | "revoked";
  grantedBy: string;
  createdAt: number;
  revokedAt: number | null;
}

export class EventStaffRepo {
  constructor(private readonly sheets: SheetsClient) {}

  async bootstrap(): Promise<void> {
    await this.sheets.ensureTab(TABS.eventStaff, COLUMNS);
  }

  async list(eventCode: string): Promise<EventStaffMember[]> {
    await this.bootstrap();
    const [range] = await this.sheets.batchGet([
      `${TABS.eventStaff}!A:${indexToColumn(COLUMNS.length - 1)}`,
    ]);
    const latest = new Map<string, EventStaffMember>();
    for (const [index, row] of (range?.values ?? []).entries()) {
      if (index === 0 || (row[C.event_code] ?? "").toUpperCase() !== eventCode.toUpperCase()) {
        continue;
      }
      const member = toMember(row);
      if (member.staffId) latest.set(member.staffId, member);
    }
    return [...latest.values()].filter((member) => member.status !== "revoked");
  }

  async membership(
    eventCode: string,
    identity: { userId: string; email: string },
  ): Promise<EventStaffMember | null> {
    const email = normalizeEmail(identity.email);
    const members = await this.list(eventCode);
    return (
      members.find(
        (member) =>
          (identity.userId && member.userId === identity.userId) ||
          (email && member.email === email),
      ) ?? null
    );
  }

  async invite(input: {
    eventCode: string;
    email: string;
    userId?: string;
    displayName?: string;
    grantedBy: string;
    at: number;
  }): Promise<EventStaffMember> {
    await this.bootstrap();
    const email = normalizeEmail(input.email);
    if (!email) throw new Error("Email phó sự kiện không hợp lệ.");
    const member: EventStaffMember = {
      staffId: randomUUID(),
      eventCode: input.eventCode.toUpperCase(),
      email,
      userId: input.userId ?? "",
      displayName: (input.displayName ?? "").trim().slice(0, 60),
      status: input.userId ? "active" : "pending",
      grantedBy: input.grantedBy,
      createdAt: input.at,
      revokedAt: null,
    };
    await this.sheets.batch([
      { kind: "append", tab: TABS.eventStaff, values: [rowFor(member)] },
    ]);
    return member;
  }

  async activate(
    member: EventStaffMember,
    identity: { userId: string; displayName: string },
    at: number,
  ): Promise<EventStaffMember> {
    if (member.status === "active" && member.userId === identity.userId) return member;
    const active: EventStaffMember = {
      ...member,
      userId: identity.userId,
      displayName: identity.displayName.trim().slice(0, 60) || member.displayName,
      status: "active",
      revokedAt: null,
    };
    await this.sheets.batch([
      { kind: "append", tab: TABS.eventStaff, values: [rowFor(active)] },
    ]);
    return active;
  }

  async revoke(eventCode: string, staffId: string, at: number): Promise<boolean> {
    const member = (await this.list(eventCode)).find((item) => item.staffId === staffId);
    if (!member) return false;
    await this.sheets.batch([
      {
        kind: "append",
        tab: TABS.eventStaff,
        values: [rowFor({ ...member, status: "revoked", revokedAt: at })],
      },
    ]);
    return true;
  }

  async eventCodesFor(identity: { userId: string; email: string }): Promise<string[]> {
    await this.bootstrap();
    const [range] = await this.sheets.batchGet([
      `${TABS.eventStaff}!A:${indexToColumn(COLUMNS.length - 1)}`,
    ]);
    const latest = new Map<string, EventStaffMember>();
    for (const [index, row] of (range?.values ?? []).entries()) {
      if (index === 0) continue;
      const member = toMember(row);
      latest.set(`${member.eventCode}:${member.staffId}`, member);
    }
    const email = normalizeEmail(identity.email);
    return [
      ...new Set(
        [...latest.values()]
          .filter(
            (member) =>
              member.status !== "revoked" &&
              ((identity.userId && member.userId === identity.userId) ||
                (email && member.email === email)),
          )
          .map((member) => member.eventCode),
      ),
    ];
  }
}

function toMember(row: string[]): EventStaffMember {
  const status = row[C.status];
  return {
    eventCode: (row[C.event_code] ?? "").toUpperCase(),
    staffId: row[C.staff_id] ?? "",
    email: normalizeEmail(row[C.email] ?? ""),
    userId: row[C.user_id] ?? "",
    displayName: row[C.display_name] ?? "",
    status: status === "revoked" ? "revoked" : status === "active" ? "active" : "pending",
    grantedBy: row[C.granted_by] ?? "",
    createdAt: Number(row[C.created_at] ?? 0),
    revokedAt: row[C.revoked_at] ? Number(row[C.revoked_at]) : null,
  };
}

function rowFor(member: EventStaffMember): string[] {
  const row = new Array<string>(COLUMNS.length).fill("");
  row[C.event_code] = member.eventCode;
  row[C.staff_id] = member.staffId;
  row[C.email] = member.email;
  row[C.user_id] = member.userId;
  row[C.display_name] = member.displayName;
  row[C.status] = member.status;
  row[C.granted_by] = member.grantedBy;
  row[C.created_at] = String(member.createdAt);
  row[C.revoked_at] = member.revokedAt === null ? "" : String(member.revokedAt);
  return row;
}
