/**
 * Kiểm thử lớp Google Sheet.
 *
 * Điều đáng lo nhất khi dùng Sheet làm cơ sở dữ liệu là mất dữ liệu âm thầm. Các
 * bài dưới đây kiểm đúng thứ đó: hai người cùng ghi thì không ai bị nuốt kết quả,
 * ảnh chụp hỏng thì dựng lại được, và mỗi lệnh chỉ tốn một lời gọi ghi.
 */

import { describe, expect, it } from "vitest";
import type { CommandEnvelope } from "../lib/domain/commands";
import { DEFAULT_CONFIG, type Actor } from "../lib/domain/types";
import { FakeSheetsClient, parseRange, rowRange } from "../lib/sheets/client";
import { EventRepo } from "../lib/sheets/repo";
import { STATE_COLUMN_START, logTab, splitState, TABS } from "../lib/sheets/schema";
import { firstOpenRound } from "../lib/domain/rounds";
import { planRoundRobinSchedule } from "../lib/scheduler/round-robin";
import { EventSim } from "../lib/testing/harness";

const ADMIN: Actor = { kind: "admin", label: "chủ sân", ref: "admin" };

function envelope(id: string, command: CommandEnvelope["command"], at = 1000): CommandEnvelope {
  return { id, at, actor: ADMIN, command };
}

async function freshEvent() {
  const sheets = new FakeSheetsClient();
  const repo = new EventRepo(sheets);
  const record = await repo.create(
    {
      code: "ABC123",
      clubId: null,
      name: "Buổi tối thứ ba",
      status: "draft",
      ownerUserId: "u1",
      playerPassHash: "hash-player",
      adminPassHash: "hash-admin",
    },
    1000,
  );
  return { sheets, repo, record };
}

describe("phân tích ký hiệu ô", () => {
  it("hiểu dải ô một dòng và dải ô cả cột", () => {
    expect(parseRange("events!A2:N2")).toMatchObject({
      tab: "events",
      startRow: 1,
      startCol: 0,
      endRow: 2,
      endCol: 14, // N là cột thứ 14, mốc cuối là mốc mở
    });
    expect(parseRange("events!A:C")).toMatchObject({
      tab: "events",
      startRow: 0,
      startCol: 0,
      endCol: 3,
    });
  });

  it("tạo đúng dải ô cho một dòng", () => {
    expect(rowRange("events", 4, 14)).toBe("events!A5:N5");
  });
});

