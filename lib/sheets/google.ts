/**
 * Bản cài đặt `SheetsClient` nói chuyện thật với Google Sheets.
 *
 * Tự ký JWT service account bằng `node:crypto` thay vì dùng `google-auth-library`.
 * Thư viện đó kéo theo `gaxios`, `gcp-metadata` và một chuỗi phụ thuộc khá dài,
 * làm chậm khởi động hàm serverless; phần thực sự cần chỉ là ký một JWT rồi đổi
 * lấy access token, khoảng bốn chục dòng.
 *
 * Mọi thao tác ghi đi qua MỘT lời gọi `spreadsheets.batchUpdate`, gộp cả nối thêm
 * dòng lẫn cập nhật ô. Hạn mức của Sheets là 60 request mỗi phút cho cả tài khoản
 * dịch vụ, nên đây là ràng buộc để ứng dụng chạy được chứ không phải tối ưu.
 */

import { createSign } from "node:crypto";
import type { CellRange, SheetsClient, WriteOp } from "./client";
import { parseRange } from "./client";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const API = "https://sheets.googleapis.com/v4/spreadsheets";

export interface GoogleConfig {
  serviceAccountEmail: string;
  /** Khoá riêng dạng PEM. Biến môi trường thường có `\n` bị thoát, hàm này tự gỡ. */
  privateKey: string;
  spreadsheetId: string;
}

export class GoogleSheetsClient implements SheetsClient {
  private token: { value: string; expiresAt: number } | null = null;
  /** Bản đồ tên tab sang id dạng số. Ghi cần id, còn đọc thì dùng tên. */
  private sheetIds: Map<string, number> | null = null;

  constructor(private readonly config: GoogleConfig) {}

  // -- xác thực ------------------------------------------------------------

