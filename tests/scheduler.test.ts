/**
 * Kiểm thử thuật toán xếp lịch.
 *
 * Yêu cầu số 1 của người dùng là "công bằng chính xác nhất có thể". Đó là một lời
 * hứa chứ không phải một tính năng, nên nó phải được đo tự động chứ không thể chỉ
 * nhìn mắt thường. Các bài dưới đây là bản dịch lời hứa đó ra khẳng định kiểm
 * chứng được.
 */

import { describe, expect, it } from "vitest";
import { firstUnplayedRound } from "../lib/domain/rounds";
import type { EventState } from "../lib/domain/types";
import { buildHistory, fairnessReport } from "../lib/scheduler/metrics";
import { validateMove, validateRoundSwap } from "../lib/scheduler/validate";
import { EventSim } from "../lib/testing/harness";
import {
  assertFairShare,
  assertGameSpread,
  assertScheduleValid,
  assertStreakCap,
  longestStreak,
} from "./invariants";

/** Cấu hình chạy nhanh để bộ test không kéo dài quá lâu. */
const FAST = { iterations: 10_000, timeBudgetMs: 300 } as const;

function names(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `P${i + 1}`);
}

function countGames(sim: EventSim, id: string): number {
  return sim.state.matches.filter(
    (m) => m.status === "submitted" && [...m.teamA, ...m.teamB].includes(id),
  ).length;
}

function deficitOf(sim: EventSim, id: string): number {
  return fairnessReport(sim.state).players.find((p) => p.playerId === id)!.deficit;
}

function runSession(players: number, courts: number, rounds: number, seed = 7) {
  const sim = new EventSim({ seed, config: { courts }, planning: FAST });
  sim.addPlayers(names(players));
  sim.start();
  sim.playRounds(rounds);
  return sim;
}

describe("ma trận quy mô", () => {
  // Quét toàn bộ dải người dùng đã chọn (6-20 người) trên 1-4 sân. Đây là lưới an
  // toàn chính: một thay đổi trọng số làm hỏng bất kỳ ô nào sẽ lộ ra ngay.
  const cases: Array<[number, number]> = [];
  for (let players = 6; players <= 20; players++) {
    for (let courts = 1; courts <= 4; courts++) {
      if (players >= courts * 4) cases.push([players, courts]);
    }
  }

  it.each(cases)("%i người / %i sân giữ được mọi bất biến", (players, courts) => {
    const sim = runSession(players, courts, 12);
    assertScheduleValid(sim.state);
    assertStreakCap(sim.state);
    assertGameSpread(sim.state);
    assertFairShare(sim.state);
  });
});

describe("cân bằng số trận", () => {
  it("chia đều tuyệt đối khi số người vừa khít số chỗ", () => {
    // 16 người trên 4 sân là đúng 16 chỗ: không ai được nghỉ, nên mọi người phải
    // có đúng cùng một số trận. Không có chỗ cho sai số nào ở đây.
    const sim = runSession(16, 4, 10);
    const games = fairnessReport(sim.state).players.map((p) => p.games);
    expect(new Set(games).size).toBe(1);
    expect(games[0]).toBe(10);
  });

  it("luân phiên đều số lần nghỉ khi lẻ người", () => {
    // 13 người trên 3 sân: mỗi vòng đúng 1 người nghỉ, sau 13 vòng ai cũng nghỉ 1.
    const sim = runSession(13, 3, 13);
    const byes = fairnessReport(sim.state).players.map((p) => p.byes);
    expect(Math.max(...byes) - Math.min(...byes)).toBeLessThanOrEqual(1);
  });

  it("không ai bị bỏ rơi qua nhiều vòng dài", () => {
    const sim = runSession(19, 2, 20);
    const report = fairnessReport(sim.state);
    // 19 người trên 2 sân, mỗi vòng chỉ 8 người đánh — dễ có người bị quên nhất.
    for (const p of report.players) {
      expect(p.games, `${p.name} chỉ được ${p.games} trận`).toBeGreaterThan(0);
    }
    assertGameSpread(sim.state);
  });
});

describe("nghỉ giữa hiệp", () => {
  it("tôn trọng trần cứng khi số người cho phép", () => {
    // 20 người trên 2 sân là rất thoáng: phải giữ được mức ưu tiên 2 vòng liên tiếp.
    const sim = runSession(20, 2, 14);
    for (const p of sim.state.players) {
      expect(longestStreak(sim.state, p.id)).toBeLessThanOrEqual(2);
    }
  });

  it("đạt mức tốt nhất có thể khi trần cứng bất khả thi", () => {
    // 20 người trên 4 sân: chỉ 4 người nghỉ mỗi vòng, nên 3 vòng liên tiếp là
    // không thể. Mức tốt nhất là 4, và thuật toán phải đạt đúng mức đó thay vì
    // buông xuôi cho chuỗi dài tuỳ ý.
    const sim = runSession(20, 4, 14);
    for (const p of sim.state.players) {
      expect(longestStreak(sim.state, p.id)).toBeLessThanOrEqual(4);
    }
  });

  it("không giả vờ xếp được khi ai cũng phải đánh mọi vòng", () => {
    // 12 người trên 3 sân là 12 chỗ. Ứng dụng phải nói thẳng thay vì im lặng.
    const sim = runSession(12, 3, 6);
    const warnings = fairnessReport(sim.state).warnings;
    expect(warnings.join(" ")).toMatch(/mọi người phải đánh mọi vòng/);
  });
});

