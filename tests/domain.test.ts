/**
 * Kiểm thử tầng nghiệp vụ: nhật ký lệnh, quyền, và bảng xếp hạng.
 *
 * Nhiều bài ở đây kiểm những thứ người dùng nêu đích danh vì đã bị chúng làm khổ:
 * bấm nhầm rồi không sửa được, tưởng đã lưu mà chưa lưu, gửi lại thì thành hai
 * kết quả. Chúng là yêu cầu chứ không phải chi tiết kỹ thuật.
 */

import { describe, expect, it } from "vitest";
import type { CommandEnvelope } from "../lib/domain/commands";
import { apply, emptyState, fold } from "../lib/domain/reduce";
import { canEditResult, checkScore } from "../lib/domain/rules";
import { computeStandings } from "../lib/domain/standings";
import { DEFAULT_CONFIG, type Actor, type Match } from "../lib/domain/types";
import { EventSim } from "../lib/testing/harness";

const PLAYER: Actor = { kind: "player", label: "Nam", ref: "nam" };
const OTHER: Actor = { kind: "player", label: "Lan", ref: "lan" };
const ADMIN: Actor = { kind: "admin", label: "chủ sân", ref: "admin" };

function names(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `P${i + 1}`);
}

function started(players = 8, courts = 2): EventSim {
  const sim = new EventSim({
    seed: 1,
    config: { courts },
    planning: { iterations: 4000, timeBudgetMs: 150 },
  });
  sim.addPlayers(names(players));
  sim.start();
  return sim;
}

describe("nhật ký lệnh", () => {
  it("phát lại nhật ký cho ra đúng trạng thái cũ", () => {
    const sim = started(12);
    sim.playRounds(4);

    const replayed = fold(sim.state.code, sim.log);
    expect(replayed.skipped).toEqual([]);
    expect(replayed.state).toEqual(sim.state);
  });

  it("gửi lại cùng một lệnh không nhân đôi kết quả", () => {
    // Đây là điều giữ cho hàng đợi offline an toàn: mất mạng rồi gửi lại năm lần
    // vẫn chỉ ra một kết quả.
    const sim = started();
    const match = sim.state.matches.find((m) => m.status === "scheduled")!;

    const envelope: CommandEnvelope = {
      id: "gui-lai-nhieu-lan",
      at: 1_700_000_000_000,
      actor: PLAYER,
      command: {
        type: "SubmitResult",
        matchId: match.id,
        scoreA: 11,
        scoreB: 7,
        irregular: false,
      },
    };

    const once = apply(sim.state, envelope);
    expect(once.ok).toBe(true);
    const twice = apply(once.ok ? once.value : sim.state, envelope);
    expect(twice.ok).toBe(true);

    const after = twice.ok ? twice.value : sim.state;
    expect(after.seq, "lệnh trùng không được làm tăng số thứ tự").toBe(
      once.ok ? once.value.seq : -1,
    );
    const stored = after.matches.find((m) => m.id === match.id)!;
    expect(stored.result?.scoreA).toBe(11);
    expect(stored.edits).toEqual([]);
  });

  it("một dòng nhật ký hỏng không giết cả sự kiện", () => {
    const sim = started();
    const broken: CommandEnvelope = {
      id: "hong",
      at: Date.now(),
      actor: ADMIN,
      command: { type: "SubmitResult", matchId: "khong-ton-tai", scoreA: 11, scoreB: 3, irregular: false },
    };
    const replayed = fold(sim.state.code, [...sim.log, broken]);
    expect(replayed.skipped).toHaveLength(1);
    expect(replayed.state.matches.length).toBe(sim.state.matches.length);
  });
});

