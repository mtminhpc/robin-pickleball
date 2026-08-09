import type { EventAssetMime } from "../assets/event-image";
import type { SheetsClient } from "./client";
import { indexToColumn, rowRange } from "./client";
import { HEADERS, TABS } from "./schema";

const COLUMNS = HEADERS[TABS.eventAssets];
const C = Object.fromEntries(COLUMNS.map((name, index) => [name, index])) as Record<
  (typeof COLUMNS)[number],
  number
>;

export type EventAssetKind = "sponsor" | "trophy";
export interface EventAsset {
  eventCode: string;
  assetId: string;
  kind: EventAssetKind;
  mime: EventAssetMime;
  dataUri: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export class EventAssetRepo {
  constructor(private readonly sheets: SheetsClient) {}

  async put(asset: EventAsset): Promise<void> {
    await this.sheets.ensureTab(TABS.eventAssets, COLUMNS);
    await this.sheets.batch([{ kind: "append", tab: TABS.eventAssets, values: [[
      asset.eventCode, asset.assetId, asset.kind, asset.mime, asset.dataUri, "1",
      asset.createdBy, String(asset.createdAt), String(asset.updatedAt),
    ]] }]);
  }

  async get(eventCode: string, assetId: string): Promise<EventAsset | null> {
    const { rows } = await this.read();
    for (let i = rows.length - 1; i > 0; i--) {
      const row = rows[i]!;
      if (row[C.event_code] === eventCode && row[C.asset_id] === assetId && row[C.active] !== "0") {
        return fromRow(row);
      }
    }
    return null;
  }

  async deactivate(eventCode: string, assetId: string, at: number): Promise<boolean> {
    const { rows } = await this.read();
    let rowIndex = -1;
    for (let i = rows.length - 1; i > 0; i--) {
      if (rows[i]?.[C.event_code] === eventCode && rows[i]?.[C.asset_id] === assetId && rows[i]?.[C.active] !== "0") {
        rowIndex = i;
        break;
      }
    }
    if (rowIndex < 0) return false;
    const next = [...rows[rowIndex]!];
    next[C.active] = "0";
    next[C.updated_at] = String(at);
    await this.sheets.batch([{ kind: "update", range: rowRange(TABS.eventAssets, rowIndex, COLUMNS.length), values: [next] }]);
    return true;
  }

  private async read(): Promise<{ rows: string[][] }> {
    await this.sheets.ensureTab(TABS.eventAssets, COLUMNS);
    const [range] = await this.sheets.batchGet([`${TABS.eventAssets}!A:${indexToColumn(COLUMNS.length - 1)}`]);
    return { rows: range?.values ?? [] };
  }
}

function fromRow(row: string[]): EventAsset {
  return {
    eventCode: row[C.event_code] ?? "",
    assetId: row[C.asset_id] ?? "",
    kind: (row[C.kind] ?? "sponsor") as EventAssetKind,
    mime: (row[C.mime] ?? "image/png") as EventAssetMime,
    dataUri: row[C.data_uri] ?? "",
    createdBy: row[C.created_by] ?? "",
    createdAt: Number(row[C.created_at] ?? 0),
    updatedAt: Number(row[C.updated_at] ?? 0),
  };
}