describe("đa dạng bạn đôi và đối thủ", () => {
  it("không lặp lại cặp đôi nào khi còn cặp mới để ghép", () => {
    // 16 người trên 2 sân trong 10 vòng: 40 lần ghép cặp trên 120 cặp khả dĩ, dư
    // sức để không lặp lại lần nào.
    const sim = runSession(16, 2, 10);
    const seen = new Map<string, number>();
    for (const m of sim.state.matches) {
      if (m.status !== "submitted") continue;
      for (const team of [m.teamA, m.teamB]) {
        const key = [...team].sort().join("|");
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }
    }
    const repeats = [...seen.values()].filter((c) => c > 1).length;
    expect(repeats, "có cặp đôi bị lặp dù còn cặp mới").toBe(0);
  });

  it("trải đều đối thủ", () => {
    const sim = runSession(12, 2, 14);
    const report = fairnessReport(sim.state);
    for (const p of report.players) {
      // Sau 14 vòng, ai cũng phải từng gặp gần hết những người còn lại.
      expect(
        p.distinctOpponents,
        `${p.name} mới gặp ${p.distinctOpponents}/${p.reachablePeers} người`,
      ).toBeGreaterThanOrEqual(p.reachablePeers - 1);
    }
  });
});

describe("người vào giữa chừng", () => {
  it("người mới không bị coi là đang thiếu trận lúc vừa tới", () => {
    // Đây là điểm cốt lõi của định nghĩa công bằng. Người tới ở vòng bảy không
    // hề bị thiệt sáu trận — họ chỉ chưa có mặt. Nếu tính đó là nợ thì hệ thống
    // sẽ trả bằng suất của người tới đúng giờ.
    const sim = new EventSim({ seed: 3, config: { courts: 2 }, planning: FAST });
    sim.addPlayers(names(12));
    sim.start();
    sim.playRounds(6);

    const newcomer = sim.joinMidEvent("Muộn");
    expect(Math.abs(deficitOf(sim, newcomer)), "vừa tới đã bị tính là thiếu trận").toBeLessThan(0.01);
  });

  it("người mới đánh cùng nhịp với mọi người kể từ lúc vào", () => {
    const sim = new EventSim({ seed: 3, config: { courts: 2 }, planning: FAST });
    const incumbents = sim.addPlayers(names(12));
    sim.start();
    sim.playRounds(6);

    const newcomer = sim.joinMidEvent("Muộn");
    const before = new Map(
      [...incumbents, newcomer].map((id) => [id, countGames(sim, id)] as const),
    );
    sim.playRounds(8);

    const gainedBy = (id: string) => countGames(sim, id) - before.get(id)!;
    const others = incumbents.map(gainedBy);
    const mine = gainedBy(newcomer);

    assertScheduleValid(sim.state);
    assertStreakCap(sim.state, 1);
    // Cùng nhịp nghĩa là nằm trong dải của nhóm cũ, không vọt lên trên.
    expect(mine, `người mới nhận ${mine} trận, nhóm cũ nhận ${Math.min(...others)}–${Math.max(...others)}`)
      .toBeLessThanOrEqual(Math.max(...others));
    expect(mine).toBeGreaterThanOrEqual(Math.min(...others));
  });

  it("bật hệ số đuổi kịp thì người mới mới được ưu tiên", () => {
    // Hệ số vẫn còn trong cấu hình cho nhóm nào muốn, chỉ là không còn mặc định.
    const sim = new EventSim({
      seed: 3,
      config: { courts: 2, catchUpFactor: 1 },
      planning: FAST,
    });
    const incumbents = sim.addPlayers(names(16));
    sim.start();
    sim.playRounds(8);

    const newcomer = sim.joinMidEvent("Muộn");
    const before = new Map(
      [...incumbents, newcomer].map((id) => [id, countGames(sim, id)] as const),
    );
    sim.playRounds(9);

    const gainedBy = (id: string) => countGames(sim, id) - before.get(id)!;
    const others = incumbents.map(gainedBy);
    expect(gainedBy(newcomer), "bật hệ số mà người mới vẫn không được ưu tiên")
      .toBeGreaterThan(Math.max(...others));
    assertStreakCap(sim.state, 1);
  });

  it("người mới không lấy mất suất của người đang chơi", () => {
    const sim = new EventSim({ seed: 4, config: { courts: 2 }, planning: FAST });
    const incumbents = sim.addPlayers(names(12));
    sim.start();
    sim.playRounds(6);
    sim.joinMidEvent("Muộn");
    sim.playRounds(6);

    // Đây mới là điều đáng lo khi cho người mới đuổi kịp: nhóm cũ bị đẩy ra rìa.
    // Người mới lệch nhiều là đúng thiết kế, nhưng nhóm cũ thì không được lệch.
    const report = fairnessReport(sim.state);
    for (const id of incumbents) {
      const row = report.players.find((p) => p.playerId === id)!;
      expect(
        Math.abs(row.deficit),
        `${row.name} bị thiệt ${row.deficit} vì nhường chỗ cho người mới`,
      ).toBeLessThanOrEqual(1.05);
    }
  });

  it("người tới sau vẫn phải được chủ sự kiện duyệt", () => {
    const sim = new EventSim({ seed: 5, config: { courts: 2 }, planning: FAST });
    sim.addPlayers(names(8));
    sim.start();
    sim.playRounds(2);

    sim.send(
      {
        type: "RequestJoin",
        player: { id: "khach", name: "Khách", avatarId: "a01" },
      },
      { kind: "player", label: "Khách", ref: "khach" },
    );
    sim.reschedule("rebuild");

    const pending = sim.state.players.find((p) => p.id === "khach");
    expect(pending?.status).toBe("pendingApproval");
    // Chưa duyệt thì không được xếp vào bất kỳ trận nào.
    expect(
      sim.state.matches.some((m) => [...m.teamA, ...m.teamB].includes("khach")),
    ).toBe(false);

    sim.send({ type: "ApproveJoin", playerId: "khach" });
    sim.reschedule("rebuild");
    expect(
      sim.state.matches.some((m) => [...m.teamA, ...m.teamB].includes("khach")),
    ).toBe(true);
  });
});

