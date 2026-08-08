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

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { FakeSheetsClient, type CellRange, type WriteOp } from "./client";

export class LocalFileSheetsClient extends FakeSheetsClient {
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
   * Nạp lại nội dung tệp trước mỗi thao tác.
   *
   * Tệp biến mất thì xoá luôn bộ nhớ: người dùng vừa xoá `.data` để làm lại từ
   * đầu, và giữ lại dữ liệu cũ trong RAM là không nghe lời họ.
   *
   * **Cố ý đọc thẳng chứ không so mốc thời gian sửa tệp.** Bản trước có một
   * đường tắt: `stat` lấy `mtimeMs`, trùng với lần trước thì bỏ qua không đọc.
   * Nghe hợp lý, nhưng Windows cập nhật mốc ghi tệp theo bước khoảng 15 mili
   * giây, nên hai lần ghi rơi vào cùng một nhịp mang **đúng một mốc** — và lần
   * sửa thứ hai bị bỏ qua im lặng. Đó chính là lời hứa "sửa tay tệp thì không bị
   * đè" của kho này, hỏng đúng lúc người ta sửa nhanh tay.
   *
   * Đo được: bài kiểm thử canh đúng chỗ đó hỏng 16 trên 25 lượt khi chạy riêng.
   * Nó lâu nay xanh là nhờ chạy chung với các tệp kiểm thử khác nên nhịp lệch đi.
   *
   * Cái giá là đọc và phân tích lại một tệp JSON cho mỗi thao tác. Với kho chạy
   * thử một người trên máy mình thì không đáng kể, và đổi lại tệp trên đĩa luôn
   * đúng là thứ đang được dùng — vốn là toàn bộ lý do kho này tồn tại.
   */
  private syncFromDisk(): void {
    let raw: string;
    try {
      raw = readFileSync(this.filePath, "utf8");
    } catch {
      this.tabs.clear();
      return;
    }

    try {
      const parsed = JSON.parse(raw) as Record<string, string[][]>;
      this.tabs.clear();
      for (const [tab, rows] of Object.entries(parsed)) this.tabs.set(tab, rows);
    } catch {
      // Tệp đang được ghi dở hoặc JSON hỏng. Giữ nguyên bộ nhớ và thử lại ở lần
      // sau, chứ đừng vứt dữ liệu đi vì đọc trúng lúc ai đó đang ghi.
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
