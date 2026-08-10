import type { Actor, EventCourt, EventState, PlannedSpan, RoundSpan } from "./types";
import { activeCourtsAt, courtLabelAt, isEligibleAt, normalizeCourtName } from "./types";
import type { Command, MatchSeed } from "./commands";
import { apply } from "./reduce";
import { firstOpenRound } from "./rounds";
import { planSchedule } from "../scheduler/plan";
import type {
  RoundRobinForecast,
  RoundRobinPlanOutcome,
} from "../scheduler/round-robin";

export type StructureIntent =
  | {
      type: "add-court";
      courtId: string;
      labelId: string;
      name: string;
      availability: RoundSpan[];
      requestedFromRound?: number;
    }
  | {
      type: "set-court-availability";
      courtId: string;
      availability: RoundSpan[];
      requestedFromRound?: number;
    }
  | {
      type: "archive-court";
      courtId: string;
      archived: boolean;
      requestedFromRound?: number;
    }
  | {
      type: "set-player-plan";
      playerId: string;
      availability: PlannedSpan[];
      requestedFromRound?: number;
    }
  | {
      type: "confirm-player-span";
      playerId: string;
      spanId: string;
      requestedFromRound?: number;
    }
  | {
      type: "transfer-match";
      matchId: string;
      toCourtId: string;
      toCourtLabelId?: string;
      closeSourceAfter?: boolean;
      requestedFromRound?: number;
      newCourt?: {
        courtId: string;
        labelId: string;
        name: string;
        availability: RoundSpan[];
      };
    }
  | {
      type: "start-round-robin";
      campaignId: string;
      requestedFromRound?: number;
    }
  | {
      type: "remove-round-robin-player";
      playerId: string;
      requestedFromRound?: number;
    }
  | {
      type: "resume-americano";
      requestedFromRound?: number;
    };

export interface StructureDiff {
  courtsAdded: string[];
  courtsChanged: string[];
  playersChanged: string[];
  matchesAdded: number;
  matchesRemoved: number;
  matchesMoved: number;
  transferredMatchId: string | null;
}

export interface StructurePreviewPlan {
  effectiveRound: number;
  commands: Command[];
  schedule: Extract<Command, { type: "SetSchedule" }>;
  after: EventState;
  diff: StructureDiff;
  warnings: string[];
  blocked: string[];
  roundRobin: RoundRobinForecast | null;
}

export interface StructurePlanningOptions {
  iterations?: number;
  timeBudgetMs?: number;
}

/**
 * Hàm thuần dựng đúng batch sẽ được ký trong preview token.
 * `now` và actor được truyền vào để replay preview/confirm cho cùng kết quả.
 */
export function previewStructureChange(
  state: EventState,
  intent: StructureIntent,
  actor: Actor,
  now: number,
  planning: StructurePlanningOptions = {},
): StructurePreviewPlan {
  const earliest = earliestEffectiveRound(state, intent);
  const requested = Math.max(1, Math.trunc(intent.requestedFromRound ?? earliest));
  const effectiveRound = Math.max(earliest, requested);
  const compiled = compileIntent(state, intent, effectiveRound);
  if (!compiled.ok) return blockedPlan(state, effectiveRound, compiled.error);

  let afterIntent = state;
  for (const [index, command] of compiled.commands.entries()) {
    const outcome = apply(afterIntent, {
      id: `structure-preview-${state.processed}-${index}`,
      at: now + index,
      actor,
      command,
    });
    if (!outcome.ok) return blockedPlan(state, effectiveRound, outcome.error);
    afterIntent = outcome.value;
  }

  const pinnedConflict = findPinnedConflict(afterIntent, effectiveRound);
  if (pinnedConflict) return blockedPlan(state, effectiveRound, pinnedConflict);

  const planned = planSchedule(afterIntent, {
    mode: "rebuild",
    fromRound: effectiveRound,
    iterations: planning.iterations,
    timeBudgetMs: planning.timeBudgetMs,
  });
  const roundRobin = (planned as Partial<RoundRobinPlanOutcome>).forecast ?? null;
  if (
    intent.type === "start-round-robin" &&
    roundRobin &&
    roundRobin.unresolvedPairs.length > 0 &&
    hasFutureCourtCapacity(afterIntent, effectiveRound)
  ) {
    return blockedPlan(
      state,
      effectiveRound,
      `Không thể phủ ${roundRobin.unresolvedPairs.length} cặp với ca người/sân hiện tại.`,
      roundRobin,
    );
  }
  const noCapacity = planned.blocked !== null;
  const schedule: Extract<Command, { type: "SetSchedule" }> = {
    type: "SetSchedule",
    fromRound: effectiveRound,
    matches: planned.matches,
    changeKind: intent.type,
  };
  const scheduled = apply(afterIntent, {
    id: `structure-preview-${state.processed}-schedule`,
    at: now + compiled.commands.length,
    actor,
    command: schedule,
  });
  if (!scheduled.ok) return blockedPlan(state, effectiveRound, scheduled.error);

  return {
    effectiveRound,
    commands: compiled.commands,
    schedule,
    after: scheduled.value,
    diff: diffStates(state, scheduled.value, intent),
    warnings: [
      ...(effectiveRound > requested
        ? [`Mốc sớm nhất an toàn là vòng ${effectiveRound}.`]
        : []),
      ...(noCapacity && planned.blocked ? [planned.blocked] : []),
      ...(planned.hardViolations > 0
        ? [`Phương án tốt nhất còn ${planned.hardViolations} vi phạm trần chuỗi.`]
        : []),
    ],
    blocked: [],
    roundRobin,
  };
}