describe("người về sớm", () => {
  it("giữ nguyên phần đã đánh và gỡ hết phần chưa đánh", () => {
    const sim = new EventSim({ seed: 6, config: { courts: 2 }, planning: FAST });
    sim.addPlayers(names(12));
    sim.start();
    sim.playRounds(5);

    const leaving = sim.state.players[0]!;
    const playedBefore = sim.state.matches.filter(
      (m) => m.status === "submitted" && [...m.teamA, ...m.teamB].includes(leaving.id),
    ).length;

    sim.leave(leaving.id);

    const playedAfter = sim.state.matches.filter(
      (m) => m.status === "submitted" && [...m.teamA, ...m.teamB].includes(leaving.id),
    ).length;
    expect(playedAfter, "kết quả đã đánh không được mất").toBe(playedBefore);

    const future = sim.state.matches.filter(
      (m) => m.status === "scheduled" && [...m.teamA, ...m.teamB].includes(leaving.id),
    );
    expect(future, "người đã về không được còn trận nào phía trước").toEqual([]);

    sim.playRounds(6);
    assertScheduleValid(sim.state);
    // Nới một bậc: ngay sau khi mất một người, số suất nghỉ giảm trong khi quá khứ
    // đã cố định, nên có thể có đúng một vòng bí không gỡ được.
    assertStreakCap(sim.state, 1);
  });

  it("không bị coi là thiệt thòi vì về sớm", () => {
    const sim = new EventSim({ seed: 8, config: { courts: 2 }, planning: FAST });
    sim.addPlayers(names(12));
    sim.start();
    sim.playRounds(5);
    const leaving = sim.state.players[0]!;
    sim.leave(leaving.id);
    sim.playRounds(8);

    // Suất kỳ vọng chỉ cộng cho những vòng người đó có mặt, nên người về sớm
    // không được hiện ra như đang bị nợ 8 trận.
    const row = fairnessReport(sim.state).players.find((p) => p.playerId === leaving.id);
    expect(Math.abs(row!.deficit)).toBeLessThanOrEqual(1.05);
  });

  it("người đã về vẫn nằm trong mẫu số suất của những vòng quá khứ", () => {
    const sim = new EventSim({ seed: 4242, config: { courts: 1 }, planning: FAST });
    sim.addPlayers(names(5));
    sim.start();
    sim.playRounds(3);
    sim.leave(sim.state.players[0]!.id);

    const activeIds = sim.state.players.filter((p) => p.status === "active").map((p) => p.id);
    const schedulerHistory = buildHistory(sim.state, activeIds);
    const visible = new Map(
      fairnessReport(sim.state).players.map((p) => [p.playerId, p.expected]),
    );

    activeIds.forEach((id, i) => {
      expect(
        schedulerHistory.expected[i],
        "bộ xếp lịch và bảng Công bằng phải dùng cùng mẫu số lịch sử",
      ).toBeCloseTo(visible.get(id)!, 2);
    });
  });
});

