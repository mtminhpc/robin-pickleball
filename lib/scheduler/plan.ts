/**
 * Điều phối việc xếp lịch: từ trạng thái sự kiện ra một lệnh `SetSchedule`.
 *
 * Có hai chế độ, khác nhau ở mức độ xáo trộn cho phép:
 *
 *   • `extend`  — giữ nguyên mọi trận đã xếp, chỉ sinh thêm các vòng còn thiếu ở
 *                 cuối cửa sổ. Dùng khi vừa đánh xong một vòng. Người chơi nhìn
 *                 lịch phía trước thấy y nguyên như lúc nãy, nên tin được nó.
 *
 *   • `rebuild` — xếp lại toàn bộ phần chưa đánh, nhưng khởi động từ chính lịch
 *                 hiện có (khởi động ấm) nên kết quả vẫn gần với lịch cũ. Dùng khi
 *                 có người vào hoặc rời cuộc, lúc đó xáo trộn là bắt buộc.
 *
 * Trận đang đánh và trận bị admin ghim luôn bất biến ở cả hai chế độ.
 */

import type { MatchSeed } from "../domain/commands";
import { firstOpenRound } from "../domain/rounds";
import type { EventState, Match, PlayerId } from "../domain/types";
import { DEFAULT_WEIGHTS, type CostContext, type Plan, type Slot, type Weights } from "./cost";
import { generate } from "./generate";
import { achievableStreakCap, buildHistory, type History } from "./metrics";
import { optimize, type OptimizeResult } from "./optimize";
import { makeRng, seedFrom } from "./rng";

export type PlanMode = "extend" | "rebuild";

export interface PlanOptions {
  mode?: PlanMode;
  /** Ghi đè số vòng cần có phía trước; mặc định lấy `lookaheadRounds`. */
  lookahead?: number;
  weights?: Partial<Weights>;
  iterations?: number;
  timeBudgetMs?: number;
  /** Hạt giống; mặc định suy từ mã sự kiện và số thứ tự lệnh. */
  seed?: number;
}

export interface PlanOutcome {
  fromRound: number;
  matches: MatchSeed[];
  /** Không xếp được vòng nào (thiếu người) — nêu lý do cho người dùng. */
  blocked: string | null;
  optimization: OptimizeResult | null;
  /** Có phương án nào buộc phải vượt trần số vòng liên tiếp không. */
  hardViolations: number;
}

