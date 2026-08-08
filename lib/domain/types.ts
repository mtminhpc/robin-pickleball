/**
 * Kiểu dữ liệu nền của một sự kiện Americano.
 *
 * Toàn bộ trạng thái được suy ra từ nhật ký lệnh (xem `reduce.ts`), nên mọi kiểu
 * ở đây phải tuần tự hoá được sang JSON: không Date, không Map, không Set.
 */

export type PlayerId = string;
export type MatchId = string;

/** Ai gây ra một lệnh — dùng cho nhật ký và cho luật tự-sửa-trong-2-phút. */
export type ActorKind = "admin" | "player" | "system";

export interface Actor {
  kind: ActorKind;
  /** Nhãn hiển thị trong nhật ký, ví dụ "Nam" hoặc "chủ sự kiện". */
  label: string;
  /** device_id / user_id / member_id nếu biết — để đối chiếu quyền tự sửa. */
  ref?: string;
}

// ---------------------------------------------------------------------------
// Cấu hình
// ---------------------------------------------------------------------------

/** Mốc điểm một trận. `winBy2` = phải hơn 2 điểm mới thắng. */
export interface ScoringConfig {
  pointsTo: number;
  winBy2: boolean;
}

export interface EventConfig {
  name: string;
  /** Số sân chạy song song. */
  courts: number;
  scoring: ScoringConfig;
  /** Ưu tiên mềm: cố không để ai đánh quá ngần này vòng liên tiếp. */
  softMaxConsecutive: number;
  /** Trần cứng: không bao giờ vượt, kể cả khi đang cho người mới đuổi kịp. */
  hardMaxConsecutive: number;
  /**
   * Người vào giữa chừng được "nợ" bao nhiêu phần số trận của người ít nhất.
   * 1 = đuổi kịp hoàn toàn, 0 = nhập cuộc bình đẳng từ lúc vào.
   *
   * Mặc định 0, và đó là phần cốt lõi của định nghĩa công bằng ở đây. Người tới
   * vòng thứ chín không hề bị thiệt tám trận — họ chỉ chưa có mặt. Coi đó là nợ
   * rồi trả bằng suất của người khác là lấy của người tới đúng giờ: đo với 16
   * người trên 2 sân thì hệ số 1 cho người tới muộn 7 trận trong khi người tới
   * đúng giờ chỉ còn 4–5.
   */
  catchUpFactor: number;
  /** Số vòng sinh sẵn trước mặt để mọi người biết khi nào tới lượt. */
  lookaheadRounds: number;
  /**
   * Số vòng đầu tiên phía trước được coi là đã chốt.
   *
   * Người chơi nhìn lịch để canh giờ nghỉ, nên vài vòng gần nhất phải đứng yên.
   * Các vòng xa hơn vẫn được xếp lại mỗi lần — vừa để tin tức mới (ai vừa vào, ai
   * vừa về) kịp phản ánh, vừa để thuật toán có chỗ xoay xở khi tối ưu.
   */
  commitRounds: number;
  /** Tỷ lệ so với trung vị số trận để được vào bảng xếp hạng chính. */
  eligibilityRatio: number;
  /** Cửa sổ tự sửa kết quả của chính người vừa nhập (mili-giây). */
  selfEditWindowMs: number;
  /** Cho phép xem bảng xếp hạng mà không cần mật khẩu. */
  publicStandings: boolean;
  /** Tính cả các trận dở dang (có tỷ số) vào bảng xếp hạng. */
  countPartialMatches: boolean;
}

export const DEFAULT_CONFIG: EventConfig = {
  name: "Buổi đánh Pickleball",
  courts: 2,
  scoring: { pointsTo: 11, winBy2: true },
  softMaxConsecutive: 2,
  hardMaxConsecutive: 3,
  catchUpFactor: 0,
  lookaheadRounds: 6,
  commitRounds: 2,
  eligibilityRatio: 0.6,
  selfEditWindowMs: 2 * 60 * 1000,
  publicStandings: true,
  countPartialMatches: true,
};

// ---------------------------------------------------------------------------
// Người chơi
// ---------------------------------------------------------------------------

