/**
 * Hàm chi phí của một phương án xếp lịch.
 *
 * Thuật toán không "biết" thế nào là công bằng — nó chỉ đi tìm phương án có chi
 * phí thấp nhất. Vậy nên mọi định nghĩa công bằng nằm gọn trong file này, và đổi
 * hành vi của cả hệ thống chỉ cần đổi các trọng số bên dưới.
 *
 * Thứ tự ưu tiên được cài vào bằng độ lớn của trọng số:
 *   1. Không ai vượt trần số vòng đánh liên tiếp  (gần như ràng buộc cứng)
 *   2. Ai cũng được đánh đúng suất của mình        (mục tiêu chính)
 *   3. Không ai phải ngồi chờ quá lâu
 *   4. Càng nhiều bạn đôi và đối thủ khác nhau càng tốt
 */

import type { History } from "./metrics";

export interface Weights {
  /** Lệch suất đánh — mục tiêu chính, nên nặng nhất trong các mục tiêu mềm. */
  deficit: number;
  /** Lệch số lần nghỉ. Phần lớn trùng với `deficit`, để nhẹ cho chắc. */
  bye: number;
  /** Mỗi vòng đánh vượt ngưỡng mềm. */
  softStreak: number;
  /** Mỗi vòng đánh vượt trần cứng — lớn tới mức thực tế là cấm. */
  hardStreak: number;
  /** Xếp người vào vòng họ đã báo trước là không có mặt. */
  unavailable: number;
  /** Mỗi vòng nghỉ liên tiếp thứ hai trở đi. */
  restStreak: number;
  /** Tổng bình phương số lần cặp đôi lặp lại. */
  partner: number;
  /** Tổng bình phương số lần gặp lại đối thủ. */
  opponent: number;
  /** Tổng bình phương số lần đánh cùng một sân. */
  court: number;
}

export const DEFAULT_WEIGHTS: Weights = {
  deficit: 1000,
  bye: 100,
  softStreak: 120,
  hardStreak: 1_000_000,
  // Nặng hơn trần chuỗi: đánh liên tiếp nhiều vòng là mệt, còn thiếu người là
  // cả sân đứng chờ và không đánh được trận nào.
  unavailable: 5_000_000,
  restStreak: 200,
  partner: 60,
  opponent: 25,
  court: 5,
};

/** Một trận trong phương án. `quad` là [A1, A2, B1, B2] theo chỉ số người chơi. */
export interface Slot {
  court: number;
  quad: [number, number, number, number];
  /** Trận đã đánh, đang đánh, hoặc bị admin ghim — không được xê dịch. */
  frozen: boolean;
  /** Id trận có sẵn, để giữ nguyên khi ghi lại vào nhật ký. */
  sourceId?: string;
}

/** Phương án cho cửa sổ xếp lịch: `plan[i]` là các trận của vòng thứ i. */
export type Plan = Slot[][];

export interface CostContext {
  history: History;
  weights: Weights;
  softMax: number;
  hardMax: number;
  /** Số người có mặt trong suốt cửa sổ (dùng để tính suất kỳ vọng). */
  activeCount: number;
  /**
   * Ai KHÔNG nhận xếp lịch ở vòng nào, theo lời khai trước.
   *
   * Mảng phẳng `n × lookahead`, `1` là không có mặt. Bỏ trống nghĩa là không ai
   * khai gì — trường hợp của gần hết các buổi, và khi đó phần tính này được bỏ
   * qua hoàn toàn nên không tốn gì.
   */
  unavailable?: Uint8Array;
  /** Số vòng trong cửa sổ, để đọc `unavailable` cho đúng ô. */
  lookahead?: number;
}

export interface CostBreakdown {
  total: number;
  deficit: number;
  bye: number;
  softStreak: number;
  hardStreak: number;
  restStreak: number;
  partner: number;
  opponent: number;
  court: number;
  /** Số lần vượt trần cứng — dùng để báo "không thể đảm bảo" cho người dùng. */
  hardViolations: number;
}

