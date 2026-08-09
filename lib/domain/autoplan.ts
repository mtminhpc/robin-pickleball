/**
 * Quyết định khi nào phải xếp lại lịch.
 *
 * Người dùng không bao giờ bấm "xếp lịch". Họ nhập điểm, duyệt người mới, bấm
 * người kia đã về — và lịch phải tự đúng theo. Hàm ở đây là bảng quy định việc
 * đó, tách thành hàm thuần để kiểm thử được toàn bộ mà không cần dựng máy chủ.
 *
 * Nguyên tắc: xáo trộn càng ít càng tốt. Người chơi nhìn lịch để canh giờ nghỉ,
 * nên chỉ xếp lại khi có lý do thật, và ưu tiên chế độ `extend` (giữ nguyên mọi
 * thứ, chỉ thêm vòng mới) hơn `rebuild` (xếp lại cả phần chưa đánh).
 */

import type { Command } from "./commands";
import { firstOpenRound } from "./rounds";
import type { EventState } from "./types";
import { planSchedule, type PlanMode, type PlanOptions } from "../scheduler/plan";

/** Lệnh nào kéo theo việc xếp lại, và xếp lại theo kiểu gì. */
export function rescheduleMode(
  state: EventState,
  trigger: Command,
): PlanMode | null {
  if (state.status !== "running") return null;

  switch (trigger.type) {
    // Bắt đầu sự kiện: chưa có lịch nào, sinh mới.
    case "StartEvent":
      return "extend";

    // Danh sách người chơi đổi thì phần chưa đánh phải tính lại từ đầu — đây là
    // lúc xáo trộn là bắt buộc chứ không phải tuỳ chọn.
    case "ApproveJoin":
    case "MarkArrived":
    case "PlayerLeft":
    case "PausePlayer":
    case "ResumePlayer":
    case "RemovePlayer":
    case "CancelMatch":
    // Cấp thêm suất chỉ có tác dụng khi phần lịch chưa đánh được xếp lại theo
    // mức thiếu hụt mới.
    case "GrantCatchUp":
    // Khai trước cũng đổi danh sách người được xếp — chỉ là đổi ở những vòng
    // phía trước chứ không phải ngay lập tức. Thiếu nhánh này thì lời khai nằm
    // im cho tới khi có việc khác tình cờ kích hoạt xếp lại, nên màn hình khai
    // giờ về trông y như một cái nút hỏng: bấm xong lịch không đổi gì cả.
    case "DeclareAvailability":
      return "rebuild";

    // Đổi số sân thì số trận mỗi vòng đổi theo.
    case "UpdateConfig":
      return trigger.patch.courts !== undefined ? "rebuild" : null;

    // Nhập xong điểm: chỉ nối thêm vòng mới vào cuối, và chỉ khi vòng vừa khép
    // lại. Nếu xếp lại sau từng trận thì lịch phía trước nhấp nháy liên tục
    // trong lúc bốn sân đang lần lượt báo kết quả.
    case "SubmitResult":
    case "AbandonMatch":
      return needsMoreRounds(state) ? "extend" : null;

    // Admin vừa dời tay. Tự xếp lại ngay sẽ đá lại chính thao tác họ vừa làm;
    // muốn dọn thì có nút "Sửa lại tự động" riêng.
    default:
      return null;
  }
}

/**
 * Sinh lệnh xếp lịch đi kèm, nếu cần.
 *
 * Trả `null` khi không cần xếp lại hoặc khi không xếp được (chưa đủ bốn người).
 * Bên gọi ghi lệnh này chung một lô với lệnh gốc, nên một thao tác của người dùng
 * vẫn chỉ tốn một lời gọi ghi.
 */
export function nextScheduleCommand(
  state: EventState,
  trigger: Command,
  options: Pick<PlanOptions, "iterations" | "timeBudgetMs"> = {},
): Command | null {
  const mode = rescheduleMode(state, trigger);
  if (!mode) return null;

  const outcome = planSchedule(state, { mode, ...options });
  if (outcome.blocked || outcome.matches.length === 0) return null;

  return {
    type: "SetSchedule",
    fromRound: outcome.fromRound,
    matches: outcome.matches,
  };
}

/**
 * Còn đủ vòng sinh sẵn phía trước hay chưa.
 *
 * Đếm số vòng chưa đánh kể từ vòng đang mở. Chỉ khi tụt xuống dưới mức cấu hình
 * mới sinh thêm, nhờ vậy bốn sân báo kết quả lệch nhau vài giây cũng chỉ gây ra
 * đúng một lần xếp lịch.
 */
function needsMoreRounds(state: EventState): boolean {
  const open = firstOpenRound(state);
  const pending = new Set(
    state.matches
      .filter((m) => m.round >= open && m.status === "scheduled")
      .map((m) => m.round),
  );
  return pending.size < state.config.lookaheadRounds;
}