/**
 * `invited`          — có tên trong danh sách mời, chưa trả lời
 * `confirmed`        — đã bấm "Có đi", chưa tới sân (chưa xếp lịch)
 * `declined`         — báo bận
 * `pendingApproval`  — xin vào sau khi sự kiện đã bắt đầu, chờ chủ sự kiện duyệt
 * `active`           — đang ở sân, được xếp lịch
 * `paused`           — nghỉ tạm, giữ nguyên điểm, không xếp lịch
 * `left`             — đã về, chốt số, vẫn nằm trong bảng xếp hạng
 * `rejected`         — chủ sự kiện từ chối
 */
export type PlayerStatus =
  | "invited"
  | "confirmed"
  | "declined"
  | "pendingApproval"
  | "active"
  | "paused"
  | "left"
  | "rejected";

/** Chỉ những trạng thái này mới được đưa vào lịch thi đấu. */
export const SCHEDULABLE: readonly PlayerStatus[] = ["active"];

/** Một khoảng vòng liên tục mà người chơi có mặt. `to === null` là vẫn đang chơi. */
export interface PresenceSpan {
  from: number;
  to: number | null;
}

export interface Player {
  id: PlayerId;
  name: string;
  avatarId: string;
  status: PlayerStatus;
  /** Danh tính xuyên sự kiện, theo thứ tự ưu tiên member → user → device. */
  memberId?: string;
  userId?: string;
  deviceId?: string;
  /**
   * Các khoảng vòng mà người này thực sự có mặt và được xếp lịch.
   * Nghỉ tạm rồi quay lại sẽ tạo ra nhiều khoảng — cần thiết để tính suất kỳ
   * vọng cho đúng, vì công bằng chỉ được tính trên những vòng người đó có mặt.
   */
  presence: PresenceSpan[];
  /**
   * Số trận "nợ" khi vào giữa chừng, để thuật toán ưu tiên xếp cho đuổi kịp.
   * Xem `catchUpFactor` trong cấu hình.
   */
  catchUpCredit: number;
  /**
   * Khoảng vòng người này **khai trước** là mình có mặt được.
   *
   * Khác `presence` ở thì: `presence` ghi lại quá khứ đã xảy ra, còn cái này là
   * lời hứa về tương lai. "Tôi 7 giờ mới tới, tầm vòng 4" hoặc "9 giờ tôi phải
   * về, đánh tới vòng 12 thôi" — chuyện xảy ra ở mọi buổi, và trước đây phần mềm
   * không có chỗ nào để ghi.
   *
   * Không khai thì `undefined`, nghĩa là có mặt suốt — đúng mặc định cho phần
   * lớn người chơi.
   *
   * Thuật toán xếp lịch coi đây là **ràng buộc cứng**: không xếp ai vào vòng họ
   * đã báo trước là không có mặt. Xếp rồi để cả sân đứng chờ một người đã nói
   * trước là mình chưa tới thì tệ hơn nhiều so với việc cho họ nghỉ thêm.
   */
  available?: PresenceSpan;
  addedAt: number;
}

/**
 * Người này có nhận xếp lịch ở vòng `round` không, theo lời khai trước.
 *
 * Không khai gì thì luôn nhận — đó là mặc định, và là trường hợp của gần hết
 * người chơi.
 */
export function isAvailableAt(p: Player, round: number): boolean {
  const w = p.available;
  if (!w) return true;
  if (round < w.from) return false;
  return w.to === null || round <= w.to;
}

// ---------------------------------------------------------------------------
// Trận đấu
// ---------------------------------------------------------------------------

/**
 * `scheduled` — đã xếp lịch, chưa đánh
 * `playing`   — đang đánh
 * `submitted` — đã nhập tỷ số và khoá lại
 * `cancelled` — huỷ khi chưa đánh (hết giờ sân, mất sân…)
 * `abandoned` — bỏ dở giữa chừng, không tính điểm
 */
export type MatchStatus =
  | "scheduled"
  | "playing"
  | "submitted"
  | "cancelled"
  | "abandoned";