describe("khoá và sửa kết quả", () => {
  const config = { ...DEFAULT_CONFIG };

  function submitted(at: number): Match {
    return {
      id: "m1",
      round: 1,
      court: 1,
      teamA: ["a", "b"],
      teamB: ["c", "d"],
      status: "submitted",
      pinned: false,
      edits: [],
      createdAt: 0,
      result: {
        scoreA: 11,
        scoreB: 7,
        irregular: false,
        partial: false,
        submittedBy: PLAYER,
        submittedAt: at,
      },
    };
  }

  it("người vừa nhập tự sửa được trong hai phút", () => {
    const m = submitted(1000);
    const verdict = canEditResult(m, PLAYER, 1000 + 60_000, config);
    expect(verdict.allowed).toBe(true);
  });

  it("hết hai phút thì phải là chủ sự kiện", () => {
    const m = submitted(1000);
    const late = canEditResult(m, PLAYER, 1000 + 5 * 60_000, config);
    expect(late.allowed).toBe(false);
    expect(late.reason).toMatch(/chủ sự kiện/);

    expect(canEditResult(m, ADMIN, 1000 + 5 * 60_000, config).allowed).toBe(true);
  });

  it("người khác không sửa được dù còn trong cửa sổ", () => {
    const m = submitted(1000);
    const verdict = canEditResult(m, OTHER, 1000 + 10_000, config);
    expect(verdict.allowed).toBe(false);
  });

  it("mọi lần sửa đều để lại dấu vết công khai", () => {
    const sim = started();
    const match = sim.state.matches.find((m) => m.status === "scheduled")!;
    sim.send(
      { type: "SubmitResult", matchId: match.id, scoreA: 11, scoreB: 7, irregular: false },
      PLAYER,
    );
    sim.send(
      { type: "EditResult", matchId: match.id, scoreA: 11, scoreB: 9, irregular: false },
      PLAYER,
    );

    const after = sim.state.matches.find((m) => m.id === match.id)!;
    expect(after.edits).toHaveLength(1);
    expect(after.edits[0]!.from).toEqual({ scoreA: 11, scoreB: 7 });
    expect(after.edits[0]!.to).toEqual({ scoreA: 11, scoreB: 9 });
    expect(after.edits[0]!.by.label).toBe("Nam");
  });

  it("không nhận tỷ số hoà hay số âm", () => {
    const sim = started();
    const match = sim.state.matches.find((m) => m.status === "scheduled")!;
    expect(
      sim.trySend({ type: "SubmitResult", matchId: match.id, scoreA: 9, scoreB: 9, irregular: false }),
    ).toMatch(/hoà/);
    expect(
      sim.trySend({ type: "SubmitResult", matchId: match.id, scoreA: -1, scoreB: 9, irregular: false }),
    ).toMatch(/âm/);
  });

  it("không ghi đè kết quả đã khoá bằng lệnh nhập mới", () => {
    const sim = started();
    const match = sim.state.matches.find((m) => m.status === "scheduled")!;
    sim.send({ type: "SubmitResult", matchId: match.id, scoreA: 11, scoreB: 7, irregular: false });
    expect(
      sim.trySend({ type: "SubmitResult", matchId: match.id, scoreA: 5, scoreB: 11, irregular: false }),
    ).toMatch(/đã được khoá/);
  });
});

describe("kiểm tra tỷ số theo mốc điểm", () => {
  const to11 = { pointsTo: 11, winBy2: true };

  it("chấp nhận tỷ số đúng mốc", () => {
    expect(checkScore(11, 7, to11).regular).toBe(true);
    expect(checkScore(13, 11, to11).regular).toBe(true); // giao du
  });

  it("cảnh báo chứ không chặn khi trận dừng sớm", () => {
    // Người dùng chọn "cố định nhưng cho ghi đè": hết giờ sân là chuyện thường,
    // nên phải cảnh báo rồi vẫn cho lưu.
    const check = checkScore(7, 4, to11);
    expect(check.regular).toBe(false);
    expect(check.fatal).toBeNull();
    expect(check.warning).toMatch(/dừng sớm/);
  });

  it("chặn hẳn tỷ số vô lý", () => {
    expect(checkScore(11, 11, to11).fatal).toMatch(/hoà/);
    expect(checkScore(-1, 5, to11).fatal).toMatch(/âm/);
  });
});

