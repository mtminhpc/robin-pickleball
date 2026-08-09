/**
 * Tinh chỉnh phương án bằng tìm kiếm cục bộ (luyện kim mô phỏng).
 *
 * Sinh tham lam cho ra lịch dùng được nhưng chưa tối ưu — nhất là về mức độ đa
 * dạng bạn đôi, thứ đòi hỏi nhìn nhiều vòng cùng lúc mới cải thiện được. Bước này
 * thử hàng chục nghìn phép hoán đổi nhỏ, nhận ngay nếu tốt hơn và thỉnh thoảng
 * nhận cả bước xấu đi để thoát khỏi cực tiểu cục bộ.
 *
 * Chấp nhận bước xấu là điểm mấu chốt: nhiều cải thiện thật chỉ lộ ra sau hai
 * phép hoán đổi liên tiếp, mà phép thứ nhất thì trông có vẻ tệ hơn.
 */

import { Evaluator, type CostContext, type Plan, type Slot } from "./cost";
import type { Rng } from "./rng";

export interface OptimizeOptions {
  ctx: CostContext;
  rng: Rng;
  /** Số phép thử. Mặc định co giãn theo quy mô bài toán. */
  iterations?: number;
  /** Thời gian tối đa (mili-giây) để không giữ request quá lâu. */
  timeBudgetMs?: number;
}

export interface OptimizeResult {
  plan: Plan;
  cost: number;
  iterations: number;
  /** Số lần vượt trần số vòng liên tiếp trong phương án cuối. */
  hardViolations: number;
  elapsedMs: number;
}

export function optimize(plan: Plan, opts: OptimizeOptions): OptimizeResult {
  const started = Date.now();
  const evaluator = new Evaluator(opts.ctx);
  const n = opts.ctx.history.n;

  const movable = plan
    .map((round, r) => ({ r, slots: round.filter((s) => !s.frozen) }))
    .filter((x) => x.slots.length > 0)
    .map((x) => x.r);

  let current = clonePlan(plan);
  const opening = evaluator.breakdown(current);
  let currentCost = opening.total;
  let best = clonePlan(current);
  let bestCost = currentCost;

  if (movable.length === 0) {
    const bd = evaluator.breakdown(best);
    return {
      plan: best,
      cost: bd.total,
      iterations: 0,
      hardViolations: bd.hardViolations,
      elapsedMs: Date.now() - started,
    };
  }

  const iterations =
    opts.iterations ?? clamp(1500 * Math.max(n, 8), 8_000, 40_000);
  const budget = opts.timeBudgetMs ?? 400;
  // Nhiệt độ khởi đầu đặt theo thang chi phí thật, để cùng bộ tham số dùng được
  // cho cả nhóm 6 người lẫn nhóm 20 người. Cố ý bỏ phần phạt vượt trần ra ngoài:
  // nó lớn gấp nhiều bậc so với mọi thành phần khác, nếu tính vào thì nhiệt độ sẽ
  // cao tới mức những cải thiện thật (cân bằng số trận, đa dạng bạn đôi) bị nhận
  // hay bị loại gần như ngẫu nhiên.
  const t0 = Math.max(1, (opening.total - opening.hardStreak) * 0.002);

  let done = 0;
  for (let i = 0; i < iterations; i++) {
    done = i + 1;
    if ((i & 255) === 0 && Date.now() - started > budget) break;

    const undo = mutate(current, movable, opts.rng, n, opts.ctx);
    if (!undo) continue;

    const nextCost = evaluator.total(current);
    const delta = nextCost - currentCost;
    const temp = t0 * (1 - i / iterations);

    const accept =
      delta <= 0 || (temp > 0 && opts.rng.next() < Math.exp(-delta / temp));

    if (accept) {
      currentCost = nextCost;
      if (nextCost < bestCost) {
        bestCost = nextCost;
        best = clonePlan(current);
      }
    } else {
      undo();
    }
  }

  const bd = evaluator.breakdown(best);
  return {
    plan: best,
    cost: bd.total,
    iterations: done,
    hardViolations: bd.hardViolations,
    elapsedMs: Date.now() - started,
  };
}

// ---------------------------------------------------------------------------
// Các phép biến đổi
// ---------------------------------------------------------------------------

type Undo = () => void;

/**
 * Thực hiện một phép biến đổi ngẫu nhiên, trả về hàm hoàn tác.
 * Trả `null` khi phép biến đổi không áp dụng được (ví dụ vòng chỉ có một trận).
 */
function mutate(
  plan: Plan,
  movableRounds: number[],
  rng: Rng,
  n: number,
  ctx: CostContext,
): Undo | null {
  const roll = rng.next();
  if (roll < 0.35) return swapWithinRound(plan, movableRounds, rng);
  if (roll < 0.7) return swapWithBench(plan, movableRounds, rng, n, ctx);
  if (roll < 0.85) return repairPairing(plan, movableRounds, rng);
  return swapAcrossRounds(plan, movableRounds, rng, ctx);
}

