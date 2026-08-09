/**
 * Tập lệnh của một sự kiện.
 *
 * Mọi thay đổi trạng thái đi qua đúng một lệnh, và mọi lệnh được ghi nối tiếp vào
 * nhật ký. Hai điện thoại cùng bấm Lưu sẽ tạo hai dòng khác nhau chứ không đè lên
 * nhau — đó là lý do toàn bộ ứng dụng được mô hình hoá theo kiểu này.
 *
 * Lệnh `SetSchedule` mang theo nguyên lịch đã sinh thay vì chỉ mang hạt giống
 * ngẫu nhiên, để phát lại nhật ký luôn cho ra đúng trạng thái cũ kể cả khi thuật
 * toán xếp lịch được sửa về sau.
 */

import type { Actor, EventConfig, MatchId, PlayerId } from "./types";

/** Thông tin tối thiểu để tạo một người chơi mới. */
export interface PlayerSeed {
  id: PlayerId;
  name: string;
  avatarId: string;
  memberId?: string;
  userId?: string;
  deviceId?: string;
}

/** Lịch sinh sẵn, chưa gắn id/thời gian — phần đó do reduce điền. */
export interface MatchSeed {
  id: MatchId;
  round: number;
  court: number;
  teamA: [PlayerId, PlayerId];
  teamB: [PlayerId, PlayerId];
}

