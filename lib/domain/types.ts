/**
 * Kiểu dữ liệu nền của một sự kiện Americano.
 *
 * Toàn bộ trạng thái được suy ra từ nhật ký lệnh (xem `reduce.ts`), nên mọi kiểu
 * ở đây phải tuần tự hoá được sang JSON: không Date, không Map, không Set.
 */

export type PlayerId = string;
export type MatchId = string;
export type CourtId = string;

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
  /** Địa chỉ sân tách khỏi tên sự kiện; để trống với dữ liệu cũ hoặc khi chưa chốt sân. */
  venueAddress: string;
  /** Ngày giờ dự kiến bắt đầu, epoch mili-giây; `null` nếu chưa hẹn. */
  scheduledAt: number | null;
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
  /** Sĩ số dùng để ước tính trước buổi đánh, không phải danh sách có mặt thật. */
  expectedPlayers: number;
  /** Mục tiêu tham khảo; lịch vẫn tiếp tục sinh cho tới khi chủ kết thúc sự kiện. */
  targetGamesPerPlayer: number;
  /** Thời lượng trung bình của một trận, tính bằng phút. */
  estimatedMatchMinutes: number;
  /** Thời gian đổi sân/xếp trận giữa hai lượt sân, tính bằng phút. */
  courtTurnoverMinutes: number;
}

