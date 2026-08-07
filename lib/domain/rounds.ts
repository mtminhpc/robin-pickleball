/** Tiện ích về vòng đấu, dùng chung giữa reduce và scheduler. */

import type { EventState, Match } from "./types";
import { isFrozen } from "./types";

/**
 * Vòng sớm nhất mà thuật toán còn được phép xếp lại.
 *
 * Đây cũng là mốc "từ giờ trở đi" khi ai đó vào hoặc rời cuộc: một người vào lúc
 * này chỉ có thể bắt đầu đánh từ vòng này, nên suất kỳ vọng của họ tính từ đây.
 */
export function firstOpenRound(state: EventState): number {
  let earliest: number | null = null;
  for (const m of state.matches) {
    if (isFrozen(m)) continue;
    if (earliest === null || m.round < earliest) earliest = m.round;
  }
  return earliest ?? state.lastRound + 1;
}

/** Các trận thuộc một vòng, sắp theo số sân. */
export function matchesInRound(matches: Match[], round: number): Match[] {
  return matches
    .filter((m) => m.round === round)
    .sort((a, b) => a.court - b.court);
}

/** Số vòng đã sinh, kể cả vòng chưa đánh. */
export function roundNumbers(matches: Match[]): number[] {
  const seen = new Set<number>();
  for (const m of matches) seen.add(m.round);
  return [...seen].sort((a, b) => a - b);
}