describe("vòng đời sự kiện trên Sheet", () => {
  it("tạo rồi đọc lại được", async () => {
    const { repo, record } = await freshEvent();
    expect(record.rowIndex).toBe(1); // dòng 0 là tiêu đề

    const loaded = await repo.load("ABC123");
    expect(loaded).not.toBeNull();
    expect(loaded!.record.name).toBe("Buổi tối thứ ba");
    expect(loaded!.record.adminPassHash).toBe("hash-admin");
    expect(loaded!.state.players).toEqual([]);
  });

  it("ghi snapshot nén mới và vẫn đọc được snapshot JSON cũ", async () => {
    const { sheets, repo, record } = await freshEvent();
    const rows = sheets.dump(TABS.events);
    const compressed = rows[record.rowIndex]!.slice(STATE_COLUMN_START).join("");
    expect(compressed.startsWith("z1:")).toBe(true);
    expect(rows[record.rowIndex]!.slice(STATE_COLUMN_START).every((cell) => cell.length <= 45_000)).toBe(true);

    const legacy = {
      ...(await repo.load("ABC123"))!.state,
      scheduleMode: undefined,
      roundRobinCampaign: undefined,
    };
    await sheets.batch([{
      kind: "update",
      range: rowRange(TABS.events, record.rowIndex, 14),
      values: [[
        "ABC123", "", "Buổi tối thứ ba", "", "draft", "u1",
        "hash-player", "hash-admin", "0", "1000",
        ...splitState(JSON.stringify(legacy)),
      ]],
    }]);

    const loadedLegacy = await repo.load("ABC123");
    expect(loadedLegacy?.repaired).toBe(false);
    expect(loadedLegacy?.state.scheduleMode).toBe("americano");
    expect(loadedLegacy?.state.roundRobinCampaign).toBeNull();
  });

  it("snapshot trọn chu kỳ 40 người nằm gọn trong bốn ô", async () => {
    const sim = new EventSim({ code: "ABC123", config: { courts: 8, lookaheadRounds: 6 } });
    sim.addPlayers(Array.from({ length: 40 }, (_, index) => `P${index + 1}`));
    sim.start();
    sim.send({
      type: "StartRoundRobinCampaign",
      campaignId: "rr-snapshot-40",
      playerIds: sim.state.players.map((player) => player.id),
      effectiveRound: firstOpenRound(sim.state),
    });
    const full = planRoundRobinSchedule(sim.state, { mode: "rebuild", lookahead: 10_000 });
    expect(full.forecast?.unresolvedPairs).toEqual([]);
    sim.send({ type: "SetSchedule", fromRound: full.fromRound, matches: full.matches });
    for (const match of [...sim.state.matches]) {
      sim.send({
        type: "SubmitResult",
        matchId: match.id,
        scoreA: 11,
        scoreB: 7,
        irregular: false,
      });
    }
    expect(sim.state.roundRobinCampaign?.status).toBe("completed");

    const { sheets, repo, record } = await freshEvent();
    const loaded = (await repo.load("ABC123"))!;
    const committed = await repo.commitMany("ABC123", sim.log, loaded, { allOrNothing: true });
    expect(committed.ok).toBe(true);
    const cells = sheets.dump(TABS.events)[record.rowIndex]!.slice(STATE_COLUMN_START);
    expect(cells).toHaveLength(4);
    expect(cells.every((cell) => cell.length <= 45_000)).toBe(true);
    expect(cells.join("").length).toBeLessThan(JSON.stringify(sim.state).length);
    expect((await repo.load("ABC123"))?.state.roundRobinCampaign?.status).toBe("completed");
  });

  it("trả về null cho mã không tồn tại", async () => {
    const { repo } = await freshEvent();
    expect(await repo.load("KHONGCO")).toBeNull();
  });

  it("mỗi lệnh chỉ tốn một lời gọi ghi", async () => {
    // Hạn mức Sheets là 60 request mỗi phút cho cả tài khoản dịch vụ, nên đây là
    // ràng buộc thật chứ không phải tối ưu cho vui.
    const { sheets, repo } = await freshEvent();
    const loaded = (await repo.load("ABC123"))!;
    const before = sheets.calls.batch;

    await repo.append(
      "ABC123",
      envelope("c1", {
        type: "CreateEvent",
        code: "ABC123",
        clubId: null,
        config: DEFAULT_CONFIG,
      }),
      loaded,
    );

    expect(sheets.calls.batch - before).toBe(1);
  });

  it("ghi lệnh vào nhật ký kèm người thực hiện", async () => {
    const { sheets, repo } = await freshEvent();
    const loaded = (await repo.load("ABC123"))!;

    await repo.append(
      "ABC123",
      envelope("c1", {
        type: "AddPlayer",
        player: { id: "p1", name: "Nam", avatarId: "a01" },
      }),
      loaded,
    );

    const rows = sheets.dump(logTab("ABC123"));
    expect(rows).toHaveLength(2); // tiêu đề + một lệnh
    const entry = rows[1]!;
    expect(entry[2]).toBe("admin");
    expect(entry[3]).toBe("chủ sân");
    expect(entry[5]).toBe("c1");
    expect(entry[6]).toBe("AddPlayer");
    expect(JSON.parse(entry[7]!).player.name).toBe("Nam");
  });
});