/** Đổi chỗ hai người ở hai trận khác nhau trong cùng một vòng. */
function swapWithinRound(plan: Plan, rounds: number[], rng: Rng): Undo | null {
  const r = rng.pick(rounds);
  const slots = plan[r].filter((s) => !s.frozen);
  if (slots.length < 2) return null;

  const i = rng.int(slots.length);
  let j = rng.int(slots.length);
  if (i === j) j = (j + 1) % slots.length;

  const s1 = slots[i] as Slot;
  const s2 = slots[j] as Slot;
  const p1 = rng.int(4);
  const p2 = rng.int(4);

  const a = s1.quad[p1] as number;
  const b = s2.quad[p2] as number;
  s1.quad[p1] = b;
  s2.quad[p2] = a;

  return () => {
    s1.quad[p1] = a;
    s2.quad[p2] = b;
  };
}

/** Đổi một người đang đánh với một người đang nghỉ trong cùng vòng. */
function swapWithBench(
  plan: Plan,
  rounds: number[],
  rng: Rng,
  n: number,
  ctx: CostContext,
): Undo | null {
  const r = rng.pick(rounds);
  const round = plan[r];
  const slots = round.filter((s) => !s.frozen);
  if (slots.length === 0) return null;

  const onCourt = new Set<number>();
  for (const s of round) for (const q of s.quad) onCourt.add(q);
  if (onCourt.size >= n) return null;

  const bench: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!onCourt.has(i) && allowedAt(ctx, i, r)) bench.push(i);
  }
  if (bench.length === 0) return null;

  const slot = rng.pick(slots);
  const pos = rng.int(4);
  const out = slot.quad[pos] as number;
  const inn = rng.pick(bench);

  slot.quad[pos] = inn;
  return () => {
    slot.quad[pos] = out;
  };
}

/**
 * Giữ nguyên bốn người, đổi cách chia đội.
 * Rẻ nhưng hiệu quả: thường sửa được một cặp bị lặp mà không đụng gì khác.
 */
function repairPairing(plan: Plan, rounds: number[], rng: Rng): Undo | null {
  const r = rng.pick(rounds);
  const slots = plan[r].filter((s) => !s.frozen);
  if (slots.length === 0) return null;

  const slot = rng.pick(slots);
  const before = [...slot.quad] as [number, number, number, number];
  const [a, b, c, d] = before;

  // Ba cách chia bốn người thành hai đội; chọn ngẫu nhiên một cách khác hiện tại.
  const options: Array<[number, number, number, number]> = [
    [a, c, b, d],
    [a, d, b, c],
  ];
  const chosen = rng.pick(options);
  slot.quad = chosen;

  return () => {
    slot.quad = before;
  };
}

/**
 * Đổi một người ở vòng này lấy một người ở vòng khác.
 * Đây là phép duy nhất dịch chuyển được tải giữa các vòng, nên cần cho việc cân
 * bằng số trận khi có người vào hoặc rời cuộc giữa chừng.
 */
function swapAcrossRounds(
  plan: Plan,
  rounds: number[],
  rng: Rng,
  ctx: CostContext,
): Undo | null {
  if (rounds.length < 2) return null;
  const r1 = rng.pick(rounds);
  let r2 = rng.pick(rounds);
  if (r1 === r2) return null;

  const s1list = plan[r1].filter((s) => !s.frozen);
  const s2list = plan[r2].filter((s) => !s.frozen);
  if (s1list.length === 0 || s2list.length === 0) return null;

  const s1 = rng.pick(s1list);
  const s2 = rng.pick(s2list);
  const p1 = rng.int(4);
  const p2 = rng.int(4);
  const a = s1.quad[p1] as number;
  const b = s2.quad[p2] as number;
  if (a === b) return null;
  if (!allowedAt(ctx, b, r1) || !allowedAt(ctx, a, r2)) return null;

  // Một người không thể có hai trận trong cùng một vòng, và cũng không thể đứng
  // hai vị trí trong cùng một trận. Phải kiểm tra cả trận đang sửa chứ không chỉ
  // các trận khác: người nhận có thể đã ngồi sẵn ở vị trí khác của chính trận đó.
  if (inRound(plan[r1], b, s1, p1) || inRound(plan[r2], a, s2, p2)) return null;

  s1.quad[p1] = b;
  s2.quad[p2] = a;
  return () => {
    s1.quad[p1] = a;
    s2.quad[p2] = b;
  };
}

/** Có được xếp người này vào vị trí tương đối `round` trong cửa sổ không. */
function allowedAt(ctx: CostContext, player: number, round: number): boolean {
  const lookahead = ctx.lookahead;
  if (!lookahead) return true;
  const offset = player * lookahead + round;
  return !ctx.unavailable?.[offset] && !ctx.blockedBusy?.[offset];
}

/** Người này đã có mặt ở vòng chưa, bỏ qua đúng ô sắp bị ghi đè. */
function inRound(
  round: Slot[],
  player: number,
  slot: Slot,
  index: number,
): boolean {
  for (const s of round) {
    if (s === slot) {
      for (let i = 0; i < 4; i++) {
        if (i !== index && s.quad[i] === player) return true;
      }
      continue;
    }
    if (s.quad.includes(player)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------

function clonePlan(plan: Plan): Plan {
  return plan.map((round) =>
    round.map((s) => ({
      court: s.court,
      quad: [...s.quad] as [number, number, number, number],
      frozen: s.frozen,
      sourceId: s.sourceId,
    })),
  );
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}
