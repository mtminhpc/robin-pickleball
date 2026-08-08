/**
 * Những điều một buổi đánh luôn phải thoả, viết thành hàm thuần.
 *
 * Trả về **danh sách vấn đề** thay vì ném lỗi, để hai nơi dùng chung đúng một
 * bộ luật: `tests/invariants.ts` bọc lại bằng `expect`, còn `npm run scenarios`
 * in thẳng ra bảng. Nếu mỗi bên tự viết luật riêng thì sớm muộn bảng số trên màn
 * hình sẽ nói một đằng mà bộ kiểm thử canh một nẻo.
 */

import { isAvailableAt, type EventState, type PlayerId } from "../domain/types";
import { standingsFromState } from "../domain/standings";
import { achievableStreakCap, countsAsGame, fairnessReport } from "../scheduler/metrics";

export interface Problem {
  /** Tên luật bị vi phạm, để gom nhóm khi báo cáo. */
  rule: string;
  detail: string;
}

export interface CheckOptions {
  /** Mức lệch so với suất kỳ vọng còn chấp nhận được. */
  tolerance?: number;
  /** Nới trần chuỗi liên tiếp thêm mấy bậc, cho kịch bản có biến động giữa chừng. */
  streakAllowance?: number;
  /**
   * Danh sách người chơi có ổn định suốt buổi không.
   *
   * Chỉ khi ổn định thì "số trận chênh không quá 1" mới là luật đúng. Có người
   * tới trễ hay về sớm thì số trận thô LỆCH NHAU MỚI LÀ ĐÚNG, và ép chúng bằng
   * nhau chính là bất công.
   */
  stableRoster?: boolean;
}

/** Người chơi xuất hiện ở những vòng nào, tính cả lịch chưa đánh. */
export function roundsOf(state: EventState, id: PlayerId): number[] {
  const out = new Set<number>();
  for (const m of state.matches) {
    if (m.status === "cancelled") continue;
    if ([...m.teamA, ...m.teamB].includes(id)) out.add(m.round);
  }
  return [...out].sort((a, b) => a - b);
}

/** Chuỗi vòng đánh liên tiếp dài nhất, tính cả lịch chưa đánh. */
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

/** Ai đã thật sự ra sân và được tính trận — dùng làm mốc "không được biến mất". */
export function playersWithGames(state: EventState): Set<PlayerId> {
  const out = new Set<PlayerId>();
  for (const m of state.matches) {
    if (!countsAsGame(m)) continue;
    for (const id of [...m.teamA, ...m.teamB]) out.add(id);
  }
  return out;
}

/**
 * Bất biến cấu trúc: không ai đánh hai trận cùng vòng, không ai đứng hai vị trí
 * trong một trận, không sân nào bị xếp trùng, lịch không đứt quãng.
 *
 * Đây là loại lỗi tệ nhất vì lịch vẫn trông bình thường trên màn hình, tới lúc
 * ra sân mới phát hiện một người phải đứng hai chỗ.
 */
export function checkStructure(state: EventState): Problem[] {
  const out: Problem[] = [];
  const rounds = new Set(state.matches.map((m) => m.round));

  for (const round of rounds) {
    const inRound = state.matches.filter(
      (m) => m.round === round && m.status !== "cancelled",
    );
    const seen = new Map<PlayerId, number>();
    const courts = new Set<number>();

    for (const m of inRound) {
      const quad = [...m.teamA, ...m.teamB];
      if (new Set(quad).size !== 4) {
        out.push({
          rule: "cấu trúc",
          detail: `trận ${m.id} vòng ${round} có người đứng hai vị trí: ${quad.join(",")}`,
        });
      }
      for (const id of quad) seen.set(id, (seen.get(id) ?? 0) + 1);
      if (courts.has(m.court)) {
        out.push({ rule: "cấu trúc", detail: `vòng ${round} xếp trùng sân ${m.court}` });
      }
      courts.add(m.court);
    }

    for (const [id, count] of seen) {
      if (count > 1) {
        out.push({
          rule: "cấu trúc",
          detail: `vòng ${round}: ${nameOf(state, id)} bị xếp ${count} trận cùng lúc`,
        });
      }
    }
  }

  // Một vòng trống ở giữa sẽ bị tính là vòng ai cũng nghỉ, làm sai toàn bộ số
  // liệu công bằng.
  const sorted = [...rounds].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] !== sorted[i - 1]! + 1) {
      out.push({
        rule: "cấu trúc",
        detail: `lịch đứt quãng: sau vòng ${sorted[i - 1]} nhảy thẳng tới vòng ${sorted[i]}`,
      });
    }
  }

  const known = new Set(state.players.map((p) => p.id));
  for (const m of state.matches) {
    for (const id of [...m.teamA, ...m.teamB]) {
      if (!known.has(id)) {
        out.push({ rule: "cấu trúc", detail: `trận ${m.id} nhắc tới người lạ ${id}` });
      }
    }
  }
  return out;
}

