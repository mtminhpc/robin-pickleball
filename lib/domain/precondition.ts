import type { Command, CommandEnvelope } from "./commands";
import type { EventState, Match, PlayerId } from "./types";

type Precondition = NonNullable<CommandEnvelope["precondition"]>;

/**
 * Tạo điều kiện so-sánh cho đúng thực thể mà lệnh sẽ thay đổi.
 *
 * Không dùng `state.processed`: một Phó điểm danh ở sân 1 không được làm lệnh nhập điểm độc lập
 * ở sân 2 thất bại. Ngược lại, mọi lệnh cùng sửa một trận/vị trí hoặc tạo ra người chơi trùng sân
 * đều nhìn thấy cùng một tập xung đột và chỉ lệnh đứng trước trong log được áp dụng.
 */
export function commandPrecondition(
  state: EventState,
  command: Command,
): Precondition | undefined {
  const value = preconditionValue(state, command);
  return value === undefined
    ? undefined
    : { version: 1, fingerprint: JSON.stringify(value) };
}

export function preconditionStillHolds(
  state: EventState,
  command: Command,
  expected: Precondition,
): boolean {
  if (expected.version !== 1) return false;
  return commandPrecondition(state, command)?.fingerprint === expected.fingerprint;
}

function preconditionValue(state: EventState, command: Command): unknown | undefined {
  switch (command.type) {
    case "SubmitResult":
    case "EditResult":
    case "RevertResult":
    case "CancelMatch":
    case "AbandonMatch":
    case "PinMatch":
      return ["match", matchStamp(findMatch(state, command.matchId))];

    case "StartMatch": {
      const target = findMatch(state, command.matchId);
      if (!target) return ["start", null];
      const players = new Set([...target.teamA, ...target.teamB]);
      return [
        "start",
        matchStamp(target),
        state.matches
          .filter(
            (match) =>
              match.id !== target.id &&
              match.status === "playing" &&
              (match.court === target.court || intersects(match, players)),
          )
          .map(matchStamp)
          .sort(byJson),
      ];
    }

    case "PromoteMatch":
    case "ReorderMatch": {
      const target = findMatch(state, command.matchId);
      if (!target) return ["move", null];
      const players = new Set([...target.teamA, ...target.teamB]);
      return [
        "move",
        matchStamp(target),
        command.toRound,
        command.toCourt,
        state.matches
          .filter(
            (match) =>
              match.id !== target.id &&
              match.status !== "cancelled" &&
              ((match.round === command.toRound &&
                (match.court === command.toCourt || intersects(match, players))) ||
                (match.status === "playing" &&
                  (match.court === command.toCourt || intersects(match, players)))),
          )
          .map(matchStamp)
          .sort(byJson),
      ];
    }

    case "TransferMatch": {
      const target = findMatch(state, command.matchId);
      return [
        "transfer",
        matchStamp(target),
        command.toCourtId,
        state.courts,
        state.matches
          .filter(
            (match) =>
              match.id !== command.matchId &&
              (match.status === "playing" ||
                (target && match.round === target.round && match.status === "scheduled")),
          )
          .map(matchStamp)
          .sort(byJson),
      ];
    }

    case "SetSchedule":
      return [
        "schedule",
        command.fromRound,
        state.matches
          .filter((match) => match.round >= command.fromRound && match.status === "scheduled")
          .map(matchStamp)
          .sort(byJson),
      ];

    case "MarkArrived":
    case "ApproveJoin":
    case "RejectJoin":
    case "PausePlayer":
    case "ResumePlayer":
    case "PlayerLeft":
    case "RemovePlayer":
    case "GrantCatchUp":
    case "DeclareAvailability":
    case "SetPlayerPlan":
    case "ConfirmPlayerSpan":
    case "UpdateProfile":
    case "ClaimPlayer":
    case "LinkAccount":
    case "Rsvp": {
      const player = state.players.find((item) => item.id === command.playerId);
      return [
        "player",
        player
          ? {
              id: player.id,
              status: player.status,
              name: player.name,
              catchUpCredit: player.catchUpCredit,
              available: player.available ?? null,
              availability: player.availability,
              presence: player.presence,
              userId: player.userId ?? "",
            }
          : null,
        state.matches
          .filter(
            (match) =>
              (match.status === "scheduled" || match.status === "playing") &&
              [...match.teamA, ...match.teamB].includes(command.playerId),
          )
          .map(matchStamp)
          .sort(byJson),
      ];
    }

    case "UpdateConfig":
      return [
        "config",
        Object.keys(command.patch)
          .sort()
          .map((key) => [key, state.config[key as keyof typeof state.config]]),
      ];

    case "AddCourt":
    case "RenameCourt":
    case "ReorderCourts":
    case "SetCourtAvailability":
    case "ArchiveCourt":
      return ["courts", state.courts];

    case "StartRoundRobinCampaign":
    case "RemoveRoundRobinPlayer":
    case "ResumeAmericano":
      return [
        "round-robin",
        state.scheduleMode,
        state.roundRobinCampaign,
        state.matches
          .filter((match) => match.status === "scheduled" || match.status === "playing")
          .map(matchStamp)
          .sort(byJson),
      ];

    case "StartEvent":
    case "EndEventEarly":
    case "FinishEvent":
      return ["lifecycle", state.status, openMatchStamps(state)];

    case "SetSponsorLogoShape":
      return ["sponsor-shape", state.presentation.sponsorLogoShape];
    case "UpsertSponsor":
      return [
        "sponsor",
        state.presentation.sponsors.find((item) => item.id === command.sponsor.id) ?? null,
      ];
    case "RemoveSponsor":
      return [
        "sponsor",
        state.presentation.sponsors.find((item) => item.id === command.sponsorId) ?? null,
      ];
    case "ReorderSponsors":
      return ["sponsor-order", state.presentation.sponsors.map((item) => item.id)];
    case "UpsertAward":
      return [
        "award",
        state.presentation.awards.find((item) => item.id === command.award.id) ?? null,
      ];
    case "RemoveAward":
      return [
        "award",
        state.presentation.awards.find((item) => item.id === command.awardId) ?? null,
      ];

    // Việc tạo mới, thêm một người mới có id riêng và log xếp lịch do máy chủ sinh không cần
    // điều kiện đích. Reducer vẫn kiểm tra id trùng và các ràng buộc nghiệp vụ của chúng.
    case "CreateEvent":
    case "AddPlayer":
    case "RequestJoin":
    case "SwapRounds":
      return undefined;
  }
}

function findMatch(state: EventState, id: string): Match | undefined {
  return state.matches.find((match) => match.id === id);
}

function matchStamp(match: Match | undefined) {
  if (!match) return null;
  return {
    id: match.id,
    round: match.round,
    courtId: match.courtId,
    courtLabelId: match.courtLabelId,
    court: match.court,
    courtWave: match.courtWave,
    teamA: match.teamA,
    teamB: match.teamB,
    status: match.status,
    result: match.result,
    pinned: match.pinned,
    startedAt: match.startedAt,
    cancelReason: match.cancelReason ?? "",
    edits: match.edits.length,
  };
}

function intersects(match: Match, players: Set<PlayerId>): boolean {
  return [...match.teamA, ...match.teamB].some((id) => players.has(id));
}

function openMatchStamps(state: EventState) {
  return state.matches
    .filter((match) => match.status === "scheduled" || match.status === "playing")
    .map(matchStamp)
    .sort(byJson);
}

function byJson(a: unknown, b: unknown): number {
  return JSON.stringify(a).localeCompare(JSON.stringify(b));
}