describe("huỷ trận", () => {
  it("bỏ qua vòng chỉ còn trận đã huỷ khi tìm vòng đang đánh", () => {
    const sim = new EventSim({ seed: 7, config: { courts: 1 }, planning: FAST });
    sim.addPlayers(names(5));
    sim.start();
    const target = sim.state.matches.find((m) => m.status === "scheduled")!;
    sim.send({ type: "CancelMatch", matchId: target.id, reason: "Mưa" });

    expect(firstUnplayedRound(sim.state)).toBe(target.round + 1);
  });

  it("không lấp lại đúng ô sân/vòng vừa bị huỷ", () => {
    const sim = new EventSim({ seed: 8, config: { courts: 2 }, planning: FAST });
    sim.addPlayers(names(10));
    sim.start();
    sim.playRounds(2);

    const target = sim.state.matches.find((m) => m.status === "scheduled")!;
    sim.send({ type: "CancelMatch", matchId: target.id, reason: "Mất sân" });
    sim.reschedule("rebuild");

    const replacements = sim.state.matches.filter(
      (m) =>
        m.id !== target.id &&
        m.round === target.round &&
        m.court === target.court &&
        m.status !== "cancelled",
    );
    expect(replacements).toEqual([]);
    expect(sim.state.matches.find((m) => m.id === target.id)?.cancelReason).toBe("Mất sân");
  });

  it("huỷ trận chưa đánh không làm ai bị thiệt", () => {
    const sim = new EventSim({ seed: 9, config: { courts: 2 }, planning: FAST });
    sim.addPlayers(names(11));
    sim.start();
    sim.playRounds(4);

    const target = sim.state.matches.find((m) => m.status === "scheduled")!;
    sim.send({ type: "CancelMatch", matchId: target.id, reason: "Hết giờ sân" });
    sim.reschedule("rebuild");
    sim.playRounds(6);

    assertScheduleValid(sim.state);
    // Suất kỳ vọng giảm theo số trận thực sự diễn ra, nên bốn người của trận bị
    // huỷ không mang theo khoản nợ nào.
    assertFairShare(sim.state);
  });

  it("5 người vẫn luân phiên đều sau một vòng bị huỷ", () => {
    const sim = new EventSim({ seed: 4242, config: { courts: 1 } });
    sim.addPlayers(names(5));
    sim.start();
    sim.playRounds(3);

    const target = sim.state.matches.find((m) => m.status === "scheduled")!;
    sim.send({ type: "CancelMatch", matchId: target.id, reason: "Trời mưa" });
    sim.reschedule("rebuild");
    sim.playRounds(9);

    const games = fairnessReport(sim.state).players.map((p) => p.games);
    expect(Math.max(...games) - Math.min(...games)).toBeLessThanOrEqual(1);
    assertFairShare(sim.state);
  });

  it("không lấp lại sân của trận bỏ dở không tính điểm", () => {
    const sim = new EventSim({ seed: 12, config: { courts: 2 }, planning: FAST });
    sim.addPlayers(names(10));
    sim.start();
    sim.playRounds(2);

    const target = sim.state.matches.find((m) => m.status === "scheduled")!;
    const victims = [...target.teamA, ...target.teamB];
    sim.send({ type: "StartMatch", matchId: target.id });
    sim.send({ type: "AbandonMatch", matchId: target.id, reason: "Trời mưa" });
    sim.reschedule("rebuild");

    const replacements = sim.state.matches.filter(
      (m) =>
        m.id !== target.id &&
        m.round === target.round &&
        m.court === target.court &&
        m.status !== "cancelled",
    );
    expect(replacements).toEqual([]);
    const busyTwice = victims.filter(
      (id) =>
        sim.state.matches.filter(
          (m) =>
            m.round === target.round &&
            m.status !== "cancelled" &&
            [...m.teamA, ...m.teamB].includes(id),
        ).length > 1,
    );
    expect(busyTwice, "người vừa bỏ dở không được gọi sang sân còn lại").toEqual([]);
  });

  it("bỏ dở trận không tính điểm nhưng vẫn được ưu tiên xếp lại", () => {
    const sim = new EventSim({ seed: 10, config: { courts: 2 }, planning: FAST });
    sim.addPlayers(names(12));
    sim.start();
    sim.playRounds(3);

    const target = sim.state.matches.find((m) => m.status === "scheduled")!;
    const victims = [...target.teamA, ...target.teamB];
    sim.send({ type: "StartMatch", matchId: target.id });
    sim.send({ type: "AbandonMatch", matchId: target.id, reason: "Mưa" });

    // Số liệu công bằng chỉ tính các vòng đã khép lại, nên phải đánh nốt các trận
    // còn lại của vòng này thì ảnh hưởng của trận bỏ dở mới hiện ra.
    for (const m of sim.state.matches.filter(
      (x) => x.round === target.round && x.status === "scheduled",
    )) {
      sim.send({ type: "SubmitResult", matchId: m.id, scoreA: 11, scoreB: 5, irregular: false });
    }

    const report = fairnessReport(sim.state);
    for (const id of victims) {
      const row = report.players.find((p) => p.playerId === id)!;
      // Đã tốn sức nhưng không được tính trận, nên đang bị thiếu suất.
      expect(row.deficit, `${row.name} phải đang bị thiếu suất`).toBeGreaterThan(0.5);
    }
  });

  it("bỏ dở có ghi tỷ số thì vẫn tính vào hiệu số", () => {
    const sim = new EventSim({ seed: 11, config: { courts: 2 }, planning: FAST });
    sim.addPlayers(names(8));
    sim.start();

    const target = sim.state.matches.find((m) => m.status === "scheduled")!;
    sim.send({ type: "StartMatch", matchId: target.id });
    sim.send({
      type: "AbandonMatch",
      matchId: target.id,
      reason: "Hết giờ",
      score: { scoreA: 7, scoreB: 4 },
    });

    const after = sim.state.matches.find((m) => m.id === target.id)!;
    expect(after.status).toBe("submitted");
    expect(after.result?.partial).toBe(true);
    expect(after.result?.scoreA).toBe(7);

    sim.reschedule("rebuild");
    const sameCourt = sim.state.matches.filter(
      (m) =>
        m.id !== target.id &&
        m.round === target.round &&
        m.court === target.court &&
        m.status !== "cancelled",
    );
    expect(sameCourt, "trận dở dang có tỷ số vẫn chiếm đúng sân/vòng đó").toEqual([]);
    assertScheduleValid(sim.state);
  });
});

