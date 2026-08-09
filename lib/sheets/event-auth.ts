import type { SheetsClient } from "./client";
import { HEADERS, TABS } from "./schema";

export class EventAuthRepo {
  constructor(private readonly sheets: SheetsClient) {}

  async version(eventCode: string): Promise<number> {
    await this.sheets.ensureTab(TABS.eventAuth, HEADERS[TABS.eventAuth]);
    const [range] = await this.sheets.batchGet([`${TABS.eventAuth}!A:C`]);
    let version = 0;
    for (const [index, row] of (range?.values ?? []).entries()) {
      if (index === 0 || (row[0] ?? "").toUpperCase() !== eventCode.toUpperCase()) continue;
      version = Math.max(version, Number(row[1] ?? 0) || 0);
    }
    return version;
  }

  async bump(eventCode: string, at: number): Promise<number> {
    const next = (await this.version(eventCode)) + 1;
    await this.sheets.batch([
      {
        kind: "append",
        tab: TABS.eventAuth,
        values: [[eventCode.toUpperCase(), String(next), String(at)]],
      },
    ]);
    return next;
  }
}
