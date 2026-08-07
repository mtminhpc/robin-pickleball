/**
 * Kiểm thử kho dữ liệu chạy thử và bản in trong Google Sheet.
 *
 * Kho file cục bộ phải cư xử giống hệt bản trong bộ nhớ mà `tests/sheets.test.ts`
 * đã kiểm — nếu nó dễ tính hơn thì lỗi sẽ chỉ lộ ra khi đã nối Google Sheet thật,
 * đúng lúc tệ nhất.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CommandEnvelope } from "../lib/domain/commands";
import type { Actor } from "../lib/domain/types";
import { LocalFileSheetsClient } from "../lib/sheets/local";
import { EventRepo } from "../lib/sheets/repo";
import { logTab, viewTab } from "../lib/sheets/schema";
import { renderView } from "../lib/sheets/view";
import { EventSim } from "../lib/testing/harness";

const ADMIN: Actor = { kind: "admin", label: "chủ sân", ref: "admin" };
const dirs: string[] = [];

function tempStore(): { path: string; client: LocalFileSheetsClient } {
  const dir = mkdtempSync(join(tmpdir(), "robin-"));
  dirs.push(dir);
  const path = join(dir, "sheet.json");
  return { path, client: new LocalFileSheetsClient(path) };
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function envelope(id: string, command: CommandEnvelope["command"]): CommandEnvelope {
  return { id, at: 1_700_000_000_000, actor: ADMIN, command };
}

describe("kho dữ liệu trên đĩa", () => {
  it("giữ lại dữ liệu sau khi khởi động lại", async () => {
    // Đây là lý do tồn tại của kho này: `pnpm dev` tắt đi bật lại không mất
    // buổi đánh đang thử dở.
    const { path, client } = tempStore();
    const repo = new EventRepo(client);
    await repo.create(
      {
        code: "LOCAL1",
        clubId: null,
        name: "Thử trên máy",
        status: "draft",
        ownerUserId: "",
        playerPassHash: "",
        adminPassHash: "hash",
      },
      1000,
    );
    await repo.commit(
      "LOCAL1",
      envelope("c1", { type: "AddPlayer", player: { id: "p1", name: "Nam", avatarId: "" } }),
    );

    // Tiến trình mới, đọc lại từ đúng tệp đó.
    const reopened = new EventRepo(new LocalFileSheetsClient(path));
    const loaded = await reopened.load("LOCAL1");
    expect(loaded?.state.players.map((p) => p.name)).toEqual(["Nam"]);
  });

  it("ghi ra JSON đọc được bằng mắt", async () => {
    // Kho chạy thử cũng là công cụ chẩn đoán: mở tệp ra phải hiểu được ngay,
    // giống như mở Google Sheet ra xem.
    const { path, client } = tempStore();
    await new EventRepo(client).bootstrap();

    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, string[][]>;
    expect(Object.keys(raw)).toContain("events");
    expect(raw.events?.[0]).toContain("code");
  });

  it("tạo tab nhật ký và tab bản in cho mỗi sự kiện", async () => {
    const { client } = tempStore();
    const repo = new EventRepo(client);
    await repo.create(
      {
        code: "LOCAL2",
        clubId: null,
        name: "Thử",
        status: "draft",
        ownerUserId: "",
        playerPassHash: "",
        adminPassHash: "hash",
      },
      1000,
    );
    const tabs = await client.listTabs();
    expect(tabs).toContain(logTab("LOCAL2"));
    expect(tabs).toContain(viewTab("LOCAL2"));
  });
});

describe("bản in trong Google Sheet", () => {
  function played() {
    const sim = new EventSim({
      seed: 3,
      config: { courts: 2, name: "Tối thứ ba" },
      planning: { iterations: 3_000, timeBudgetMs: 120 },
    });
    sim.addPlayers(["Nam", "Lan", "Hùng", "Mai", "Cường", "Thảo", "Dũng", "Ngọc"]);
    sim.start();
    sim.playRounds(3);
    return sim;
  }

  it("có đủ ba bảng và mọi dòng bằng nhau về số cột", () => {
    const view = renderView(played().state);
    const text = view.rows.map((r) => r.join("|")).join("\n");

    expect(text).toContain("LỊCH THI ĐẤU");
    expect(text).toContain("BẢNG XẾP HẠNG");
    expect(text).toContain("CÔNG BẰNG");

    // Sheets ghi theo dải ô chữ nhật; dòng ngắn hơn sẽ để sót nội dung cũ.
    for (const row of view.rows) expect(row).toHaveLength(view.width);
  });

  it("hiện tên người chứ không hiện mã", () => {
    // Mở bảng tính ra mà thấy "p-nam-3" thì bản in này chẳng để làm gì.
    const view = renderView(played().state);
    const text = view.rows.map((r) => r.join(" ")).join("\n");
    expect(text).toContain("Nam");
    expect(text).not.toMatch(/p-nam/);
  });

  it("có đệm dòng trống ở cuối để xoá nội dung cũ", () => {
    // Bản in được ghi đè từ ô A1. Nội dung ngắn lại mà không đệm thì phần thừa
    // của lần trước nằm lại và trông như dữ liệu thật.
    const view = renderView(played().state);
    const tail = view.rows.slice(-10);
    for (const row of tail) expect(row.every((c) => c === "")).toBe(true);
  });

  it("ghi rõ trận bị huỷ và lý do", () => {
    const sim = played();
    const target = sim.state.matches.find((m) => m.status === "scheduled")!;
    sim.send({ type: "CancelMatch", matchId: target.id, reason: "Hết giờ sân" });

    const text = renderView(sim.state).rows.map((r) => r.join(" ")).join("\n");
    expect(text).toContain("đã huỷ");
    expect(text).toContain("Hết giờ sân");
  });

  it("tỷ số ghi ra dạng số để cộng tay được trong Sheet", () => {
    const view = renderView(played().state);
    const header = view.rows.findIndex((r) => r[0] === "Vòng");
    const firstMatch = view.rows[header + 1]!;
    // Cột 4 và 5 là điểm A, điểm B. Chuỗi phải là số thuần để Sheets hiểu.
    expect(firstMatch[4]).toMatch(/^\d+$/);
    expect(firstMatch[5]).toMatch(/^\d+$/);
  });
});
