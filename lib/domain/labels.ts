/**
 * Nhãn tiếng Việt cho các trạng thái.
 *
 * Gom về một chỗ để cùng một trạng thái không bị gọi bằng hai tên khác nhau ở
 * hai màn hình — chuyện đó khiến người dùng tưởng là hai thứ khác nhau.
 */

import type { MatchStatus, PlayerStatus } from "./types";

export const PLAYER_STATUS_LABEL: Record<PlayerStatus, string> = {
  invited: "Đã có tên trong danh sách",
  confirmed: "Đã xác nhận, chờ bắt đầu",
  declined: "Báo bận",
  pendingApproval: "Đang chờ duyệt",
  active: "Đang chơi",
  paused: "Nghỉ tạm",
  left: "Đã về",
  rejected: "Đã từ chối",
};

/** Bản ngắn dùng cho nhãn nhỏ trong danh sách dày. */
export const PLAYER_STATUS_SHORT: Record<PlayerStatus, string> = {
  invited: "chưa trả lời",
  confirmed: "sẽ đến",
  declined: "bận",
  pendingApproval: "chờ duyệt",
  active: "đang chơi",
  paused: "nghỉ tạm",
  left: "đã về",
  rejected: "từ chối",
};

export const MATCH_STATUS_LABEL: Record<MatchStatus, string> = {
  scheduled: "chưa đánh",
  playing: "đang đánh",
  submitted: "đã xong",
  cancelled: "đã huỷ",
  abandoned: "bỏ dở",
};
