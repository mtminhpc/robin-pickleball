/**
 * Kiểm lại bảng lịch Whist từ đầu.
 *
 * Bảng trong `lib/scheduler/whist.ts` là dữ liệu do máy sinh ra — không ai đọc
 * mấy con số đó mà thấy được nó đúng hay sai. Bài kiểm thử này dựng lại toàn bộ
 * lịch rồi đếm, nên nếu có ai gõ nhầm một chữ số thì lộ ra ngay.
 *
 * Ba điều phải đúng, và điều thứ ba mới là điều dễ hỏng nhất:
 *   1. không ai đánh hai trận trong một vòng
 *   2. mỗi cặp bắt đôi đúng một lần, gặp nhau đúng hai lần
 *   3. số vòng nghỉ chia đều — vì đây là lời hứa công bằng, không phải chuyện đẹp
 */

import { describe, expect, it } from "vitest";
import { EventSim } from "../lib/testing/harness";
import { fairnessReport } from "../lib/scheduler/metrics";
import type { PlayerId } from "../lib/domain/types";
import {
  hasWhistDesign,
  whistPeriod,
  whistRound,
  type WhistQuad,
} from "../lib/scheduler/whist";

const SIZES = [4, 5, 8, 9, 12, 13, 16, 17, 20, 21];

function collect(players: number): WhistQuad[][] {
  const rounds: WhistQuad[][] = [];
  for (let r = 0; r < whistPeriod(players); r++) {
    const round = whistRound(players, r);
    expect(round, `${players} người, vòng ${r}`).not.toBeNull();
    rounds.push(round!);
  }
  return rounds;
}

describe("lịch Whist", () => {
  it.each(SIZES)("%i người: có lịch và đúng số vòng", (players) => {
    expect(hasWhistDesign(players)).toBe(true);
    // Chu kỳ đúng bằng số cặp chia cho số cặp mỗi vòng.
    const pairs = (players * (players - 1)) / 2;
    const perRound = Math.floor(players / 4) * 2;
    expect(whistPeriod(players)).toBe(pairs / perRound);
  });

  it.each(SIZES)("%i người: không ai đánh hai trận trong một vòng", (players) => {
    for (const round of collect(players)) {
      const seen = new Set<number>();
      for (const quad of round) {
        for (const x of quad) {
          expect(x, "chỉ số người chơi").toBeGreaterThanOrEqual(0);
          expect(x, "chỉ số người chơi").toBeLessThan(players);
          expect(seen.has(x), `người ${x} bị xếp hai trận`).toBe(false);
          seen.add(x);
        }
      }
      expect(round.length).toBe(Math.floor(players / 4));
    }
  });

  it.each(SIZES)("%i người: bắt cặp một lần, gặp nhau hai lần", (players) => {
    const partner = new Int32Array(players * players);
    const opponent = new Int32Array(players * players);
    for (const round of collect(players)) {
      for (const [a0, a1, b0, b1] of round) {
        for (const [x, y] of [[a0, a1], [b0, b1]]) {
          partner[x! * players + y!]! ++;
          partner[y! * players + x!]! ++;
        }
        for (const x of [a0, a1]) {
          for (const y of [b0, b1]) {
            opponent[x * players + y]!++;
            opponent[y * players + x]!++;
          }
        }
      }
    }
    for (let i = 0; i < players; i++) {
      for (let j = i + 1; j < players; j++) {
        expect(partner[i * players + j], `cặp ${i}-${j} đánh đôi`).toBe(1);
        expect(opponent[i * players + j], `cặp ${i}-${j} gặp nhau`).toBe(2);
      }
    }
  });

  it.each(SIZES)("%i người: số vòng nghỉ chia đều", (players) => {
    const byes = new Int32Array(players);
    for (const round of collect(players)) {
      const playing = new Set(round.flat());
      for (let i = 0; i < players; i++) if (!playing.has(i)) byes[i]!++;
    }
    const first = byes[0]!;
    for (let i = 1; i < players; i++) {
      expect(byes[i], `người ${i} nghỉ khác người 0`).toBe(first);
    }
    // 4×sân người thì không ai nghỉ; 4×sân+1 người thì mỗi người nghỉ đúng một lần.
    expect(first).toBe(players % 4 === 0 ? 0 : 1);
  });

  it("cỡ nhóm không có lịch thì trả null, không ném lỗi", () => {
    for (const players of [3, 6, 7, 10, 11, 14, 15, 18, 19, 22, 100]) {
      expect(hasWhistDesign(players), `${players} người`).toBe(false);
      expect(whistPeriod(players)).toBe(0);
      expect(whistRound(players, 0)).toBeNull();
    }
  });

  it("bảng chỉ phủ cỡ nhóm mà mọi sân đều kín", () => {
    // Điều kiện dùng được: `4×sân` người (ai cũng đánh) hoặc `4×sân + 1` (đúng
    // một người nghỉ). Cỡ nào khác thì bài toán không còn là Whist nữa.
    for (const v of SIZES) expect(v % 4, `${v} người`).toBeLessThanOrEqual(1);
  });

  it("vòng vượt chu kỳ thì quay lại từ đầu", () => {
    const period = whistPeriod(8);
    expect(whistRound(8, period)).toEqual(whistRound(8, 0));
    expect(whistRound(8, period * 3 + 2)).toEqual(whistRound(8, 2));
    // Vòng âm cũng phải trả đúng vòng chứ không phải mảng rỗng hay lỗi.
    expect(whistRound(8, -1)).toEqual(whistRound(8, period - 1));
  });
});

