/** Các luật kiểm tra không phụ thuộc I/O: tỷ số hợp lệ, quyền sửa kết quả. */

import type { Actor, EventConfig, Match, ScoringConfig } from "./types";

export interface ScoreCheck {
  /** Tỷ số khớp hoàn toàn với mốc điểm đã cấu hình. */
  regular: boolean;
  /** Sai nghiêm trọng tới mức không cho lưu kể cả khi xác nhận. */
  fatal: string | null;
  /** Lời cảnh báo hiển thị cho người nhập, kèm nút "Vẫn lưu". */
  warning: string | null;
}

/**
 * Kiểm tra tỷ số. Trả về cảnh báo mềm chứ không chặn, vì trận hay phải dừng sớm
 * do hết giờ sân hoặc thiếu người — nhưng số âm và tỷ số hoà thì chặn hẳn.
 */
export function checkScore(
  scoreA: number,
  scoreB: number,
  scoring: ScoringConfig,
): ScoreCheck {
  if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB)) {
    return { regular: false, fatal: "Tỷ số phải là số nguyên.", warning: null };
  }
  if (scoreA < 0 || scoreB < 0) {
    return { regular: false, fatal: "Tỷ số không được âm.", warning: null };
  }
  if (scoreA === scoreB) {
    return { regular: false, fatal: "Trận không thể hoà.", warning: null };
  }

  const hi = Math.max(scoreA, scoreB);
  const lo = Math.min(scoreA, scoreB);
  const { pointsTo, winBy2 } = scoring;

  if (winBy2) {
    const exact = hi === pointsTo && lo <= pointsTo - 2;
    const deuce = hi > pointsTo && hi - lo === 2;
    if (exact || deuce) return { regular: true, fatal: null, warning: null };
    return {
      regular: false,
      fatal: null,
      warning: `Tỷ số ${scoreA}–${scoreB} không khớp mốc "tới ${pointsTo}, hơn 2". Trận dừng sớm?`,
    };
  }

  if (hi === pointsTo) return { regular: true, fatal: null, warning: null };
  return {
    regular: false,
    fatal: null,
    warning: `Tỷ số ${scoreA}–${scoreB} không khớp mốc "tới ${pointsTo}". Trận dừng sớm?`,
  };
}

/**
 * Ai được sửa một kết quả đã khoá.
 *
 * Trong cửa sổ tự sửa, chính người vừa nhập được sửa lại mà không cần đi tìm chủ
 * sân — đó là cách chống bấm nhầm mà không phải nới lỏng quyền cho cả nhóm.
 * Hết cửa sổ thì chỉ chủ sự kiện.
 */
export function canEditResult(
  match: Match,
  actor: Actor,
  now: number,
  config: EventConfig,
): { allowed: boolean; reason: string | null } {
  if (actor.kind === "admin") return { allowed: true, reason: null };
  if (!match.result) return { allowed: true, reason: null };

  const submitter = match.result.submittedBy;
  const sameActor =
    submitter.ref !== undefined &&
    actor.ref !== undefined &&
    submitter.ref === actor.ref;

  if (!sameActor) {
    return {
      allowed: false,
      reason: "Chỉ người vừa nhập hoặc chủ sự kiện mới sửa được kết quả này.",
    };
  }

  const elapsed = now - match.result.submittedAt;
  if (elapsed > config.selfEditWindowMs) {
    const mins = Math.round(config.selfEditWindowMs / 60000);
    return {
      allowed: false,
      reason: `Đã quá ${mins} phút kể từ lúc lưu. Cần mật khẩu chủ sự kiện để sửa.`,
    };
  }
  return { allowed: true, reason: null };
}
