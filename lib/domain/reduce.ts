/**
 * Suy trạng thái sự kiện từ nhật ký lệnh.
 *
 * Hàm ở đây là hàm thuần: không đọc đồng hồ, không gọi mạng, không sinh số ngẫu
 * nhiên. Mọi thứ cần thiết đều nằm trong `envelope` (đặc biệt là `at` và `actor`).
 * Nhờ vậy phát lại nhật ký luôn cho ra đúng một kết quả, và toàn bộ luật nghiệp vụ
 * kiểm thử được mà không cần dựng Google Sheet.
 */

import type { Command, CommandEnvelope, PlayerSeed } from "./commands";
import { err, ok, type Result } from "./commands";
import { preconditionStillHolds } from "./precondition";
import { firstOpenRound, firstUnplayedRound, roundIsPlayed } from "./rounds";
import type {
  EventState,
  EventAward,
  EventSponsor,
  Match,
  MatchId,
  Player,
  PlayerId,
  PlayerStatus,
} from "./types";
import {
  DEFAULT_CONFIG,
  closePresence,
  emptyPresentation,
  isAvailableAt,
  isFrozen,
  openPresence,
  withEventDefaults,
} from "./types";

export function emptyState(code: string): EventState {
  return {
    code,
    clubId: null,
    status: "draft",
    config: { ...DEFAULT_CONFIG, scoring: { ...DEFAULT_CONFIG.scoring } },
    presentation: emptyPresentation(),
    players: [],
    matches: [],
    lastRound: 0,
    seq: 0,
    processed: 0,
    startedAt: null,
    finishedAt: null,
    endedEarly: false,
    createdAt: 0,
    updatedAt: 0,
    appliedCommandIds: [],
  };
}

/** Số lệnh gần nhất được nhớ để chống trùng. Đủ dài cho mọi hàng đợi offline thực tế. */
const DEDUPE_WINDOW = 500;

/**
 * Áp một lệnh lên trạng thái. Trả về trạng thái MỚI (không sửa tại chỗ).
 *
 * Lệnh trùng `id` bị bỏ qua và coi như thành công — hàng đợi offline gửi lại bao
 * nhiêu lần cũng không nhân đôi kết quả.
 */
export function apply(
  state: EventState,
  envelope: CommandEnvelope,
): Result<EventState> {
  // Lệnh trùng vẫn tính là một dòng nhật ký đã đọc qua, nếu không thì ảnh chụp
  // sẽ mãi mãi bị coi là lỗi thời sau mỗi lần hàng đợi offline gửi lại.
  if (state.appliedCommandIds.includes(envelope.id)) {
    return ok({ ...withEventDefaults(state), processed: state.processed + 1 });
  }

  const next = withEventDefaults(structuredClone(state) as EventState);
  const outcome = applyInPlace(next, envelope);
  if (!outcome.ok) return outcome;

  next.seq += 1;
  next.processed += 1;
  next.updatedAt = envelope.at;
  next.appliedCommandIds.push(envelope.id);
  if (next.appliedCommandIds.length > DEDUPE_WINDOW) {
    next.appliedCommandIds.splice(
      0,
      next.appliedCommandIds.length - DEDUPE_WINDOW,
    );
  }
  return ok(next);
}

/** Phát lại cả nhật ký. Lệnh lỗi bị bỏ qua để một dòng hỏng không giết cả sự kiện. */
export function fold(
  code: string,
  log: CommandEnvelope[],
): { state: EventState; skipped: Array<{ id: string; error: string }> } {
  let state = emptyState(code);
  const skipped: Array<{ id: string; error: string }> = [];
  for (const envelope of log) {
    const result = apply(state, envelope);
    if (result.ok) state = result.value;
    else skipped.push({ id: envelope.id, error: result.error });
  }
  // Dòng bị từ chối cũng đã được đọc qua, nên phải tính vào — bằng không ảnh chụp
  // sẽ bị coi là lỗi thời mãi mãi và mỗi lần đọc lại phải dựng lại từ đầu.
  state = { ...state, processed: log.length };
  return { state, skipped };
}

// ---------------------------------------------------------------------------

function findPlayer(state: EventState, id: PlayerId): Player | undefined {
  return state.players.find((p) => p.id === id);
}

function findMatch(state: EventState, id: MatchId): Match | undefined {
  return state.matches.find((m) => m.id === id);
}

/**
 * Sau khi đổi chỗ hai trận, có ai phải đánh hai trận trong cùng một vòng không.
 *
 * Phải xét cả hai vòng chứ không riêng vòng đích: trận bị đẩy ngược về chỗ cũ
 * cũng có thể đụng người đang đánh ở đó. Trả về câu giải thích kèm tên người bị
 * trùng, `null` nếu đổi được.
 */
function doubleBooked(
  state: EventState,
  moving: Match,
  swapped: Match | undefined,
  toRound: number,
): string | null {
  const fromRound = moving.round;
  const roundOf = (o: Match): number =>
    o.id === moving.id
      ? toRound
      : swapped && o.id === swapped.id
        ? fromRound
        : o.round;

  for (const round of new Set([toRound, fromRound])) {
    const seen = new Set<PlayerId>();
    for (const o of state.matches) {
      if (o.status === "cancelled") continue;
      if (roundOf(o) !== round) continue;
      for (const id of [...o.teamA, ...o.teamB]) {
        if (seen.has(id)) {
          const name = state.players.find((p) => p.id === id)?.name ?? id;
          return `${name} sẽ phải đánh hai trận trong vòng ${round}.`;
        }
        seen.add(id);
      }
    }
  }
  return null;
}

/** Số trận đã đánh xong của một người — mốc để tính khoản "nợ" đuổi kịp. */
function gamesPlayed(state: EventState, id: PlayerId): number {
  return state.matches.filter(
    (m) =>
      m.status === "submitted" &&
      [...m.teamA, ...m.teamB].includes(id),
  ).length;
}

