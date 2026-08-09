import { randomUUID } from "node:crypto";
import type { SheetsClient } from "./client";
import { indexToColumn, rowRange } from "./client";
import { HEADERS, TABS } from "./schema";

const COLUMNS = HEADERS[TABS.appEventReservations];
const C = Object.fromEntries(COLUMNS.map((name, index) => [name, index])) as Record<(typeof COLUMNS)[number], number>;
const LEASE_MS = 2 * 60_000;

/**
 * Vé tạo sự kiện dựa trên append-order của Sheet. Append là thao tác duy nhất
 * Google Sheets bảo toàn khi nhiều serverless instance ghi đồng thời; nhờ vậy
 * yêu cầu đứng ngoài số chỗ còn lại tự thua, thay vì cả hai cùng vượt quota.
 */
export class EventCreationReservationRepo {
  constructor(private readonly sheets: SheetsClient) {}

  async acquire(userId: string, available: number, at: number): Promise<string | null> {
    if (available <= 0) return null;
    await this.sheets.ensureTab(TABS.appEventReservations, COLUMNS);
    const token = randomUUID();
    await this.sheets.batch([{ kind: "append", tab: TABS.appEventReservations, values: [[userId, token, "reserved", String(at), String(at)]] }]);
    const rows = await this.rows();
    const live = rows
      .map((row, rowIndex) => ({ row, rowIndex }))
      .filter(({ row, rowIndex }) => rowIndex > 0 && row[C.user_id] === userId && row[C.status] === "reserved" && Number(row[C.created_at] ?? 0) >= at - LEASE_MS);
    const position = live.findIndex(({ row }) => row[C.token] === token);
    const winner = position >= 0 && position < available;
    if (!winner) await this.finish(token, "released", at);
    return winner ? token : null;
  }

  async finish(token: string, status: "consumed" | "released", at: number): Promise<void> {
    const rows = await this.rows();
    const rowIndex = rows.findIndex((row, index) => index > 0 && row[C.token] === token);
    if (rowIndex < 0) return;
    const next = [...rows[rowIndex]!];
    next[C.status] = status;
    next[C.updated_at] = String(at);
    await this.sheets.batch([{ kind: "update", range: rowRange(TABS.appEventReservations, rowIndex, COLUMNS.length), values: [next] }]);
  }

  private async rows(): Promise<string[][]> {
    await this.sheets.ensureTab(TABS.appEventReservations, COLUMNS);
    const [range] = await this.sheets.batchGet([`${TABS.appEventReservations}!A:${indexToColumn(COLUMNS.length - 1)}`]);
    return range?.values ?? [];
  }
}
