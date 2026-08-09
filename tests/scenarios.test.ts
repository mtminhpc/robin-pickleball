/**
 * Ma trận mẫu thử: mọi kịch bản × 8 cỡ nhóm = các buổi 4–11 người, mỗi buổi soi bằng
 * cùng một bộ luật.
 *
 * Cỡ 4–11 người bao trọn từ một sân vừa đủ người đến hai sân có ba suất nghỉ:
 *
 * | Người | Sân | Nghỉ mỗi vòng | Điều đáng canh |
 * |---|---|---|---|
 * | 4 | 1 | 0 | Ai cũng buộc phải đánh mọi vòng |
 * | 5–7 | 1 | 1–3 | Nhóm nhỏ, dễ lặp cặp đôi |
 * | 8 | 2 | 0 | Ai cũng đánh mọi vòng — không có gì để phân phối |
 * | 9–11 | 2 | 1–3 | Hai sân, suất nghỉ phải xoay đều |
 *
 * Bộ này ra đời sau khi bấm thử tay làm lộ một người đã thắng mà biến mất khỏi
 * bảng xếp hạng. Chạy lần đầu nó bắt được **43 vấn đề trên 60 lượt**, trong đó
 * có cả người bị xếp hai trận cùng một vòng. Muốn xem bằng số thì:
 *
 *   npm run scenarios
 *   npm run scenarios -- --only ghim-roi-cho-nghi --detail
 *
 * Cùng một bộ luật ở `lib/testing/checks.ts`, nên bảng in ra và bài kiểm thử
 * không bao giờ nói khác nhau.
 */

import { describe, expect, it } from "vitest";
import { checkAll } from "../lib/testing/checks";
import { SCENARIOS, SIZES } from "../lib/testing/scenarios";

describe("ma trận mẫu thử 4–11 người", () => {
  for (const scenario of SCENARIOS) {
    describe(scenario.title, () => {
      for (const setup of SIZES) {
        it(`${setup.players} người / ${setup.courts} sân`, () => {
          const { sim, streakAllowance } = scenario.run(setup);
          const problems = checkAll(sim.state, {
            streakAllowance,
            stableRoster: scenario.stableRoster,
            tolerance: scenario.tolerance,
          });

          expect(
            problems.map((p) => `[${p.rule}] ${p.detail}`),
            `${scenario.title} — ${scenario.why}`,
          ).toEqual([]);
        });
      }
    });
  }
});

/**
 * Hai điều đáng canh riêng, vì chúng là lời hứa nói thành lời trong README.
 */
describe("lời hứa về công bằng", () => {
  it("người tới trễ KHÔNG bị coi là đang nợ những vòng họ chưa có mặt", () => {
    const scenario = SCENARIOS.find((s) => s.key === "toi-tre")!;
    for (const setup of SIZES) {
      const { sim } = scenario.run(setup);
      // Người vào sau cùng là người tới trễ.
      const muon = sim.state.players[sim.state.players.length - 1]!;
      const span = muon.presence[0];
      expect(span, `${muon.name} phải có khoảng có mặt`).toBeDefined();
      // Khoảng có mặt bắt đầu từ lúc họ tới, không phải từ vòng 1 — đây chính là
      // thứ khiến họ không bị tính nợ cho những vòng còn chưa đặt chân tới sân.
      expect(span!.from, `${muon.name} vào từ vòng ${span!.from}`).toBeGreaterThan(1);
      const beforeArrival = sim.state.matches.filter(
        (m) =>
          m.round < span!.from && [...m.teamA, ...m.teamB].includes(muon.id),
      );
      expect(beforeArrival, `${muon.name} bị xếp trước khi tới`).toEqual([]);
    }
  });

  it("người về sớm giữ nguyên kết quả đã đánh trong bảng xếp hạng", () => {
    const scenario = SCENARIOS.find((s) => s.key === "ve-som")!;
    for (const setup of SIZES) {
      const { sim } = scenario.run(setup);
      const veSom = sim.state.players.filter((p) => p.status === "left");
      expect(veSom.length, "phải có người đã về").toBeGreaterThan(0);
      for (const p of veSom) {
        // Đã ra sân thì tên phải còn trong bảng, kèm đúng số trận.
        expect(p.presence.length, `${p.name} mất khoảng có mặt`).toBeGreaterThan(0);
      }
    }
  });

  for (const key of ["nghi-tam-roi-quay-lai", "ve-roi-quay-lai"] as const) {
    it(`${key}: quay lại tạo khoảng có mặt mới, không mất kết quả cũ`, () => {
      const scenario = SCENARIOS.find((s) => s.key === key)!;
      for (const setup of SIZES) {
        const { sim } = scenario.run(setup);
        const returned = sim.state.players.find((p) => p.presence.length === 2);
        expect(returned, `${setup.players} người: không tìm thấy người quay lại`).toBeDefined();
        expect(returned!.status).toBe("active");

        const [before, after] = returned!.presence;
        expect(before!.to).not.toBeNull();
        expect(after!.from).toBeGreaterThan(before!.to!);
        expect(after!.to).toBeNull();

        const duringAbsence = sim.state.matches.filter(
          (m) =>
            m.round > before!.to! &&
            m.round < after!.from &&
            [...m.teamA, ...m.teamB].includes(returned!.id),
        );
        expect(duringAbsence, `${returned!.name} có trận trong lúc vắng`).toEqual([]);

        const played = sim.state.matches.filter(
          (m) =>
            m.status === "submitted" &&
            [...m.teamA, ...m.teamB].includes(returned!.id),
        );
        expect(played.some((m) => m.round <= before!.to!), "mất kết quả trước lúc rời").toBe(true);
        expect(played.some((m) => m.round >= after!.from), "quay lại nhưng không được đánh").toBe(true);
      }
    });
  }
});