/**
 * Khoản "nợ" cho người vào giữa chừng: bằng số trận của người ít nhất hiện tại,
 * nhân với hệ số cấu hình. Thuật toán sẽ ưu tiên họ cho tới khi trả hết khoản này,
 * nhưng trần số vòng liên tiếp vẫn chặn không cho đánh dồn.
 */
function computeCatchUpCredit(state: EventState): number {
  const playing = state.players.filter((p) => p.status === "active");
  if (playing.length === 0) return 0;
  const counts = playing.map((p) => gamesPlayed(state, p.id));
  const min = Math.min(...counts);
  return min * state.config.catchUpFactor;
}

function makePlayer(
  seed: PlayerSeed,
  status: PlayerStatus,
  at: number,
): Player {
  return {
    id: seed.id,
    name: seed.name.trim(),
    avatarId: seed.avatarId,
    status,
    memberId: seed.memberId,
    userId: seed.userId,
    deviceId: seed.deviceId,
    presence: [],
    catchUpCredit: 0,
    addedAt: at,
  };
}

/** Chuyển một người sang `active` và mở khoảng có mặt kể từ vòng còn xếp được. */
function activate(state: EventState, player: Player): void {
  if (player.status === "active") return;
  const wasNew = player.presence.length === 0;
  if (wasNew && state.status === "running") {
    player.catchUpCredit = computeCatchUpCredit(state);
  }
  player.status = "active";
  // Ngược lại với lúc rời cuộc, chỗ này cố ý dùng `firstOpenRound`: người mới
  // chỉ có thể được xếp vào vòng thuật toán còn sửa được. Tính họ là có mặt từ
  // sớm hơn sẽ sinh ra một khoản thiệt thòi ảo cho những vòng họ vốn không thể
  // chen vào.
  openPresence(player, firstOpenRound(state));
}

/** Đưa một người ra khỏi lịch và đóng khoảng có mặt. */
function deactivate(
  state: EventState,
  player: Player,
  status: PlayerStatus,
): void {
  // "Đã đánh chưa", không phải "thuật toán còn xếp lại được". Trận bị ghim vẫn
  // là trận chưa đánh, mà `firstOpenRound` lại bỏ qua nó — lấy nhầm hàm thì
  // người vừa ra về vẫn còn tên trong những trận đã ghim, và cả sân đứng chờ
  // một người không có mặt.
  const open = firstUnplayedRound(state);

  // Nhưng KHÔNG được đóng lùi xuống trước vòng người này đã thật sự ra sân.
  //
  // `closePresence` xoá hẳn khoảng có mặt khi mốc đóng nằm trước mốc mở — đúng
  // cho người vừa vào đã rời, chưa kịp được xếp trận nào. Với người đã đánh thì
  // nó là tai hoạ: mất khoảng có mặt là mất luôn tên khỏi cả bảng Công bằng lẫn
  // bảng Xếp hạng, trong khi tỷ số của họ vẫn nằm đó và bạn đôi của họ vẫn hiện.
  //
  // Hai mốc này tách nhau ra thật khi có một vòng **đã ghim mà chưa đánh**:
  // `firstOpenRound` nhảy qua nó còn `firstUnplayedRound` thì không, nên người
  // vào giữa chừng nhận khoảng bắt đầu muộn hơn mốc đóng.
  closePresence(player, Math.max(open - 1, lastRoundPlayed(state, player.id)));

  // Lời khai có mặt là một DỰ ĐỊNH, và dự định đó vừa bị thực tế vượt qua. Giữ
  // lại thì nó thành cái bẫy: ai khai "đánh tới vòng 8", về ở vòng 4 rồi quay
  // lại ở vòng 9 sẽ mang theo một lời khai nói rằng mình đã đi mất — và thuật
  // toán, vốn coi lời khai là ràng buộc cứng, sẽ không xếp cho họ trận nào nữa.
  // Người dùng thì chỉ thấy mình bấm "quay lại" xong ngồi không tới hết buổi.
  delete player.available;

  player.status = status;
  dropFutureMatches(state, player.id, open);
}

/**
 * Gỡ người vừa rời khỏi mọi trận chưa đánh.
 *
 * Kể cả trận đã bị admin ghim: người ta về rồi thì trận đó không đánh được nữa,
 * giữ lại chỉ tổ tạo ra một trận thiếu người mà thuật toán không được phép sửa.
 * Trận đang đánh dở thì giữ nguyên — chủ sự kiện tự quyết bỏ dở hay ghi tỷ số.
 */
/**
 * Vòng cuối cùng người này đã thật sự ra sân. `0` nếu chưa đánh trận nào.
 *
 * Tính cả trận bỏ dở: họ đã ra sân, đã tốn sức, và tên họ phải ở lại trong bảng.
 */
function lastRoundPlayed(state: EventState, playerId: PlayerId): number {
  let last = 0;
  for (const m of state.matches) {
    if (m.status !== "submitted" && m.status !== "playing" && m.status !== "abandoned") {
      continue;
    }
    if (!m.teamA.includes(playerId) && !m.teamB.includes(playerId)) continue;
    if (m.round > last) last = m.round;
  }
  return last;
}

function dropFutureMatches(
  state: EventState,
  playerId: PlayerId,
  fromRound: number,
): void {
  state.matches = state.matches.filter((m) => {
    if (m.status !== "scheduled" || m.round < fromRound) return true;
    return ![...m.teamA, ...m.teamB].includes(playerId);
  });
  state.lastRound = state.matches.reduce((n, m) => Math.max(n, m.round), 0);
}

function newMatch(
  seed: { id: string; round: number; court: number; courtWave?: number },
  teamA: [PlayerId, PlayerId],
  teamB: [PlayerId, PlayerId],
  at: number,
): Match {
  return {
    id: seed.id,
    round: seed.round,
    court: seed.court,
    courtWave: seed.courtWave ?? 1,
    teamA,
    teamB,
    status: "scheduled",
    result: null,
    pinned: false,
    edits: [],
    createdAt: at,
    startedAt: null,
  };
}

