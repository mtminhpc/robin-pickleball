/**
 * Kiểm tra hậu quả của việc dời lịch bằng tay.
 *
 * Chủ sự kiện có toàn quyền dời trận, nhưng phải thấy trước mình vừa làm gì.
 * Hàm ở đây mô phỏng thay đổi rồi so số liệu công bằng trước/sau, và diễn giải
 * chênh lệch thành câu tiếng Việt để hiện ngay trên hộp xác nhận.
 */

import { apply } from "../domain/reduce";
import { isAvailableAt } from "../domain/types";
import type { EventState, PlayerId, PresenceSpan } from "../domain/types";
import { achievableStreakCap, buildHistory } from "./metrics";

export type Severity = "ok" | "warn" | "block";

export interface ValidationNote {
  severity: Severity;
  message: string;
}

export interface MoveValidation {
  /** `block` nghĩa là lệnh sẽ bị từ chối, không phải chỉ cảnh báo. */
  severity: Severity;
  notes: ValidationNote[];
  /** Trạng thái giả định sau khi dời, để giao diện xem trước. */
  preview: EventState | null;
}

export function validateMove(
  state: EventState,
  matchId: string,
  toRound: number,
  toCourt: number,
  now: number,
): MoveValidation {
  const notes: ValidationNote[] = [];

  const match = state.matches.find((m) => m.id === matchId);
  if (!match) {
    return {
      severity: "block",
      notes: [{ severity: "block", message: "Không tìm thấy trận." }],
      preview: null,
    };
  }
  if (match.status !== "scheduled") {
    return {
      severity: "block",
      notes: [{ severity: "block", message: "Chỉ dời được trận chưa đánh." }],
      preview: null,
    };
  }

  const outcome = apply(state, {
    id: `preview-${matchId}-${toRound}-${toCourt}`,
    at: now,
    actor: { kind: "admin", label: "xem trước" },
    command: { type: "ReorderMatch", matchId, toRound, toCourt },
  });

  if (!outcome.ok) {
    return {
      severity: "block",
      notes: [{ severity: "block", message: outcome.error }],
      preview: null,
    };
  }

  const after = outcome.value;
  const affected = collectAffected(state, after);
  const before = projectFairness(state, affected);
  const later = projectFairness(after, affected);

  const nameOf = new Map(state.players.map((p) => [p.id, p.name] as const));
  const { soft, hard } = streakCaps(state);

  for (const id of affected) {
    const b = before.get(id);
    const a = later.get(id);
    if (!b || !a) continue;
    const name = nameOf.get(id) ?? id;

    if (a.longestPlayStreak > b.longestPlayStreak && a.longestPlayStreak > soft) {
      const blocked = a.longestPlayStreak > hard;
      notes.push({
        severity: blocked ? "block" : "warn",
        message:
          blocked
            ? `${name} sẽ phải đánh ${a.longestPlayStreak} vòng liên tiếp — quá trần ${hard} vòng.`
            : `${name} sẽ phải đánh ${a.longestPlayStreak} vòng liên tiếp.`,
      });
    }
    if (a.longestRestStreak > b.longestRestStreak && a.longestRestStreak >= 3) {
      notes.push({
        severity: "warn",
        message: `${name} sẽ phải nghỉ ${a.longestRestStreak} vòng liền.`,
      });
    }
  }

  const prefixRound = Math.min(match.round, toRound);
  const beforeGap = playedPrefixGap(state, prefixRound);
  const afterGap = playedPrefixGap(after, prefixRound);
  if (afterGap > beforeGap && afterGap > 1) {
    notes.push({
      severity: "block",
      message: `Đổi vị trí làm chênh số trận trong tiền tố tăng từ ${beforeGap} lên ${afterGap}.`,
    });
  }
  const diversity = diversityDelta(state, after, matchId, prefixRound);
  if (diversity > 0) {
    notes.push({
      severity: "warn",
      message: `Độ lặp đồng đội/đối thủ trong phần lịch sớm tăng ${diversity} lượt.`,
    });
  }
  const courtDelta = courtImbalanceDelta(state, after, affected, prefixRound);
  if (courtDelta > 0) {
    notes.push({
      severity: "warn",
      message: `Độ lệch phân bổ sân trong phần lịch sớm tăng ${courtDelta} lượt.`,
    });
  }
  notes.push({
    severity: "ok",
    message: `Đã đối chiếu deficit/catch-up của những người bị ảnh hưởng (tổng ưu tiên ${catchUpPriority(state, affected).toFixed(2)}).`,
  });

  if (notes.length === 0) {
    notes.push({ severity: "ok", message: "Không ai bị ảnh hưởng xấu." });
  }
  notes.push({
    severity: "ok",
    message: "Trận này sẽ được ghim — hệ thống không tự xếp lại nó nữa.",
  });

  const severity: Severity = notes.some((x) => x.severity === "block")
    ? "block"
    : notes.some((x) => x.severity === "warn")
      ? "warn"
      : "ok";

  return { severity, notes, preview: severity === "block" ? null : after };
}