export function planSchedule(
  state: EventState,
  options: PlanOptions = {},
): PlanOutcome {
  const mode = options.mode ?? "extend";
  const fromRound = firstOpenRound(state);
  const activeIds = state.players.filter((p) => p.status === "active").map((p) => p.id);

  if (activeIds.length < 4) {
    return {
      fromRound,
      matches: [],
      blocked: `Mới có ${activeIds.length} người đang chơi — cần ít nhất 4 người.`,
      optimization: null,
      hardViolations: 0,
    };
  }

  const courts = Math.max(1, state.config.courts);
  const usableCourts = Math.min(courts, Math.floor(activeIds.length / 4));
  if (usableCourts < 1) {
    return {
      fromRound,
      matches: [],
      blocked: `${activeIds.length} người không đủ cho một trận đôi.`,
      optimization: null,
      hardViolations: 0,
    };
  }

  const lookahead = Math.max(1, options.lookahead ?? state.config.lookaheadRounds);
  const history = buildHistory(state, activeIds);
  const index = history.index;

  // Các trận trong cửa sổ, chia theo mức độ được phép xê dịch.
  const horizonRounds: number[] = [];
  for (let r = fromRound; r < fromRound + lookahead; r++) horizonRounds.push(r);

  const existing = state.matches.filter(
    (m) => m.round >= fromRound && m.status !== "cancelled" && m.status !== "abandoned",
  );

  const frozenByRound = new Map<number, Slot[]>();
  const warmByRound = new Map<number, Slot[]>();
  /**
   * Trận mà `reduce` sẽ tự giữ lại khi áp lệnh `SetSchedule` (đang đánh hoặc bị
   * ghim). Không được phát lại chúng trong lệnh, nếu không sẽ có hai bản.
   */
  const keptByReduce = new Set<string>();
  /** Sân bị trận đã đánh chiếm mà không dựng được `Slot`. Xem `blockedByRound`. */
  const blockedByRound = new Map<number, { courts: Set<number>; busy: Set<number> }>();

  for (const m of existing) {
    const offsetOf = m.round - fromRound;
    const slot = toSlot(m, index);

    if (!slot) {
      // Trận nhắc tới người không còn được xếp lịch.
      //
      // Nếu nó CHƯA đánh thì bỏ qua là đúng: người kia đã về, trận đó sẽ được
      // xếp lại. Nhưng nếu nó ĐÃ đánh (hoặc đang đánh, hoặc bị ghim) thì bỏ qua
      // là mất dấu một cái sân đang bị chiếm — và bước sinh sẽ đặt chồng thêm
      // một trận nữa lên đúng sân ấy, gọi ba người ra hai trận cùng một lúc.
      const daDienRa = m.status !== "scheduled" || m.pinned;
      if (daDienRa && offsetOf >= 0 && offsetOf < lookahead) {
        const entry = blockedByRound.get(offsetOf) ?? {
          courts: new Set<number>(),
          busy: new Set<number>(),
        };
        entry.courts.add(m.court);
        for (const id of [...m.teamA, ...m.teamB]) {
          const i = index.get(id);
          if (i !== undefined) entry.busy.add(i);
        }
        blockedByRound.set(offsetOf, entry);
        keptByReduce.add(m.id);
      }
      continue;
    }

    const offset = offsetOf;
    if (offset < 0 || offset >= lookahead) continue;

    if (m.status !== "scheduled" || m.pinned) keptByReduce.add(m.id);

    // Ở chế độ `extend`, chỉ mấy vòng sát nút mới bị đông cứng. Nếu đông cứng tất
    // thì mỗi lần chỉ còn đúng một vòng mới để tối ưu, và thuật toán mất hẳn khả
    // năng nhìn xa — đúng lúc cần nhất là khi số người vừa khít số chỗ trên sân.
    const committed = m.round < fromRound + state.config.commitRounds;
    const immovable =
      m.status === "playing" ||
      m.pinned ||
      (mode === "extend" && m.status === "scheduled" && committed);

    const bucket = immovable ? frozenByRound : warmByRound;
    const list = bucket.get(offset) ?? [];
    list.push({ ...slot, frozen: immovable });
    bucket.set(offset, list);
  }

  // Nới ngưỡng tới mức khả thi thay vì hạ trọng số.
  //
  // Đòi hỏi một điều không thể rồi phạt thật nặng sẽ khiến tổng chi phí chỉ phản
  // ánh thứ không sửa được, và mọi mục tiêu còn lại chìm nghỉm. Đặt đúng ngưỡng
  // đạt được thì hình phạt lại có nghĩa: với 20 người trên 4 sân, "đừng quá 3
  // vòng" là bất khả thi nhưng "đừng quá 4 vòng" thì làm được, và ép đúng mức 4
  // tốt hơn nhiều so với buông cho tới 8.
  const best = achievableStreakCap(activeIds.length, courts);
  const weights = { ...DEFAULT_WEIGHTS, ...options.weights };
  if (!Number.isFinite(best)) {
    // Không ai nghỉ được thì hai hình phạt này chỉ còn là nhiễu.
    weights.softStreak = 0;
    weights.hardStreak = 0;
    weights.restStreak = 0;
  }

  const ctx: CostContext = {
    history,
    weights,
    softMax: Math.max(state.config.softMaxConsecutive, Number.isFinite(best) ? best : 0),
    hardMax: Math.max(state.config.hardMaxConsecutive, Number.isFinite(best) ? best : 0),
    activeCount: activeIds.length,
  };

  const seed = options.seed ?? seedFrom(`${state.code}:${state.seq}:${mode}`);
  const rng = makeRng(seed);

  const seeded = generate({
    history,
    courts,
    rounds: lookahead,
    softMax: ctx.softMax,
    hardMax: ctx.hardMax,
    frozenByRound: mergeWarmStart(frozenByRound, warmByRound, lookahead),
    blockedByRound,
    rng,
  });

  // Khởi động ấm: các trận lấy từ lịch cũ được đưa vào phương án ban đầu nhưng
  // KHÔNG bị đông cứng, nên thuật toán sửa được nếu cần mà vẫn bám sát lịch cũ.
  const start = unfreezeWarmStart(seeded, warmByRound);

  const result = optimize(start, {
    ctx,
    rng,
    iterations: options.iterations,
    timeBudgetMs: options.timeBudgetMs,
  });

  const matches = toSeeds(result.plan, history, fromRound, state.seq, keptByReduce);

  return {
    fromRound,
    matches,
    blocked: null,
    optimization: result,
    hardViolations: result.hardViolations,
  };
}