  private async accessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.token && this.token.expiresAt > now + 60) return this.token.value;

    const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claims = b64url(
      JSON.stringify({
        iss: this.config.serviceAccountEmail,
        scope: SCOPE,
        aud: TOKEN_URL,
        iat: now,
        exp: now + 3600,
      }),
    );

    const signer = createSign("RSA-SHA256");
    signer.update(`${header}.${claims}`);
    const signature = signer
      .sign(normalizeKey(this.config.privateKey))
      .toString("base64url");

    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${header}.${claims}.${signature}`,
      }),
    });

    if (!res.ok) {
      throw new Error(
        `Không lấy được access token từ Google (${res.status}): ${await res.text()}. ` +
          "Kiểm tra GOOGLE_SERVICE_ACCOUNT_EMAIL và GOOGLE_PRIVATE_KEY.",
      );
    }

    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: body.access_token, expiresAt: now + body.expires_in };
    return body.access_token;
  }

  /**
   * Gọi API, thử lại khi bị chặn hạn mức.
   *
   * 429 và 5xx là lỗi tạm thời và rất hay gặp khi cả nhóm cùng bấm một lúc, nên
   * chờ rồi thử lại. 4xx khác là lỗi thật (sai quyền, sai id) và phải nổi lên
   * ngay chứ không im lặng thử lại.
   */
  private async call<T>(url: string, init?: RequestInit): Promise<T> {
    let lastError = "";
    for (let attempt = 0; attempt < 4; attempt++) {
      const token = await this.accessToken();
      const res = await fetch(url, {
        ...init,
        headers: {
          ...init?.headers,
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        cache: "no-store",
      });

      if (res.ok) return (await res.json()) as T;

      lastError = `${res.status} ${await res.text()}`;
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable) break;
      await sleep(1000 * 2 ** attempt);
    }
    throw new Error(`Google Sheets từ chối yêu cầu: ${lastError}`);
  }

  // -- siêu dữ liệu --------------------------------------------------------

  private async loadSheetIds(force = false): Promise<Map<string, number>> {
    if (this.sheetIds && !force) return this.sheetIds;

    const body = await this.call<{
      sheets: Array<{ properties: { sheetId: number; title: string } }>;
    }>(`${API}/${this.config.spreadsheetId}?fields=sheets.properties`);

    const map = new Map<string, number>();
    for (const s of body.sheets ?? []) {
      map.set(s.properties.title, s.properties.sheetId);
    }
    this.sheetIds = map;
    return map;
  }

  async listTabs(): Promise<string[]> {
    return [...(await this.loadSheetIds()).keys()];
  }

  /**
   * Tạo tab nếu chưa có.
   *
   * Hai lần đọc trước khi ghi vẫn **không** làm việc này nguyên tử: đọc rồi mới ghi
   * thì hai hàm serverless vẫn có thể cùng lọt qua và cùng gọi `addSheet`. Google
   * từ chối cái đến sau, và trước v0.6.1 lời từ chối đó nổi thẳng lên thành 500.
   *
   * Chuyện đó đã xảy ra thật ở lượt deploy v0.6.1 đầu tiên. Nó nghiêm trọng hơn các
   * đợt thêm tab trước vì `event_deletions` được đọc từ `readEvent` — đường nóng nhất
   * của cả ứng dụng, nên mọi trang và mọi API đều có thể là hàm đầu tiên tạo nó.
   *
   * Cách xử: thua cuộc đua thì **không phải lỗi**. Đọc lại danh sách tab; tab đã có
   * nghĩa là ai đó vừa tạo hộ, coi như xong. Kiểm bằng trạng thái thật chứ không dò
   * chuỗi lỗi của Google — lời văn ấy có thể đổi hoặc đổi ngôn ngữ bất cứ lúc nào.
   */
  async ensureTab(tab: string, headers: readonly string[]): Promise<void> {
    const known = await this.loadSheetIds();
    if (known.has(tab)) return;

    // Có thể một hàm khác vừa tạo tab này. Đọc lại trước khi kết luận là chưa có.
    if ((await this.loadSheetIds(true)).has(tab)) return;

    try {
      await this.call(`${API}/${this.config.spreadsheetId}:batchUpdate`, {
        method: "POST",
        body: JSON.stringify({
          requests: [{ addSheet: { properties: { title: tab } } }],
        }),
      });
    } catch (error) {
      // Người thắng cuộc đua cũng ghi dòng tiêu đề, nên trả về ở đây là đủ.
      if ((await this.loadSheetIds(true)).has(tab)) return;
      throw error;
    }
    await this.loadSheetIds(true);

    await this.batch([{ kind: "append", tab, values: [[...headers]] }]);
  }

  // -- đọc và ghi ----------------------------------------------------------

  /**
   * Đọc nhiều dải ô một lượt.
   *
   * **Bỏ qua dải thuộc tab chưa tồn tại**, trả về dải rỗng cho nó. Bản giả trong
   * bộ nhớ vẫn luôn làm vậy, còn Google thì trả `400 Unable to parse range` —
   * và tệ hơn, lỗi đó giết **cả lô** chứ không riêng dải hỏng. Không có chỗ này
   * thì hỏi "mã buổi này đã ai dùng chưa" là hỏng, vì `EventRepo.load` đọc chỉ
   * mục sự kiện chung với `log__<mã>!A:A` mà tab nhật ký thì chưa có. Hệ quả:
   * trên Sheet thật không tạo được buổi đánh nào cả.
   */
  async batchGet(ranges: string[]): Promise<CellRange[]> {
    const known = await this.tabsKnownFor(ranges);
    const wanted = ranges.map((r, i) => [r, i] as const).filter(([r]) => known.has(parseRange(r).tab));

    const rows = new Array<unknown[][]>(ranges.length);
    if (wanted.length > 0) {
      const params = new URLSearchParams();
      for (const [range] of wanted) params.append("ranges", range);
      // Ô trống ở cuối dòng bị Google cắt bớt; xin trả về đúng chuỗi rỗng cho khớp
      // với bản giả trong bộ nhớ, để hai đường chạy không lệch nhau âm thầm.
      params.set("majorDimension", "ROWS");
      params.set("valueRenderOption", "UNFORMATTED_VALUE");

      const body = await this.call<{
        valueRanges?: Array<{ range: string; values?: unknown[][] }>;
      }>(`${API}/${this.config.spreadsheetId}/values:batchGet?${params}`);

      wanted.forEach(([, at], i) => {
        rows[at] = body.valueRanges?.[i]?.values ?? [];
      });
    }

    return ranges.map((range, i) => ({
      range,
      values: (rows[i] ?? []).map((row) =>
        row.map((cell) => (cell === null || cell === undefined ? "" : String(cell))),
      ),
    }));
  }

  /**
   * Những tab đang có thật, đủ để trả lời cho đúng các dải sắp đọc.
   *
   * Thiếu tab nào thì đọc lại siêu dữ liệu **một lần** rồi mới kết luận, giống
   * `ensureTab`: bản đồ tab nằm trong bộ nhớ của một tiến trình, mà một hàm
   * serverless khác có thể vừa tạo tab đó xong. Kết luận vội là `load` trả `null`
   * cho một buổi đánh đang có thật.
   *
   * Đường thường gặp — mọi tab đều đã biết — không tốn thêm lời gọi nào.
   */
  private async tabsKnownFor(ranges: readonly string[]): Promise<Set<string>> {
    const wanted = new Set(ranges.map((r) => parseRange(r).tab));
    const known = new Set((await this.loadSheetIds()).keys());
    if ([...wanted].every((tab) => known.has(tab))) return known;
    return new Set((await this.loadSheetIds(true)).keys());
  }

  async batch(ops: WriteOp[]): Promise<void> {
    if (ops.length === 0) return;
    const ids = await this.loadSheetIds();

    const requests = ops.map((op) => {
      if (op.kind === "append") {
        const sheetId = ids.get(op.tab);
        if (sheetId === undefined) {
          throw new Error(`Chưa có tab "${op.tab}" trong bảng tính.`);
        }
        return {
          appendCells: {
            sheetId,
            rows: op.values.map((row) => toRowData(row, op.typed)),
            fields: "userEnteredValue",
          },
        };
      }

      const parsed = parseRange(op.range);
      const sheetId = ids.get(parsed.tab);
      if (sheetId === undefined) {
        throw new Error(`Chưa có tab "${parsed.tab}" trong bảng tính.`);
      }
      return {
        updateCells: {
          range: {
            sheetId,
            startRowIndex: parsed.startRow,
            endRowIndex: parsed.startRow + op.values.length,
            startColumnIndex: parsed.startCol,
            endColumnIndex:
              parsed.endCol ??
              parsed.startCol + Math.max(...op.values.map((r) => r.length)),
          },
          rows: op.values.map((row) => toRowData(row, op.typed)),
          fields: "userEnteredValue",
        },
      };
    });

    await this.call(`${API}/${this.config.spreadsheetId}:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({ requests }),
    });
  }
}

// ---------------------------------------------------------------------------

function toRowData(row: string[], typed: boolean | undefined) {
  return {
    values: row.map((value) => ({
      userEnteredValue: cellValue(value, typed),
    })),
  };
}

/**
 * Mặc định ghi mọi thứ dạng chuỗi.
 *
 * Sheets rất hay tự đoán kiểu, và với dữ liệu của ứng dụng thì đoán là hỏng: mã
 * sự kiện `012345` sẽ mất số 0 đầu, chuỗi JSON dài có thể bị hiểu thành công thức.
 * Chỉ tab bản in mới bật `typed` để tỷ số ghi thành số và cộng tay được.
 */
function cellValue(value: string, typed: boolean | undefined) {
  if (typed && value !== "" && !Number.isNaN(Number(value))) {
    return { numberValue: Number(value) };
  }
  return { stringValue: value };
}

function b64url(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

/** Khoá lấy từ biến môi trường thường có xuống dòng bị thoát thành `\n`. */
function normalizeKey(key: string): string {
  return key.includes("\\n") ? key.replace(/\\n/g, "\n") : key;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