export type Command =
  // ---- vòng đời sự kiện --------------------------------------------------
  | { type: "CreateEvent"; code: string; clubId: string | null; config: EventConfig }
  | { type: "UpdateConfig"; patch: Partial<EventConfig> }
  | { type: "StartEvent" }
  | { type: "EndEventEarly"; reason: string }
  | { type: "FinishEvent" }

  // ---- người chơi --------------------------------------------------------
  /** Chủ sự kiện thêm người. Trước giờ đánh vào `invited`, sau đó vào thẳng `active`. */
  | { type: "AddPlayer"; player: PlayerSeed; asActive?: boolean }
  /** Người được mời tự trả lời trước giờ đánh. */
  | { type: "Rsvp"; playerId: PlayerId; going: boolean }
  /** Người đã xác nhận nay có mặt ở sân → bắt đầu được xếp lịch. */
  | { type: "MarkArrived"; playerId: PlayerId }
  /** Ai đó quét mã xin vào sau khi sự kiện đã bắt đầu → chờ duyệt. */
  | { type: "RequestJoin"; player: PlayerSeed }
  /**
   * Nhận một ô tên chủ sân đã gõ sẵn: "Đây là tôi".
   *
   * Tách khỏi `UpdateProfile` + `MarkArrived` vì hai lệnh đó không làm được việc
   * này. `MarkArrived` chỉ chủ sự kiện gọi được, còn `UpdateProfile` thì đổi tên
   * mà **không gắn máy vào ô tên** — nên người vừa nhận xong, mở lại app là app
   * quên mất họ và bắt gõ tên lần nữa.
   *
   * `deviceId` và `userId` do **máy chủ điền** từ cookie, không lấy từ thân yêu
   * cầu: đây là lệnh công khai, mà một lệnh công khai để trình duyệt tự khai
   * mình là ai thì bất kỳ ai cũng nhận được ô tên của người khác.
   */
  | {
      type: "ClaimPlayer";
      playerId: PlayerId;
      name?: string;
      avatarId?: string;
      deviceId?: string;
      userId?: string;
    }
  /**
   * Gắn danh tính vào một ô tên đã có, **không đụng gì khác**.
   *
   * Đây là chỗ chữa cảnh "một máy hai danh tính": chơi vài buổi bằng máy (nhận
   * qua `deviceId`), hôm sau đăng nhập Google, và nếu không có lệnh này thì tài
   * khoản mới không biết gì về những ô tên cũ.
   *
   * Không dùng `ClaimPlayer` cho việc đó được, dù nó cũng gắn danh tính:
   * `ClaimPlayer` còn đổi tên, đổi ảnh, và **đẩy người ta vào hàng chờ duyệt**
   * sau giờ bắt đầu. Ai đang đánh dở mà bỗng phải xin duyệt lại thì đó là phần
   * mềm tự phá buổi đánh.
   *
   * `deviceId` và `userId` do **máy chủ điền** từ cookie đã ký, y hệt
   * `ClaimPlayer` — xem `stampIdentity`.
   */
  | { type: "LinkAccount"; playerId: PlayerId; userId?: string; deviceId?: string }
  | { type: "ApproveJoin"; playerId: PlayerId }
  | { type: "RejectJoin"; playerId: PlayerId }
  | { type: "PausePlayer"; playerId: PlayerId }
  | { type: "ResumePlayer"; playerId: PlayerId }
  | { type: "PlayerLeft"; playerId: PlayerId }
  /** Xoá hẳn khỏi sự kiện — chỉ dùng khi thêm nhầm, người chưa đánh trận nào. */
  | { type: "RemovePlayer"; playerId: PlayerId }
  | { type: "UpdateProfile"; playerId: PlayerId; name?: string; avatarId?: string }
  /**
   * Cấp thêm suất cho một người đang bị thiếu trận.
   *
   * Không phải là "chèn thêm mấy trận cho họ" mà là cộng vào khoản nợ mà thuật
   * toán đang theo dõi — đúng cơ chế đã dùng cho người vào giữa chừng. Nhờ vậy
   * người này được ưu tiên ở các vòng tới nhưng vẫn bị trần số vòng liên tiếp
   * chặn, và mức ưu tiên hiện rõ ở cột Kỳ vọng trong bảng Công bằng thay vì là
   * một ưu ái ngầm.
   */
  | { type: "GrantCatchUp"; playerId: PlayerId; games: number }
  /**
   * Khai trước mình có mặt được từ vòng nào đến vòng nào.
   *
   * `toRound: null` nghĩa là "từ vòng đó trở đi thì ở tới hết buổi". Gửi cả hai
   * là `null` để xoá lời khai, quay về mặc định có mặt suốt.
   *
   * Ai cũng gửi được cho chính mình — người biết mình mấy giờ tới là chính họ,
   * bắt phải nhắn cho chủ sân rồi chủ sân gõ hộ thì sẽ không ai dùng.
   */
  | {
      type: "DeclareAvailability";
      playerId: PlayerId;
      fromRound: number | null;
      toRound: number | null;
    }

  // ---- lịch thi đấu ------------------------------------------------------
  /**
   * Thay toàn bộ các trận từ vòng `fromRound` trở đi bằng `matches`.
   * Dùng cho cả lần sinh lịch đầu tiên lẫn mọi lần xếp lại phần đuôi.
   * Các trận đã đông cứng (đã đánh, đã huỷ, hoặc bị ghim) không bị đụng tới.
   */
  | { type: "SetSchedule"; fromRound: number; matches: MatchSeed[] }
  /** Admin dời một trận sang vòng/sân khác. Trận đó thành "ghim". */
  | { type: "ReorderMatch"; matchId: MatchId; toRound: number; toCourt: number }
  /**
   * Đổi chỗ toàn bộ hai vòng cho nhau.
   *
   * Đây mới là thứ nút "sớm hơn / muộn hơn" cần dùng. Dời riêng một trận sang
   * vòng khác gần như luôn bất khả thi khi lịch kín sân: vòng đích đã đủ người,
   * nên nhét thêm bốn người vào là có kẻ phải đánh hai trận. Đổi cả vòng thì
   * không ai thêm bớt trận nào, không ai đổi bạn đôi — chỉ thứ tự trước sau
   * thay đổi, đúng điều người bấm nút muốn.
   */
  | { type: "SwapRounds"; roundA: number; roundB: number }
  | { type: "PinMatch"; matchId: MatchId; pinned: boolean }
  | { type: "CancelMatch"; matchId: MatchId; reason: string }
  /**
   * Bỏ dở trận đang đánh. Có `score` nghĩa là vẫn ghi lại tỷ số dở dang
   * (tính vào hiệu số, gắn cờ `partial`); không có nghĩa là bỏ hẳn.
   */
  | {
      type: "AbandonMatch";
      matchId: MatchId;
      reason: string;
      score?: { scoreA: number; scoreB: number };
    }

  // ---- kết quả -----------------------------------------------------------
  | { type: "StartMatch"; matchId: MatchId }
  | {
      type: "SubmitResult";
      matchId: MatchId;
      scoreA: number;
      scoreB: number;
      /** Người nhập đã thấy cảnh báo lệch mốc điểm và vẫn chọn lưu. */
      irregular: boolean;
    }
  | {
      type: "EditResult";
      matchId: MatchId;
      scoreA: number;
      scoreB: number;
      irregular: boolean;
      note?: string;
    }
  /** Gỡ tỷ số, đưa trận về trạng thái chưa đánh. */
  | { type: "RevertResult"; matchId: MatchId; note?: string };

export type CommandType = Command["type"];

/** Một dòng trong nhật ký: lệnh + ai + lúc nào + mã chống trùng. */
export interface CommandEnvelope {
  /**
   * Sinh ở phía trình duyệt. Gửi lại cùng một mã sẽ không tạo thêm kết quả —
   * đây là thứ giúp hàng đợi offline gửi lại thoải mái mà không nhân đôi điểm.
   */
  id: string;
  at: number;
  actor: Actor;
  command: Command;
}

/** Các lệnh chỉ chủ sự kiện được phép gửi. */
export const ADMIN_ONLY: readonly CommandType[] = [
  "UpdateConfig",
  "StartEvent",
  "EndEventEarly",
  "FinishEvent",
  "AddPlayer",
  "MarkArrived",
  "ApproveJoin",
  "RejectJoin",
  "PausePlayer",
  "ResumePlayer",
  "RemovePlayer",
  "GrantCatchUp",
  "SetSchedule",
  "ReorderMatch",
  "SwapRounds",
  "PinMatch",
  "CancelMatch",
  "AbandonMatch",
];

