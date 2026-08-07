/**
 * Kiểm thử thuật toán xếp lịch.
 *
 * Yêu cầu số 1 của người dùng là "công bằng chính xác nhất có thể". Đó là một lời
 * hứa chứ không phải một tính năng, nên nó phải được đo tự động chứ không thể chỉ
 * nhìn mắt thường. Các bài dưới đây là bản dịch lời hứa đó ra khẳng định kiểm
 * chứng được.
 */

import { describe, expect, it } from "vitest";
import { fairnessReport } from "../lib/scheduler/metrics";
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
  it("người mới được ưu tiên nhiều hơn người đã chơi từ đầu", () => {
    const sim = new EventSim({ seed: 3, config: { courts: 2 }, planning: FAST });
    sim.addPlayers(names(12));
    sim.start();
    sim.playRounds(6);

    const newcomer = sim.joinMidEvent("Muộn");
    const before = countGames(sim, newcomer);
    sim.playRounds(8);

    assertScheduleValid(sim.state);
    assertStreakCap(sim.state, 1);

    // "Đuổi kịp" nghĩa là được chia nhiều suất hơn mức trung bình, không phải là
    // san bằng ngay lập tức. Với 13 người trên 2 sân, mức trung bình là 8/13 suất
    // mỗi vòng; người mới phải trên mức đó thì mới thực sự đang đuổi.
    const gained = countGames(sim, newcomer) - before;
    const average = (8 / 13) * 8;
    expect(gained, "người mới không được ưu tiên hơn mức trung bình").toBeGreaterThan(average);
  });

  it("người mới đuổi kịp dần chứ không vọt lên chiếm chỗ", () => {
    const sim = new EventSim({ seed: 3, config: { courts: 2 }, planning: FAST });
    sim.addPlayers(names(12));
    sim.start();
    sim.playRounds(6);

    const newcomer = sim.joinMidEvent("Muộn");
    const deficitAtJoin = deficitOf(sim, newcomer);
    sim.playRounds(10);

    // Khoản nợ phải teo dần...
    expect(deficitOf(sim, newcomer)).toBeLessThan(deficitAtJoin);
    // ...nhưng trần số vòng liên tiếp vẫn chặn, không cho họ đánh dồn tới kiệt sức.
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
});

describe("huỷ trận", () => {
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
    expect(error).toMatch(/hai trận cùng một vòng|đã có trận/);
  });
});

describe("tính tái lập", () => {
  it("cùng hạt giống cho ra cùng một lịch", () => {
    const a = runSession(13, 3, 6, 99);
    const b = runSession(13, 3, 6, 99);
    const shape = (sim: EventSim) =>
      sim.state.matches.map((m) => `${m.round}/${m.court}/${m.teamA}/${m.teamB}`);
    expect(shape(a)).toEqual(shape(b));
  });
});
