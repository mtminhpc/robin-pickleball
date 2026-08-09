import { normalizeEmail } from "../domain/account";
import type { SheetsClient } from "./client";
import { indexToColumn, rowRange } from "./client";
import { HEADERS, TABS } from "./schema";

const COLUMNS = HEADERS[TABS.appEventLimits];
const C = Object.fromEntries(COLUMNS.map((name, index) => [name, index])) as Record<
  (typeof COLUMNS)[number],
  number
>;

export interface AppEventLimit {
  email: string;
  /** null nghĩa là không giới hạn. */
  limit: number | null;
  grantedBy: string;
  updatedAt: number;
}

export class AppEventLimitRepo {
  constructor(private readonly sheets: SheetsClient) {}

  async bootstrap(): Promise<void> {
    await this.sheets.ensureTab(TABS.appEventLimits, COLUMNS);
  }

  async byEmail(email: string): Promise<AppEventLimit | null> {
    const wanted = normalizeEmail(email);
    if (!wanted) return null;
    const rows = await this.rows();
    const row = rows.find(
      (item, index) => index > 0 && normalizeEmail(item[C.email] ?? "") === wanted && item[C.active] !== "0",
    );
    return row ? fromRow(row) : null;
  }

  async list(): Promise<AppEventLimit[]> {
    return (await this.rows())
      .slice(1)
      .filter((row) => row[C.email] && row[C.active] !== "0")
      .map(fromRow)
      .sort((a, b) => a.email.localeCompare(b.email));
  }

  async upsert(email: string, limit: number | null, grantedBy: string, at: number): Promise<void> {
    await this.bootstrap();
    const wanted = normalizeEmail(email);
    const rows = await this.rows();
    const rowIndex = rows.findIndex(
      (row, index) => index > 0 && normalizeEmail(row[C.email] ?? "") === wanted,
    );
    const values = [wanted, limit === null ? "unlimited" : String(limit), grantedBy, String(at), "1"];
    await this.sheets.batch([
      rowIndex < 0
        ? { kind: "append", tab: TABS.appEventLimits, values: [values] }
        : { kind: "update", range: rowRange(TABS.appEventLimits, rowIndex, COLUMNS.length), values: [values] },
    ]);
  }

  async revoke(email: string, grantedBy: string, at: number): Promise<boolean> {
    await this.bootstrap();
    const wanted = normalizeEmail(email);
    const rows = await this.rows();
    const rowIndex = rows.findIndex(
      (row, index) => index > 0 && normalizeEmail(row[C.email] ?? "") === wanted,
    );
    if (rowIndex < 0) return false;
    const old = rows[rowIndex]!;
    const values = [wanted, old[C.limit] ?? "", grantedBy, String(at), "0"];
    await this.sheets.batch([
      { kind: "update", range: rowRange(TABS.appEventLimits, rowIndex, COLUMNS.length), values: [values] },
    ]);
    return true;
  }

  private async rows(): Promise<string[][]> {
    await this.bootstrap();
    const [range] = await this.sheets.batchGet([
      `${TABS.appEventLimits}!A:${indexToColumn(COLUMNS.length - 1)}`,
    ]);
    return range?.values ?? [];
  }
}

function fromRow(row: string[]): AppEventLimit {
  return {
    email: normalizeEmail(row[C.email] ?? ""),
    limit: row[C.limit] === "unlimited" ? null : Number(row[C.limit] ?? 3),
    grantedBy: row[C.granted_by] ?? "",
    updatedAt: Number(row[C.updated_at] ?? 0),
  };
}
