/**
 * Nhật ký xóa mềm sự kiện.
 *
 * Không có thao tác nào ở đây sửa hay xóa snapshot, nhật ký tỷ số hoặc asset. Dòng
 * mới nhất của một mã quyết định buổi đó đang ẩn hay hiện; vì vậy cả xóa nhầm cũng
 * khôi phục được mà không phải chạm vào dữ liệu thi đấu gốc.
 */

import type { SheetsClient } from "./client";
import { indexToColumn } from "./client";
import { HEADERS, TABS } from "./schema";

const COLUMNS = HEADERS[TABS.eventDeletions];
const C = Object.fromEntries(COLUMNS.map((name, index) => [name, index])) as Record<
  (typeof COLUMNS)[number],
  number
>;

export type EventDeletionAction = "delete" | "restore";
export type EventDeletionActorKind = "owner" | "app-admin";

export interface EventDeletionRecord {
  eventCode: string;
  action: EventDeletionAction;
  actorUserId: string;
  actorKind: EventDeletionActorKind;
  createdAt: number;
}

export class EventDeletionRepo {
  constructor(private readonly sheets: SheetsClient) {}

  async bootstrap(): Promise<void> {
    await this.sheets.ensureTab(TABS.eventDeletions, COLUMNS);
  }

  async list(): Promise<EventDeletionRecord[]> {
    await this.bootstrap();
    const [range] = await this.sheets.batchGet([
      `${TABS.eventDeletions}!A:${indexToColumn(COLUMNS.length - 1)}`,
    ]);
    return (range?.values ?? [])
      .slice(1)
      .map(fromRow)
      .filter((row): row is EventDeletionRecord => row !== null);
  }

  async isDeleted(eventCode: string): Promise<boolean> {
    return (await this.latest(eventCode))?.action === "delete";
  }

  /** Dòng gần nhất của một mã. App admin cần nó để biết buổi bị xóa lúc nào. */
  async latest(eventCode: string): Promise<EventDeletionRecord | null> {
    const normalized = eventCode.toUpperCase();
    let latest: EventDeletionRecord | null = null;
    for (const row of await this.list()) {
      if (row.eventCode === normalized) latest = row;
    }
    return latest;
  }

  async deletedCodes(): Promise<string[]> {
    const latest = new Map<string, EventDeletionRecord>();
    for (const row of await this.list()) latest.set(row.eventCode, row);
    return [...latest.values()]
      .filter((row) => row.action === "delete")
      .map((row) => row.eventCode);
  }

  /** Gọi lặp an toàn: bản ghi delete thứ hai không cần được thêm vào Sheet. */
  async delete(input: Omit<EventDeletionRecord, "action">): Promise<{ alreadyDeleted: boolean }> {
    if (await this.isDeleted(input.eventCode)) return { alreadyDeleted: true };
    await this.append({ ...input, action: "delete" });
    return { alreadyDeleted: false };
  }

  /** Khôi phục cũng idempotent để App admin bấm lại sau khi mất mạng không gây nhiễu log. */
  async restore(input: Omit<EventDeletionRecord, "action">): Promise<{ alreadyRestored: boolean }> {
    if (!(await this.isDeleted(input.eventCode))) return { alreadyRestored: true };
    await this.append({ ...input, action: "restore" });
    return { alreadyRestored: false };
  }

  private async append(record: EventDeletionRecord): Promise<void> {
    await this.bootstrap();
    await this.sheets.batch([{
      kind: "append",
      tab: TABS.eventDeletions,
      values: [[
        record.eventCode.toUpperCase(),
        record.action,
        record.actorUserId,
        record.actorKind,
        String(record.createdAt),
      ]],
    }]);
  }
}

function fromRow(row: string[]): EventDeletionRecord | null {
  const eventCode = (row[C.event_code] ?? "").trim().toUpperCase();
  const action = row[C.action] as EventDeletionAction;
  const actorKind = row[C.actor_kind] as EventDeletionActorKind;
  const createdAt = Number(row[C.created_at]);
  if (!/^[A-Z0-9]{4,6}$/.test(eventCode)) return null;
  if (action !== "delete" && action !== "restore") return null;
  if (actorKind !== "owner" && actorKind !== "app-admin") return null;
  if (!Number.isFinite(createdAt)) return null;
  return {
    eventCode,
    action,
    actorUserId: row[C.actor_user_id] ?? "",
    actorKind,
    createdAt: Math.floor(createdAt),
  };
}
