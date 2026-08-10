import type { MatchSeed } from "../domain/commands";
import { firstOpenRound } from "../domain/rounds";
import {
  roundRobinProgress,
  type RoundRobinPair,
} from "../domain/round-robin";
import {
  activeCourtsAt,
  courtLabelAt,
  isEligibleAt,
  type EventState,
  type Match,
  type PlayerId,
} from "../domain/types";
import { buildHistory } from "./metrics";
import type { PlanMode, PlanOutcome, PlanOptions } from "./plan";

interface Edge {
  a: PlayerId;
  b: PlayerId;
  factor: number;
}

interface Task {
  left: Edge;
  right: Edge | null;
}

export interface RoundRobinForecast {
  cohortPlayerIds: PlayerId[];
  cohortPlayers: Array<{ id: PlayerId; name: string }>;
  outsideCohortPlayers: Array<{ id: PlayerId; name: string }>;
  excludedPlayerIds: PlayerId[];
  totalPairs: number;
  coveredPairs: number;
  missingPairs: RoundRobinPair[];
  repeatedPairs: number;
  projectedMatches: number;
  projectedRounds: number;
  estimatedMinutes: number;
  preservedMatches: number;
  unavoidableRepeatMatches: number;
  unresolvedPairs: RoundRobinPair[];
}

export interface RoundRobinPlanOutcome extends PlanOutcome {
  forecast: RoundRobinForecast | null;
}

/**
 * Dựng lịch hoàn thiện cặp trên toàn chân trời rồi chỉ trả cửa sổ rolling.
 * One-factorization cho thứ tự cạnh ổn định; bước ghép cạnh rời nhau tối đa hoá
 * số trận phủ hai cặp mới trước khi phải dùng một đội phụ đã lặp.
 */