// ---------------------------------------------------------------------------

function applyInPlace(
  state: EventState,
  envelope: CommandEnvelope,
): Result<null> {
  const { command: c, at, actor } = envelope;

  if (
    envelope.precondition &&
    !preconditionStillHolds(state, envelope.command, envelope.precondition)
  ) {
    return err(
      "Xung đột dữ liệu: tỷ số, vị trí hoặc người chơi đích đã được thiết bị khác thay đổi.",
    );
  }

  // Sau khi chốt chỉ phần trình bày còn được sửa: nhà tài trợ có thể được
  // nghiệm thu lại và giải thưởng chỉ được trao sau thời điểm này.
  const allowedAfterFinish = new Set([
    "UpdateConfig",
    "SetSponsorLogoShape",
    "UpsertSponsor",
    "RemoveSponsor",
    "ReorderSponsors",
    "UpsertAward",
    "RemoveAward",
    "EditResult",
    "RevertResult",
  ]);
  if (state.status === "finished" && !allowedAfterFinish.has(c.type)) {
    return err("Sự kiện đã kết thúc, không thể thay đổi.");
  }

  switch (c.type) {
    // ---- vòng đời sự kiện ------------------------------------------------
    case "CreateEvent": {
      state.code = c.code;
      state.clubId = c.clubId;
      state.config = { ...DEFAULT_CONFIG, ...c.config };
      state.createdAt = at;
      return ok(null);
    }

    case "UpdateConfig": {
      const invalid = validateConfigPatch(c.patch);
      if (invalid) return err(invalid);
      state.config = { ...state.config, ...c.patch };
      return ok(null);
    }

    case "StartEvent": {
      if (state.status !== "draft") return err("Sự kiện đã bắt đầu rồi.");
      // Chốt danh sách: ai đã xác nhận đi thì coi như có mặt.
      for (const p of state.players) {
        if (p.status === "confirmed") {
          p.status = "active";
          openPresence(p, 1);
        }
      }
      const playing = state.players.filter((p) => p.status === "active");
      if (playing.length < 4) {
        return err("Cần ít nhất 4 người có mặt để bắt đầu.");
      }
      state.status = "running";
      state.startedAt = at;
      return ok(null);
    }

    case "EndEventEarly": {
      if (state.status !== "running") return err("Sự kiện chưa bắt đầu.");
      for (const m of state.matches) {
        if (m.status === "scheduled" || m.status === "playing") {
          m.status = "cancelled";
          m.cancelReason = c.reason || "Kết thúc sớm";
          m.edits.push({ at, by: actor, from: null, to: null, note: "Kết thúc sớm" });
        }
      }
      state.status = "finished";
      state.finishedAt = at;
      state.endedEarly = true;
      return ok(null);
    }

    case "FinishEvent": {
      if (state.status !== "running") return err("Sự kiện chưa bắt đầu.");
      const open = state.matches.some(
        (m) => m.status === "scheduled" || m.status === "playing",
      );
      if (open) {
        return err("Vẫn còn trận chưa hoàn tất. Hãy kết thúc sớm nếu muốn dừng ngay.");
      }
      state.status = "finished";
      state.finishedAt = at;
      return ok(null);
    }

    // ---- trình bày / thương mại -----------------------------------------
    case "SetSponsorLogoShape": {
      if (!(["square", "round", "transparent"] as const).includes(c.shape)) {
        return err("Hình dạng logo không hợp lệ.");
      }
      state.presentation.sponsorLogoShape = c.shape;
      return ok(null);
    }

    case "UpsertSponsor": {
      const sponsor = validateSponsor(c.sponsor, at);
      if (!sponsor.ok) return sponsor;
      const existingIndex = state.presentation.sponsors.findIndex(
        (item) => item.id === sponsor.value.id,
      );
      const next = [...state.presentation.sponsors];
      const existing = existingIndex >= 0 ? next[existingIndex] : undefined;
      const value: EventSponsor = {
        ...sponsor.value,
        createdAt: existing?.createdAt ?? at,
        updatedAt: at,
      };
      if (existingIndex >= 0) next[existingIndex] = value;
      else next.push(value);

      if (value.tier !== "custom") {
        const count = next.filter((item) => item.tier === value.tier).length;
        if (count > 2) return err("Mỗi hạng tài trợ chuẩn chỉ được tối đa 2 logo.");
      }
      state.presentation.sponsors = sortSponsors(next);
      return ok(null);
    }

    case "RemoveSponsor": {
      const before = state.presentation.sponsors.length;
      state.presentation.sponsors = state.presentation.sponsors.filter(
        (item) => item.id !== c.sponsorId,
      );
      if (before === state.presentation.sponsors.length) {
        return err("Không tìm thấy nhà tài trợ.");
      }
      return ok(null);
    }

    case "ReorderSponsors": {
      const current = state.presentation.sponsors;
      if (
        c.sponsorIds.length !== current.length ||
        new Set(c.sponsorIds).size !== current.length ||
        c.sponsorIds.some((id) => !current.some((item) => item.id === id))
      ) {
        return err("Danh sách sắp xếp nhà tài trợ không hợp lệ.");
      }
      const positions = new Map(c.sponsorIds.map((id, index) => [id, index]));
      state.presentation.sponsors = sortSponsors(
        current.map((item) => ({ ...item, order: positions.get(item.id) ?? item.order })),
      );
      return ok(null);
    }

    case "UpsertAward": {
      if (state.status !== "finished") {
        return err("Chỉ được trao giải sau khi sự kiện đã kết thúc.");
      }
      const award = validateAward(state, c.award, at);
      if (!award.ok) return award;
      const existingIndex = state.presentation.awards.findIndex(
        (item) => item.id === award.value.id,
      );
      if (
        award.value.kind !== "custom" &&
        state.presentation.awards.some(
          (item) => item.kind === award.value.kind && item.id !== award.value.id,
        )
      ) {
        return err("Mỗi bậc giải chuẩn chỉ được tạo một lần.");
      }
      const existing = existingIndex >= 0 ? state.presentation.awards[existingIndex] : undefined;
      const value: EventAward = {
        ...award.value,
        createdAt: existing?.createdAt ?? at,
        updatedAt: at,
      };
      if (existingIndex >= 0) state.presentation.awards[existingIndex] = value;
      else state.presentation.awards.push(value);
      state.presentation.awards = sortAwards(state.presentation.awards);
      return ok(null);
    }

    case "RemoveAward": {
      if (state.status !== "finished") {
        return err("Chỉ được sửa giải sau khi sự kiện đã kết thúc.");
      }
      const before = state.presentation.awards.length;
      state.presentation.awards = state.presentation.awards.filter(
        (item) => item.id !== c.awardId,
      );
      if (before === state.presentation.awards.length) return err("Không tìm thấy giải.");
      return ok(null);
    }

    // ---- người chơi ------------------------------------------------------
    case "AddPlayer": {
      if (findPlayer(state, c.player.id)) return err("Người này đã có trong danh sách.");
      const wantActive = c.asActive ?? state.status === "running";
      const player = makePlayer(c.player, "invited", at);
      state.players.push(player);
      if (wantActive) {
        if (state.status === "running") activate(state, player);
        else {
          player.status = "confirmed";
        }
      }
      return ok(null);
    }

    case "Rsvp": {
      const p = findPlayer(state, c.playerId);
      if (!p) return err("Không tìm thấy người chơi.");
      if (state.status !== "draft") {
        return err("Sự kiện đã bắt đầu, cần chủ sự kiện duyệt.");
      }
      p.status = c.going ? "confirmed" : "declined";
      return ok(null);
    }

    case "MarkArrived": {
      const p = findPlayer(state, c.playerId);
      if (!p) return err("Không tìm thấy người chơi.");
      if (p.status === "active") return ok(null);
      if (state.status === "draft") {
        p.status = "confirmed";
        return ok(null);
      }
      activate(state, p);
      return ok(null);
    }

    case "RequestJoin": {
      const existing = findPlayer(state, c.player.id);
      if (existing) {
        // Người đã có tên (đã RSVP hoặc từng chơi) quay lại thì xin duyệt lần nữa.
        if (existing.status === "active") return ok(null);
        existing.status = "pendingApproval";
        return ok(null);
      }
      if (state.status === "draft") {
        // Trước giờ đánh thì vào thẳng, không phải chờ ai duyệt.
        state.players.push(makePlayer(c.player, "confirmed", at));
        return ok(null);
      }
      state.players.push(makePlayer(c.player, "pendingApproval", at));
      return ok(null);
    }

    case "ClaimPlayer": {
      const p = findPlayer(state, c.playerId);
      if (!p) return err("Không tìm thấy người chơi.");

      // Ô tên đã có chủ thì không ai nhận đè lên được. Không có luật này thì
      // người quét mã sau cùng chiếm được tên của người đang chơi, và mọi kết
      // quả từ đó rơi vào nhầm người.
      if (p.deviceId && c.deviceId && p.deviceId !== c.deviceId) {
        return err("Tên này đã có người nhận rồi.");
      }
      // Một ô đã thuộc tài khoản thì người chưa đăng nhập cũng không được nhận.
      // Phép kiểm cũ chỉ chặn khi *cả hai* phía có userId, nên một người ẩn danh
      // vẫn gắn được máy mình vào ô tên của tài khoản khác.
      if (p.userId && p.userId !== c.userId) {
        return err("Tên này thuộc về tài khoản khác.");
      }

      if (c.name !== undefined && c.name.trim() !== "") p.name = c.name.trim();
      if (c.avatarId !== undefined && c.avatarId !== "") p.avatarId = c.avatarId;
      if (c.deviceId) p.deviceId = c.deviceId;
      if (c.userId) p.userId = c.userId;

      if (p.status === "active") return ok(null);
      if (state.status === "draft") {
        p.status = "confirmed";
        return ok(null);
      }
      // Sau giờ bắt đầu thì vẫn phải chờ duyệt, hệt như `RequestJoin`. Chủ sân
      // gõ sẵn cái tên không có nghĩa là đồng ý cho người vừa quét mã vào sân
      // giữa buổi — hai việc đó khác nhau, và trộn vào nhau thì lịch bị xếp cho
      // một người không ai biết là ai.
      p.status = "pendingApproval";
      return ok(null);
    }

    case "LinkAccount": {
      const p = findPlayer(state, c.playerId);
      if (!p) return err("Không tìm thấy người chơi.");

      // Hai lá chắn, chép NGUYÊN của `ClaimPlayer` — đây cũng là lệnh công khai,
      // nên nới một ly ở đây là mở đúng đường chiếm tên mà `ClaimPlayer` đã bịt.
      //
      // Lá chắn thiết bị đặc biệt không được bỏ, dù nghe có vẻ thừa với một lệnh
      // "chỉ gắn tài khoản": ô tên chưa có `userId` thì lá chắn kia không chặn
      // được gì cả, và người lạ quét mã QR sẽ đóng dấu tài khoản mình lên tên
      // người đang chơi — rồi đổi được cả ảnh của họ qua đường ảnh người chơi.
      if (p.deviceId && c.deviceId && p.deviceId !== c.deviceId) {
        return err("Tên này đã có người nhận rồi.");
      }
      if (p.userId && p.userId !== c.userId) {
        return err("Tên này thuộc về tài khoản khác.");
      }

      if (c.userId) p.userId = c.userId;
      if (c.deviceId) p.deviceId = c.deviceId;

      // Cố ý không đụng `status`, `name`, `avatarId`. Xem docblock của lệnh.
      return ok(null);
    }

    case "ApproveJoin": {
      const p = findPlayer(state, c.playerId);
      if (!p) return err("Không tìm thấy người chơi.");
      if (p.status !== "pendingApproval") return err("Người này không nằm trong hàng chờ.");
      activate(state, p);
      return ok(null);
    }

    case "RejectJoin": {
      const p = findPlayer(state, c.playerId);
      if (!p) return err("Không tìm thấy người chơi.");
      p.status = "rejected";
      return ok(null);
    }

    case "PausePlayer": {
      const p = findPlayer(state, c.playerId);
      if (!p) return err("Không tìm thấy người chơi.");
      if (p.status !== "active") return err("Người này không đang chơi.");
      deactivate(state, p, "paused");
      return ok(null);
    }

    case "ResumePlayer": {
      const p = findPlayer(state, c.playerId);
      if (!p) return err("Không tìm thấy người chơi.");
      // Cùng một lệnh mở lại cả hai cánh cửa mà người chơi tự đóng: nghỉ tạm và
      // đã về. Không nới `MarkArrived` cho tự phục vụ, vì lệnh đó còn áp dụng
      // cho người `invited`/`declined`; cho tự gửi sẽ vô tình bỏ qua hàng duyệt.
      if (p.status !== "paused" && p.status !== "left") {
        return err("Người này không ở trạng thái nghỉ tạm hoặc đã về.");
      }
      activate(state, p);
      return ok(null);
    }

    case "PlayerLeft": {
      const p = findPlayer(state, c.playerId);
      if (!p) return err("Không tìm thấy người chơi.");
      deactivate(state, p, "left");
      return ok(null);
    }

    case "RemovePlayer": {
      const p = findPlayer(state, c.playerId);
      if (!p) return err("Không tìm thấy người chơi.");
      if (gamesPlayed(state, p.id) > 0) {
        return err("Người này đã đánh rồi — dùng \"Đã về\" để giữ lại kết quả.");
      }
      dropFutureMatches(state, p.id, 0);
      state.players = state.players.filter((x) => x.id !== p.id);
      return ok(null);
    }

    case "UpdateProfile": {
      const p = findPlayer(state, c.playerId);
      if (!p) return err("Không tìm thấy người chơi.");
      if (c.name !== undefined) p.name = c.name.trim();
      if (c.avatarId !== undefined) p.avatarId = c.avatarId;
      return ok(null);
    }

    case "GrantCatchUp": {
      const p = findPlayer(state, c.playerId);
      if (!p) return err("Không tìm thấy người chơi.");
      if (c.games <= 0 || c.games > 10) {
        return err("Số trận cấp thêm phải từ 1 đến 10.");
      }
      p.catchUpCredit += c.games;
      return ok(null);
    }

    case "DeclareAvailability": {
      const p = findPlayer(state, c.playerId);
      if (!p) return err("Không tìm thấy người chơi.");

      // Cả hai rỗng là xoá lời khai, quay về mặc định có mặt suốt buổi.
      if (c.fromRound === null && c.toRound === null) {
        delete p.available;
        return ok(null);
      }

      const from = Math.max(1, Math.floor(c.fromRound ?? 1));
      const to = c.toRound === null ? null : Math.floor(c.toRound);
      if (to !== null && to < from) {
        return err("Vòng kết thúc phải từ vòng bắt đầu trở đi.");
      }

      // Vòng đã đánh rồi thì khai lại cũng không đổi được quá khứ. Chặn ở đây
      // để lời khai luôn nói về những vòng còn xếp lại được — nếu không, người
      // dùng gõ "tôi chỉ đánh tới vòng 3" ở vòng 8 rồi ngồi chờ một điều sẽ
      // không bao giờ xảy ra.
      const open = firstOpenRound(state);
      if (to !== null && to < open) {
        return err(
          `Vòng ${to} đã đánh xong rồi. Muốn về sớm thì bấm rời cuộc, không khai lịch.`,
        );
      }

      p.available = { from, to };
      return ok(null);
    }

    // ---- lịch thi đấu ----------------------------------------------------
    case "SetSchedule": {
      const known = new Set(state.players.map((p) => p.id));
      for (const seed of c.matches) {
        for (const id of [...seed.teamA, ...seed.teamB]) {
          if (!known.has(id)) return err(`Lịch nhắc tới người lạ: ${id}`);
        }
        if (seed.round < c.fromRound) {
          return err("Lịch mới chứa vòng nằm trước mốc thay thế.");
        }
      }
      // Giữ lại mọi trận đã đông cứng và mọi trận trước mốc.
      const kept = state.matches.filter(
        (m) => m.round < c.fromRound || isFrozen(m),
      );
      const added = c.matches.map((seed) =>
        newMatch(seed, seed.teamA, seed.teamB, at),
      );
      state.matches = [...kept, ...added].sort(
        (a, b) => a.round - b.round || a.court - b.court,
      );
      state.lastRound = state.matches.reduce((n, m) => Math.max(n, m.round), 0);
      return ok(null);
    }

    case "ReorderMatch": {
      const m = findMatch(state, c.matchId);
      if (!m) return err("Không tìm thấy trận.");
      if (m.status !== "scheduled") return err("Chỉ dời được trận chưa đánh.");
      if (c.toRound < 1) return err("Không có vòng nào trước vòng 1.");

      if (roundIsPlayed(state, c.toRound)) {
        return err(`Vòng ${c.toRound} đã đánh rồi, không dời vào đó được.`);
      }

      // Trận đang chiếm đúng ô sắp dời tới, nếu có, sẽ ĐỔI CHỖ với trận này chứ
      // không chặn lệnh.
      //
      // Dời một chiều nghe thì đơn giản hơn, nhưng ở giải round robin mọi vòng
      // đều kín sân: 9 người trên 2 sân thì vòng nào cũng đủ hai trận, nên chỗ
      // trống chỉ tồn tại sau vòng cuối. Đo thử trên lịch thật thì nút "sớm hơn
      // / muộn hơn" hỏng 22 trên 24 lần — tức là tính năng coi như không có.
      // Người bấm nút cũng không hề muốn tạo ô trống: họ muốn cặp này đánh
      // trước cặp kia. Đổi chỗ mới đúng là điều họ định làm.
      const other = state.matches.find(
        (o) =>
          o.id !== m.id &&
          o.round === c.toRound &&
          o.court === c.toCourt &&
          o.status !== "cancelled",
      );
      if (other && other.status !== "scheduled") {
        return err("Trận ở chỗ đó đã bắt đầu hoặc đã có kết quả, không đổi chỗ được.");
      }

      const clash = doubleBooked(state, m, other, c.toRound);
      if (clash) return err(clash);

      const fromRound = m.round;
      const fromCourt = m.court;
      for (const [candidate, nextRound] of [
        [m, c.toRound],
        ...(other ? ([[other, fromRound]] as const) : []),
      ] as ReadonlyArray<readonly [Match, number]>) {
        for (const id of [...candidate.teamA, ...candidate.teamB]) {
          const player = findPlayer(state, id);
          if (!player || player.status !== "active") {
            return err(`${player?.name ?? id} hiện không có mặt để thi đấu.`);
          }
          if (!isAvailableAt(player, nextRound)) {
            return err(`${player.name} đã khai không có mặt ở vòng ${nextRound}.`);
          }
        }
      }
      m.round = c.toRound;
      m.court = c.toCourt;
      m.pinned = true;
      if (other) {
        other.round = fromRound;
        other.court = fromCourt;
        // Ghim cả trận bị đẩy sang: chủ sự kiện vừa cố ý xếp hai trận này cạnh
        // nhau, để bộ xếp lịch trả nó về chỗ cũ thì công đổi chỗ thành vô nghĩa.
        other.pinned = true;
      }
      state.matches.sort((a, b) => a.round - b.round || a.court - b.court);
      state.lastRound = state.matches.reduce((n, x) => Math.max(n, x.round), 0);
      return ok(null);
    }

    case "PromoteMatch": {
      const m = findMatch(state, c.matchId);
      if (!m) return err("Không tìm thấy trận.");
      if (m.status !== "scheduled") return err("Chỉ đưa lên được trận chưa đánh.");
      if (c.toRound < 1) return err("Không có vòng nào trước vòng 1.");
      if (c.toCourt < 1 || c.toCourt > state.config.courts) {
        return err("Sân đích không hợp lệ.");
      }
      if (m.round <= c.toRound) return err("Chỉ đưa được một trận tương lai lên sớm hơn.");

      const participants = new Set([...m.teamA, ...m.teamB]);
      for (const id of participants) {
        const player = findPlayer(state, id);
        if (!player || player.status !== "active") {
          return err(`${player?.name ?? id} hiện không có mặt để thi đấu.`);
        }
        if (!isAvailableAt(player, c.toRound)) {
          return err(`${player.name} đã khai không có mặt ở vòng ${c.toRound}.`);
        }
      }

      const sameRound = state.matches.filter(
        (other) =>
          other.id !== m.id &&
          other.round === c.toRound &&
          other.status !== "cancelled" &&
          other.status !== "abandoned",
      );
      for (const other of sameRound) {
        if ([...other.teamA, ...other.teamB].some((id) => participants.has(id))) {
          const id = [...other.teamA, ...other.teamB].find((p) => participants.has(p));
          return err(`${findPlayer(state, id!)?.name ?? id} đã có trận trong vòng ${c.toRound}.`);
        }
      }

      const playingOnCourt = state.matches.some(
        (other) =>
          other.id !== m.id &&
          other.court === c.toCourt &&
          (other.status === "playing" ||
            (other.round === c.toRound && other.status === "scheduled")),
      );
      if (playingOnCourt) return err(`Sân ${c.toCourt} chưa trống để nhận trận khác.`);

      const occupiedWaves = sameRound
        .filter((other) => other.court === c.toCourt)
        .map((other) => other.courtWave ?? 1);
      m.round = c.toRound;
      m.court = c.toCourt;
      m.courtWave = Math.max(0, ...occupiedWaves) + 1;
      m.pinned = true;
      if (c.startNow) {
        const busyPlayer = state.matches.find(
          (other) =>
            other.id !== m.id &&
            other.status === "playing" &&
            [...other.teamA, ...other.teamB].some((id) => participants.has(id)),
        );
        if (busyPlayer) return err("Có người trong trận này đang thi đấu ở sân khác.");
        m.status = "playing";
        m.startedAt = at;
      }
      state.matches.sort(
        (a, b) =>
          a.round - b.round ||
          (a.courtWave ?? 1) - (b.courtWave ?? 1) ||
          a.court - b.court,
      );
      return ok(null);
    }

    case "SwapRounds": {
      if (c.roundA === c.roundB) return err("Hai vòng trùng nhau.");

      const inA = state.matches.filter((m) => m.round === c.roundA);
      const inB = state.matches.filter((m) => m.round === c.roundB);
      if (inA.length === 0 && inB.length === 0) {
        return err("Cả hai vòng đều chưa có trận nào.");
      }
      // Chỉ cần "đã đánh chưa", KHÔNG dùng `firstOpenRound`: hàm đó coi trận đã
      // ghim là đông cứng, nên vòng vừa được đổi chỗ xong sẽ lập tức không đổi
      // lại được nữa — chủ sự kiện bị khoá bởi chính thao tác mình vừa làm.
      const busy = [...inA, ...inB].find(
        (m) => m.status !== "scheduled" && m.status !== "cancelled",
      );
      if (busy) {
        return err(`Vòng ${busy.round} đã đánh rồi, không đổi chỗ được.`);
      }

      // Không cần kiểm trùng người: hai vòng chỉ hoán vị cho nhau nên nội dung
      // mỗi vòng vẫn y nguyên. Không ai thêm hay bớt trận, không ai đổi bạn đôi.
      for (const m of inA) m.round = c.roundB;
      for (const m of inB) m.round = c.roundA;
      // Ghim lại, nếu không lần xếp lịch kế tiếp sẽ trả mọi thứ về chỗ cũ và
      // công đổi chỗ thành vô nghĩa.
      for (const m of [...inA, ...inB]) if (m.status === "scheduled") m.pinned = true;

      state.matches.sort((a, b) => a.round - b.round || a.court - b.court);
      state.lastRound = state.matches.reduce((n, x) => Math.max(n, x.round), 0);
      return ok(null);
    }

    case "PinMatch": {
      const m = findMatch(state, c.matchId);
      if (!m) return err("Không tìm thấy trận.");
      m.pinned = c.pinned;
      return ok(null);
    }

    case "CancelMatch": {
      const m = findMatch(state, c.matchId);
      if (!m) return err("Không tìm thấy trận.");
      if (m.status !== "scheduled") {
        return err("Trận này đã bắt đầu — dùng \"Bỏ dở\" thay vì huỷ.");
      }
      m.status = "cancelled";
      m.cancelReason = c.reason;
      m.edits.push({ at, by: actor, from: null, to: null, note: `Huỷ: ${c.reason}` });
      return ok(null);
    }

    case "AbandonMatch": {
      const m = findMatch(state, c.matchId);
      if (!m) return err("Không tìm thấy trận.");
      if (m.status !== "playing" && m.status !== "scheduled") {
        return err("Trận này đã có kết quả.");
      }
      if (c.score) {
        // Ghi lại tỷ số dở dang: vẫn tính vào hiệu số nhưng có dấu riêng.
        m.status = "submitted";
        m.result = {
          scoreA: c.score.scoreA,
          scoreB: c.score.scoreB,
          irregular: true,
          partial: true,
          submittedBy: actor,
          submittedAt: at,
        };
      } else {
        m.status = "abandoned";
      }
      m.cancelReason = c.reason;
      m.edits.push({
        at,
        by: actor,
        from: null,
        to: c.score ? { scoreA: c.score.scoreA, scoreB: c.score.scoreB } : null,
        note: `Bỏ dở: ${c.reason}`,
      });
      return ok(null);
    }

    // ---- kết quả ---------------------------------------------------------
    case "StartMatch": {
      const m = findMatch(state, c.matchId);
      if (!m) return err("Không tìm thấy trận.");
      if (m.status !== "scheduled") return err("Trận này không ở trạng thái chờ đánh.");
      const participants = new Set([...m.teamA, ...m.teamB]);
      for (const id of participants) {
        const player = findPlayer(state, id);
        if (!player || player.status !== "active") {
          return err(`${player?.name ?? id} hiện không có mặt để thi đấu.`);
        }
        if (!isAvailableAt(player, m.round)) {
          return err(`${player.name} đã khai không có mặt ở vòng ${m.round}.`);
        }
      }
      const logicalClash = state.matches.find(
        (other) =>
          other.id !== m.id &&
          other.round === m.round &&
          other.status !== "cancelled" &&
          other.status !== "abandoned" &&
          [...other.teamA, ...other.teamB].some((id) => participants.has(id)),
      );
      if (logicalClash) return err("Có người đã có một trận khác trong cùng vòng logic.");
      const clash = state.matches.find(
        (other) =>
          other.id !== m.id &&
          other.status === "playing" &&
          (other.court === m.court ||
            [...other.teamA, ...other.teamB].some((id) => participants.has(id))),
      );
      if (clash) return err("Sân hoặc người chơi đang bận ở một trận khác.");
      m.status = "playing";
      m.startedAt = at;
      return ok(null);
    }

    case "SubmitResult": {
      const m = findMatch(state, c.matchId);
      if (!m) return err("Không tìm thấy trận.");
      if (m.status === "submitted") {
        return err("Kết quả đã được khoá. Cần mở khoá để sửa.");
      }
      if (m.status === "cancelled" || m.status === "abandoned") {
        return err("Trận này đã bị huỷ.");
      }
      if (c.scoreA === c.scoreB) return err("Trận không thể hoà.");
      if (c.scoreA < 0 || c.scoreB < 0) return err("Tỷ số không được âm.");

      m.status = "submitted";
      m.result = {
        scoreA: c.scoreA,
        scoreB: c.scoreB,
        irregular: c.irregular,
        partial: false,
        submittedBy: actor,
        submittedAt: at,
      };
      return ok(null);
    }

    case "EditResult": {
      const m = findMatch(state, c.matchId);
      if (!m) return err("Không tìm thấy trận.");
      if (!m.result) return err("Trận này chưa có kết quả để sửa.");
      if (c.scoreA === c.scoreB) return err("Trận không thể hoà.");
      if (c.scoreA < 0 || c.scoreB < 0) return err("Tỷ số không được âm.");

      const from = { scoreA: m.result.scoreA, scoreB: m.result.scoreB };
      m.result = {
        ...m.result,
        scoreA: c.scoreA,
        scoreB: c.scoreB,
        irregular: c.irregular,
      };
      m.edits.push({
        at,
        by: actor,
        from,
        to: { scoreA: c.scoreA, scoreB: c.scoreB },
        note: c.note,
      });
      return ok(null);
    }

    case "RevertResult": {
      const m = findMatch(state, c.matchId);
      if (!m) return err("Không tìm thấy trận.");
      if (!m.result) return err("Trận này chưa có kết quả.");
      const from = { scoreA: m.result.scoreA, scoreB: m.result.scoreB };
      const previousEdit = [...m.edits].reverse().find((edit) => edit.from && edit.to);
      if (previousEdit?.from) {
        m.result = { ...m.result, ...previousEdit.from };
        m.status = "submitted";
        m.edits.push({ at, by: actor, from, to: previousEdit.from, note: c.note ?? "Hoàn tác lần sửa gần nhất" });
      } else {
        m.result = null;
        m.status = state.status === "finished" ? "cancelled" : "scheduled";
        if (state.status === "finished") m.cancelReason = "Gỡ kết quả sau khi sự kiện kết thúc";
        m.edits.push({ at, by: actor, from, to: null, note: c.note ?? "Gỡ kết quả" });
      }
      return ok(null);
    }
  }

  return exhaustive(c);
}