/**
 * Bộ đánh giá chi phí có vùng nhớ tái dùng.
 *
 * Thuật toán gọi hàm này hàng chục nghìn lần, nên các mảng đếm được cấp phát một
 * lần rồi chép đè lại từ lịch sử ở mỗi lần tính. Cố ý tính lại toàn bộ chứ không
 * tính chênh lệch tăng dần: một lần tính chỉ vài chục micro-giây, trong khi tính
 * tăng dần rất dễ sai lệch âm thầm rồi cho ra lịch bất công mà không ai phát hiện.
 */
export class Evaluator {
  private readonly n: number;
  private readonly courts: number;
  private readonly games: Float64Array;
  private readonly byes: Float64Array;
  private readonly expected: Float64Array;
  private readonly partner: Int32Array;
  private readonly opponent: Int32Array;
  private readonly courtUse: Int32Array;
  private readonly playStreak: Int32Array;
  private readonly restStreak: Int32Array;
  private readonly playedThisRound: Uint8Array;

  constructor(readonly ctx: CostContext) {
    const h = ctx.history;
    this.n = h.n;
    this.courts = h.courts;
    this.games = new Float64Array(h.n);
    this.byes = new Float64Array(h.n);
    this.expected = new Float64Array(h.n);
    this.partner = new Int32Array(h.n * h.n);
    this.opponent = new Int32Array(h.n * h.n);
    this.courtUse = new Int32Array(h.n * h.courts);
    this.playStreak = new Int32Array(h.n);
    this.restStreak = new Int32Array(h.n);
    this.playedThisRound = new Uint8Array(h.n);
  }

  /** Chỉ tổng chi phí — đường nóng của vòng lặp tối ưu. */
  total(plan: Plan): number {
    return this.run(plan).total;
  }

  /** Tách nhỏ từng thành phần — dùng cho công cụ mô phỏng và khi chỉnh trọng số. */
  breakdown(plan: Plan): CostBreakdown {
    return this.run(plan);
  }