export function planRoundRobinSchedule(
  state: EventState,
  options: PlanOptions = {},
): RoundRobinPlanOutcome {
  const campaign = state.roundRobinCampaign;
  const fromRound = Math.max(firstOpenRound(state), options.fromRound ?? 1);
  if (!campaign || state.scheduleMode !== "round-robin") {
    return empty(fromRound, "Sự kiện chưa có chiến dịch round robin.");
  }
  const progress = roundRobinProgress(state, campaign)!;
  if (campaign.status !== "active" || progress.missingPairs.length === 0) {
    return {
      fromRound,
      matches: [],
      blocked: null,
      optimization: null,
      hardViolations: 0,
      forecast: forecastOf(state, progress, campaign.playerIds, [], [], 0, 0),
    };
  }

  const mode: PlanMode = options.mode ?? "extend";
  const lookahead = Math.max(1, options.lookahead ?? state.config.lookaheadRounds);
  const players = new Map(state.players.map((player) => [player.id, player] as const));
  const active = state.players.filter((player) => player.status === "active");
  if (active.length < 4) {
    return empty(fromRound, `Mới có ${active.length} người đang chơi — cần ít nhất 4 người.`, {
      ...forecastOf(state, progress, campaign.playerIds, [], progress.missingPairs, 0, 0),
    });
  }

  const fixed = fixedMatches(state, fromRound, mode);
  const projectedPartner = pairCounts(state, campaign.playerIds, campaign.countedMatchIds);
  const projectedOpponent = opponentCounts(state, campaign.playerIds, campaign.countedMatchIds);
  const alreadyCounted = new Set(campaign.countedMatchIds);
  for (const match of fixed) {
    if (!alreadyCounted.has(match.id)) {
      addMatchCounts(match, campaign.playerIds, projectedPartner, projectedOpponent);
    }
  }

  const factors = factorOrder(campaign.playerIds);
  const missingKeys = new Set(progress.missingPairs.map((pair) => pairKey(pair.a, pair.b)));
  const edges = factors
    .flatMap((factor, factorIndex) =>
      factor.map(([a, b]) => ({ a, b, factor: factorIndex })),
    )
    // A pinned/committed scheduled match is a future constraint: keep it and do
    // not generate the same missing partnership elsewhere in the forecast.
    .filter(
      (edge) =>
        missingKeys.has(pairKey(edge.a, edge.b)) &&
        matrixAt(projectedPartner, campaign.playerIds, edge.a, edge.b) === 0,
    );
  const tasks = pairEdges(edges, campaign.playerIds, projectedPartner, projectedOpponent);

  const fixedByRound = new Map<number, Match[]>();
  for (const match of fixed) {
    const list = fixedByRound.get(match.round) ?? [];
    list.push(match);
    fixedByRound.set(match.round, list);
  }

  const history = buildHistory(state, active.map((player) => player.id));
  const scheduledGames = new Map<PlayerId, number>(
    active.map((player) => [player.id, history.games[history.index.get(player.id)!] ?? 0]),
  );
  const allSeeds: MatchSeed[] = fixed
    // Trận ghim được reducer tự giữ; phát lại trong SetSchedule sẽ nhân đôi nó.
    .filter((match) => match.status === "scheduled" && !match.pinned)
    .map(seedOf);
  const unresolved: Edge[] = [];
  let repeatedFillers = 0;
  let lastPlannedRound = fromRound - 1;
  let taskCursor = 0;
  const maxRound = Math.min(100_000, fromRound + Math.max(200, tasks.length * 4 + 80));

  for (let round = fromRound; round <= maxRound && taskCursor < tasks.length; round++) {
    const courts = activeCourtsAt(state, round);
    if (courts.length === 0) continue;
    const frozen = fixedByRound.get(round) ?? [];
    const busy = new Set<PlayerId>(frozen.flatMap((match) => [...match.teamA, ...match.teamB]));
    const takenCourts = new Set(frozen.map((match) => match.courtId));
    const free = courts.filter((court) => !takenCourts.has(court.id));
    if (free.length === 0) continue;
    const reserveForOutsiders = shouldReserveOutsiderCourt(
      active.map((player) => player.id),
      campaign.playerIds,
      round,
      players,
      scheduledGames,
    );
    const taskCourtLimit = Math.max(0, free.length - (reserveForOutsiders ? 1 : 0));

    let placedThisRound = 0;
    // Quét toàn bộ phần chưa đặt để một task đang chờ người không chặn các task khác.
    for (let scan = taskCursor; scan < tasks.length && placedThisRound < taskCourtLimit; scan++) {
      const task = tasks[scan]!;
      const teamA: [PlayerId, PlayerId] = [task.left.a, task.left.b];
      let teamB: [PlayerId, PlayerId] | null = task.right
        ? [task.right.a, task.right.b]
        : null;
      if (
        teamA.some((id) => busy.has(id) || !eligible(players.get(id), round)) ||
        (teamB && teamB.some((id) => busy.has(id) || !eligible(players.get(id), round)))
      ) {
        continue;
      }
      if (!teamB) {
        teamB = chooseFiller(
          active.map((player) => player.id),
          new Set([...busy, ...teamA]),
          round,
          players,
          campaign.playerIds,
          missingKeys,
          projectedPartner,
          projectedOpponent,
          scheduledGames,
        );
        if (!teamB) continue;
        repeatedFillers += 1;
      }
      const court = free[placedThisRound]!;
      const label = courtLabelAt(court, round);
      const seed: MatchSeed = {
        id: `rr-${campaign.id}-${round}-${court.id}-${allSeeds.length + 1}`,
        round,
        court: court.order,
        courtId: court.id,
        courtLabelId: label.id,
        teamA,
        teamB,
      };
      allSeeds.push(seed);
      for (const id of [...teamA, ...teamB]) {
        busy.add(id);
        scheduledGames.set(id, (scheduledGames.get(id) ?? 0) + 1);
      }
      addSeedCounts(seed, campaign.playerIds, projectedPartner, projectedOpponent);
      tasks.splice(scan, 1);
      scan -= 1;
      placedThisRound += 1;
      lastPlannedRound = Math.max(lastPlannedRound, round);
    }

    fillOutsiderMatches({
      state,
      round,
      freeCourts: free.slice(placedThisRound),
      busy,
      activeIds: active.map((player) => player.id),
      targetIds: campaign.playerIds,
      players,
      missingKeys,
      partner: projectedPartner,
      opponent: projectedOpponent,
      scheduledGames,
      seeds: allSeeds,
      campaignId: campaign.id,
    });
  }

  for (const task of tasks) {
    unresolved.push(task.left);
    if (task.right) unresolved.push(task.right);
  }
  const unresolvedPairs = unresolved.map((edge) => pairInfo(state, edge));
  const materialized = allSeeds.filter(
    (seed) => seed.round < fromRound + lookahead,
  );
  const forecast = forecastOf(
    state,
    progress,
    campaign.playerIds,
    allSeeds,
    unresolvedPairs,
    lastPlannedRound,
    repeatedFillers,
  );

  return {
    fromRound,
    matches: materialized,
    blocked:
      materialized.length === 0 && unresolvedPairs.length > 0
        ? `Chưa thể xếp ${unresolvedPairs.length} cặp còn thiếu với ca người/sân hiện tại.`
        : null,
    optimization: null,
    hardViolations: 0,
    forecast,
  };
}