function validateConfigPatch(patch: Partial<EventState["config"]>): string | null {
  if (patch.name !== undefined && (patch.name.trim().length < 2 || patch.name.length > 80)) {
    return "Tên sự kiện phải từ 2 đến 80 ký tự.";
  }
  if (patch.venueAddress !== undefined && patch.venueAddress.length > 200) {
    return "Địa chỉ sân tối đa 200 ký tự.";
  }
  const ranges: Array<[unknown, number, number, string]> = [
    [patch.courts, 1, 8, "Số sân"],
    [patch.expectedPlayers, 4, 200, "Số người dự kiến"],
    [patch.targetGamesPerPlayer, 1, 50, "Số trận mỗi người"],
    [patch.estimatedMatchMinutes, 5, 180, "Thời lượng trận"],
    [patch.courtTurnoverMinutes, 0, 60, "Thời gian đổi sân"],
  ];
  for (const [value, min, max, label] of ranges) {
    if (value === undefined) continue;
    if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) {
      return `${label} không hợp lệ.`;
    }
  }
  return null;
}

function exhaustive(c: never): Result<null> {
  return err(`Lệnh không xác định: ${JSON.stringify(c)}`);
}

const SPONSOR_TIER_ORDER = {
  diamond: 0,
  gold: 1,
  silver: 2,
  partner: 3,
  custom: 4,
} as const;

