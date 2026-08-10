/**
 * Kho Google Sheet thật — phần duy nhất của ứng dụng mà kho giả không thay thế được.
 *
 * Tệp này ra đời sau một lỗi chặn hoàn toàn, và lỗi đó lọt qua 212 bài kiểm thử
 * vì **không bài nào chạm tới `GoogleSheetsClient`**: mọi thứ khác chạy trên
 * `FakeSheetsClient`, vốn trả về dải rỗng cho tab chưa tồn tại. Google thì trả
 * `400 Unable to parse range`, và lỗi đó giết cả lô chứ không riêng dải hỏng.
 *
 * Hệ quả ngoài đời: `EventRepo.load` đọc chỉ mục sự kiện chung một lô với
 * `log__<mã>!A:A`, mà lúc đi tìm một mã chưa ai dùng thì tab nhật ký đương nhiên
 * chưa có. Nên trên Sheet thật **không tạo được buổi đánh nào cả** — trong khi
 * chạy ở nhà thì mọi thứ trơn tru.
 *
 * Bài ở đây chặn `fetch` để khỏi cần mạng hay tài khoản Google. Thứ đáng kiểm
 * không phải là Google trả về gì, mà là **ứng dụng gửi đi những dải nào**.
 */

import { describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { GoogleSheetsClient } from "../lib/sheets/google";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

/**
 * Máy chủ Google giả lập.
 *
 * `tabs` là danh sách tab đang có; đổi nó giữa chừng để giả cảnh một hàm
 * serverless khác vừa tạo thêm tab.
 */
function fakeGoogle(tabs: string[]) {
  const calls = { token: 0, meta: 0, values: 0, addSheet: 0, appendCells: 0 };
  /** Các dải thật sự được gửi lên, theo từng lời gọi. */
  const sentRanges: string[][] = [];
  const state = { tabs };
  /** Cắm vào giữa lời gọi `addSheet` để dựng lại một cuộc đua giữa hai hàm. */
  const hooks: { onAddSheet?: (title: string) => void } = {};

  const fetchImpl = async (url: string | URL, init?: RequestInit) => {
    const href = String(url);

    if (href.includes("oauth2.googleapis.com/token")) {
      calls.token++;
      return json({ access_token: "token-gia", expires_in: 3600 });
    }

    if (href.includes("fields=sheets.properties")) {
      calls.meta++;
      return json({
        sheets: state.tabs.map((title, i) => ({ properties: { sheetId: i, title } })),
      });
    }

    if (href.includes("values:batchGet")) {
      calls.values++;
      const ranges = [...new URL(href).searchParams.getAll("ranges")];
      sentRanges.push(ranges);
      // Google chỉ trả về đúng số dải đã hỏi, theo đúng thứ tự đã hỏi.
      return json({
        valueRanges: ranges.map((range) => ({ range, values: [[range]] })),
      });
    }

    if (href.endsWith(":batchUpdate")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        requests?: Array<{ addSheet?: { properties: { title: string } }; appendCells?: unknown }>;
      };
      const added = body.requests?.[0]?.addSheet?.properties.title;

      if (added !== undefined) {
        calls.addSheet++;
        // Một hàm serverless khác có thể vừa tạo tab này xong.
        if (hooks.onAddSheet) hooks.onAddSheet(added);
        if (state.tabs.includes(added)) {
          return new Response(
            JSON.stringify({
              error: { code: 400, message: `A sheet with the name "${added}" already exists.` },
            }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }
        state.tabs = [...state.tabs, added];
        return json({ replies: [{}] });
      }

      calls.appendCells++;
      return json({ replies: [{}] });
    }

    throw new Error(`Bài kiểm thử chưa lo tới lời gọi này: ${href} ${init?.method ?? "GET"}`);
  };

  return { calls, sentRanges, state, hooks, fetchImpl };
}

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function fresh(tabs: string[]) {
  const google = fakeGoogle(tabs);
  const original = globalThis.fetch;
  globalThis.fetch = google.fetchImpl as typeof fetch;

  const client = new GoogleSheetsClient({
    serviceAccountEmail: "robin-writer@thu.iam.gserviceaccount.com",
    privateKey,
    spreadsheetId: "sheet-gia",
  });

  return { ...google, client, restore: () => (globalThis.fetch = original) };
}

describe("đọc dải ô từ Google Sheet", () => {
  it("KHÔNG gửi dải của tab chưa tồn tại, và trả về dải rỗng cho nó", async () => {
    // Đây chính là lỗi làm không tạo được buổi đánh nào trên Sheet thật.
    const g = fresh(["events", "clubs"]);
    try {
      const out = await g.client.batchGet(["events!A:N", "log__MOI99!A:A"]);

      expect(g.sentRanges).toEqual([["events!A:N"]]);
      expect(out).toHaveLength(2);
      expect(out[0]!.values).toEqual([["events!A:N"]]);
      expect(out[1]!.range).toBe("log__MOI99!A:A");
      expect(out[1]!.values).toEqual([]);
    } finally {
      g.restore();
    }
  });

  it("mọi tab đều chưa có thì không gọi Google lần nào để đọc ô", async () => {
    const g = fresh(["events"]);
    try {
      const out = await g.client.batchGet(["log__AAA111!A:A", "view__AAA111!A:A"]);
      expect(g.calls.values).toBe(0);
      expect(out.map((r) => r.values)).toEqual([[], []]);
    } finally {
      g.restore();
    }
  });

  it("tab nào cũng đã biết thì không đọc lại siêu dữ liệu", async () => {
    // Đường thường gặp nhất. Đọc lại siêu dữ liệu mỗi lượt là đốt hạn mức Sheets
    // vào thứ gần như không bao giờ đổi.
    const g = fresh(["events", "log__AAA111"]);
    try {
      await g.client.batchGet(["events!A:N", "log__AAA111!A:A"]);
      const after = g.calls.meta;
      await g.client.batchGet(["events!A:N", "log__AAA111!A:A"]);
      expect(g.calls.meta).toBe(after);
    } finally {
      g.restore();
    }
  });

  it("tab do tiến trình khác vừa tạo vẫn đọc được, nhờ đọc lại siêu dữ liệu", async () => {
    // Bản đồ tab nằm trong bộ nhớ của MỘT tiến trình. Kết luận vội "chưa có" là
    // `load` trả null cho một buổi đánh đang có thật, và người chơi mở app lên
    // thấy buổi biến mất.
    const g = fresh(["events"]);
    try {
      await g.client.batchGet(["events!A:N"]);

      // Một hàm serverless khác vừa tạo tab nhật ký.
      g.state.tabs = ["events", "log__BBB222"];

      const out = await g.client.batchGet(["events!A:N", "log__BBB222!A:A"]);
      expect(g.sentRanges.at(-1)).toEqual(["events!A:N", "log__BBB222!A:A"]);
      expect(out[1]!.values).toEqual([["log__BBB222!A:A"]]);
    } finally {
      g.restore();
    }
  });

  it("giữ đúng thứ tự và số lượng dải kể cả khi có dải bị bỏ qua", async () => {
    // Người gọi lấy kết quả theo vị trí — `const [index, logColumn] = ...`. Lệch
    // một ô là đọc nhật ký ra chỉ mục sự kiện, hỏng theo kiểu rất khó truy.
    const g = fresh(["events", "clubs"]);
    try {
      const out = await g.client.batchGet([
        "log__X!A:A",
        "events!A:N",
        "view__X!A:A",
        "clubs!A:F",
      ]);
      expect(out.map((r) => r.range)).toEqual([
        "log__X!A:A",
        "events!A:N",
        "view__X!A:A",
        "clubs!A:F",
      ]);
      expect(out.map((r) => r.values)).toEqual([
        [],
        [["events!A:N"]],
        [],
        [["clubs!A:F"]],
      ]);
    } finally {
      g.restore();
    }
  });
});

/**
 * Cuộc đua tạo tab.
 *
 * Đây là lỗi thật ở lượt deploy `v0.6.1` đầu tiên: `/e/HY62PJ` trả 500 trong khi
 * `/api/events/HY62PJ/state` trả 200 ở đúng khoảnh khắc đó. Hai hàm serverless cùng
 * là hàm đầu tiên đọc `event_deletions`, cùng thấy tab chưa có, cùng gọi `addSheet`;
 * Google từ chối cái đến sau và lời từ chối ấy nổi thẳng lên thành 500.
 *
 * Từ v0.6.1 tab đó được đọc trong `readEvent` — đường mà mọi trang và mọi API đều đi
 * qua — nên thua cuộc đua phải là chuyện bình thường, không phải lỗi.
 */
describe("tạo tab khi nhiều hàm cùng chạy", () => {
  it("thua cuộc đua thì coi như xong, không ném lỗi và không ghi đè tiêu đề", async () => {
    const g = fresh(["events"]);
    try {
      // Đúng giữa lời gọi `addSheet` của mình, một hàm khác tạo xong tab.
      g.hooks.onAddSheet = (title) => {
        g.state.tabs = [...g.state.tabs, title];
      };

      await expect(
        g.client.ensureTab("event_deletions", ["event_code", "action"]),
      ).resolves.toBeUndefined();

      expect(g.calls.addSheet).toBe(1);
      // Người thắng cuộc đua đã ghi dòng tiêu đề rồi. Ghi thêm lần nữa sẽ thành hai
      // dòng tiêu đề, và dòng thứ hai bị đọc nhầm thành dữ liệu.
      expect(g.calls.appendCells).toBe(0);
    } finally {
      g.restore();
    }
  });

  it("tab chưa có thì vẫn tạo và ghi đúng một dòng tiêu đề", async () => {
    const g = fresh(["events"]);
    try {
      await g.client.ensureTab("event_deletions", ["event_code", "action"]);
      expect(g.state.tabs).toContain("event_deletions");
      expect(g.calls.addSheet).toBe(1);
      expect(g.calls.appendCells).toBe(1);
    } finally {
      g.restore();
    }
  });

  it("tab đã biết từ trước thì không gọi tạo lần nào", async () => {
    const g = fresh(["events", "event_deletions"]);
    try {
      await g.client.ensureTab("event_deletions", ["event_code", "action"]);
      expect(g.calls.addSheet).toBe(0);
      expect(g.calls.appendCells).toBe(0);
    } finally {
      g.restore();
    }
  });

  it("lỗi thật vẫn nổi lên, không bị nuốt chung với cuộc đua", async () => {
    // Phân biệt bằng trạng thái thật — tab có tồn tại hay không — chứ không dò chuỗi
    // lỗi của Google. Ở đây `addSheet` hỏng mà tab vẫn chưa có: đó là lỗi thật.
    const g = fresh(["events"]);
    try {
      globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
        const href = String(url);
        if (href.endsWith(":batchUpdate")) {
          return new Response(
            JSON.stringify({ error: { code: 403, message: "The caller does not have permission" } }),
            { status: 403, headers: { "content-type": "application/json" } },
          );
        }
        return g.fetchImpl(url, init);
      }) as typeof fetch;

      await expect(
        g.client.ensureTab("event_deletions", ["event_code", "action"]),
      ).rejects.toThrow(/403/);
      expect(g.state.tabs).not.toContain("event_deletions");
    } finally {
      g.restore();
    }
  });
});
