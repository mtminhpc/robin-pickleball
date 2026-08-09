import { randomUUID } from "node:crypto";
import type { SheetsClient } from "./client";
import { indexToColumn } from "./client";
import { HEADERS, TABS } from "./schema";

const COLUMNS = HEADERS[TABS.eventOwnerClaims];
const C = Object.fromEntries(
  COLUMNS.map((name, index) => [name, index]),
) as Record<(typeof COLUMNS)[number], number>;

/**
 * Sổ phân xử quyền sở hữu cho các buổi cũ chưa có `owner_user_id`.
 *
 * Google Sheets không có compare-and-swap. Append là thao tác duy nhất giữ được
 * thứ tự khi hai Vercel instance ghi đồng thời, nên ứng viên đầu tiên của một mã
 * buổi là người thắng vĩnh viễn. Nếu tiến trình chết sau append nhưng trước khi
 * cập nhật dòng sự kiện, đúng tài khoản đó gọi lại vẫn được hoàn tất; tài khoản
 * khác không thể lợi dụng khe hở để ghi đè.
 */
export class EventOwnerClaimRepo {
  constructor(private readonly sheets: SheetsClient) {}

  async acquire(eventCode: string, userId: string, at: number): Promise<boolean> {
    const code = eventCode.trim().toUpperCase();
    if (!code || !userId) return false;

    await this.sheets.ensureTab(TABS.eventOwnerClaims, COLUMNS);

    // Lần thử lại sau một lỗi mạng không cần nối thêm một dòng. Đọc trước không
    // dùng để phân xử lần đầu — hai instance vẫn có thể cùng thấy trống — nên sau
    // append luôn đọc lại và lấy đúng dòng đầu theo thứ tự Sheet.
    const existing = firstClaim(await this.rows(), code);
    if (existing) return existing.userId === userId;

    await this.sheets.batch([
      {
        kind: "append",
        tab: TABS.eventOwnerClaims,
        values: [[code, userId, randomUUID(), String(at)]],
      },
    ]);

    return firstClaim(await this.rows(), code)?.userId === userId;
  }

  private async rows(): Promise<string[][]> {
    await this.sheets.ensureTab(TABS.eventOwnerClaims, COLUMNS);
    const [range] = await this.sheets.batchGet([
      `${TABS.eventOwnerClaims}!A:${indexToColumn(COLUMNS.length - 1)}`,
    ]);
    return range?.values ?? [];
  }
}

function firstClaim(
  rows: readonly string[][],
  eventCode: string,
): { userId: string } | null {
  const row = rows.find(
    (item, index) =>
      index > 0 && (item[C.event_code] ?? "").toUpperCase() === eventCode,
  );
  if (!row) return null;
  return { userId: row[C.user_id] ?? "" };
}
