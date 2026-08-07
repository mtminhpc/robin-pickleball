/**
 * Giao diện tối thiểu tới Google Sheets, cùng một bản giả chạy trong bộ nhớ.
 *
 * Toàn bộ phần còn lại của ứng dụng chỉ biết tới `SheetsClient`, nên bộ kiểm thử
 * chạy được trọn vẹn mà không cần tài khoản Google, và ngày nào cần đổi sang cơ
 * sở dữ liệu thật thì chỉ phải thay đúng một tệp.
 *
 * Hạn mức của Sheets API là 60 request mỗi phút cho một tài khoản dịch vụ, nên
 * mọi thao tác ghi ở đây được gom vào MỘT lời gọi `batch`. Đó không phải tối ưu
 * sớm mà là điều kiện để ứng dụng chạy được.
 */

export interface CellRange {
  /** Ví dụ `events!A2:N2`. */
  range: string;
  values: string[][];
}

/**
 * Một thao tác ghi trong lô.
 *
 * `typed` cho phép Sheets hiểu ô số là số thay vì chuỗi. Mặc định tắt: Sheets rất
 * hay tự đoán kiểu, và với dữ liệu của ứng dụng thì đoán là hỏng — mã sự kiện
 * `012345` mất số 0 đầu, chuỗi JSON dài có thể bị hiểu thành công thức. Chỉ tab
 * bản in mới bật, để tỷ số cộng tay được ngay trong Google Sheet.
 */
export type WriteOp =
  | { kind: "update"; range: string; values: string[][]; typed?: boolean }
  | { kind: "append"; tab: string; values: string[][]; typed?: boolean };

export interface SheetsClient {
  /** Đọc nhiều dải ô trong một lời gọi. */
  batchGet(ranges: string[]): Promise<CellRange[]>;
  /** Ghi nhiều thao tác trong một lời gọi. */
  batch(ops: WriteOp[]): Promise<void>;
  /** Tạo tab nếu chưa có, kèm dòng tiêu đề. */
  ensureTab(tab: string, headers: readonly string[]): Promise<void>;
  /** Danh sách tên tab hiện có. */
  listTabs(): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// Bản giả trong bộ nhớ
// ---------------------------------------------------------------------------

/**
 * Bản giả dùng cho kiểm thử và phát triển ngoại tuyến.
 *
 * Cố ý mô phỏng cả những chỗ Sheets khó chịu: dải ô ngoài vùng có dữ liệu trả về
 * mảng rỗng chứ không lỗi, và ô trống là chuỗi rỗng chứ không phải `null`. Nếu
 * bản giả dễ tính hơn hàng thật thì nó chẳng bảo vệ được gì.
 */
export class FakeSheetsClient implements SheetsClient {
  /** `protected` để kho dữ liệu file cục bộ kế thừa lại được toàn bộ logic này. */
  protected readonly tabs = new Map<string, string[][]>();
  /** Đếm số lời gọi, để kiểm thử khẳng định được là không phá hạn mức. */
  readonly calls = { batchGet: 0, batch: 0, ensureTab: 0 };

  async listTabs(): Promise<string[]> {
    return [...this.tabs.keys()];
  }

  async ensureTab(tab: string, headers: readonly string[]): Promise<void> {
    this.calls.ensureTab += 1;
    if (!this.tabs.has(tab)) this.tabs.set(tab, [[...headers]]);
  }

  async batchGet(ranges: string[]): Promise<CellRange[]> {
    this.calls.batchGet += 1;
    return ranges.map((range) => {
      const parsed = parseRange(range);
      const rows = this.tabs.get(parsed.tab) ?? [];
      const slice = rows
        .slice(parsed.startRow, parsed.endRow ?? rows.length)
        .map((row) => row.slice(parsed.startCol, parsed.endCol ?? undefined));
      return { range, values: slice };
    });
  }

  async batch(ops: WriteOp[]): Promise<void> {
    this.calls.batch += 1;
    for (const op of ops) {
      if (op.kind === "append") {
        const rows = this.tabs.get(op.tab) ?? [];
        rows.push(...op.values.map((r) => [...r]));
        this.tabs.set(op.tab, rows);
        continue;
      }

      const parsed = parseRange(op.range);
      const rows = this.tabs.get(parsed.tab) ?? [];
      op.values.forEach((values, i) => {
        const rowIndex = parsed.startRow + i;
        while (rows.length <= rowIndex) rows.push([]);
        const row = rows[rowIndex]!;
        values.forEach((value, j) => {
          const col = parsed.startCol + j;
          while (row.length <= col) row.push("");
          row[col] = value;
        });
      });
      this.tabs.set(parsed.tab, rows);
    }
  }

  /** Chỉ dùng trong kiểm thử: xem thẳng nội dung một tab. */
  dump(tab: string): string[][] {
    return (this.tabs.get(tab) ?? []).map((r) => [...r]);
  }
}

// ---------------------------------------------------------------------------

interface ParsedRange {
  tab: string;
  startRow: number;
  startCol: number;
  endRow: number | null;
  endCol: number | null;
}

/** Phân tích ký hiệu A1 (`events!A2:N2`) thành chỉ số đánh từ 0. */
export function parseRange(range: string): ParsedRange {
  const bang = range.lastIndexOf("!");
  const tab = bang === -1 ? range : stripQuotes(range.slice(0, bang));
  const cells = bang === -1 ? "" : range.slice(bang + 1);
  if (cells === "") {
    return { tab, startRow: 0, startCol: 0, endRow: null, endCol: null };
  }

  const [from, to] = cells.split(":");
  const start = parseCell(from ?? "A1");
  const end = to ? parseCell(to) : null;

  return {
    tab,
    startRow: start.row ?? 0,
    startCol: start.col ?? 0,
    endRow: end ? (end.row === null ? null : end.row + 1) : (start.row ?? 0) + 1,
    endCol: end ? (end.col === null ? null : end.col + 1) : (start.col ?? 0) + 1,
  };
}

function stripQuotes(s: string): string {
  return s.startsWith("'") && s.endsWith("'") ? s.slice(1, -1) : s;
}

/** `B3` thành `{col: 1, row: 2}`. Thiếu phần nào thì phần đó là `null`. */
function parseCell(cell: string): { col: number | null; row: number | null } {
  const match = /^([A-Z]*)(\d*)$/.exec(cell.trim().toUpperCase());
  if (!match) return { col: null, row: null };
  const [, letters, digits] = match;
  return {
    col: letters ? columnToIndex(letters) : null,
    row: digits ? Number(digits) - 1 : null,
  };
}

export function columnToIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function indexToColumn(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** Dải ô một dòng, ví dụ `rowRange("events", 5, 14)` cho `events!A6:N6`. */
export function rowRange(tab: string, rowIndex: number, width: number): string {
  return `${tab}!A${rowIndex + 1}:${indexToColumn(width - 1)}${rowIndex + 1}`;
}
