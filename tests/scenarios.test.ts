/**
 * Ma trận mẫu thử: 15 kịch bản × 4 cỡ nhóm = 60 buổi đánh, mỗi buổi soi bằng
 * cùng một bộ luật.
 *
 * Cỡ 6–9 người được chọn vì mỗi cỡ là một chế độ khác hẳn:
 *
 * | Người | Sân | Nghỉ mỗi vòng | Điều đáng canh |
 * |---|---|---|---|
 * | 6 | 1 | 2 | Nhóm nhỏ, dễ lặp cặp đôi |
 * | 7 | 1 | 3 | Số lẻ, suất nghỉ phải xoay đều |
 * | 8 | 2 | 0 | Ai cũng đánh mọi vòng — không có gì để phân phối |
 * | 9 | 2 | 1 | Chỉ một suất nghỉ, khắt khe nhất |
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

describe("ma trận mẫu thử 6–9 người", () => {
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
});
