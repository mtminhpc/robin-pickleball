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
import { achievableStreakCap } from "./metrics";

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