/**
 * Kiểm tra dời một trận tương lai lên lượt sân bổ sung của vòng hiện tại.
 * Khác dời tay cũ, vi phạm trần chuỗi hoặc chênh số trận là lỗi cứng: không có
 * nút cưỡng ép vì bốn người được ưu tiên lúc này lấy trực tiếp lượt của người khác.
 */
export function validatePromoteMatch(
  state: EventState,
  matchId: string,
  toRound: number,
  toCourt: number,
  startNow: boolean,
  now: number,
): MoveValidation {
  const outcome = apply(state, {
    id: `preview-promote-${matchId}-${toRound}-${toCourt}`,
    at: now,
    actor: { kind: "admin", label: "xem trước" },
    command: { type: "PromoteMatch", matchId, toRound, toCourt, startNow },
  });
  if (!outcome.ok) {
    return { severity: "block", notes: [{ severity: "block", message: outcome.error }], preview: null };
  }

  const after = outcome.value;
  const match = state.matches.find((item) => item.id === matchId)!;
  const affected = [...match.teamA, ...match.teamB];
  const beforeProjection = projectFairness(state, affected);
  const afterProjection = projectFairness(after, affected);
  const names = new Map(state.players.map((player) => [player.id, player.name] as const));
  const { hard } = streakCaps(state);
  const notes: ValidationNote[] = [];

  for (const id of affected) {
    const before = beforeProjection.get(id);
    const later = afterProjection.get(id);
    if (!before || !later) continue;
    if (later.longestPlayStreak > before.longestPlayStreak && later.longestPlayStreak > hard) {
      notes.push({
        severity: "block",
        message: `${names.get(id) ?? id} sẽ phải đánh ${later.longestPlayStreak} vòng liên tiếp, vượt trần công bằng ${hard}.`,
      });
    }
  }

  const beforeGap = playedPrefixGap(state, toRound);
  const afterGap = playedPrefixGap(after, toRound);
  if (afterGap > beforeGap && afterGap > 1) {
    notes.push({
      severity: "block",
      message: `Dời trận làm chênh số trận trong tiền tố tăng từ ${beforeGap} lên ${afterGap}.`,
    });
  }
  const diversity = diversityDelta(state, after, matchId, toRound);
  if (diversity > 0) {
    notes.push({
      severity: "warn",
      message: `Độ lặp đồng đội/đối thủ trong phần lịch sớm tăng ${diversity} lượt; hệ thống sẽ bù ở lịch tương lai chưa chốt.`,
    });
  }
  const courtDelta = courtImbalanceDelta(state, after, affected, toRound);
  if (courtDelta > 0) {
    notes.push({
      severity: "warn",
      message: `Độ lệch phân bổ sân của bốn người tăng ${courtDelta} lượt; lịch tương lai sẽ ưu tiên bù sân ít được chơi.`,
    });
  }
  const priority = catchUpPriority(state, affected);
  notes.push({
    severity: "ok",
    message: `Đã đối chiếu deficit/catch-up hiện tại của bốn người (tổng ưu tiên ${priority.toFixed(2)}).`,
  });
  if (notes.length === 0) {
    notes.push({ severity: "ok", message: "Trận hợp lệ để đưa lên; không trùng người/sân và không làm xấu chênh số trận." });
  }
  notes.push({ severity: "ok", message: "Cặp đấu giữ nguyên; chỉ lịch tương lai chưa chốt được xếp bù lại." });
  const severity: Severity = notes.some((note) => note.severity === "block")
    ? "block"
    : notes.some((note) => note.severity === "warn") ? "warn" : "ok";
  return { severity, notes, preview: severity === "block" ? null : after };
}