/**
 * Không ai đánh liên tiếp quá trần — hoặc quá mức tốt nhất mà cấu hình cho phép.
 *
 * Với danh sách ổn định thì so thẳng vào số người đang chơi. Có người vào/ra
 * giữa chừng thì **không so như vậy được**: chuỗi đo trên cả buổi, mà số người
 * thì đã đổi mấy lần, nên một chuỗi dài có thể là hệ quả hợp lệ của lúc đông
 * người chứ không phải lỗi xếp lịch. Khi đó lấy trần rộng nhất mà bất kỳ cỡ
 * nhóm nào từng có thể biện minh — vượt qua cả mức đó thì chắc chắn là lỗi.
 */
export function checkStreak(
  state: EventState,
  allowance = 0,
  stableRoster = true,
): Problem[] {
  const active = state.players.filter((p) => p.status === "active").length;
  const courts = state.config.courts;

  let best: number;
  if (stableRoster) {
    best = achievableStreakCap(active, courts);
  } else {
    best = 0;
    for (let k = 4; k <= state.players.length; k++) {
      const c = achievableStreakCap(k, courts);
      if (!Number.isFinite(c)) return []; // có lúc ai cũng phải đánh mọi vòng
      best = Math.max(best, c);
    }
  }
  // Không còn suất nghỉ nào thì ai cũng phải đánh mọi vòng — không có gì để giữ.
  if (!Number.isFinite(best)) return [];

  const cap = Math.max(state.config.hardMaxConsecutive, best) + allowance;
  const out: Problem[] = [];
  for (const p of state.players) {
    if (p.presence.length === 0) continue;
    const streak = longestStreak(state, p.id);
    if (streak > cap) {
      out.push({
        rule: "chuỗi liên tiếp",
        detail: `${p.name} đánh ${streak} vòng liền, trần ${cap} (${active} người / ${courts} sân)`,
      });
    }
  }
  return out;
}

/**
 * Mức thiệt thòi so với suất kỳ vọng phải nhỏ.
 *
 * Cố ý đo `deficit` chứ không đo số trận thô: có người đến muộn hay về sớm thì
 * số trận thô lệch nhau là đúng, còn suất kỳ vọng thì không được lệch.
 */
export function checkFairShare(state: EventState, tolerance = 1.05): Problem[] {
  const out: Problem[] = [];
  const granted = new Map(state.players.map((p) => [p.id, p.catchUpCredit] as const));

  for (const p of fairnessReport(state).players) {
    // Dương là bị thiệt — đây mới là câu hỏi người chơi mở bảng ra để hỏi.
    if (p.deficit > tolerance) {
      out.push({
        rule: "suất kỳ vọng",
        detail: `${p.name} THIẾU ${p.deficit} suất (đánh ${p.games}, kỳ vọng ${p.expected})`,
      });
      continue;
    }
    // Âm là đánh nhiều hơn suất. Bất thường, TRỪ KHI chủ sân đã chủ động cấp
    // thêm suất đuổi kịp cho người này — lúc đó đánh vượt lên là đúng ý.
    if (p.deficit < -tolerance && (granted.get(p.playerId) ?? 0) === 0) {
      out.push({
        rule: "suất kỳ vọng",
        detail: `${p.name} đánh VƯỢT ${-p.deficit} suất mà không ai cấp thêm (đánh ${p.games}, kỳ vọng ${p.expected})`,
      });
    }
  }
  return out;
}

