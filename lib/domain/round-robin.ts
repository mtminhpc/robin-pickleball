import { firstOpenRound } from "./rounds";
import { isEligibleAt, type EventState, type Match, type PlayerId, type RoundRobinCampaign } from "./types";

export interface RoundRobinPair {
  a: PlayerId;
  b: PlayerId;
  aName: string;
  bName: string;
  count: number;
}

export interface RoundRobinProgress {
  totalPairs: number;
  coveredPairs: number;
  repeatedPairs: number;
  missingPairs: RoundRobinPair[];
  opponentMin: number;
  opponentMax: number;
  absentPlayerIds: PlayerId[];
  outsiderPlayerIds: PlayerId[];
}

/** Các trạng thái chứng minh bốn người đã thật sự ra sân. */
export function happenedForRoundRobin(match: Match): boolean {
  return (
    match.status === "playing" ||
    match.status === "submitted" ||
    match.status === "abandoned"
  );
}

export function initialRoundRobinMatchIds(state: EventState): string[] {
  return state.matches.filter(happenedForRoundRobin).map((match) => match.id);
}

export function roundRobinProgress(
  state: EventState,
  campaign: RoundRobinCampaign | null = state.roundRobinCampaign,
): RoundRobinProgress | null {
  if (!campaign) return null;
  const ids = campaign.playerIds;
  const n = ids.length;
  const index = new Map(ids.map((id, i) => [id, i] as const));
  const partners = new Int32Array(n * n);
  const opponents = new Int32Array(n * n);
  const counted = new Set(campaign.countedMatchIds);

  for (const match of state.matches) {
    if (!counted.has(match.id)) continue;
    const a0 = index.get(match.teamA[0]);
    const a1 = index.get(match.teamA[1]);
    const b0 = index.get(match.teamB[0]);
    const b1 = index.get(match.teamB[1]);
    if (a0 !== undefined && a1 !== undefined) bump(partners, n, a0, a1);
    if (b0 !== undefined && b1 !== undefined) bump(partners, n, b0, b1);
    for (const x of [a0, a1]) {
      for (const y of [b0, b1]) {
        if (x !== undefined && y !== undefined) bump(opponents, n, x, y);
      }
    }
  }

  const names = new Map(state.players.map((player) => [player.id, player.name] as const));
  const missingPairs: RoundRobinPair[] = [];
  let coveredPairs = 0;
  let repeatedPairs = 0;
  let opponentMin = Number.POSITIVE_INFINITY;
  let opponentMax = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const count = partners[i * n + j]!;
      if (count > 0) coveredPairs += 1;
      else {
        missingPairs.push({
          a: ids[i]!,
          b: ids[j]!,
          aName: names.get(ids[i]!) ?? ids[i]!,
          bName: names.get(ids[j]!) ?? ids[j]!,
          count,
        });
      }
      repeatedPairs += Math.max(0, count - 1);
      const met = opponents[i * n + j]!;
      opponentMin = Math.min(opponentMin, met);
      opponentMax = Math.max(opponentMax, met);
    }
  }
  if (!Number.isFinite(opponentMin)) opponentMin = 0;
  const target = new Set(ids);
  const openRound = firstOpenRound(state);
  return {
    totalPairs: (n * (n - 1)) / 2,
    coveredPairs,
    repeatedPairs,
    missingPairs,
    opponentMin,
    opponentMax,
    absentPlayerIds: ids.filter(
      (id) => {
        const player = state.players.find((item) => item.id === id);
        return !player || player.status !== "active" || !isEligibleAt(player, openRound);
      },
    ),
    outsiderPlayerIds: state.players
      .filter(
        (player) =>
          player.status === "active" &&
          !target.has(player.id) &&
          isEligibleAt(player, openRound),
      )
      .map((player) => player.id),
  };
}

export function campaignIsComplete(state: EventState): boolean {
  return roundRobinProgress(state)?.missingPairs.length === 0;
}

function bump(matrix: Int32Array, n: number, a: number, b: number): void {
  matrix[a * n + b] += 1;
  matrix[b * n + a] += 1;
}