export function suggestedPromotions(
  state: EventState,
  toRound: number,
  toCourt: number,
  now: number,
): Array<{ matchId: string; validation: MoveValidation }> {
  return state.matches
    .filter((match) => match.status === "scheduled" && match.round > toRound)
    .map((match) => ({
      matchId: match.id,
      validation: validatePromoteMatch(state, match.id, toRound, toCourt, false, now),
    }))
    .filter((item) => item.validation.severity !== "block")
    .sort((a, b) => {
      const severity = Number(a.validation.severity === "warn") - Number(b.validation.severity === "warn");
      if (severity !== 0) return severity;
      const am = state.matches.find((match) => match.id === a.matchId)!;
      const bm = state.matches.find((match) => match.id === b.matchId)!;
      const priority = catchUpPriority(state, [...bm.teamA, ...bm.teamB]) -
        catchUpPriority(state, [...am.teamA, ...am.teamB]);
      if (priority !== 0) return priority;
      return am.round - bm.round || am.court - bm.court;
    });
}

function playedPrefixGap(state: EventState, round: number): number {
  const counts = state.players
    .filter((player) => player.status === "active" && isAvailableAt(player, round))
    .map((player) => state.matches.filter(
      (match) =>
        match.round <= round &&
        match.status !== "cancelled" &&
        match.status !== "abandoned" &&
        [...match.teamA, ...match.teamB].includes(player.id),
    ).length);
  return counts.length === 0 ? 0 : Math.max(...counts) - Math.min(...counts);
}