describe("dời lịch bằng tay", () => {
  it("trận đã ghim không bị thuật toán xếp lại", () => {
    const sim = new EventSim({ seed: 12, config: { courts: 2 }, planning: FAST });
    sim.addPlayers(names(14));
    sim.start();

    // Dời một trận ở vòng xa lên gần hơn, rồi bắt thuật toán xếp lại toàn bộ.
    const far = sim.state.matches.find((m) => m.round >= 4 && m.status === "scheduled")!;
    const quad = [...far.teamA, ...far.teamB];
    const clash = sim.state.matches.some(
      (m) => m.round === 3 && [...m.teamA, ...m.teamB].some((id) => quad.includes(id)),
    );
    if (clash) return; // cấu hình này không dời được, bài khác lo

    sim.send({ type: "ReorderMatch", matchId: far.id, toRound: 3, toCourt: 2 });
    sim.reschedule("rebuild");

    const moved = sim.state.matches.find((m) => m.id === far.id);
    expect(moved, "trận đã ghim bị biến mất khi xếp lại").toBeDefined();
    expect(moved!.round).toBe(3);
    expect(moved!.pinned).toBe(true);
    expect([...moved!.teamA, ...moved!.teamB].sort()).toEqual(quad.sort());
    assertScheduleValid(sim.state);
  });

  it("từ chối dời khi có người phải đánh hai trận cùng vòng", () => {
    const sim = new EventSim({ seed: 13, config: { courts: 2 }, planning: FAST });
    sim.addPlayers(names(8));
    sim.start();

    // 8 người trên 2 sân: ai cũng đánh mọi vòng, nên mọi lần dời đều đụng nhau.
    const target = sim.state.matches.find((m) => m.round === 2)!;
    const error = sim.trySend({
      type: "ReorderMatch",
      matchId: target.id,
      toRound: 1,
      toCourt: 1,
    });
    expect(error).toMatch(/phải đánh hai trận trong vòng/);
  });

  it("đổi chỗ được với trận ở ô đích khi không ai bị trùng", () => {
    // 6 người trên 1 sân: mỗi vòng chỉ 4 người đánh, nên còn chỗ để hai trận
    // hoán đổi cho nhau mà không ai phải đánh hai lần.
    const sim = new EventSim({ seed: 21, config: { courts: 1 }, planning: FAST });
    sim.addPlayers(names(6));
    sim.start();

    const a = sim.state.matches.find((m) => m.round === 2)!;
    const b = sim.state.matches.find((m) => m.round === 3)!;
    const quadA = [...a.teamA, ...a.teamB].sort();
    const quadB = [...b.teamA, ...b.teamB].sort();

    const error = sim.trySend({
      type: "ReorderMatch",
      matchId: a.id,
      toRound: 3,
      toCourt: b.court,
    });

    if (error) {
      // Cấu hình này vẫn có thể trùng người; khi đó phải từ chối có lý do rõ ràng.
      expect(error).toMatch(/phải đánh hai trận trong vòng/);
      return;
    }

    const movedA = sim.state.matches.find((m) => m.id === a.id)!;
    const movedB = sim.state.matches.find((m) => m.id === b.id)!;
    expect(movedA.round, "trận được dời phải sang vòng đích").toBe(3);
    expect(movedB.round, "trận ở ô đích phải lùi về chỗ cũ của trận kia").toBe(2);
    expect([...movedA.teamA, ...movedA.teamB].sort()).toEqual(quadA);
    expect([...movedB.teamA, ...movedB.teamB].sort()).toEqual(quadB);
    expect(movedA.pinned && movedB.pinned, "cả hai phải được ghim").toBe(true);
    assertScheduleValid(sim.state);
  });

  it("không dời được vào vòng đã đánh xong", () => {
    const sim = new EventSim({ seed: 22, config: { courts: 2 }, planning: FAST });
    sim.addPlayers(names(12));
    sim.start();
    sim.playRounds(2);

    const later = sim.state.matches.find((m) => m.status === "scheduled")!;
    const error = sim.trySend({
      type: "ReorderMatch",
      matchId: later.id,
      toRound: 1,
      toCourt: 1,
    });
    expect(error).toMatch(/đã đánh rồi/);
  });
});

