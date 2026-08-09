/** Ước tính hậu cần trước buổi đánh; không can thiệp lịch hoặc điểm công bằng. */
export interface EventEstimateInput {
  players: number;
  courts: number;
  targetGamesPerPlayer: number;
  matchMinutes: number;
  turnoverMinutes: number;
}

export interface EventEstimate {
  usableCourts: number;
  totalMatches: number;
  waves: number;
  durationMinutes: number;
  minGamesPerPlayer: number;
  maxGamesPerPlayer: number;
  averageWaitMinutes: number;
}

export function estimateEvent(input: EventEstimateInput): EventEstimate | null {
  const players = integer(input.players, 4, 200);
  const courts = integer(input.courts, 1, 50);
  const games = integer(input.targetGamesPerPlayer, 1, 100);
  const matchMinutes = integer(input.matchMinutes, 1, 240);
  const turnoverMinutes = integer(input.turnoverMinutes, 0, 60);
  if (
    players === null ||
    courts === null ||
    games === null ||
    matchMinutes === null ||
    turnoverMinutes === null
  ) {
    return null;
  }

  const usableCourts = Math.min(courts, Math.floor(players / 4));
  if (usableCourts < 1) return null;
  const totalMatches = Math.ceil((players * games) / 4);
  const waves = Math.ceil(totalMatches / usableCourts);
  const durationMinutes = waves * matchMinutes + Math.max(0, waves - 1) * turnoverMinutes;
  const playerSlots = totalMatches * 4;
  const minGamesPerPlayer = Math.floor(playerSlots / players);
  const maxGamesPerPlayer = Math.ceil(playerSlots / players);
  const playShare = Math.min(1, (4 * usableCourts) / players);
  const averageWaitMinutes = Math.round(
    turnoverMinutes + ((1 - playShare) / playShare) * (matchMinutes + turnoverMinutes),
  );

  return {
    usableCourts,
    totalMatches,
    waves,
    durationMinutes,
    minGamesPerPlayer,
    maxGamesPerPlayer,
    averageWaitMinutes,
  };
}

function integer(value: number, min: number, max: number): number | null {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < min || value > max) {
    return null;
  }
  return value;
}

export function formatEstimatedDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} phút`;
  if (rest === 0) return `${hours} giờ`;
  return `${hours} giờ ${rest} phút`;
}
