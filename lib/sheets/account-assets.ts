import { validImageEditMetadata, type ImageEditMetadata } from "../assets/edit-metadata";
import type { EventAssetMime } from "../assets/event-image";
import type { SheetsClient } from "./client";
import { indexToColumn } from "./client";
import { ASSET_CHUNK_HEADERS, HEADERS, TABS, splitAssetData } from "./schema";

const COLUMNS = HEADERS[TABS.accountAssets];
const C = Object.fromEntries(COLUMNS.map((name, index) => [name, index])) as Record<
  (typeof COLUMNS)[number],
  number
>;

export interface AccountAsset {
  userId: string;
  assetId: string;
  kind: "avatar";
  mime: EventAssetMime;
  dataUri: string;
  metadata: ImageEditMetadata;
  active: boolean;
  createdAt: number;
  updatedAt: number;
}

export class AccountAssetRepo {
  constructor(private readonly sheets: SheetsClient) {}

  async put(asset: AccountAsset): Promise<void> {
    await this.sheets.ensureTab(TABS.accountAssets, COLUMNS);
    const row = new Array<string>(COLUMNS.length).fill("");
    row[C.user_id] = asset.userId;
    row[C.asset_id] = asset.assetId;
    row[C.kind] = asset.kind;
    row[C.mime] = asset.mime;
    row[C.data_uri] = "";
    row[C.metadata_json] = JSON.stringify(asset.metadata);
    row[C.active] = asset.active ? "1" : "0";
    row[C.created_at] = String(asset.createdAt);
    row[C.updated_at] = String(asset.updatedAt);
    splitAssetData(asset.dataUri).forEach((part, index) => {
      row[C[ASSET_CHUNK_HEADERS[index]!]] = part;
    });
    await this.sheets.batch([
      { kind: "update", range: `${TABS.accountAssets}!A1:${indexToColumn(COLUMNS.length - 1)}1`, values: [[...COLUMNS]] },
      { kind: "append", tab: TABS.accountAssets, values: [row] },
    ]);
  }

  async get(userId: string, assetId: string): Promise<AccountAsset | null> {
    const rows = await this.rows();
    for (let index = rows.length - 1; index > 0; index--) {
      const row = rows[index]!;
      if (row[C.user_id] === userId && row[C.asset_id] === assetId && row[C.active] !== "0") {
        let metadata: ImageEditMetadata;
        try {
          const value: unknown = JSON.parse(row[C.metadata_json] ?? "{}");
          if (!validImageEditMetadata(value)) return null;
          metadata = value;
        } catch {
          // Một ô metadata hỏng không được làm ảnh đại diện kéo sập toàn bộ phiên tài khoản.
          return null;
        }
        return {
          userId,
          assetId,
          kind: "avatar",
          mime: (row[C.mime] ?? "image/webp") as EventAssetMime,
          dataUri: row[C.data_uri] || ASSET_CHUNK_HEADERS.map((header) => row[C[header]] ?? "").join(""),
          metadata,
          active: true,
          createdAt: Number(row[C.created_at] ?? 0),
          updatedAt: Number(row[C.updated_at] ?? 0),
        };
      }
    }
    return null;
  }

  async deactivate(userId: string, assetId: string, at: number): Promise<void> {
    const existing = await this.get(userId, assetId);
    if (!existing) return;
    await this.put({ ...existing, active: false, updatedAt: at });
  }

  private async rows(): Promise<string[][]> {
    await this.sheets.ensureTab(TABS.accountAssets, COLUMNS);
    const [range] = await this.sheets.batchGet([
      `${TABS.accountAssets}!A:${indexToColumn(COLUMNS.length - 1)}`,
    ]);
    return range?.values ?? [];
  }
}