function validateSponsor(
  input: Omit<EventSponsor, "createdAt" | "updatedAt">,
  at: number,
): Result<EventSponsor> {
  const tiers = ["diamond", "gold", "silver", "partner", "custom"] as const;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(input.id)) return err("Mã nhà tài trợ không hợp lệ.");
  const name = input.name.trim().slice(0, 60);
  if (name.length < 2) return err("Tên nhà tài trợ phải có ít nhất 2 ký tự.");
  if (!tiers.includes(input.tier)) return err("Hạng tài trợ không hợp lệ.");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(input.assetId)) return err("Mã ảnh logo không hợp lệ.");
  const tierLabel = input.tierLabel?.trim().slice(0, 40);
  if (input.tier === "custom" && (!tierLabel || tierLabel.length < 2)) {
    return err("Hạng tự đặt cần có tên.");
  }
  return ok({
    id: input.id,
    name,
    tier: input.tier,
    ...(input.tier === "custom" ? { tierLabel } : {}),
    assetId: input.assetId,
    order: Number.isFinite(input.order) ? Math.max(0, Math.floor(input.order)) : 0,
    createdAt: at,
    updatedAt: at,
  });
}

function sortSponsors(items: EventSponsor[]): EventSponsor[] {
  return [...items].sort(
    (a, b) =>
      SPONSOR_TIER_ORDER[a.tier] - SPONSOR_TIER_ORDER[b.tier] ||
      a.order - b.order ||
      a.createdAt - b.createdAt,
  );
}

