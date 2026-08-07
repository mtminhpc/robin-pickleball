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
import { firstOpenRound } from "./rounds";
import type {
  EventState,
  Match,
  MatchId,
  Player,
  PlayerId,
  PlayerStatus,
} from "./types";
import {
  DEFAULT_CONFIG,
  closePresence,
  isFrozen,
  openPresence,
} from "./types";

export function emptyState(code: string): EventState {
  return {
    code,
    clubId: null,
    status: "draft",
    config: { ...DEFAULT_CONFIG },
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
    return ok({ ...state, processed: state.processed + 1 });
  }

  const next = structuredClone(state) as EventState;
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
  openPresence(player, firstOpenRound(state));
}

/** Đưa một người ra khỏi lịch và đóng khoảng có mặt. */
function deactivate(
  state: EventState,
  player: Player,
  status: PlayerStatus,
): void {
  const open = firstOpenRound(state);
  closePresence(player, open - 1);
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
  seed: { id: string; round: number; court: number },
  teamA: [PlayerId, PlayerId],
  teamB: [PlayerId, PlayerId],
  at: number,
): Match {
  return {
    id: seed.id,
    round: seed.round,
    court: seed.court,
    teamA,
    teamB,
    status: "scheduled",
    result: null,
    pinned: false,
    edits: [],
    createdAt: at,
  };
}

// ---------------------------------------------------------------------------

function applyInPlace(
  state: EventState,
  envelope: CommandEnvelope,
): Result<null> {
  const { command: c, at, actor } = envelope;

  // Sự kiện đã chốt thì không nhận thêm gì, trừ việc xem lại nhật ký.
  if (state.status === "finished" && c.type !== "UpdateConfig") {
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
      state.status = "finished";
      state.finishedAt = at;
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
      if (p.status !== "paused") return err("Người này không ở trạng thái nghỉ tạm.");
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
      const clash = state.matches.find(
        (o) =>
          o.id !== m.id &&
          o.round === c.toRound &&
          o.status !== "cancelled" &&
          [...o.teamA, ...o.teamB].some((id) =>
            [...m.teamA, ...m.teamB].includes(id),
          ),
      );
      if (clash) {
        return err("Có người phải đánh hai trận cùng một vòng.");
      }
      const courtTaken = state.matches.find(
        (o) =>
          o.id !== m.id &&
          o.round === c.toRound &&
          o.court === c.toCourt &&
          o.status !== "cancelled",
      );
      if (courtTaken) return err("Sân đó đã có trận trong vòng này.");

      m.round = c.toRound;
      m.court = c.toCourt;
      m.pinned = true;
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
      m.status = "playing";
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
      m.result = null;
      m.status = "scheduled";
      m.edits.push({ at, by: actor, from, to: null, note: c.note ?? "Gỡ kết quả" });
      return ok(null);
    }
  }

  return exhaustive(c);
}

function exhaustive(c: never): Result<null> {
  return err(`Lệnh không xác định: ${JSON.stringify(c)}`);
}