/** Các lệnh người chưa có mật khẩu nào cũng gửi được (tự phục vụ). */
export const PUBLIC_COMMANDS: readonly CommandType[] = [
  "Rsvp",
  "RequestJoin",
  // Người quét mã QR ở sân là `viewer` cho tới khi họ gõ mật khẩu. Bắt gõ mật
  // khẩu chỉ để nhận cái tên chủ sân vừa gõ hộ mình là dựng thêm một cửa ải
  // đúng vào chỗ cần nhanh nhất. `ClaimPlayer` tự bảo vệ bằng cách từ chối ô
  // tên đã có chủ.
  "ClaimPlayer",
  // Cùng một lý lẽ, và cùng một lớp bảo vệ: danh tính bị máy chủ ghi đè từ cookie
  // đã ký, còn `reduce` từ chối ghi đè lên ô tên đã thuộc tài khoản khác. Người
  // vừa đăng nhập trên điện thoại mới chưa có mật khẩu buổi nào cả — bắt gõ mật
  // khẩu ở đây thì việc tự gộp danh tính sẽ không bao giờ chạy.
  "LinkAccount",
];

/**
 * Các lệnh nói về CHÍNH MÌNH, không phải về cả buổi đánh.
 *
 * Ba lệnh này trước đây chỉ được xét theo vai, và cách xét đó sai về cả hai phía
 * cùng lúc:
 *
 *   • **Quá rộng.** Chúng không nằm trong `ADMIN_ONLY`, nên bất kỳ ai gõ được
 *     mật khẩu người chơi đều đổi được tên người khác, khai hộ giờ về của người
 *     khác, hay cho người khác "đã về" — mà `reduce` không hề kiểm người gửi có
 *     phải chính chủ. Mật khẩu người chơi thì cả nhóm biết.
 *   • **Quá hẹp.** Người quét mã QR ở sân là `viewer` cho tới khi gõ mật khẩu,
 *     nên họ *không* tự bấm về được — đúng thứ họ cần nhất, và cũng là thứ chỉ
 *     họ mới biết.
 *
 * Thước đo đúng ở đây không phải "vai gì" mà là "có phải việc của mình không".
 *
 * Danh sách này **không thay** hai bảng trên, nó chèn thêm một tầng: nhắm vào
 * chính mình thì được, nhắm vào người khác thì quay về luật cũ. Nên `PausePlayer`
 * và `ResumePlayer` vẫn nằm trong `ADMIN_ONLY` — chỉ chủ sự kiện cho *người khác*
 * nghỉ, còn tự mình xin nghỉ một lúc thì không cần hỏi ai.
 *
 * Hai lệnh nghỉ/vào lại phải đi cùng nhau. Cho người ta tự bấm về mà bắt đi tìm
 * chủ sân mới quay lại được là một cánh cửa chỉ mở một chiều.
 */
export const SELF_SERVICE: readonly CommandType[] = [
  "PlayerLeft",
  "PausePlayer",
  "ResumePlayer",
  "UpdateProfile",
  "DeclareAvailability",
];

export type Role = "viewer" | "player" | "admin";

/**
 * `EditResult` có luật riêng nên không nằm trong hai danh sách trên: trong cửa sổ
 * tự sửa thì chính người vừa nhập được phép, hết cửa sổ thì phải là admin.
 * Xem `canEditResult` trong `rules.ts`.
 */
export function isAllowedForRole(type: CommandType, role: Role): boolean {
  if (role === "admin") return true;
  if (PUBLIC_COMMANDS.includes(type)) return true;
  if (role === "viewer") return false;
  return !ADMIN_ONLY.includes(type);
}

/**
 * Vai trò **cộng thêm** câu hỏi "lệnh này nhắm vào ai".
 *
 * Đây là hàm mà tầng route phải gọi, không phải `isAllowedForRole`. Cả hai `&&`
 * ở dưới đều cần: thiếu chúng thì một `myPlayerId` rỗng (người xem chưa có tên
 * trong buổi) sẽ khớp với một `targetPlayerId` rỗng, và người lạ bất kỳ sửa được
 * hồ sơ của một người chơi không tồn tại — cùng đúng cái bẫy đã bắt ở `roleFor`.
 */
export function isAllowedForActor(
  type: CommandType,
  role: Role,
  myPlayerId: string | null,
  targetPlayerId: string | null,
): boolean {
  if (role === "admin") return true;
  if (SELF_SERVICE.includes(type)) {
    return Boolean(myPlayerId && targetPlayerId && myPlayerId === targetPlayerId);
  }
  return isAllowedForRole(type, role);
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T>(error: string): Result<T> {
  return { ok: false, error };
}
