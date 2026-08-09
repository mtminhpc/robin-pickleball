/**
 * Sinh phương án khởi đầu cho cửa sổ xếp lịch.
 *
 * Cố ý làm đơn giản: chọn người theo mức thiệt thòi rồi ghép đôi thô. Phần tinh
 * chỉnh nằm ở `optimize.ts`. Chia việc như vậy khiến mỗi nửa dễ đọc và dễ kiểm
 * thử hơn nhiều so với một hàm tham lam thông minh nhưng khó dò.
 */

import type { Plan, Slot } from "./cost";
import type { History } from "./metrics";
import type { Rng } from "./rng";

export interface GenerateOptions {
  history: History;
  /** Số sân dùng được, đã trừ các sân bị trận đông cứng chiếm. */
  courts: number;
  rounds: number;
  softMax: number;
  hardMax: number;
  /** Trận không được xê dịch, theo chỉ số vòng trong cửa sổ. */
  frozenByRound: Map<number, Slot[]>;
  /**
   * Sân đã bị chiếm bởi một trận **không biểu diễn được thành `Slot`**.
   *
   * Xảy ra khi một trận đã đánh có mặt người nay không còn trong danh sách xếp
   * lịch: họ nghỉ tạm hoặc đã về, nên không có chỉ số trong `history`. Trận ấy
   * vẫn chiếm sân đó ở vòng đó — nó đã diễn ra rồi. Không giữ chỗ thì bước sinh
   * đặt thêm một trận nữa lên đúng sân ấy, và ba người bị gọi ra hai trận cùng
   * một lúc.
   */
  blockedByRound?: Map<number, { courts: Set<number>; busy: Set<number> }>;
  /** `n × rounds`, `1` là người này đã khai trước là không có mặt ở vòng đó. */
  unavailable?: Uint8Array;
  rng: Rng;
}

/**
 * Ước lượng mức thiệt thòi đang tích luỹ, cập nhật dần trong lúc sinh.
 * Đây là bản rút gọn của phép tính trong `cost.ts`, chỉ để xếp thứ tự ưu tiên.
 */
interface Running {
  deficit: Float64Array;
  playStreak: Int32Array;
  restStreak: Int32Array;
  partner: Int32Array;
}

export function generate(opts: GenerateOptions): Plan {
  const h = opts.history;
  const n = h.n;
  const run: Running = {
    deficit: Float64Array.from(h.deficit),
    playStreak: Int32Array.from(h.playStreak),
    restStreak: Int32Array.from(h.restStreak),
    partner: Int32Array.from(h.partner),
  };

  const plan: Plan = [];

  for (let r = 0; r < opts.rounds; r++) {
    const frozen = opts.frozenByRound.get(r) ?? [];
    const busy = new Set<number>();
    for (const s of frozen) for (const q of s.quad) busy.add(q);

    const takenCourts = new Set(frozen.map((s) => s.court));

    // Trận đã đánh mà có người nay không còn được xếp lịch: sân vẫn bị chiếm,
    // và những người đang chơi có mặt trong trận đó vẫn đang bận ở vòng này.
    const blocked = opts.blockedByRound?.get(r);
    if (blocked) {
      for (const c of blocked.courts) takenCourts.add(c);
      for (const q of blocked.busy) busy.add(q);
    }
    const freeCourts: number[] = [];
    for (let c = 1; c <= opts.courts; c++) {
      if (!takenCourts.has(c)) freeCourts.push(c);
    }

    const available: number[] = [];
    for (let i = 0; i < n; i++) {
      if (busy.has(i)) continue;
      // Đã báo trước là chưa tới (hoặc đã về) ở vòng này thì không xếp.
      if (opts.unavailable?.[i * opts.rounds + r]) continue;
      available.push(i);
    }

    const slotsToFill = Math.min(freeCourts.length, Math.floor(available.length / 4));
    const chosen = choosePlayers(available, slotsToFill * 4, run, opts);
    const matches = pairUp(chosen, freeCourts, run, n, opts.rng);

    plan.push([...frozen, ...matches].sort((a, b) => a.court - b.court));

    // Cập nhật ước lượng để vòng sau biết ai vừa đánh, ai vừa nghỉ.
    const played = new Set<number>();
    for (const s of plan[r]) for (const q of s.quad) played.add(q);

    let eligibleCount = 0;
    for (let i = 0; i < n; i++) {
      if (!opts.unavailable?.[i * opts.rounds + r] || played.has(i)) eligibleCount += 1;
    }
    const share =
      eligibleCount > 0 ? Math.min(1, (4 * plan[r].length) / eligibleCount) : 0;
    for (let i = 0; i < n; i++) {
      const eligible = !opts.unavailable?.[i * opts.rounds + r] || played.has(i);
      if (!eligible) {
        run.playStreak[i] = 0;
        run.restStreak[i] = 0;
        continue;
      }
      run.deficit[i] += share;
      if (played.has(i)) {
        run.deficit[i] -= 1;
        run.playStreak[i] += 1;
        run.restStreak[i] = 0;
      } else {
        run.restStreak[i] += 1;
        run.playStreak[i] = 0;
      }
    }
  }

  return plan;
}

/**
 * Chọn ai được đánh vòng này.
 *
 * Ai thiệt nhiều nhất được ưu tiên, nhưng người sắp chạm trần số vòng liên tiếp
 * bị đẩy xuống cuối hàng — đó là cách khoản "nợ" của người vào giữa chừng được
 * trả dần qua vài vòng thay vì bắt họ đánh liền tù tì tới kiệt sức.
 */
function choosePlayers(
  available: number[],
  count: number,
  run: Running,
  opts: GenerateOptions,
): number[] {
  const scored = available.map((i) => {
    let score = run.deficit[i];
    // Chờ càng lâu càng được ưu tiên, nhưng nhẹ thôi để không lấn át mức thiệt.
    score += run.restStreak[i] * 0.15;
    if (run.playStreak[i] >= opts.hardMax) score -= 1000;
    else if (run.playStreak[i] >= opts.softMax) score -= 0.75;
    // Nhiễu nhỏ để phá thế hoà mà không đảo lộn thứ tự thật.
    score += opts.rng.next() * 1e-3;
    return { i, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, count).map((s) => s.i);
}

/**
 * Chia những người đã chọn thành các trận, ưu tiên ghép người chưa từng đánh cặp.
 *
 * Tham lam theo cặp: lấy người thiệt nhất, ghép với người ít đánh cặp cùng nhất,
 * rồi ghép hai cặp thành một trận. Đủ tốt làm điểm xuất phát.
 */
function pairUp(
  chosen: number[],
  freeCourts: number[],
  run: Running,
  n: number,
  rng: Rng,
): Slot[] {
  const pool = rng.shuffle([...chosen]);
  const pairs: Array<[number, number]> = [];

  while (pool.length >= 2) {
    const a = pool.shift() as number;
    let bestIdx = 0;
    let bestCount = Infinity;
    for (let k = 0; k < pool.length; k++) {
      const c = run.partner[a * n + (pool[k] as number)];
      if (c < bestCount) {
        bestCount = c;
        bestIdx = k;
      }
    }
    const b = pool.splice(bestIdx, 1)[0] as number;
    pairs.push([a, b]);
  }

  const slots: Slot[] = [];
  for (let k = 0; k + 1 < pairs.length; k += 2) {
    const court = freeCourts[k / 2];
    if (court === undefined) break;
    const [a0, a1] = pairs[k] as [number, number];
    const [b0, b1] = pairs[k + 1] as [number, number];
    slots.push({ court, quad: [a0, a1, b0, b1], frozen: false });
  }
  return slots;
}