function fixedMatches(state: EventState, fromRound: number, mode: PlanMode): Match[] {
  return state.matches.filter((match) => {
    if (match.round < fromRound) return false;
    // Cancelled-before-start matches remain in the append-only history, but
    // they neither occupy a slot nor cover a partnership for the campaign.
    if (match.status === "cancelled") return false;
    if (match.status !== "scheduled" || match.pinned) return true;
    return mode === "extend" && match.round < fromRound + state.config.commitRounds;
  });
}

/** One-factorization của K_n; thêm một BYE khi n lẻ. */
function factorOrder(ids: PlayerId[]): Array<Array<[PlayerId, PlayerId]>> {
  const ring: Array<PlayerId | null> = [...ids];
  if (ring.length % 2 === 1) ring.push(null);
  const factors: Array<Array<[PlayerId, PlayerId]>> = [];
  for (let round = 0; round < ring.length - 1; round++) {
    const pairs: Array<[PlayerId, PlayerId]> = [];
    for (let i = 0; i < ring.length / 2; i++) {
      const a = ring[i];
      const b = ring[ring.length - 1 - i];
      if (a && b) pairs.push([a, b]);
    }
    factors.push(pairs);
    ring.splice(1, 0, ring.pop()!);
  }
  return factors;
}

function pairEdges(
  input: Edge[],
  targetIds: PlayerId[],
  partner: Int32Array,
  opponent: Int32Array,
): Task[] {
  const edges = [...input];
  const tasks: Task[] = [];
  // Pairing needs projected opponent counts for its own greedy choices, but
  // the scheduling phase must only see matches that were actually placed in
  // an earlier round. Otherwise an outsider game can rely on a partnership
  // that is merely planned later in the forecast.
  const pairingPartner = partner.slice();
  const pairingOpponent = opponent.slice();
  while (edges.length > 0) {
    const left = edges.shift()!;
    let best = -1;
    let bestCost = Number.POSITIVE_INFINITY;
    for (let i = 0; i < edges.length; i++) {
      const right = edges[i]!;
      if (shares(left, right)) continue;
      const cost = opponentCost(left, right, targetIds, pairingOpponent) + right.factor * 1e-6;
      if (cost < bestCost) {
        bestCost = cost;
        best = i;
      }
    }
    const right = best >= 0 ? edges.splice(best, 1)[0]! : null;
    tasks.push({ left, right });
    addEdge(pairingPartner, targetIds, left);
    if (right) {
      addEdge(pairingPartner, targetIds, right);
      addOpponentEdges(pairingOpponent, targetIds, left, right);
    }
  }
  return tasks;
}