describe("đổi chỗ hai vòng", () => {
  /**
   * Đây là thứ nút "sớm hơn / muộn hơn" thực sự gửi đi.
   *
   * Dời riêng một trận gần như luôn bất khả thi khi lịch kín sân — đo trên lịch
   * thật thì hỏng 22 trên 24 lần. Đổi cả vòng thì luôn làm được, và đó mới là
   * điều người bấm nút muốn: cặp này đánh trước cặp kia.
   */
  it("đổi được ở mọi cấu hình, không ai thêm hay bớt trận nào", () => {
    for (const [players, courts] of [[8, 2], [9, 2], [11, 3], [12, 2], [20, 4]] as const) {
      const sim = new EventSim({ seed: 31, config: { courts }, planning: FAST });
      sim.addPlayers(names(players));
      sim.start();
      sim.playRounds(3);

      const before = gamesPerPlayer(sim.state);
      const open = firstUnplayedRound(sim.state);
      const inOpen = matchIds(sim.state, open);
      const inNext = matchIds(sim.state, open + 1);

      const error = sim.trySend({ type: "SwapRounds", roundA: open, roundB: open + 1 });
      expect(error, `${players} người / ${courts} sân: ${error}`).toBeNull();

      expect(matchIds(sim.state, open), "vòng đầu phải nhận nội dung vòng sau").toEqual(inNext);
      expect(matchIds(sim.state, open + 1), "và ngược lại").toEqual(inOpen);
      expect(gamesPerPlayer(sim.state), "không ai được thêm hay bớt trận").toEqual(before);
      assertScheduleValid(sim.state);
    }
  });

  it("vòng đã đổi chỗ không bị thuật toán trả về chỗ cũ", () => {
    const sim = new EventSim({ seed: 32, config: { courts: 2 }, planning: FAST });
    sim.addPlayers(names(12));
    sim.start();
    sim.playRounds(2);

    const open = firstUnplayedRound(sim.state);
    const wanted = matchIds(sim.state, open + 1);
    sim.send({ type: "SwapRounds", roundA: open, roundB: open + 1 });
    sim.reschedule("rebuild");

    expect(matchIds(sim.state, open)).toEqual(wanted);
  });

  it("từ chối đổi vòng đã đánh xong", () => {
    const sim = new EventSim({ seed: 33, config: { courts: 2 }, planning: FAST });
    sim.addPlayers(names(12));
    sim.start();
    sim.playRounds(3);

    expect(sim.trySend({ type: "SwapRounds", roundA: 1, roundB: 2 })).toMatch(/đã đánh rồi/);
  });

  it("đổi đi rồi đổi lại được, ghim xong vẫn đổi tiếp", () => {
    // Lỗi thật gặp khi chạy thử: `SwapRounds` ghim các trận, mà `firstOpenRound`
    // coi trận đã ghim là đông cứng — nên vừa đổi chỗ xong là không đổi lại được
    // nữa, chủ sự kiện bị khoá bởi đúng thao tác mình vừa làm.
    const sim = new EventSim({ seed: 36, config: { courts: 2 }, planning: FAST });
    sim.addPlayers(names(12));
    sim.start();
    sim.playRounds(2);

    const open = firstUnplayedRound(sim.state);
    const before = matchIds(sim.state, open);
    sim.send({ type: "SwapRounds", roundA: open, roundB: open + 1 });
    expect(sim.trySend({ type: "SwapRounds", roundA: open, roundB: open + 1 })).toBeNull();
    expect(matchIds(sim.state, open), "đổi hai lần phải về đúng chỗ cũ").toEqual(before);
  });

  it("người về sớm không còn tên trong trận đã ghim", () => {
    // Lỗi thật gặp khi chạy thử: đổi chỗ vòng làm các trận bị ghim, mà chỗ gỡ
    // người ra khỏi lịch lại lấy mốc `firstOpenRound` — hàm bỏ qua trận đã ghim.
    // Kết quả là người đã về vẫn còn tên trong lịch, cả sân đứng chờ một người
    // không có mặt.
    const sim = new EventSim({ seed: 37, config: { courts: 2 }, planning: FAST });
    sim.addPlayers(names(12));
    sim.start();
    sim.playRounds(2);

    const open = firstUnplayedRound(sim.state);
    sim.send({ type: "SwapRounds", roundA: open, roundB: open + 1 });

    const leaving = sim.state.matches.find(
      (m) => m.round === open && m.status === "scheduled",
    )!.teamA[0];
    sim.send({ type: "PlayerLeft", playerId: leaving });

    const left = sim.state.matches.filter(
      (m) => m.status === "scheduled" && [...m.teamA, ...m.teamB].includes(leaving),
    );
    expect(left, "người đã về vẫn còn trong lịch").toEqual([]);
    assertScheduleValid(sim.state);
  });

  it("cảnh báo chuỗi liên tiếp nhưng không chặn chủ sự kiện", () => {
    // Trần chuỗi là mức bộ xếp lịch cố giữ, không phải luật chơi. Chủ sự kiện có
    // lý do ngoài sân mà phần mềm không biết, nên họ phải được đọc cảnh báo rồi
    // tự quyết — chứ không bị khoá nút.
    const sim = new EventSim({ seed: 34, config: { courts: 3 }, planning: FAST });
    sim.addPlayers(names(11));
    sim.start();
    sim.playRounds(3);

    const open = firstUnplayedRound(sim.state);
    const v = validateRoundSwap(sim.state, open, open + 1, Date.now());
    expect(v.severity, "không bao giờ được chặn").not.toBe("block");
    expect(v.preview, "phải xem trước được").not.toBeNull();
  });

  it("không cảnh báo chuỗi khi trần đó vốn bất khả thi", () => {
    // 8 người trên 2 sân thì ai cũng phải đánh mọi vòng. Đem so với trần 3 vòng
    // trong cấu hình rồi báo đỏ là cảnh báo về một ràng buộc không ai thoả được.
    const sim = new EventSim({ seed: 35, config: { courts: 2 }, planning: FAST });
    sim.addPlayers(names(8));
    sim.start();
    sim.playRounds(2);

    const open = firstUnplayedRound(sim.state);
    const v = validateRoundSwap(sim.state, open, open + 1, Date.now());
    expect(v.notes.some((n) => /vòng liên tiếp/.test(n.message))).toBe(false);
    expect(v.severity).toBe("ok");
  });

  it("cảnh báo khi đổi chỗ đẩy ai đó vào vòng họ đã khai là vắng", () => {
    // Lỗi thật: `SwapRounds` ghi số vòng mới lên trận nhưng không đụng lời khai,
    // và nó cũng không kéo theo lần xếp lịch nào. Nên một trận rơi được vào đúng
    // cái vòng người trong đó đã khai là mình không có mặt, lặng lẽ.
    const sim = new EventSim({ seed: 41, config: { courts: 1 }, planning: FAST });
    const ids = sim.addPlayers(names(8));
    sim.start();

    const open = firstUnplayedRound(sim.state);
    const here = sim.state.matches.find((m) => m.round === open)!;
    const victim = here.teamA[0];

    // Khai đúng tới vòng đang tới. Vòng sau đó thì họ đã về.
    sim.send({
      type: "DeclareAvailability",
      playerId: victim,
      fromRound: null,
      toRound: open,
    });

    const v = validateRoundSwap(sim.state, open, open + 1, Date.now());
    const name = sim.state.players.find((p) => p.id === victim)!.name;
    // Khớp đúng câu về lời khai, không phải "có cảnh báo nào đó": cảnh báo chuỗi
    // liên tiếp cũng nhắc tên người và cũng là `warn`, nên bài này sẽ xanh vì lý
    // do sai nếu chỉ đếm số cảnh báo.
    const declared = v.notes.filter(
      (n) => n.severity === "warn" && /đã khai/.test(n.message),
    );
    expect(declared.length, "phải cảnh báo đúng một lần về lời khai").toBe(1);
    expect(declared[0]!.message).toContain(name);
    expect(declared[0]!.message).toMatch(new RegExp(`vòng ${open + 1}`));
    expect(v.severity, "cảnh báo chứ không chặn — chủ sự kiện tự quyết").toBe("warn");
    expect(v.preview).not.toBeNull();
    expect(ids).toContain(victim);
  });

  it("không cảnh báo lời khai khi trận không xê dịch qua ranh giới đó", () => {
    const sim = new EventSim({ seed: 42, config: { courts: 1 }, planning: FAST });
    sim.addPlayers(names(8));
    sim.start();

    const open = firstUnplayedRound(sim.state);
    const v = validateRoundSwap(sim.state, open, open + 1, Date.now());
    expect(v.notes.some((n) => /đã khai/.test(n.message))).toBe(false);
  });
});