function hasFutureCourtCapacity(state: EventState, fromRound: number): boolean {
  return state.courts.some(
    (court) =>
      !court.archived &&
      court.availability.some((span) => span.to === null || span.to >= fromRound),
  );
}

function earliestEffectiveRound(state: EventState, intent: StructureIntent): number {
  const open = firstOpenRound(state);
  if (intent.type !== "set-player-plan") return open;
  const playing = state.matches.filter(
    (match) =>
      match.status === "playing" &&
      [...match.teamA, ...match.teamB].includes(intent.playerId),
  );
  return Math.max(open, ...playing.map((match) => match.round + 1), 1);
}

function compileIntent(
  state: EventState,
  intent: StructureIntent,
  effectiveRound: number,
): { ok: true; commands: Command[] } | { ok: false; error: string } {
  switch (intent.type) {
    case "add-court": {
      const name = normalizeCourtName(intent.name);
      const court: EventCourt = {
        id: intent.courtId,
        order: state.courts.length + 1,
        labels: [{ id: intent.labelId, name, effectiveFromRound: effectiveRound }],
        availability: intent.availability,
        archived: false,
      };
      return { ok: true, commands: [{ type: "AddCourt", court, effectiveRound }] };
    }
    case "set-court-availability":
      return {
        ok: true,
        commands: [{
          type: "SetCourtAvailability",
          courtId: intent.courtId,
          availability: intent.availability,
          effectiveRound,
        }],
      };
    case "archive-court":
      return {
        ok: true,
        commands: [{
          type: "ArchiveCourt",
          courtId: intent.courtId,
          archived: intent.archived,
          effectiveRound,
        }],
      };
    case "set-player-plan":
      return {
        ok: true,
        commands: [{
          type: "SetPlayerPlan",
          playerId: intent.playerId,
          availability: intent.availability,
          effectiveRound,
        }],
      };
    case "confirm-player-span":
      return {
        ok: true,
        commands: [{ type: "ConfirmPlayerSpan", playerId: intent.playerId, spanId: intent.spanId }],
      };
    case "transfer-match": {
      const match = state.matches.find((item) => item.id === intent.matchId);
      if (!match) return { ok: false, error: "Không tìm thấy trận cần chuyển." };
      let court = state.courts.find((item) => item.id === intent.toCourtId);
      let newCourt: EventCourt | undefined;
      if (!court && intent.newCourt) {
        newCourt = {
          id: intent.newCourt.courtId,
          order: state.courts.length + 1,
          labels: [{
            id: intent.newCourt.labelId,
            name: normalizeCourtName(intent.newCourt.name),
            effectiveFromRound: effectiveRound,
          }],
          availability: intent.newCourt.availability,
          archived: false,
        };
        court = newCourt;
      }
      if (!court) return { ok: false, error: "Không tìm thấy sân đích." };
      const label = intent.toCourtLabelId
        ? court.labels.find((item) => item.id === intent.toCourtLabelId)
        : courtLabelAt(court, match.round);
      if (!label) return { ok: false, error: "Không tìm thấy tên sân đích." };
      return { ok: true, commands: [{
        type: "TransferMatch",
        matchId: intent.matchId,
        toCourtId: court.id,
        toCourtLabelId: label.id,
        effectiveRound,
        closeSourceAfter: Boolean(intent.closeSourceAfter),
        ...(newCourt ? { newCourt } : {}),
      }] };
    }
    case "start-round-robin": {
      const playerIds = state.players
        .filter(
          (player) =>
            player.status === "active" && isEligibleAt(player, effectiveRound),
        )
        .map((player) => player.id);
      if (playerIds.length < 4) {
        return { ok: false, error: "Cần ít nhất 4 người đang trong ca để chuyển round robin." };
      }
      return {
        ok: true,
        commands: [{
          type: "StartRoundRobinCampaign",
          campaignId: intent.campaignId,
          playerIds,
          effectiveRound,
        }],
      };
    }
    case "remove-round-robin-player": {
      const campaign = state.roundRobinCampaign;
      if (!campaign) return { ok: false, error: "Không có chiến dịch round robin." };
      return {
        ok: true,
        commands: [{
          type: "RemoveRoundRobinPlayer",
          campaignId: campaign.id,
          playerId: intent.playerId,
          effectiveRound,
        }],
      };
    }
    case "resume-americano": {
      const campaign = state.roundRobinCampaign;
      if (!campaign) return { ok: false, error: "Không có chiến dịch round robin." };
      return {
        ok: true,
        commands: [{
          type: "ResumeAmericano",
          campaignId: campaign.id,
          effectiveRound,
        }],
      };
    }
  }
}