/**
 * Bảng đúng chưa đủ — phải chắc bộ xếp lịch THẬT SỰ dùng nó, và biết buông ra
 * đúng lúc. Buông sai chỗ thì hoặc mất hết lợi ích, hoặc tệ hơn: thiết kế đè lên
 * một ràng buộc quan trọng hơn nó.
 */
describe("lịch Whist trong bộ xếp lịch", () => {
  function soCapLap(sim: EventSim, ids: PlayerId[]): number {
    const idx = new Map(ids.map((id, i) => [id, i] as const));
    const seen = new Set<string>();
    let lap = 0;
    for (const m of sim.state.matches) {
      if (m.status !== "submitted" && m.status !== "playing") continue;
      for (const team of [m.teamA, m.teamB]) {
        const a = idx.get(team[0]);
        const b = idx.get(team[1]);
        if (a === undefined || b === undefined) continue;
        const key = [a, b].sort((x, y) => x - y).join(",");
        if (seen.has(key)) lap++;
        seen.add(key);
      }
    }
    return lap;
  }

  function choi(players: number, courts: number, rounds: number, code: string) {
    const sim = new EventSim({ code, config: { courts } });
    const ids = sim.addPlayers(
      Array.from({ length: players }, (_, i) => `P${i + 1}`),
    ) as PlayerId[];
    sim.start();
    sim.playRounds(rounds);
    return { sim, ids };
  }

  it.each([
    [8, 2, 7],
    [9, 2, 9],
    [12, 3, 11],
  ])(
    "%i người / %i sân, danh sách ổn định: không ai phải đánh đôi lại với ai",
    (players, courts, rounds) => {
      for (const code of ["WH0001", "WH0002", "WH0003"]) {
        const { sim, ids } = choi(players, courts, rounds, code);
        expect(soCapLap(sim, ids), `mã buổi ${code}`).toBe(0);
      }
    },
  );

  it("không đánh đổi công bằng để lấy đa dạng", () => {
    const { sim } = choi(9, 2, 9, "WH0004");
    for (const p of fairnessReport(sim.state).players) {
      expect(Math.abs(p.deficit), `${p.name} lệch suất`).toBeLessThan(1.05);
    }
  });

  it("có người khai vắng thì lời khai thắng, thiết kế phải nhường", () => {
    const sim = new EventSim({ code: "WH0005", config: { courts: 2 } });
    const ids = sim.addPlayers(
      Array.from({ length: 8 }, (_, i) => `P${i + 1}`),
    ) as PlayerId[];
    sim.start();
    // Thiết kế Wh(8) bắt cả tám người đánh mọi vòng. Lời khai này mâu thuẫn
    // trực tiếp với nó, nên nếu thiết kế còn được ép thì test đỏ.
    sim.send({
      type: "DeclareAvailability",
      playerId: ids[0]!,
      fromRound: 4,
      toRound: null,
    });
    sim.reschedule("rebuild");
    sim.playRounds(5);

    for (const m of sim.state.matches) {
      if (m.round >= 4) continue;
      expect(
        [...m.teamA, ...m.teamB].includes(ids[0]!),
        `vòng ${m.round} vẫn xếp người đã khai là chưa tới`,
      ).toBe(false);
    }
  });

  it("có người tới trễ thì nhường lại cho bộ tìm kiếm để nó trả nợ", () => {
    const sim = new EventSim({ code: "WH0006", config: { courts: 2 } });
    sim.addPlayers(Array.from({ length: 8 }, (_, i) => `P${i + 1}`));
    sim.start();
    sim.playRounds(3);
    // 8 thành 9 — vẫn có thiết kế cho cỡ này, nên đây đúng là chỗ dễ sai: ép
    // thiết kế vào thì người mới không bao giờ được ưu tiên trả nợ.
    sim.joinMidEvent("Muộn");
    sim.playRounds(6);

    for (const p of fairnessReport(sim.state).players) {
      expect(Math.abs(p.deficit), `${p.name} lệch suất`).toBeLessThan(1.05);
    }
  });
});