/** Danh sách ổn định thì số trận không được chênh quá 1. */
export function checkGameSpread(state: EventState, maxSpread = 1): Problem[] {
  const games = fairnessReport(state).players.map((p) => p.games);
  if (games.length === 0) return [];
  const spread = Math.max(...games) - Math.min(...games);
  if (spread <= maxSpread) return [];
  return [
    {
      rule: "chênh số trận",
      detail: `chênh ${spread} trận giữa người đánh nhiều nhất và ít nhất`,
    },
  ];
}

/**
 * **Đã ra sân thì không được biến mất.**
 *
 * Ai đã có trận được tính thì phải còn nguyên ở cả bảng Công bằng lẫn bảng Xếp
 * hạng, bất kể sau đó họ về, nghỉ tạm hay bị đổi trạng thái thế nào. README hứa
 * đúng điều này — "kết quả đã đánh giữ nguyên trong bảng xếp hạng" — và người
 * chơi mất tên khỏi bảng sau khi đã thắng là kiểu hỏng khó chối nhất.
 */
export function checkPlayedStayVisible(state: EventState): Problem[] {
  const out: Problem[] = [];
  const played = playersWithGames(state);
  if (played.size === 0) return out;

  const inFairness = new Set(fairnessReport(state).players.map((p) => p.playerId));
  const table = standingsFromState(state);
  const inStandings = new Set(
    [...table.main, ...table.provisional].map((r) => r.playerId),
  );

  for (const id of played) {
    if (!inFairness.has(id)) {
      out.push({
        rule: "đã đánh mà biến mất",
        detail: `${nameOf(state, id)} có trận đã tính nhưng không có trong bảng Công bằng`,
      });
    }
    if (!inStandings.has(id)) {
      out.push({
        rule: "đã đánh mà biến mất",
        detail: `${nameOf(state, id)} có trận đã tính nhưng không có trong bảng Xếp hạng`,
      });
    }
  }
  return out;
}

/**
 * Số trận trong bảng xếp hạng phải khớp với số trận thật trên lịch.
 *
 * Bắt kiểu lỗi ngược lại với cái trên: người còn trong bảng nhưng số liệu bị hụt.
 */
export function checkGameCounts(state: EventState): Problem[] {
  const actual = new Map<PlayerId, number>();
  for (const m of state.matches) {
    if (!countsAsGame(m)) continue;
    for (const id of [...m.teamA, ...m.teamB]) {
      actual.set(id, (actual.get(id) ?? 0) + 1);
    }
  }

  const out: Problem[] = [];
  for (const p of fairnessReport(state).players) {
    const real = actual.get(p.playerId) ?? 0;
    if (p.games !== real) {
      out.push({
        rule: "số trận sai",
        detail: `${p.name}: bảng ghi ${p.games} trận, lịch có ${real}`,
      });
    }
  }
  return out;
}

/**
 * **Lời khai trước phải được tôn trọng.**
 *
 * Ai đã báo "vòng 5 tôi mới tới" hoặc "tôi đánh tới vòng 8 thôi" thì không được
 * có tên trong lịch ngoài khoảng đó. Xếp rồi để cả sân đứng chờ một người đã nói
 * rõ là mình chưa đến là cách nhanh nhất khiến không ai thèm khai nữa.
 */
export function checkDeclaredAvailability(state: EventState): Problem[] {
  const out: Problem[] = [];
  for (const p of state.players) {
    if (!p.available) continue;
    for (const round of roundsOf(state, p.id)) {
      if (isAvailableAt(p, round)) continue;
      const w = p.available;
      out.push({
        rule: "khai trước bị bỏ qua",
        detail: `${p.name} khai có mặt vòng ${w.from}–${w.to ?? "hết"} nhưng bị xếp vào vòng ${round}`,
      });
    }
  }
  return out;
}

/** Chạy hết mọi luật một lượt. */
export function checkAll(state: EventState, opts: CheckOptions = {}): Problem[] {
  const out = [
    ...checkStructure(state),
    ...checkStreak(state, opts.streakAllowance ?? 0, opts.stableRoster ?? false),
    ...checkFairShare(state, opts.tolerance ?? 1.05),
    ...checkPlayedStayVisible(state),
    ...checkGameCounts(state),
    ...checkDeclaredAvailability(state),
  ];
  if (opts.stableRoster) out.push(...checkGameSpread(state));
  return out;
}

function nameOf(state: EventState, id: PlayerId): string {
  return state.players.find((p) => p.id === id)?.name ?? id;
}