describe("vòng đời sự kiện", () => {
  it("chưa đủ bốn người thì không bắt đầu được", () => {
    const sim = new EventSim({ seed: 1 });
    sim.addPlayers(names(3));
    expect(sim.trySend({ type: "StartEvent" })).toMatch(/ít nhất 4 người/);
  });

  it("kết thúc sớm sẽ huỷ hết trận chưa đánh và khoá sự kiện", () => {
    const sim = started(12);
    sim.playRounds(3);
    const pending = sim.state.matches.filter((m) => m.status === "scheduled").length;
    expect(pending).toBeGreaterThan(0);

    sim.send({ type: "EndEventEarly", reason: "Mưa to" });

    expect(sim.state.status).toBe("finished");
    expect(sim.state.endedEarly).toBe(true);
    expect(sim.state.matches.some((m) => m.status === "scheduled")).toBe(false);

    // Sau khi chốt thì không lệnh nào ghi thêm được nữa.
    const anyMatch = sim.state.matches[0]!;
    expect(
      sim.trySend({ type: "SubmitResult", matchId: anyMatch.id, scoreA: 11, scoreB: 2, irregular: false }),
    ).toMatch(/đã kết thúc/);
  });

  it("trước giờ đánh thì tự vào, sau giờ đánh thì phải chờ duyệt", () => {
    const sim = new EventSim({ seed: 1, planning: { iterations: 3000, timeBudgetMs: 100 } });
    sim.addPlayers(names(8));

    sim.send(
      { type: "RequestJoin", player: { id: "som", name: "Sớm", avatarId: "a01" } },
      { kind: "player", label: "Sớm", ref: "som" },
    );
    expect(sim.state.players.find((p) => p.id === "som")?.status).toBe("confirmed");

    sim.start();
    sim.send(
      { type: "RequestJoin", player: { id: "muon", name: "Muộn", avatarId: "a01" } },
      { kind: "player", label: "Muộn", ref: "muon" },
    );
    expect(sim.state.players.find((p) => p.id === "muon")?.status).toBe("pendingApproval");
  });

  it("không xoá được người đã đánh, phải dùng \"đã về\"", () => {
    const sim = started(12);
    sim.playRounds(2);
    const played = sim.state.matches.find((m) => m.status === "submitted")!;
    const id = played.teamA[0];
    expect(sim.trySend({ type: "RemovePlayer", playerId: id })).toMatch(/Đã về/i);
  });
});

