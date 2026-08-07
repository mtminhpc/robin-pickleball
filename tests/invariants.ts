/**
 * Các bất biến mà mọi lịch thi đấu phải thoả, dùng chung cho toàn bộ test.
 *
 * Tách riêng để mỗi kịch bản kiểm thử chỉ cần gọi `assertScheduleValid` là kiểm
 * hết một lượt, thay vì mỗi bài tự viết lại và bỏ sót.
 */

import { expect } from "vitest";
import type { EventState, PlayerId } from "../lib/domain/types";
import { achievableStreakCap, fairnessReport } from "../lib/scheduler/metrics";

/** Người chơi xuất hiện ở vòng nào, tính trên cả lịch chưa đánh. */
export function roundsOf(state: EventState, id: PlayerId): number[] {
  const out = new Set<number>();
  for (const m of state.matches) {
    if (m.status === "cancelled") continue;
    if ([...m.teamA, ...m.teamB].includes(id)) out.add(m.round);
  }
  return [...out].sort((a, b) => a - b);
}

/** Chuỗi vòng đánh liên tiếp dài nhất, tính trên cả lịch chưa đánh. */
export function longestStreak(state: EventState, id: PlayerId): number {
  const last = state.matches.reduce((n, m) => Math.max(n, m.round), 0);
  const playing = new Set(roundsOf(state, id));
  let run = 0;
  let best = 0;
  for (let r = 1; r <= last; r++) {
    run = playing.has(r) ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}

/**
 * Bất biến cấu trúc: không ai đánh hai trận trong cùng một vòng, không ai đứng
 * hai vị trí trong cùng một trận, không có sân bị xếp trùng.
 *
 * Đây là loại lỗi tệ nhất vì lịch vẫn trông bình thường trên màn hình, chỉ tới
 * lúc ra sân mới phát hiện một người phải đứng hai chỗ.
 */
export function assertScheduleValid(state: EventState): void {
  const rounds = new Set(state.matches.map((m) => m.round));

  for (const round of rounds) {
    const inRound = state.matches.filter(
      (m) => m.round === round && m.status !== "cancelled",
    );

    const seen = new Map<PlayerId, number>();
    const courts = new Set<number>();

    for (const m of inRound) {
      const quad = [...m.teamA, ...m.teamB];
      expect(
        new Set(quad).size,
        `trận ${m.id} vòng ${round} có người đứng hai vị trí: ${quad.join(",")}`,
      ).toBe(4);

      for (const id of quad) seen.set(id, (seen.get(id) ?? 0) + 1);

      expect(courts.has(m.court), `vòng ${round} xếp trùng sân ${m.court}`).toBe(false);
      courts.add(m.court);
    }

    const duplicates = [...seen.entries()].filter(([, c]) => c > 1);
    expect(duplicates, `vòng ${round} có người đánh hai trận`).toEqual([]);
  }

  // Lịch không được có lỗ hổng: một vòng trống ở giữa sẽ bị tính là vòng ai cũng
  // nghỉ, làm sai toàn bộ số liệu công bằng.
  const sorted = [...rounds].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    expect(sorted[i], "lịch bị đứt quãng giữa các vòng").toBe(sorted[i - 1]! + 1);
  }

  // Mọi người trong lịch phải còn trong danh sách người chơi.
  const known = new Set(state.players.map((p) => p.id));
  for (const m of state.matches) {
    for (const id of [...m.teamA, ...m.teamB]) {
      expect(known.has(id), `trận ${m.id} nhắc tới người lạ ${id}`).toBe(true);
    }
  }
}

/**
 * Không ai được đánh liên tiếp quá trần cứng — hoặc quá mức tốt nhất mà số người
 * và số sân cho phép, nếu trần cứng là bất khả thi.
 *
 * `allowance` nới thêm một bậc cho các kịch bản có người vào hoặc rời cuộc giữa
 * chừng. Lúc đó quá khứ đã cố định còn số người vừa đổi, nên có thể tồn tại một
 * thế bí thật sự: bốn người cùng đang ở mức trần trong khi chỉ còn ba suất nghỉ.
 * Không thuật toán nào gỡ được, và nới đúng một bậc vẫn đủ chặt để bắt lỗi thật.
 */
export function assertStreakCap(state: EventState, allowance = 0): void {
  const active = state.players.filter((p) => p.status === "active").length;
  const best = achievableStreakCap(active, state.config.courts);
  if (!Number.isFinite(best)) return; // ai cũng phải đánh mọi vòng, không có gì để giữ

  const cap = Math.max(state.config.hardMaxConsecutive, best) + allowance;
  for (const p of state.players) {
    if (p.presence.length === 0) continue;
    const streak = longestStreak(state, p.id);
    expect(
      streak,
      `${p.name} đánh ${streak} vòng liên tiếp, trần là ${cap} (${active} người / ${state.config.courts} sân)`,
    ).toBeLessThanOrEqual(cap);
  }
}

/**
 * Mức thiệt thòi so với suất kỳ vọng phải nhỏ.
 *
 * Cố ý đo `deficit` chứ không đo số trận thô: khi có người đến muộn hoặc về sớm
 * thì số trận thô lệch nhau là đúng, còn suất kỳ vọng thì không được lệch.
 */
export function assertFairShare(state: EventState, tolerance = 1.05): void {
  const report = fairnessReport(state);
  for (const p of report.players) {
    expect(
      Math.abs(p.deficit),
      `${p.name} lệch ${p.deficit} so với suất kỳ vọng (${p.games} trận, kỳ vọng ${p.expected})`,
    ).toBeLessThanOrEqual(tolerance);
  }
}

/** Với danh sách người chơi ổn định, số trận không được chênh quá 1. */
export function assertGameSpread(state: EventState, maxSpread = 1): void {
  const report = fairnessReport(state);
  const games = report.players.map((p) => p.games);
  if (games.length === 0) return;
  const spread = Math.max(...games) - Math.min(...games);
  expect(
    spread,
    `số trận chênh ${spread}: ${report.players.map((p) => `${p.name}=${p.games}`).join(" ")}`,
  ).toBeLessThanOrEqual(maxSpread);
}
