import type { EventAssetMime } from "../assets/event-image";
import { validImageEditMetadata, type ImageEditMetadata } from "../assets/edit-metadata";
import type { SheetsClient } from "./client";
import { indexToColumn, rowRange } from "./client";
import { ASSET_CHUNK_HEADERS, HEADERS, TABS, joinAssetData, splitAssetData } from "./schema";

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
  metadata?: ImageEditMetadata;
}

export class EventAssetRepo {
  constructor(private readonly sheets: SheetsClient) {}

  async put(asset: EventAsset): Promise<void> {
    await this.putMany([asset]);
  }

  /** Sao chép nhiều logo bằng một lần ghi Sheet, tránh timeout khi có nhiều hạng custom. */
  async putMany(assets: EventAsset[]): Promise<void> {
    if (assets.length === 0) return;
    await this.sheets.ensureTab(TABS.eventAssets, COLUMNS);
    // `event_assets` đã tồn tại từ v0.5; cập nhật riêng hàng tiêu đề để cột metadata
    // mới có tên mà không đụng bất kỳ dòng ảnh cũ nào.
    await this.sheets.batch([
      { kind: "update", range: rowRange(TABS.eventAssets, 0, COLUMNS.length), values: [[...COLUMNS]] },
      { kind: "append", tab: TABS.eventAssets, values: assets.map(rowForAsset) },
    ]);
  }

  async listForEvent(eventCode: string): Promise<EventAsset[]> {
    const { rows } = await this.read();
    const latest = new Map<string, EventAsset>();
    for (let index = 1; index < rows.length; index++) {
      const row = rows[index]!;
      if (row[C.event_code] !== eventCode.toUpperCase()) continue;
      const id = row[C.asset_id] ?? "";
      if (!id) continue;
      if (row[C.active] === "0") latest.delete(id);
      else latest.set(id, fromRow(row));
    }
    return [...latest.values()];
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
    dataUri: row[C.data_uri] || joinAssetData(row),
    createdBy: row[C.created_by] ?? "",
    createdAt: Number(row[C.created_at] ?? 0),
    updatedAt: Number(row[C.updated_at] ?? 0),
    metadata: parseMetadata(row[C.metadata_json]),
  };
}

function rowForAsset(asset: EventAsset): string[] {
  const row = new Array<string>(COLUMNS.length).fill("");
  row[C.event_code] = asset.eventCode.toUpperCase();
  row[C.asset_id] = asset.assetId;
  row[C.kind] = asset.kind;
  row[C.mime] = asset.mime;
  row[C.data_uri] = "";
  row[C.active] = "1";
  row[C.created_by] = asset.createdBy;
  row[C.created_at] = String(asset.createdAt);
  row[C.updated_at] = String(asset.updatedAt);
  row[C.metadata_json] = asset.metadata ? JSON.stringify(asset.metadata) : "";
  splitAssetData(asset.dataUri).forEach((part, index) => {
    row[C[ASSET_CHUNK_HEADERS[index]!]] = part;
  });
  return row;
}

function parseMetadata(raw: string | undefined): ImageEditMetadata | undefined {
  if (!raw) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    return validImageEditMetadata(value) ? value : undefined;
  } catch {
    return undefined;
  }
}