  private run(plan: Plan): CostBreakdown {
    const h = this.ctx.history;
    const n = this.n;
    const courts = this.courts;

    this.games.set(h.games);
    this.byes.set(h.byes);
    this.expected.set(h.expected);
    this.partner.set(h.partner);
    this.opponent.set(h.opponent);
    this.courtUse.set(h.courtUse);
    this.playStreak.set(h.playStreak);
    this.restStreak.set(h.restStreak);

    const {
      games,
      byes,
      expected,
      partner,
      opponent,
      courtUse,
      playStreak,
      restStreak,
      playedThisRound,
    } = this;

    let softStreakCount = 0;
    let hardStreakCount = 0;
    let restStreakCount = 0;
    let deficitAccum = 0;
    let unavailableCount = 0;

    const unavailable = this.ctx.unavailable;
    const lookahead = this.ctx.lookahead ?? plan.length;

    for (let r = 0; r < plan.length; r++) {
      const round = plan[r]!;
      playedThisRound.fill(0);

      const share =
        this.ctx.activeCount > 0
          ? Math.min(1, (4 * round.length) / this.ctx.activeCount)
          : 0;

      for (const slot of round) {
        const [a0, a1, b0, b1] = slot.quad;

        // Xếp ai vào vòng họ đã báo trước là không có mặt thì cả sân đứng chờ
        // một người chưa tới. Phạt nặng hơn cả trần chuỗi liên tiếp: chuỗi dài
        // là mệt, còn thiếu người là không đánh được.
        if (unavailable && !slot.frozen) {
          const base = r;
          if (unavailable[a0 * lookahead + base]) unavailableCount += 1;
          if (unavailable[a1 * lookahead + base]) unavailableCount += 1;
          if (unavailable[b0 * lookahead + base]) unavailableCount += 1;
          if (unavailable[b1 * lookahead + base]) unavailableCount += 1;
        }

        playedThisRound[a0] = 1;
        playedThisRound[a1] = 1;
        playedThisRound[b0] = 1;
        playedThisRound[b1] = 1;

        games[a0] += 1;
        games[a1] += 1;
        games[b0] += 1;
        games[b1] += 1;

        partner[a0 * n + a1] += 1;
        partner[a1 * n + a0] += 1;
        partner[b0 * n + b1] += 1;
        partner[b1 * n + b0] += 1;

        opponent[a0 * n + b0] += 1;
        opponent[b0 * n + a0] += 1;
        opponent[a0 * n + b1] += 1;
        opponent[b1 * n + a0] += 1;
        opponent[a1 * n + b0] += 1;
        opponent[b0 * n + a1] += 1;
        opponent[a1 * n + b1] += 1;
        opponent[b1 * n + a1] += 1;

        const c = slot.court < 1 ? 0 : Math.min(courts - 1, slot.court - 1);
        courtUse[a0 * courts + c] += 1;
        courtUse[a1 * courts + c] += 1;
        courtUse[b0 * courts + c] += 1;
        courtUse[b1 * courts + c] += 1;
      }

      for (let i = 0; i < n; i++) {
        expected[i] += share;
        if (playedThisRound[i]) {
          playStreak[i] += 1;
          restStreak[i] = 0;
          if (playStreak[i] > this.ctx.hardMax) hardStreakCount += 1;
          else if (playStreak[i] > this.ctx.softMax) softStreakCount += 1;
        } else {
          byes[i] += 1;
          restStreak[i] += 1;
          playStreak[i] = 0;
          if (restStreak[i] >= 2) restStreakCount += 1;
        }
      }

      // Đo lệch suất đánh ở CUỐI MỖI VÒNG chứ không chỉ cuối cửa sổ.
      //
      // Lịch được xếp theo cửa sổ trượt: mỗi lần chỉ một vòng được chốt, phần đuôi
      // sẽ xếp lại. Nếu chỉ cân bằng ở cuối cửa sổ, thuật toán sẵn sàng để vòng
      // đầu lệch nặng rồi hẹn bù ở vòng thứ năm — nhưng vòng đầu bị chốt ngay còn
      // vòng thứ năm thì bị xếp lại, nên lời hẹn đó không bao giờ được giữ.
      for (let i = 0; i < n; i++) {
        const d = expected[i] + h.credit[i] - games[i];
        deficitAccum += d * d;
      }
    }

    // Trung bình qua các vòng, để trọng số giữ nguyên ý nghĩa dù cửa sổ dài ngắn.
    const deficitSq = plan.length > 0 ? deficitAccum / plan.length : 0;

    let byeMean = 0;
    for (let i = 0; i < n; i++) byeMean += byes[i];
    byeMean = n > 0 ? byeMean / n : 0;

    let byeSq = 0;
    for (let i = 0; i < n; i++) {
      const d = byes[i] - byeMean;
      byeSq += d * d;
    }

    // Tổng bình phương: với tổng số lần gặp cố định, tổng bình phương nhỏ nhất khi
    // các lần gặp trải đều ra nhiều cặp khác nhau — không cần đặt ngưỡng thủ công.
    let partnerSq = 0;
    let opponentSq = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const pc = partner[i * n + j];
        const oc = opponent[i * n + j];
        partnerSq += pc * pc;
        opponentSq += oc * oc;
      }
    }

    let courtSq = 0;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < courts; c++) {
        const v = courtUse[i * courts + c];
        courtSq += v * v;
      }
    }

    const w = this.ctx.weights;
    const parts = {
      deficit: w.deficit * deficitSq,
      bye: w.bye * byeSq,
      softStreak: w.softStreak * softStreakCount,
      hardStreak: w.hardStreak * hardStreakCount,
      unavailable: w.unavailable * unavailableCount,
      restStreak: w.restStreak * restStreakCount,
      partner: w.partner * partnerSq,
      opponent: w.opponent * opponentSq,
      court: w.court * courtSq,
    };

    return {
      ...parts,
      hardViolations: hardStreakCount + unavailableCount,
      total:
        parts.deficit +
        parts.bye +
        parts.softStreak +
        parts.hardStreak +
        parts.unavailable +
        parts.restStreak +
        parts.partner +
        parts.opponent +
        parts.court,
    };
  }
}