function shouldReserveOutsiderCourt(
  activeIds: PlayerId[],
  targetIds: PlayerId[],
  round: number,
  players: Map<PlayerId, EventState["players"][number]>,
  games: Map<PlayerId, number>,
): boolean {
  const target = new Set(targetIds);
  const eligibleTargets = activeIds.filter(
    (id) => target.has(id) && eligible(players.get(id), round),
  );
  const eligibleOutsiders = activeIds.filter(
    (id) => !target.has(id) && eligible(players.get(id), round),
  );
  if (eligibleTargets.length < 3 || eligibleOutsiders.length === 0) return false;
  const targetAverage = eligibleTargets.reduce((sum, id) => sum + (games.get(id) ?? 0), 0) /
    eligibleTargets.length;
  const outsiderMinimum = Math.min(...eligibleOutsiders.map((id) => games.get(id) ?? 0));
  return outsiderMinimum + 0.25 < targetAverage;
}

function chooseFiller(
  activeIds: PlayerId[],
  busy: Set<PlayerId>,
  round: number,
  players: Map<PlayerId, EventState["players"][number]>,
  targetIds: PlayerId[],
  missing: Set<string>,
  partner: Int32Array,
  opponent: Int32Array,
  games: Map<PlayerId, number>,
): [PlayerId, PlayerId] | null {
  const target = new Set(targetIds);
  let best: [PlayerId, PlayerId] | null = null;
  let bestCost = Number.POSITIVE_INFINITY;
  for (let i = 0; i < activeIds.length; i++) {
    const a = activeIds[i]!;
    if (busy.has(a) || !eligible(players.get(a), round)) continue;
    for (let j = i + 1; j < activeIds.length; j++) {
      const b = activeIds[j]!;
      if (busy.has(b) || !eligible(players.get(b), round)) continue;
      if (target.has(a) && target.has(b) && missing.has(pairKey(a, b))) continue;
      const count = matrixAt(partner, targetIds, a, b);
      const opp = [...busy].reduce(
        (sum, id) => sum + matrixAt(opponent, targetIds, a, id) + matrixAt(opponent, targetIds, b, id),
        0,
      );
      const cost = count * 1_000 + opp * 10 + (games.get(a) ?? 0) + (games.get(b) ?? 0);
      if (cost < bestCost) {
        bestCost = cost;
        best = [a, b];
      }
    }
  }
  return best;
}

function fillOutsiderMatches(input: {
  state: EventState;
  round: number;
  freeCourts: ReturnType<typeof activeCourtsAt>;
  busy: Set<PlayerId>;
  activeIds: PlayerId[];
  targetIds: PlayerId[];
  players: Map<PlayerId, EventState["players"][number]>;
  missingKeys: Set<string>;
  partner: Int32Array;
  opponent: Int32Array;
  scheduledGames: Map<PlayerId, number>;
  seeds: MatchSeed[];
  campaignId: string;
}): void {
  const target = new Set(input.targetIds);
  for (const court of input.freeCourts) {
    const candidates = input.activeIds
      .filter((id) => !input.busy.has(id) && eligible(input.players.get(id), input.round))
      .sort((a, b) => {
        const outsider = Number(target.has(a)) - Number(target.has(b));
        return outsider || (input.scheduledGames.get(a) ?? 0) - (input.scheduledGames.get(b) ?? 0);
      });
    if (candidates.length < 4 || !candidates.slice(0, 4).some((id) => !target.has(id))) return;
    const picked = candidates.slice(0, 4);
    const pairings: Array<[[PlayerId, PlayerId], [PlayerId, PlayerId]]> = [
      [[picked[0]!, picked[1]!], [picked[2]!, picked[3]!]],
      [[picked[0]!, picked[2]!], [picked[1]!, picked[3]!]],
      [[picked[0]!, picked[3]!], [picked[1]!, picked[2]!]],
    ];
    const valid = pairings.filter(([a, b]) =>
      ![a, b].some(
        ([x, y]) =>
          target.has(x) &&
          target.has(y) &&
          input.missingKeys.has(pairKey(x, y)) &&
          matrixAt(input.partner, input.targetIds, x, y) === 0,
      ),
    );
    if (valid.length === 0) return;
    valid.sort(([a1, b1], [a2, b2]) =>
      pairCost(a1, b1, input.targetIds, input.partner, input.opponent) -
      pairCost(a2, b2, input.targetIds, input.partner, input.opponent),
    );
    const [teamA, teamB] = valid[0]!;
    const seed: MatchSeed = {
      id: `rr-${input.campaignId}-${input.round}-${court.id}-${input.seeds.length + 1}`,
      round: input.round,
      court: court.order,
      courtId: court.id,
      courtLabelId: courtLabelAt(court, input.round).id,
      teamA,
      teamB,
    };
    input.seeds.push(seed);
    for (const id of [...teamA, ...teamB]) {
      input.busy.add(id);
      input.scheduledGames.set(id, (input.scheduledGames.get(id) ?? 0) + 1);
    }
    addSeedCounts(seed, input.targetIds, input.partner, input.opponent);
  }
}