describe("bảng xếp hạng", () => {
  function match(
    id: string,
    a: [string, string],
    b: [string, string],
    scoreA: number,
    scoreB: number,
  ): Match {
    return {
      id,
      round: 1,
      court: 1,
      teamA: a,
      teamB: b,
      status: "submitted",
      pinned: false,
      edits: [],
      createdAt: 0,
      result: {
        scoreA,
        scoreB,
        irregular: false,
        partial: false,
        submittedBy: ADMIN,
        submittedAt: 0,
      },
    };
  }

  const roster = (ids: string[], left: string[] = []) =>
    ids.map((id) => ({ id, name: id, hasLeft: left.includes(id) }));

  it("xếp theo hiệu số trung bình chứ không phải tổng hiệu số", () => {
    // A đánh 2 trận được +16 (TB +8); B đánh 1 trận được +10 (TB +10).
    // Tổng hiệu số thì A hơn, nhưng công bằng thì B phải đứng trên.
    const standings = computeStandings({
      matches: [
        match("m1", ["A", "X"], ["Y", "Z"], 11, 3),
        match("m2", ["A", "X"], ["Y", "Z"], 11, 3),
        match("m3", ["B", "X"], ["Y", "Z"], 11, 1),
      ],
      players: roster(["A", "B", "X", "Y", "Z"]),
      config: { ...DEFAULT_CONFIG, eligibilityRatio: 0 },
    });
    const order = standings.main.map((r) => r.playerId);
    expect(order.indexOf("B")).toBeLessThan(order.indexOf("A"));
  });

  it("tách người chưa đủ số trận xuống nhóm riêng", () => {
    // Người dùng lo đúng điều này: đánh hai trận may mắn rồi vô địch.
    const matches = [
      match("m1", ["A", "B"], ["C", "D"], 11, 9),
      match("m2", ["A", "C"], ["B", "D"], 11, 9),
      match("m3", ["A", "D"], ["B", "C"], 11, 9),
      match("m4", ["A", "B"], ["C", "D"], 11, 9),
      // Khách chỉ đánh đúng một trận nhưng thắng đậm.
      match("m5", ["E", "A"], ["B", "C"], 11, 0),
    ];
    const standings = computeStandings({
      matches,
      players: roster(["A", "B", "C", "D", "E"]),
      config: { ...DEFAULT_CONFIG },
    });

    expect(standings.main.some((r) => r.playerId === "E")).toBe(false);
    const provisional = standings.provisional.find((r) => r.playerId === "E")!;
    expect(provisional.eligible).toBe(false);
    expect(provisional.gamesNeeded).toBeGreaterThan(0);
  });

  it("người đã về vẫn có mặt trong bảng", () => {
    const standings = computeStandings({
      matches: [match("m1", ["A", "B"], ["C", "D"], 11, 5)],
      players: roster(["A", "B", "C", "D"], ["A"]),
      config: { ...DEFAULT_CONFIG, eligibilityRatio: 0 },
    });
    const row = standings.main.find((r) => r.playerId === "A")!;
    expect(row.hasLeft).toBe(true);
  });

  it("phá thế hoà bằng số trận thắng rồi tới đối đầu trực tiếp", () => {
    // A và B cùng hiệu số TB, nhưng A thắng B khi gặp nhau.
    const standings = computeStandings({
      matches: [
        match("m1", ["A", "X"], ["B", "Y"], 11, 9),
        match("m2", ["B", "X"], ["A", "Y"], 9, 11),
      ],
      players: roster(["A", "B", "X", "Y"]),
      config: { ...DEFAULT_CONFIG, eligibilityRatio: 0 },
    });
    const order = standings.main.map((r) => r.playerId);
    expect(order.indexOf("A")).toBeLessThan(order.indexOf("B"));
  });

  it("bỏ qua trận dở dang khi cấu hình yêu cầu", () => {
    const partial: Match = {
      ...match("m2", ["A", "B"], ["C", "D"], 7, 2),
      result: {
        scoreA: 7,
        scoreB: 2,
        irregular: true,
        partial: true,
        submittedBy: ADMIN,
        submittedAt: 0,
      },
    };
    const input = {
      matches: [match("m1", ["A", "B"], ["C", "D"], 11, 9), partial],
      players: roster(["A", "B", "C", "D"]),
    };

    const counted = computeStandings({
      ...input,
      config: { ...DEFAULT_CONFIG, eligibilityRatio: 0, countPartialMatches: true },
    });
    const skipped = computeStandings({
      ...input,
      config: { ...DEFAULT_CONFIG, eligibilityRatio: 0, countPartialMatches: false },
    });

    expect(counted.main.find((r) => r.playerId === "A")!.games).toBe(2);
    expect(skipped.main.find((r) => r.playerId === "A")!.games).toBe(1);
  });
});

describe("trạng thái rỗng", () => {
  it("sự kiện chưa có gì thì mọi bảng đều rỗng chứ không nổ", () => {
    const state = emptyState("TRONG1");
    const standings = computeStandings({
      matches: state.matches,
      players: [],
      config: state.config,
    });
    expect(standings.main).toEqual([]);
    expect(standings.provisional).toEqual([]);
  });
});
