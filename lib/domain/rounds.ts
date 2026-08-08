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
  let lastFrozen = 0;
  for (const m of state.matches) {
    if (isFrozen(m)) {
      if (m.round > lastFrozen) lastFrozen = m.round;
      continue;
    }
    if (earliest === null || m.round < earliest) earliest = m.round;
  }

  const conTran = earliest ?? state.lastRound + 1;

  // Vòng RỖNG cũng là vòng còn mở.
  //
  // Trên một sân, mỗi vòng chỉ có đúng một trận. Người về sớm mà trận đó có tên
  // họ thì cả vòng biến mất khỏi lịch, và nếu chỉ đi tìm "trận chưa đông cứng
  // sớm nhất" thì mốc này nhảy thẳng qua chỗ trống đó. Hệ quả: bộ xếp lịch không
  // bao giờ quay lại lấp, lịch để lại một lỗ vĩnh viễn — sau vòng 6 nhảy tới
  // vòng 8 — và cái lỗ ấy bị mọi phép đếm hiểu thành "một vòng ai cũng nghỉ".
  return Math.min(conTran, lastFrozen + 1);
}

/**
 * Vòng sớm nhất chưa ai đánh.
 *
 * Khác `firstOpenRound` ở một điểm quan trọng: chỗ này hỏi "đã đánh chưa", còn
 * chỗ kia hỏi "thuật toán còn được xếp lại không". Một trận vừa bị chủ sự kiện
 * ghim là đông cứng với thuật toán nhưng vẫn chưa đánh, nên vẫn phải dời hay đổi
 * chỗ tiếp được — lấy nhầm hàm ở đây sẽ khoá luôn thao tác mà chính họ vừa làm.
 */
export function firstUnplayedRound(state: EventState): number {
  let earliest: number | null = null;
  for (const m of state.matches) {
    if (m.status !== "scheduled" && m.status !== "cancelled") continue;
    if (earliest === null || m.round < earliest) earliest = m.round;
  }
  return earliest ?? state.lastRound + 1;
}

/** Vòng này đã có trận đang đánh hoặc đã xong chưa. */
export function roundIsPlayed(state: EventState, round: number): boolean {
  return state.matches.some(
    (m) => m.round === round && m.status !== "scheduled" && m.status !== "cancelled",
  );
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