function diversityDelta(before: EventState, after: EventState, matchId: string, round: number): number {
  const target = before.matches.find((match) => match.id === matchId);
  if (!target) return 0;
  const repetitions = (state: EventState) => {
    const partner = new Map<string, number>();
    const opponent = new Map<string, number>();
    for (const match of state.matches.filter((item) => item.round <= round && item.status !== "cancelled")) {
      for (const team of [match.teamA, match.teamB]) {
        const key = [...team].sort().join(":");
        partner.set(key, (partner.get(key) ?? 0) + 1);
      }
      for (const left of match.teamA) for (const right of match.teamB) {
        const key = [left, right].sort().join(":");
        opponent.set(key, (opponent.get(key) ?? 0) + 1);
      }
    }
    return [...partner.values(), ...opponent.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
  };
  return Math.max(0, repetitions(after) - repetitions(before));
}

/** Độ lệch sân lớn nhất của nhóm trong tiền tố vừa được rút ngắn. */
function courtImbalanceDelta(
  before: EventState,
  after: EventState,
  ids: PlayerId[],
  round: number,
): number {
  const spread = (state: EventState, id: PlayerId) => {
    const uses = Array.from({ length: Math.max(1, state.config.courts) }, () => 0);
    for (const match of state.matches) {
      if (
        match.round > round ||
        match.status === "cancelled" ||
        match.status === "abandoned" ||
        ![...match.teamA, ...match.teamB].includes(id)
      ) continue;
      uses[Math.min(uses.length - 1, Math.max(0, match.court - 1))]! += 1;
    }
    return Math.max(...uses) - Math.min(...uses);
  };
  return Math.max(
    0,
    ...ids.map((id) => spread(after, id) - spread(before, id)),
  );
}

/** Ưu tiên thật mà scheduler dùng: suất kỳ vọng + credit đuổi kịp − số trận. */
function catchUpPriority(state: EventState, ids: PlayerId[]): number {
  const activeIds = state.players
    .filter((player) => player.status === "active")
    .map((player) => player.id);
  const history = buildHistory(state, activeIds);
  return ids.reduce((sum, id) => {
    const index = history.index.get(id);
    return sum + (index === undefined ? 0 : history.deficit[index]!);
  }, 0);
}

/**
 * Kiểm tra hậu quả của việc đổi chỗ hai vòng.
 *
 * Đổi cả vòng không bao giờ làm ai thừa hay thiếu trận, nên phần lớn thứ đáng
 * cảnh báo chỉ còn là chuỗi đánh liên tiếp và chuỗi ngồi chờ.
 *
 * Trừ một thứ nữa: **lời khai có mặt**. `SwapRounds` ghi số vòng mới lên trận
 * nhưng không đụng `player.available`, và nó cũng không kéo theo lần xếp lịch
 * nào (`rescheduleMode` trả `null` cho lệnh dời tay). Nên một trận có thể lặng
 * lẽ rơi vào đúng cái vòng mà người trong đó đã khai là mình không có mặt, và
 * không có bước nào kiểm lại. Hậu quả không dừng ở chỗ họ đứng chờ hụt:
 * `buildHistory` loại họ khỏi `present` ở vòng đó trong khi trận vẫn tính vào
 * `games`, nên phần "lệch" của họ âm giả và thuật toán đi bù trừ nhầm về sau.
 */
export function validateRoundSwap(
  state: EventState,
  roundA: number,
  roundB: number,
  now: number,
): MoveValidation {
  const outcome = apply(state, {
    id: `preview-swap-${roundA}-${roundB}`,
    at: now,
    actor: { kind: "admin", label: "xem trước" },
    command: { type: "SwapRounds", roundA, roundB },
  });

  if (!outcome.ok) {
    return {
      severity: "block",
      notes: [{ severity: "block", message: outcome.error }],
      preview: null,
    };
  }

  const after = outcome.value;
  const affected = collectAffected(state, after);
  const before = projectFairness(state, affected);
  const later = projectFairness(after, affected);

  const nameOf = new Map(state.players.map((p) => [p.id, p.name] as const));
  const { soft, hard } = streakCaps(state);
  const notes: ValidationNote[] = [];

  for (const id of affected) {
    const b = before.get(id);
    const a = later.get(id);
    if (!b || !a) continue;
    const name = nameOf.get(id) ?? id;

    if (a.longestPlayStreak > b.longestPlayStreak && a.longestPlayStreak > soft) {
      // Cố ý chỉ cảnh báo chứ không chặn, kể cả khi vượt trần cứng. Trần chuỗi
      // là mức bộ xếp lịch cố giữ, không phải luật chơi — mà người đang bấm nút
      // là chủ sự kiện, họ có lý do ngoài sân mà phần mềm không biết (ai đó phải
      // về sớm chẳng hạn). `block` ở đây chỉ dành cho việc máy chủ sẽ từ chối
      // thật, để hai chữ đó còn giữ được nghĩa.
      notes.push({
        severity: "warn",
        message:
          a.longestPlayStreak > hard
            ? `${name} sẽ phải đánh ${a.longestPlayStreak} vòng liên tiếp — quá trần ${hard} vòng.`
            : `${name} sẽ phải đánh ${a.longestPlayStreak} vòng liên tiếp.`,
      });
    }
    if (a.longestRestStreak > b.longestRestStreak && a.longestRestStreak >= 3) {
      notes.push({
        severity: "warn",
        message: `${name} sẽ phải nghỉ ${a.longestRestStreak} vòng liền.`,
      });
    }
  }

  notes.push(...brokenDeclarations(state, after));

  const moved = after.matches.filter((m) => m.round === roundA || m.round === roundB).length;
  if (notes.length === 0) {
    notes.push({ severity: "ok", message: "Không ai bị ảnh hưởng xấu." });
  }
  notes.push({
    severity: "ok",
    message: `Không ai thêm hay bớt trận nào — ${moved} trận chỉ đổi thứ tự trước sau.`,
  });
  notes.push({
    severity: "ok",
    message: "Hai vòng này sẽ được ghim — hệ thống không tự xếp lại nữa.",
  });

  const severity: Severity = notes.some((x) => x.severity === "block")
    ? "block"
    : notes.some((x) => x.severity === "warn")
      ? "warn"
      : "ok";

  return { severity, notes, preview: severity === "block" ? null : after };
}

/**
 * Trần chuỗi đánh liên tiếp thực sự đạt được với sĩ số hiện tại.
 *
 * Lấy thẳng con số trong cấu hình là sai, và sai theo kiểu chặn mất thao tác hợp
 * lệ: 9 người trên 2 sân thì mỗi vòng chỉ một người được nghỉ, nên ai cũng phải
 * đánh tới 8 vòng liên tiếp — không cách nào khác. Đem so với trần 3 trong cấu
 * hình thì mọi lần đổi chỗ đều bị báo đỏ vì vi phạm một ràng buộc vốn bất khả
 * thi. Bộ xếp lịch đã nới trần theo đúng cách này (`plan.ts`), phần kiểm tra
 * phải dùng chung một thước thì cảnh báo mới có nghĩa.
 */
function streakCaps(state: EventState): { soft: number; hard: number } {
  const active = state.players.filter((p) => p.status === "active").length;
  const best = achievableStreakCap(active, state.config.courts);
  if (!Number.isFinite(best)) {
    // Không ai nghỉ được vòng nào thì chuỗi liên tiếp không còn là thứ để cảnh báo.
    return { soft: Infinity, hard: Infinity };
  }
  return {
    soft: Math.max(state.config.softMaxConsecutive, best),
    hard: Math.max(state.config.hardMaxConsecutive, best),
  };
}

/**
 * Ai bị đẩy vào một vòng mình đã khai là không có mặt.
 *
 * Chỉ xét những trận **thật sự xê dịch**, và chỉ báo mỗi người một lần. Người
 * vốn đã ở trong tình trạng đó từ trước không phải hậu quả của thao tác này, và
 * đổ hết lên hộp xác nhận thì cảnh báo thật bị chìm mất.
 */
function brokenDeclarations(before: EventState, after: EventState): ValidationNote[] {
  const notes: ValidationNote[] = [];
  const byId = new Map(before.players.map((p) => [p.id, p] as const));
  const roundBefore = new Map(before.matches.map((m) => [m.id, m.round] as const));
  const seen = new Set<PlayerId>();

  for (const m of after.matches) {
    if (roundBefore.get(m.id) === m.round) continue;
    for (const id of [...m.teamA, ...m.teamB]) {
      if (seen.has(id)) continue;
      const p = byId.get(id);
      if (!p?.available) continue;
      if (isAvailableAt(p, m.round)) continue;
      seen.add(id);
      notes.push({
        severity: "warn",
        message: `${p.name} đã khai ${describeSpan(p.available)}, mà sau khi đổi chỗ thì trận của ${p.name} rơi vào vòng ${m.round}.`,
      });
    }
  }
  return notes;
}

function describeSpan(span: PresenceSpan): string {
  if (span.to === null) return `chỉ đánh từ vòng ${span.from} trở đi`;
  if (span.from <= 1) return `chỉ đánh tới vòng ${span.to}`;
  return `chỉ đánh từ vòng ${span.from} đến vòng ${span.to}`;
}

/** Những người có trận bị xê dịch giữa hai trạng thái. */
function collectAffected(before: EventState, after: EventState): PlayerId[] {
  const moved = new Set<PlayerId>();
  const positionBefore = new Map(before.matches.map((m) => [m.id, m.round] as const));
  for (const m of after.matches) {
    if (positionBefore.get(m.id) !== m.round) {
      for (const id of [...m.teamA, ...m.teamB]) moved.add(id);
    }
  }
  return [...moved];
}

interface Projection {
  longestPlayStreak: number;
  longestRestStreak: number;
}

/**
 * Chiếu số liệu chuỗi đánh/nghỉ lên CẢ lịch dự kiến, không chỉ phần đã đánh.
 *
 * `buildHistory` chỉ nhìn quá khứ vì đó là thứ dùng để xếp lịch tiếp. Còn ở đây
 * người dùng đang hỏi "nếu dời thì tương lai ra sao", nên phải duyệt hết lịch.
 */
function projectFairness(
  state: EventState,
  ids: PlayerId[],
): Map<PlayerId, Projection> {
  const out = new Map<PlayerId, Projection>();
  if (ids.length === 0) return out;

  const lastRound = state.matches.reduce((n, m) => Math.max(n, m.round), 0);
  const byId = new Map(state.players.map((p) => [p.id, p] as const));

  for (const id of ids) {
    if (!byId.has(id)) continue;
    let play = 0;
    let rest = 0;
    let longestPlay = 0;
    let longestRest = 0;

    for (let r = 1; r <= lastRound; r++) {
      const playing = state.matches.some(
        (m) =>
          m.round === r &&
          m.status !== "cancelled" &&
          [...m.teamA, ...m.teamB].includes(id),
      );
      if (playing) {
        play += 1;
        rest = 0;
        if (play > longestPlay) longestPlay = play;
      } else {
        rest += 1;
        play = 0;
        if (rest > longestRest) longestRest = rest;
      }
    }
    out.set(id, { longestPlayStreak: longestPlay, longestRestStreak: longestRest });
  }
  return out;
}