const AWARD_ORDER = {
  champion: 0,
  runnerUp: 1,
  third: 2,
  encouragement: 3,
  custom: 4,
} as const;

function validateAward(
  state: EventState,
  input: Omit<EventAward, "createdAt" | "updatedAt">,
  at: number,
): Result<EventAward> {
  const kinds = ["champion", "runnerUp", "third", "encouragement", "custom"] as const;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(input.id)) return err("Mã giải không hợp lệ.");
  if (!kinds.includes(input.kind)) return err("Bậc giải không hợp lệ.");
  const label = input.label.trim().slice(0, 40);
  const labels: Record<Exclude<EventAward["kind"], "custom">, readonly string[]> = {
    champion: ["Vô địch", "Giải nhất"],
    runnerUp: ["Á quân", "Giải nhì"],
    third: ["Giải ba"],
    encouragement: ["Khuyến khích"],
  };
  if (input.kind === "custom") {
    if (label.length < 2) return err("Giải tự đặt cần có tên.");
  } else if (!labels[input.kind].includes(label)) {
    return err("Tên giải không khớp với bậc đã chọn.");
  }
  const recipientIds = [...new Set(input.recipientIds)];
  if (recipientIds.length === 0) return err("Hãy chọn ít nhất một người nhận giải.");
  const known = new Set(state.players.map((player) => player.id));
  if (recipientIds.some((id) => !known.has(id))) return err("Giải có người nhận không tồn tại.");
  if (!(["framed", "transparent"] as const).includes(input.trophyMode)) {
    return err("Kiểu hiển thị cúp không hợp lệ.");
  }
  if (input.trophyAssetId && !/^[A-Za-z0-9_-]{1,64}$/.test(input.trophyAssetId)) {
    return err("Mã ảnh cúp không hợp lệ.");
  }
  return ok({
    id: input.id,
    kind: input.kind,
    label,
    recipientIds,
    ...(input.trophyAssetId ? { trophyAssetId: input.trophyAssetId } : {}),
    trophyMode: input.trophyMode,
    createdAt: at,
    updatedAt: at,
  });
}

function sortAwards(items: EventAward[]): EventAward[] {
  return [...items].sort(
    (a, b) => AWARD_ORDER[a.kind] - AWARD_ORDER[b.kind] || a.createdAt - b.createdAt,
  );
}
