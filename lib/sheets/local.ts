/**
 * Kho dữ liệu chạy thử trên máy, lưu vào một tệp JSON.
 *
 * Mục đích duy nhất: `npm run dev` là bấm thử được toàn bộ ứng dụng, không phải
 * làm thủ tục Google Cloud trước. Cấu trúc tab giống hệt Google Sheet nên chuyển
 * sang hàng thật là không phải đổi gì trong phần còn lại của mã.
 *
 * **Tệp là nguồn sự thật, không phải bộ nhớ.** Trước đây kho này đọc tệp đúng một
 * lần lúc khởi tạo rồi giữ tất cả trong RAM, và điều đó phản bội đúng hai lời hứa
 * đã viết trong tài liệu:
 *
 *   - "Mở tệp đó ra xem được" — xem thì được, nhưng sửa thì lần ghi kế tiếp của
 *     máy chủ đè sạch, im lặng.
 *   - "Xoá thư mục `.data` là chơi lại từ đầu" — chỉ đúng khi máy chủ đang tắt.
 *     Đang chạy mà xoá thì không có gì xảy ra, rồi lần ghi sau dựng lại y nguyên
 *     dữ liệu cũ từ RAM.
 *
 * Nay mỗi lần đọc hay ghi đều liếc qua thời điểm sửa tệp, lệch thì nạp lại. Một
 * lời gọi `stat` cho mỗi thao tác — không đáng kể với kho chạy thử một người,
 * mà đổi lại tệp trên đĩa luôn là thứ thật sự đang được dùng.
 *
 * KHÔNG dùng được khi triển khai thật: trên Vercel hệ tệp không giữ lại giữa các
 * lần gọi hàm, nên dữ liệu sẽ biến mất. `factory.ts` chặn chuyện đó.
 */

import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { FakeSheetsClient, type CellRange, type WriteOp } from "./client";

export class LocalFileSheetsClient extends FakeSheetsClient {
  /** Thời điểm sửa của tệp ứng với những gì đang nằm trong bộ nhớ. */
  private lastMtimeMs = -1;

  constructor(private readonly filePath: string) {
    super();
    this.syncFromDisk();
  }

  override async listTabs(): Promise<string[]> {
    this.syncFromDisk();
    return super.listTabs();
  }

  override async batchGet(ranges: string[]): Promise<CellRange[]> {
    this.syncFromDisk();
    return super.batchGet(ranges);
  }

  override async ensureTab(tab: string, headers: readonly string[]): Promise<void> {
    this.syncFromDisk();
    const before = this.tabs.size;
    await super.ensureTab(tab, headers);
    if (this.tabs.size !== before) this.persist();
  }

  override async batch(ops: WriteOp[]): Promise<void> {
    // Nạp lại TRƯỚC khi ghi, không chỉ trước khi đọc. Ghi đè lên một ảnh chụp cũ
    // là cách đánh mất dữ liệu của người khác mà không ai kịp thấy.
    this.syncFromDisk();
    await super.batch(ops);
    this.persist();
  }

  // -- nội bộ ---------------------------------------------------------------

  /**
   * Nạp lại nếu tệp trên đĩa đã đổi kể từ lần cuối ta đụng vào.
   *
   * Tệp biến mất thì xoá luôn bộ nhớ: người dùng vừa xoá `.data` để làm lại từ
   * đầu, và giữ lại dữ liệu cũ trong RAM là không nghe lời họ.
   */
  private syncFromDisk(): void {
    let mtimeMs: number;
    try {
      mtimeMs = statSync(this.filePath).mtimeMs;
    } catch {
      if (this.lastMtimeMs !== -1) this.tabs.clear();
      this.lastMtimeMs = -1;
      return;
    }

    if (mtimeMs === this.lastMtimeMs) return;

    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as Record<
        string,
        string[][]
      >;
      this.tabs.clear();
      for (const [tab, rows] of Object.entries(parsed)) this.tabs.set(tab, rows);
      this.lastMtimeMs = mtimeMs;
    } catch {
      // Tệp đang được ghi dở hoặc JSON hỏng. Giữ nguyên bộ nhớ và thử lại ở lần
      // sau — `lastMtimeMs` không đổi nên lần sau chắc chắn thử lại.
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
    // Nhớ dấu thời gian của chính mình, nếu không lần đọc kế tiếp sẽ nạp lại
    // đúng thứ mình vừa ghi ra.
    try {
      this.lastMtimeMs = statSync(this.filePath).mtimeMs;
    } catch {
      this.lastMtimeMs = -1;
    }
  }
}