// ---------------------------------------------------------------------------

function toSlot(m: Match, index: Map<PlayerId, number>): Slot | null {
  const quad = [m.teamA[0], m.teamA[1], m.teamB[0], m.teamB[1]].map((id) =>
    index.get(id),
  );
  if (quad.some((q) => q === undefined)) return null;
  return {
    court: m.court,
    quad: quad as [number, number, number, number],
    frozen: false,
    sourceId: m.id,
  };
}

/**
 * Gộp trận đông cứng và trận khởi động ấm để bước sinh biết chỗ nào đã có người.
 * Cả hai đều được đánh dấu đông cứng ở bước này, rồi `unfreezeWarmStart` mở khoá
 * lại nhóm thứ hai — nhờ vậy bước sinh không xếp trùng chỗ.
 */
function mergeWarmStart(
  frozen: Map<number, Slot[]>,
  warm: Map<number, Slot[]>,
  lookahead: number,
): Map<number, Slot[]> {
  const merged = new Map<number, Slot[]>();
  for (let r = 0; r < lookahead; r++) {
    const list = [...(frozen.get(r) ?? []), ...(warm.get(r) ?? [])];
    if (list.length > 0) merged.set(r, list.map((s) => ({ ...s, frozen: true })));
  }
  return merged;
}

/** Mở khoá lại các trận chỉ dùng để khởi động ấm. */
function unfreezeWarmStart(plan: Plan, warm: Map<number, Slot[]>): Plan {
  const warmIds = new Set<string>();
  for (const list of warm.values()) {
    for (const s of list) if (s.sourceId) warmIds.add(s.sourceId);
  }
  return plan.map((round) =>
    round.map((s) =>
      s.sourceId && warmIds.has(s.sourceId) ? { ...s, frozen: false } : s,
    ),
  );
}

/**
 * Đổi phương án về dạng lệnh.
 *
 * Trận giữ nguyên vị trí thì giữ nguyên id để giao diện không nhấp nháy và để
 * trận đã ghim không bị mất dấu. Trận mới nhận id có kèm số thứ tự lệnh, nên
 * không bao giờ đụng id của một trận cũ đã bị dời đi chỗ khác.
 */
function toSeeds(
  plan: Plan,
  history: History,
  fromRound: number,
  seq: number,
  keptByReduce: Set<string>,
): MatchSeed[] {
  const out: MatchSeed[] = [];
  plan.forEach((round, offset) => {
    const roundNo = fromRound + offset;
    for (const slot of round) {
      if (slot.sourceId && keptByReduce.has(slot.sourceId)) continue;
      const [a0, a1, b0, b1] = slot.quad;
      out.push({
        id: slot.sourceId ?? `m${seq}-${roundNo}-${slot.court}`,
        round: roundNo,
        court: slot.court,
        teamA: [history.ids[a0] as PlayerId, history.ids[a1] as PlayerId],
        teamB: [history.ids[b0] as PlayerId, history.ids[b1] as PlayerId],
      });
    }
  });
  return out.sort((a, b) => a.round - b.round || a.court - b.court);
}