export const DEFAULT_CONFIG: EventConfig = {
  name: "Buổi đánh Pickleball",
  venueAddress: "",
  scheduledAt: null,
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
  expectedPlayers: 8,
  targetGamesPerPlayer: 6,
  estimatedMatchMinutes: 15,
  courtTurnoverMinutes: 3,
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

/** Khoảng vòng inclusive; `to === null` nghĩa là đến cuối sự kiện. */
export interface RoundSpan {
  from: number;
  to: number | null;
}

/** Khoảng có ID ổn định để một lần xác nhận hiện diện không mất liên kết khi gộp. */
export interface PlannedSpan extends RoundSpan {
  id: string;
}

/** Một khoảng vòng mà người chơi thực sự có mặt. */
export interface PresenceSpan extends RoundSpan {
  /** ID ca dự kiến đã được xác nhận; bỏ trống với dữ liệu legacy. */
  plannedSpanId?: string;
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
  availability?: PlannedSpan[];
  /** @deprecated Trường v0.2–v0.7, chỉ giữ để replay/client cũ gửi được. */
  available?: RoundSpan;
  addedAt: number;
}

/**
 * Người này có nhận xếp lịch ở vòng `round` không, theo lời khai trước.
 *
 * Không khai gì thì luôn nhận — đó là mặc định, và là trường hợp của gần hết
 * người chơi.
 */
export function isAvailableAt(p: Player, round: number): boolean {
  const spans = plannedSpansOf(p);
  if (spans.length === 0) return true;
  return spans.some((span) => spanContains(span, round));
}

/** Ca dự kiến đã được xác nhận hiện diện thật ở vòng này hay chưa. */
export function isEligibleAt(p: Player, round: number): boolean {
  const spans = plannedSpansOf(p);
  if (spans.length === 0) return wasPresentAt(p, round);
  const planned = spans.find((span) => spanContains(span, round));
  if (!planned) return false;
  return p.presence.some(
    (span) =>
      span.plannedSpanId === planned.id &&
      spanContains(span, round),
  );
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
  /** ID sân ổn định từ v0.8; dữ liệu cũ được dựng từ trường `court`. */
  courtId?: CourtId;
  /** Version nhãn được chốt lúc trận được tạo/chuyển sân. */
  courtLabelId?: string;
  /** @deprecated Số sân v0.1–v0.7, vẫn được ghi để client/log cũ hoạt động. */
  court: number;
  /** Lượt dùng sân trong cùng một vòng logic; dữ liệu trước v0.6 mặc định là 1. */
  courtWave: number;
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
  /** Thời điểm bắt đầu thật, null nếu chưa đánh hoặc snapshot cũ chưa từng ghi. */
  startedAt: number | null;
}

// ---------------------------------------------------------------------------
// Trạng thái sự kiện
// ---------------------------------------------------------------------------

export type EventStatus = "draft" | "running" | "finished";

// ---------------------------------------------------------------------------
// Cấu trúc sân và lịch
// ---------------------------------------------------------------------------

export interface CourtLabelVersion {
  id: string;
  name: string;
  effectiveFromRound: number;
}

export interface EventCourt {
  id: CourtId;
  order: number;
  labels: CourtLabelVersion[];
  availability: RoundSpan[];
  archived: boolean;
}

export interface ScheduleChange {
  revision: number;
  effectiveRound: number;
  changedAt: number;
  actorLabel: string;
  kind: string;
}

// ---------------------------------------------------------------------------
// Trình bày sự kiện: nhà tài trợ và giải thưởng
// ---------------------------------------------------------------------------

export type SponsorLogoShape = "square" | "round" | "transparent";
export type SponsorTier = "diamond" | "gold" | "silver" | "partner" | "custom";

export interface EventSponsor {
  id: string;
  name: string;
  tier: SponsorTier;
  /** Bắt buộc với hạng tự đặt, ví dụ "Tài trợ áo đấu". */
  tierLabel?: string;
  /** Ảnh nằm ở tab `event_assets`, không nhét data URI vào trạng thái. */
  assetId: string;
  order: number;
  createdAt: number;
  updatedAt: number;
}

export type AwardKind =
  | "champion"
  | "runnerUp"
  | "third"
  | "encouragement"
  | "custom";
export type TrophyMode = "framed" | "transparent";

export interface EventAward {
  id: string;
  kind: AwardKind;
  label: string;
  recipientIds: PlayerId[];
  /** Bỏ trống để dùng cúp mặc định của app. */
  trophyAssetId?: string;
  trophyMode: TrophyMode;
  createdAt: number;
  updatedAt: number;
}

export interface EventPresentation {
  sponsorLogoShape: SponsorLogoShape;
  sponsors: EventSponsor[];
  awards: EventAward[];
}

export function emptyPresentation(): EventPresentation {
  return { sponsorLogoShape: "square", sponsors: [], awards: [] };
}

export interface EventState {
  code: string;
  clubId: string | null;
  status: EventStatus;
  config: EventConfig;
  presentation: EventPresentation;
  /** Danh mục sân ổn định; `config.courts` chỉ còn là ước tính/legacy. */
  courts: EventCourt[];
  /** Lần gần nhất phần lịch chưa bắt đầu được thay đổi có chủ ý. */
  scheduleChange: ScheduleChange | null;
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

/**
 * Bổ sung các trường ra đời sau v0.4.1 cho snapshot cũ mà không xoá dữ liệu.
 * Hàm trả bản mới để các tầng đọc có thể gọi an toàn trên dữ liệu đang đệm.
 */
export function withEventDefaults(state: EventState): EventState {
  const configuredCourts = Number.isInteger(state.config?.courts)
    ? Math.max(1, Math.min(8, state.config.courts))
    : DEFAULT_CONFIG.courts;
  const courts = normalizeCourts(
    Array.isArray(state.courts) && state.courts.length > 0
      ? state.courts
      : legacyCourts(configuredCourts),
  );
  const courtByOrder = new Map(courts.map((court) => [court.order, court] as const));
  return {
    ...state,
    config: {
      ...DEFAULT_CONFIG,
      ...state.config,
      scoring: { ...DEFAULT_CONFIG.scoring, ...state.config?.scoring },
      scheduledAt:
        typeof state.config?.scheduledAt === "number" ? state.config.scheduledAt : null,
    },
    presentation: {
      ...emptyPresentation(),
      ...(state.presentation ?? {}),
      sponsors: Array.isArray(state.presentation?.sponsors)
        ? state.presentation.sponsors
        : [],
      awards: Array.isArray(state.presentation?.awards)
        ? state.presentation.awards
        : [],
    },
    courts,
    scheduleChange: state.scheduleChange ?? null,
    players: Array.isArray(state.players)
      ? state.players.map((player) => withPlayerDefaults(player))
      : [],
    matches: Array.isArray(state.matches)
      ? state.matches.map((match) => {
          const court =
            courts.find((item) => item.id === match.courtId) ??
            courtByOrder.get(match.court) ??
            courts[0];
          const label = court ? courtLabelAt(court, match.round) : undefined;
          return {
            ...match,
            courtId: match.courtId || court?.id || `court-${match.court || 1}`,
            courtLabelId:
              match.courtLabelId || label?.id || `court-${match.court || 1}-label-1`,
            court:
              Number.isInteger(match.court) && match.court > 0
                ? match.court
                : court?.order ?? 1,
            courtWave:
              Number.isInteger(match.courtWave) && match.courtWave > 0
                ? match.courtWave
                : 1,
            startedAt:
              typeof match.startedAt === "number" ? match.startedAt : null,
          };
        })
      : [],
  };
}

/** Sân mặc định xác định cho snapshot/log trước v0.8, không ghi migration. */
export function legacyCourts(count: number): EventCourt[] {
  const safe = Math.max(1, Math.min(8, Math.trunc(count) || 1));
  return Array.from({ length: safe }, (_, index) => {
    const order = index + 1;
    return {
      id: `court-${order}`,
      order,
      labels: [{ id: `court-${order}-label-1`, name: `Sân ${order}`, effectiveFromRound: 1 }],
      availability: [{ from: 1, to: null }],
      archived: false,
    };
  });
}

/** Trim + Unicode NFC; phép so tên dùng `courtNameKey`. */
export function normalizeCourtName(name: string): string {
  return name.normalize("NFC").trim().replace(/\s+/g, " ");
}

export function courtNameKey(name: string): string {
  return normalizeCourtName(name).toLocaleLowerCase("vi");
}

export function spanContains(span: RoundSpan, round: number): boolean {
  return round >= span.from && (span.to === null || round <= span.to);
}

export function spansOverlap(a: RoundSpan, b: RoundSpan): boolean {
  const aTo = a.to ?? Number.POSITIVE_INFINITY;
  const bTo = b.to ?? Number.POSITIVE_INFINITY;
  return a.from <= bTo && b.from <= aTo;
}

/**
 * Chuẩn hoá/gộp khoảng. Khoảng cũ đứng trước nên ID của nó được giữ khi có thể.
 */
export function normalizePlannedSpans(spans: PlannedSpan[]): PlannedSpan[] {
  const sorted = spans
    .filter((span) => Number.isInteger(span.from) && span.from >= 1)
    .map((span) => ({
      id: String(span.id || "").trim(),
      from: span.from,
      to:
        span.to === null
          ? null
          : Number.isInteger(span.to) && span.to >= span.from
            ? span.to
            : span.from,
    }))
    .filter((span) => span.id.length > 0)
    .sort((a, b) => a.from - b.from || (a.to ?? Infinity) - (b.to ?? Infinity));

  const out: PlannedSpan[] = [];
  for (const span of sorted) {
    const last = out[out.length - 1];
    if (!last) {
      out.push({ ...span });
      continue;
    }
    const lastTo = last.to ?? Infinity;
    if (span.from <= lastTo + 1) {
      if (last.to === null || span.to === null) last.to = null;
      else last.to = Math.max(last.to, span.to);
      continue;
    }
    out.push({ ...span });
  }
  return out.slice(0, 20);
}

export function normalizeRoundSpans(spans: RoundSpan[]): RoundSpan[] {
  return normalizePlannedSpans(
    spans.map((span, index) => ({ ...span, id: `span-${index + 1}` })),
  ).map(({ from, to }) => ({ from, to }));
}

export function plannedSpansOf(player: Player): PlannedSpan[] {
  if (Array.isArray(player.availability) && player.availability.length > 0) {
    return normalizePlannedSpans(player.availability);
  }
  return player.available
    ? [{ id: "legacy-availability", from: player.available.from, to: player.available.to }]
    : [];
}

function withPlayerDefaults(player: Player): Player {
  const availability = plannedSpansOf(player);
  const onlySpan = availability.length === 1 ? availability[0] : undefined;
  return {
    ...player,
    availability,
    presence: Array.isArray(player.presence)
      ? player.presence.map((span) => ({
          ...span,
          plannedSpanId:
            span.plannedSpanId ??
            (onlySpan && spansOverlap(span, onlySpan) ? onlySpan.id : undefined),
        }))
      : [],
  };
}

export function courtLabelAt(court: EventCourt, round: number): CourtLabelVersion {
  const labels = [...court.labels].sort(
    (a, b) => a.effectiveFromRound - b.effectiveFromRound || a.id.localeCompare(b.id),
  );
  let selected = labels[0];
  for (const label of labels) {
    if (label.effectiveFromRound <= round) selected = label;
    else break;
  }
  return selected;
}

export function activeCourtsAt(state: Pick<EventState, "courts">, round: number): EventCourt[] {
  return state.courts
    .filter(
      (court) =>
        !court.archived && court.availability.some((span) => spanContains(span, round)),
    )
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/** Tên sân đã chốt trên trận; đổi tên sau này không làm lịch sử đổi theo. */
export function matchCourtName(
  state: Pick<EventState, "courts">,
  match: Pick<Match, "court" | "courtId" | "courtLabelId" | "round">,
): string {
  const court =
    state.courts.find((item) => item.id === match.courtId) ??
    state.courts.find((item) => item.order === match.court);
  if (!court) return `Sân ${match.court}`;
  return (
    court.labels.find((label) => label.id === match.courtLabelId)?.name ??
    courtLabelAt(court, match.round).name
  );
}

function normalizeCourts(courts: EventCourt[]): EventCourt[] {
  return courts
    .map((court, index) => {
      const fallbackOrder = index + 1;
      const id = String(court.id || `court-${fallbackOrder}`);
      const labels = Array.isArray(court.labels) && court.labels.length > 0
        ? court.labels
            .map((label, labelIndex) => ({
              id: String(label.id || `${id}-label-${labelIndex + 1}`),
              name: normalizeCourtName(label.name || `Sân ${fallbackOrder}`),
              effectiveFromRound:
                Number.isInteger(label.effectiveFromRound) && label.effectiveFromRound >= 1
                  ? label.effectiveFromRound
                  : 1,
            }))
            .sort((a, b) => a.effectiveFromRound - b.effectiveFromRound)
        : [{ id: `${id}-label-1`, name: `Sân ${fallbackOrder}`, effectiveFromRound: 1 }];
      return {
        id,
        order:
          Number.isInteger(court.order) && court.order > 0 ? court.order : fallbackOrder,
        labels,
        availability: normalizeRoundSpans(
          Array.isArray(court.availability) ? court.availability : [{ from: 1, to: null }],
        ),
        archived: Boolean(court.archived),
      };
    })
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map((court, index) => ({ ...court, order: index + 1 }));
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
export function openPresence(p: Player, round: number, plannedSpanId?: string): void {
  const last = p.presence[p.presence.length - 1];
  if (last && last.to === null && last.plannedSpanId === plannedSpanId) return;
  if (last && last.to === null) closePresence(p, round - 1);
  p.presence.push({ from: round, to: null, plannedSpanId });
}

/** Đóng khoảng có mặt đang mở tại vòng `round` (vòng cuối còn được xếp lịch). */
export function closePresence(p: Player, round: number): void {
  const last = p.presence[p.presence.length - 1];
  if (!last || last.to !== null) return;
  if (round < last.from) p.presence.pop();
  else last.to = round;
}
