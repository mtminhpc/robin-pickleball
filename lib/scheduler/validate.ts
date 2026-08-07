/**
 * Kiểm tra hậu quả của việc dời lịch bằng tay.
 *
 * Chủ sự kiện có toàn quyền dời trận, nhưng phải thấy trước mình vừa làm gì.
 * Hàm ở đây mô phỏng thay đổi rồi so số liệu công bằng trước/sau, và diễn giải
 * chênh lệch thành câu tiếng Việt để hiện ngay trên hộp xác nhận.
 */

import { apply } from "../domain/reduce";
import type { EventState, PlayerId } from "../domain/types";

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
  const soft = state.config.softMaxConsecutive;
  const hard = state.config.hardMaxConsecutive;

  for (const id of affected) {
    const b = before.get(id);
    const a = later.get(id);
    if (!b || !a) continue;
    const name = nameOf.get(id) ?? id;

    if (a.longestPlayStreak > b.longestPlayStreak && a.longestPlayStreak > soft) {
      notes.push({
        severity: a.longestPlayStreak > hard ? "block" : "warn",
        message: `${name} sẽ phải đánh ${a.longestPlayStreak} vòng liên tiếp.`,
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
