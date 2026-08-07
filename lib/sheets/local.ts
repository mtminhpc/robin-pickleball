/**
 * Kho dữ liệu chạy thử trên máy, lưu vào một tệp JSON.
 *
 * Mục đích duy nhất: `pnpm dev` là bấm thử được toàn bộ ứng dụng, không phải làm
 * thủ tục Google Cloud trước. Cấu trúc tab giống hệt Google Sheet nên chuyển sang
 * hàng thật là không phải đổi gì trong phần còn lại của mã.
 *
 * KHÔNG dùng được khi triển khai thật: trên Vercel hệ tệp không giữ lại giữa các
 * lần gọi hàm, nên dữ liệu sẽ biến mất. `factory.ts` chặn chuyện đó.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { FakeSheetsClient, type WriteOp } from "./client";

export class LocalFileSheetsClient extends FakeSheetsClient {
  constructor(private readonly filePath: string) {
    super();
    this.restore();
  }

  override async ensureTab(tab: string, headers: readonly string[]): Promise<void> {
    const before = this.tabs.size;
    await super.ensureTab(tab, headers);
    if (this.tabs.size !== before) this.persist();
  }

  override async batch(ops: WriteOp[]): Promise<void> {
    await super.batch(ops);
    this.persist();
  }

  private restore(): void {
    try {
      const raw = readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Record<string, string[][]>;
      for (const [tab, rows] of Object.entries(parsed)) this.tabs.set(tab, rows);
    } catch {
      // Chưa có tệp là chuyện bình thường ở lần chạy đầu.
    }
  }

  /**
   * Ghi cả tệp sau mỗi lần thay đổi.
   *
   * Chậm, nhưng đây là kho chạy thử cho một người trên máy mình, và ghi trọn vẹn
   * thì không bao giờ để lại tệp hỏng dở dang.
   */
  private persist(): void {
    const snapshot: Record<string, string[][]> = {};
    for (const [tab, rows] of this.tabs) snapshot[tab] = rows;
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(snapshot, null, 2), "utf8");
  }
}