function forecastOf(
  state: EventState,
  progress: NonNullable<ReturnType<typeof roundRobinProgress>>,
  cohortPlayerIds: PlayerId[],
  planned: MatchSeed[],
  unresolvedPairs: RoundRobinPair[],
  lastRound: number,
  repeatMatches: number,
): RoundRobinForecast {
  const effective = state.roundRobinCampaign?.effectiveRound ?? firstOpenRound(state);
  const rounds = lastRound >= effective ? lastRound - effective + 1 : 0;
  return {
    cohortPlayerIds,
    cohortPlayers: cohortPlayerIds.map((id) => ({
      id,
      name: state.players.find((player) => player.id === id)?.name ?? id,
    })),
    outsideCohortPlayers: state.players
      .filter((player) => !cohortPlayerIds.includes(player.id))
      .map((player) => ({ id: player.id, name: player.name })),
    excludedPlayerIds: progress.absentPlayerIds,
    totalPairs: progress.totalPairs,
    coveredPairs: progress.coveredPairs,
    missingPairs: progress.missingPairs,
    repeatedPairs: progress.repeatedPairs,
    projectedMatches: planned.length,
    projectedRounds: rounds,
    estimatedMinutes:
      rounds * (state.config.estimatedMatchMinutes + state.config.courtTurnoverMinutes),
    preservedMatches: state.matches.filter(
      (match) => match.status === "playing" || match.pinned,
    ).length,
    unavoidableRepeatMatches: repeatMatches,
    unresolvedPairs,
  };
}

function empty(
  fromRound: number,
  blocked: string,
  forecast: RoundRobinForecast | null = null,
): RoundRobinPlanOutcome {
  return { fromRound, matches: [], blocked, optimization: null, hardViolations: 0, forecast };
}

function eligible(player: EventState["players"][number] | undefined, round: number): boolean {
  return Boolean(player && player.status === "active" && isEligibleAt(player, round));
}

function seedOf(match: Match): MatchSeed {
  return {
    id: match.id,
    round: match.round,
    court: match.court,
    courtId: match.courtId,
    courtLabelId: match.courtLabelId,
    courtWave: match.courtWave,
    teamA: match.teamA,
    teamB: match.teamB,
  };
}

function pairCounts(state: EventState, ids: PlayerId[], matchIds: string[]): Int32Array {
  const out = new Int32Array(ids.length * ids.length);
  const wanted = new Set(matchIds);
  for (const match of state.matches) {
    if (!wanted.has(match.id)) continue;
    addTeam(out, ids, match.teamA);
    addTeam(out, ids, match.teamB);
  }
  return out;
}