describe("chống mất dữ liệu khi hai người cùng ghi", () => {
  it("hai lệnh khác nhau từ hai trạng thái cũ đều được giữ lại", async () => {
    // Hai điện thoại cùng đọc, cùng ghi. Google Sheet không có phép so-sánh-rồi-
    // ghi nguyên tử nên không thể chặn tình huống này; điều bắt buộc là KHÔNG kết
    // quả nào biến mất. Nối thêm dòng vào nhật ký thì luôn an toàn, còn ô ảnh chụp
    // bị ghi đè cũng không sao vì lần đọc sau sẽ phát hiện và dựng lại.
    const { repo } = await freshEvent();
    const a = (await repo.load("ABC123"))!;
    const b = (await repo.load("ABC123"))!;

    await repo.append(
      "ABC123",
      envelope("c1", { type: "AddPlayer", player: { id: "p1", name: "Nam", avatarId: "a01" } }),
      a,
    );
    await repo.append(
      "ABC123",
      envelope("c2", { type: "AddPlayer", player: { id: "p2", name: "Lan", avatarId: "a01" } }),
      b, // vẫn là trạng thái cũ
    );

    const final = (await repo.load("ABC123"))!;
    expect(final.repaired, "phải nhận ra ảnh chụp bị ghi đè").toBe(true);
    expect(final.state.players.map((p) => p.name).sort()).toEqual(["Lan", "Nam"]);
  });

  it("hai người cùng nhập một trận thì người sau bị từ chối, không đè mất", async () => {
    const { repo } = await freshEvent();

    // Dựng một trận sẵn sàng để nhập điểm.
    await repo.commit("ABC123", envelope("c0", {
      type: "CreateEvent", code: "ABC123", clubId: null, config: DEFAULT_CONFIG,
    }));
    for (let i = 1; i <= 4; i++) {
      await repo.commit("ABC123", envelope(`add${i}`, {
        type: "AddPlayer",
        player: { id: `p${i}`, name: `P${i}`, avatarId: "a01" },
        asActive: true,
      }));
    }
    await repo.commit("ABC123", envelope("start", { type: "StartEvent" }));
    await repo.commit("ABC123", envelope("sched", {
      type: "SetSchedule",
      fromRound: 1,
      matches: [{ id: "m1", round: 1, court: 1, teamA: ["p1", "p2"], teamB: ["p3", "p4"] }],
    }));

    const a = (await repo.load("ABC123"))!;
    const b = (await repo.load("ABC123"))!;

    const first = await repo.append("ABC123", envelope("r1", {
      type: "SubmitResult", matchId: "m1", scoreA: 11, scoreB: 7, irregular: false,
    }), a);
    expect(first.ok).toBe(true);

    // Người thứ hai áp lệnh trên trạng thái cũ nên `reduce` vẫn nhận. Đó chính là
    // lý do phải có bước phát lại: nó mới là nơi phân xử cuối cùng.
    await repo.append("ABC123", envelope("r2", {
      type: "SubmitResult", matchId: "m1", scoreA: 5, scoreB: 11, irregular: false,
    }), b);

    const final = (await repo.load("ABC123"))!;
    const match = final.state.matches.find((m) => m.id === "m1")!;
    expect(match.result?.scoreA, "kết quả nhập trước phải thắng").toBe(11);
    expect(
      final.skipped.map((s) => s.id),
      "lệnh thua cuộc phải được báo lại chứ không biến mất lặng lẽ",
    ).toContain("r2");
  });

  it("đọc lại rồi thử lại thì cả hai kết quả đều còn", async () => {
    const { repo } = await freshEvent();

    for (const [id, name] of [["c1", "Nam"], ["c2", "Lan"]] as const) {
      const out = await repo.commit(
        "ABC123",
        envelope(id, { type: "AddPlayer", player: { id: name, name, avatarId: "a01" } }),
      );
      expect(out.ok).toBe(true);
    }

    const final = (await repo.load("ABC123"))!;
    expect(final.state.players.map((p) => p.name)).toEqual(["Nam", "Lan"]);
  });
});

describe("dựng lại từ nhật ký", () => {
  it("ảnh chụp hỏng vẫn khôi phục được đầy đủ", async () => {
    const { sheets, repo } = await freshEvent();

    for (const [id, name] of [["c1", "Nam"], ["c2", "Lan"], ["c3", "Hùng"]] as const) {
      await repo.commit(
        "ABC123",
        envelope(id, { type: "AddPlayer", player: { id: name, name, avatarId: "a01" } }),
      );
    }

    // Phá ô ảnh chụp, mô phỏng việc ai đó sửa tay trong Google Sheet.
    await sheets.batch([
      {
        kind: "update",
        range: `${TABS.events}!${String.fromCharCode(65 + STATE_COLUMN_START)}2`,
        values: [["{rác}"]],
      },
    ]);

    const loaded = (await repo.load("ABC123"))!;
    expect(loaded.repaired, "phải nhận ra ảnh chụp hỏng").toBe(true);
    expect(loaded.state.players.map((p) => p.name)).toEqual(["Nam", "Lan", "Hùng"]);
  });

  it("bỏ qua dòng nhật ký hỏng chứ không hỏng cả sự kiện", async () => {
    const { sheets, repo } = await freshEvent();
    await repo.commit(
      "ABC123",
      envelope("c1", { type: "AddPlayer", player: { id: "p1", name: "Nam", avatarId: "a01" } }),
    );

    await sheets.batch([
      {
        kind: "append",
        tab: logTab("ABC123"),
        values: [["2", "khong-phai-ngay", "admin", "x", "", "c2", "AddPlayer", "{json hỏng"]],
      },
    ]);

    const state = await repo.rebuild("ABC123");
    expect(state.players).toHaveLength(1);
  });
});