/**
 * Hai lớp chặn dưới đây từng không có bài nào canh — bỏ đi mà cả bộ vẫn xanh.
 * Chặn không ai canh thì sớm muộn cũng có người xoá nhầm, nên viết hẳn ra đây
 * hoàn cảnh mà thiếu nó là hỏng.
 */
describe("lịch Whist biết nhường khi hoàn cảnh đổi", () => {
  it("ai đó ghim một trận trái thiết kế thì bỏ hẳn thiết kế", () => {
    const sim = new EventSim({ code: "WH0007", config: { courts: 2 } });
    const ids = sim.addPlayers(
      Array.from({ length: 8 }, (_, i) => `P${i + 1}`),
    ) as PlayerId[];
    sim.start();

    // Đặt vào vòng 1 đúng các cặp mà thiết kế dành cho VÒNG 3, rồi ghim lại.
    // Nếu thiết kế vẫn được ép cho các vòng sau thì tới vòng 3 nó lại xếp đúng
    // những cặp này lần nữa, và có người phải đánh đôi lại với nhau.
    const vong3 = whistRound(8, 2)!;
    const conLai = [0, 1, 2, 3, 4, 5, 6, 7].filter(
      (i) => !vong3[0]!.includes(i),
    );
    sim.send({
      type: "SetSchedule",
      fromRound: 1,
      matches: [
        {
          id: "ghim-1",
          round: 1,
          court: 1,
          teamA: [ids[vong3[0]![0]]!, ids[vong3[0]![1]]!],
          teamB: [ids[vong3[0]![2]]!, ids[vong3[0]![3]]!],
        },
        {
          id: "ghim-2",
          round: 1,
          court: 2,
          teamA: [ids[conLai[0]!]!, ids[conLai[1]!]!],
          teamB: [ids[conLai[2]!]!, ids[conLai[3]!]!],
        },
      ],
    });
    for (const m of sim.state.matches.filter((x) => x.round === 1)) {
      sim.send({ type: "PinMatch", matchId: m.id, pinned: true });
    }
    sim.reschedule("rebuild");
    sim.playRounds(6);

    // Đúng một chu kỳ Wh(8) là 7 vòng, nên tới đây mọi cặp phải là cặp mới.
    expect(
      sim.state.matches.filter((x) => x.status === "submitted").length,
      "buổi đánh phải thật sự diễn ra",
    ).toBe(12);

    // Vòng 3 là chỗ thiết kế định dùng lại đúng cặp vừa bị mượn. Nếu thiết kế
    // vẫn bị ép thì hai người này đánh đôi hai lần trong khi còn 20 cặp chưa ai
    // được thử — đó là hại cụ thể mà lớp chặn ngăn được.
    const a = ids[vong3[0]![0]]!;
    const b = ids[vong3[0]![1]]!;
    const lai = sim.state.matches.some(
      (x) =>
        x.round === 3 &&
        [x.teamA, x.teamB].some((t) => t.includes(a) && t.includes(b)),
    );
    expect(lai, "vòng 3 xếp lại đúng cặp vừa đánh đôi ở vòng 1").toBe(false);
  });

  it("bật hệ số đuổi kịp thì người tới trễ được trả nợ, không bị thiết kế chặn", () => {
    const sim = new EventSim({
      code: "WH0008",
      config: { courts: 2, catchUpFactor: 1 },
    });
    sim.addPlayers(Array.from({ length: 8 }, (_, i) => `P${i + 1}`));
    sim.start();
    sim.playRounds(4);
    // 8 thành 9 — cỡ này VẪN có thiết kế, nên nếu không nhường thì các vòng sau
    // bị đông cứng theo thiết kế và khoản nợ của người mới không ai trả.
    const muon = sim.joinMidEvent("Muộn");
    sim.playRounds(5);

    const p = fairnessReport(sim.state).players.find((x) => x.playerId === muon)!;
    expect(p.deficit, "người tới trễ vẫn còn nợ chưa được trả").toBeLessThan(1.05);
  });
});