function findPinnedConflict(state: EventState, effectiveRound: number): string | null {
  for (const match of state.matches) {
    if (!match.pinned || match.status !== "scheduled" || match.round < effectiveRound) continue;
    if (!activeCourtsAt(state, match.round).some((court) => court.id === match.courtId)) {
      return `Trận ghim ${match.id} đang nằm trên sân không hoạt động ở vòng ${match.round}.`;
    }
    for (const playerId of [...match.teamA, ...match.teamB]) {
      const player = state.players.find((item) => item.id === playerId);
      if (!player || player.status !== "active" || !isEligibleAt(player, match.round)) {
        return `Trận ghim ${match.id} xung đột với ca của người chơi ở vòng ${match.round}.`;
      }
    }
  }
  return null;
}

function diffStates(
  before: EventState,
  after: EventState,
  intent: StructureIntent,
): StructureDiff {
  const beforeCourts = new Map(before.courts.map((court) => [court.id, JSON.stringify(court)]));
  const beforePlayers = new Map(before.players.map((player) => [player.id, JSON.stringify({
    status: player.status,
    availability: player.availability ?? [],
    presence: player.presence,
  })]));
  const beforeMatches = new Map(before.matches.map((match) => [match.id, match]));
  const afterMatches = new Map(after.matches.map((match) => [match.id, match]));
  let moved = 0;
  for (const [id, match] of afterMatches) {
    const old = beforeMatches.get(id);
    if (
      old &&
      (old.round !== match.round || old.courtId !== match.courtId || old.courtWave !== match.courtWave)
    ) moved += 1;
  }
  return {
    courtsAdded: after.courts.filter((court) => !beforeCourts.has(court.id)).map((court) => court.id),
    courtsChanged: after.courts
      .filter((court) => beforeCourts.has(court.id) && beforeCourts.get(court.id) !== JSON.stringify(court))
      .map((court) => court.id),
    playersChanged: after.players
      .filter((player) => beforePlayers.get(player.id) !== JSON.stringify({
        status: player.status,
        availability: player.availability ?? [],
        presence: player.presence,
      }))
      .map((player) => player.id),
    matchesAdded: [...afterMatches.keys()].filter((id) => !beforeMatches.has(id)).length,
    matchesRemoved: [...beforeMatches.keys()].filter((id) => !afterMatches.has(id)).length,
    matchesMoved: moved,
    transferredMatchId: intent.type === "transfer-match" ? intent.matchId : null,
  };
}

function blockedPlan(
  state: EventState,
  effectiveRound: number,
  error: string,
  roundRobin: RoundRobinForecast | null = null,
): StructurePreviewPlan {
  const schedule: Extract<Command, { type: "SetSchedule" }> = {
    type: "SetSchedule",
    fromRound: effectiveRound,
    matches: [] as MatchSeed[],
  };
  return {
    effectiveRound,
    commands: [],
    schedule,
    after: state,
    diff: {
      courtsAdded: [],
      courtsChanged: [],
      playersChanged: [],
      matchesAdded: 0,
      matchesRemoved: 0,
      matchesMoved: 0,
      transferredMatchId: null,
    },
    warnings: [],
    blocked: [error],
    roundRobin,
  };
}