export interface MatchResult {
  scoreA: number;
  scoreB: number;
  /** Tỷ số không khớp mốc điểm đã cấu hình nhưng người nhập vẫn xác nhận lưu. */
  irregular: boolean;
  /** Trận dừng giữa chừng nhưng có ghi tỷ số. */
  partial: boolean;
  submittedBy: Actor;
  submittedAt: number;
}

export interface MatchEdit {
  at: number;
  by: Actor;
  from: { scoreA: number; scoreB: number } | null;
  to: { scoreA: number; scoreB: number } | null;
  note?: string;
}

export interface Match {
  id: MatchId;
  round: number;
  court: number;
  teamA: [PlayerId, PlayerId];
  teamB: [PlayerId, PlayerId];
  status: MatchStatus;
  result: MatchResult | null;
  /** Admin đã dời tay trận này → thuật toán không được xếp lại nó. */
  pinned: boolean;
  /** Lý do huỷ / bỏ dở, hiện trên thẻ trận và trong nhật ký. */
  cancelReason?: string;
  /** Lịch sử chỉnh sửa công khai — mọi lần mở khoá và sửa điểm. */
  edits: MatchEdit[];
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Trạng thái sự kiện
// ---------------------------------------------------------------------------

export type EventStatus = "draft" | "running" | "finished";

export interface EventState {
  code: string;
  clubId: string | null;
  status: EventStatus;
  config: EventConfig;
  players: Player[];
  matches: Match[];
  /** Vòng cao nhất đã được sinh; 0 nghĩa là chưa sinh vòng nào. */
  lastRound: number;
  /** Số lệnh đã áp dụng thành công. */
  seq: number;
  /**
   * Số dòng nhật ký đã đọc qua, kể cả dòng bị từ chối khi phát lại.
   *
   * Đây là thứ cho biết ảnh chụp trạng thái còn dùng được hay không. Không thể
   * dùng `seq`: khi hai người ghi đồng thời từ cùng một trạng thái cũ, cả hai đều
   * tính ra cùng một `seq`, nên ảnh chụp của người sau ghi đè người trước mà vẫn
   * trông hợp lệ — và một kết quả biến mất không dấu vết. Số dòng nhật ký thì
   * luôn tăng, không ai làm giả được, nên so với nó mới bắt được.
   */
  processed: number;
  startedAt: number | null;
  finishedAt: number | null;
  /** Kết thúc sớm bằng tay, khác với đánh hết lịch. */
  endedEarly: boolean;
  createdAt: number;
  updatedAt: number;
  /** clientCommandId đã xử lý — để gửi lại lệnh không nhân đôi kết quả. */
  appliedCommandIds: string[];
}

// ---------------------------------------------------------------------------
// Tiện ích dùng chung
// ---------------------------------------------------------------------------

export function isSchedulable(p: Player): boolean {
  return SCHEDULABLE.includes(p.status);
}

/** Trận đã chốt sổ — thuật toán không bao giờ được đụng vào. */
export function isFrozen(m: Match): boolean {
  return (
    m.status !== "scheduled" || m.pinned
  );
}

/** Trận có tỷ số được tính vào bảng xếp hạng. */
export function countsForStandings(m: Match, config: EventConfig): boolean {
  if (m.status !== "submitted" || !m.result) return false;
  if (m.result.partial && !config.countPartialMatches) return false;
  return true;
}

export function playersOf(m: Match): PlayerId[] {
  return [m.teamA[0], m.teamA[1], m.teamB[0], m.teamB[1]];
}

/** Người chơi có mặt (được xếp lịch) ở vòng `round` hay không. */
export function wasPresentAt(p: Player, round: number): boolean {
  return p.presence.some((s) => round >= s.from && (s.to === null || round <= s.to));
}

/** Mở một khoảng có mặt mới, bỏ qua nếu đang mở sẵn. */
export function openPresence(p: Player, round: number): void {
  const last = p.presence[p.presence.length - 1];
  if (last && last.to === null) return;
  p.presence.push({ from: round, to: null });
}

/** Đóng khoảng có mặt đang mở tại vòng `round` (vòng cuối còn được xếp lịch). */
export function closePresence(p: Player, round: number): void {
  const last = p.presence[p.presence.length - 1];
  if (!last || last.to !== null) return;
  if (round < last.from) p.presence.pop();
  else last.to = round;
}