describe("xem trước khi dời một trận", () => {
  /**
   * `validateMove` viết xong từ lâu nhưng chưa bài nào chạm tới, vì chưa nút nào
   * gọi nó. Nó là thứ duy nhất đứng giữa chủ sự kiện và một cú bấm làm hỏng lịch,
   * nên phải có lưới an toàn trước khi nối vào giao diện.
   */
  it("chặn với lý do rõ ràng khi trận đã đánh xong", () => {
    const sim = new EventSim({ seed: 51, config: { courts: 2 }, planning: FAST });
    sim.addPlayers(names(12));
    sim.start();
    sim.playRounds(2);

    const done = sim.state.matches.find((m) => m.status === "submitted")!;
    const v = validateMove(sim.state, done.id, 9, 1, Date.now());
    expect(v.severity).toBe("block");
    expect(v.preview).toBeNull();
    expect(v.notes[0]!.message).toMatch(/chưa đánh/);
  });

  it("chặn khi không tìm thấy trận", () => {
    const sim = new EventSim({ seed: 52, config: { courts: 2 }, planning: FAST });
    sim.addPlayers(names(8));
    sim.start();

    const v = validateMove(sim.state, "khong-co-that", 3, 1, Date.now());
    expect(v.severity).toBe("block");
    expect(v.notes[0]!.message).toMatch(/Không tìm thấy trận/);
  });

  it("chuyển nguyên văn lời từ chối của reduce lên hộp xác nhận", () => {
    // 8 người trên 2 sân: ai cũng đánh mọi vòng nên dời đâu cũng đụng người.
    const sim = new EventSim({ seed: 53, config: { courts: 2 }, planning: FAST });
    sim.addPlayers(names(8));
    sim.start();

    const target = sim.state.matches.find((m) => m.round === 2)!;
    const v = validateMove(sim.state, target.id, 1, 1, Date.now());
    expect(v.severity).toBe("block");
    expect(v.notes[0]!.message).toMatch(/phải đánh hai trận trong vòng/);
  });

  it("cho xem trước và báo trận sẽ bị ghim khi dời được", () => {
    // 6 người trên 1 sân: mỗi vòng chỉ 4 người ra sân nên còn chỗ để xoay.
    const sim = new EventSim({ seed: 54, config: { courts: 1 }, planning: FAST });
    sim.addPlayers(names(6));
    sim.start();

    const a = sim.state.matches.find((m) => m.round === 2)!;
    const b = sim.state.matches.find((m) => m.round === 3)!;
    const v = validateMove(sim.state, a.id, 3, b.court, Date.now());
    if (v.severity === "block") {
      // Hạt giống này vẫn có thể trùng người; khi đó lý do phải nói được ra.
      expect(v.notes[0]!.message).toMatch(/hai trận|đã đánh/);
      return;
    }

    expect(v.preview, "không chặn thì phải xem trước được").not.toBeNull();
    expect(v.notes.some((n) => /sẽ được ghim/.test(n.message))).toBe(true);
    // Xem trước là bản sao, không được đụng vào trạng thái thật.
    expect(sim.state.matches.find((m) => m.id === a.id)!.round).toBe(2);
    expect(v.preview!.matches.find((m) => m.id === a.id)!.round).toBe(3);
  });
});

/** Số trận của từng người, để khẳng định đổi chỗ không làm ai thiệt. */
function gamesPerPlayer(state: EventState): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of state.players) out[p.id] = 0;
  for (const m of state.matches) {
    if (m.status === "cancelled") continue;
    for (const id of [...m.teamA, ...m.teamB]) out[id] = (out[id] ?? 0) + 1;
  }
  return out;
}

/** Mã các trận trong một vòng, sắp theo sân. */
function matchIds(state: EventState, round: number): string[] {
  return state.matches
    .filter((m) => m.round === round)
    .sort((a, b) => a.court - b.court)
    .map((m) => m.id);
}

describe("tính tái lập", () => {
  it("cùng hạt giống cho ra cùng một lịch", () => {
    const a = runSession(13, 3, 6, 99);
    const b = runSession(13, 3, 6, 99);
    const shape = (sim: EventSim) =>
      sim.state.matches.map((m) => `${m.round}/${m.court}/${m.teamA}/${m.teamB}`);
    expect(shape(a)).toEqual(shape(b));
  });
});