function opponentCounts(state: EventState, ids: PlayerId[], matchIds: string[]): Int32Array {
  const out = new Int32Array(ids.length * ids.length);
  const wanted = new Set(matchIds);
  for (const match of state.matches) {
    if (!wanted.has(match.id)) continue;
    addOpponents(out, ids, match.teamA, match.teamB);
  }
  return out;
}

function addMatchCounts(match: Match, ids: PlayerId[], partner: Int32Array, opponent: Int32Array) {
  addTeam(partner, ids, match.teamA);
  addTeam(partner, ids, match.teamB);
  addOpponents(opponent, ids, match.teamA, match.teamB);
}

function addSeedCounts(seed: MatchSeed, ids: PlayerId[], partner: Int32Array, opponent: Int32Array) {
  addTeam(partner, ids, seed.teamA);
  addTeam(partner, ids, seed.teamB);
  addOpponents(opponent, ids, seed.teamA, seed.teamB);
}

function addTeam(matrix: Int32Array, ids: PlayerId[], team: [PlayerId, PlayerId]) {
  const a = ids.indexOf(team[0]);
  const b = ids.indexOf(team[1]);
  if (a < 0 || b < 0) return;
  matrix[a * ids.length + b] += 1;
  matrix[b * ids.length + a] += 1;
}

function addOpponents(
  matrix: Int32Array,
  ids: PlayerId[],
  teamA: [PlayerId, PlayerId],
  teamB: [PlayerId, PlayerId],
) {
  for (const a of teamA) for (const b of teamB) {
    const ai = ids.indexOf(a);
    const bi = ids.indexOf(b);
    if (ai < 0 || bi < 0) continue;
    matrix[ai * ids.length + bi] += 1;
    matrix[bi * ids.length + ai] += 1;
  }
}

function matrixAt(matrix: Int32Array, ids: PlayerId[], a: PlayerId, b: PlayerId): number {
  const ai = ids.indexOf(a);
  const bi = ids.indexOf(b);
  return ai < 0 || bi < 0 ? 0 : matrix[ai * ids.length + bi]!;
}

function addEdge(matrix: Int32Array, ids: PlayerId[], edge: Edge) {
  addTeam(matrix, ids, [edge.a, edge.b]);
}

function addOpponentEdges(matrix: Int32Array, ids: PlayerId[], left: Edge, right: Edge) {
  addOpponents(matrix, ids, [left.a, left.b], [right.a, right.b]);
}

function opponentCost(left: Edge, right: Edge, ids: PlayerId[], matrix: Int32Array): number {
  return [left.a, left.b].reduce(
    (sum, a) => sum + matrixAt(matrix, ids, a, right.a) + matrixAt(matrix, ids, a, right.b),
    0,
  );
}

function pairCost(
  a: [PlayerId, PlayerId],
  b: [PlayerId, PlayerId],
  ids: PlayerId[],
  partner: Int32Array,
  opponent: Int32Array,
): number {
  return (
    matrixAt(partner, ids, a[0], a[1]) * 1_000 +
    matrixAt(partner, ids, b[0], b[1]) * 1_000 +
    a.reduce(
      (sum, x) => sum + matrixAt(opponent, ids, x, b[0]) + matrixAt(opponent, ids, x, b[1]),
      0,
    )
  );
}

function shares(a: Edge, b: Edge): boolean {
  return a.a === b.a || a.a === b.b || a.b === b.a || a.b === b.b;
}

function pairKey(a: PlayerId, b: PlayerId): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

function pairInfo(state: EventState, edge: Edge): RoundRobinPair {
  const names = new Map(state.players.map((player) => [player.id, player.name] as const));
  return {
    a: edge.a,
    b: edge.b,
    aName: names.get(edge.a) ?? edge.a,
    bName: names.get(edge.b) ?? edge.b,
    count: 0,
  };
}
