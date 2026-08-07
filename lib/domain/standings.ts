/**
 * Bảng xếp hạng.
 *
 * Chỉ số chính là **hiệu số trung bình mỗi trận**, không phải tổng hiệu số. Khi có
 * người đến trễ hoặc về sớm thì số trận mỗi người khác nhau, lúc đó tổng hiệu số
 * thưởng cho người ở lại lâu chứ không thưởng cho người đánh hay.
 *
 * Cái giá phải trả là ai đánh ít trận dễ ăn may, nên có thêm ngưỡng số trận tối
 * thiểu: chưa đủ thì tách xuống một nhóm riêng bên dưới, không tranh ngôi đầu.
 *
 * Cùng một hàm được dùng cho bảng của một buổi lẫn bảng tổng kết tuần/tháng.
 * Gộp nhiều buổi chỉ đơn giản là truyền vào nhiều trận hơn.
 */

import type { EventConfig, EventState, Match, PlayerId } from "./types";
import { countsForStandings } from "./types";

export interface StandingRow {
  playerId: PlayerId;
  name: string;
  games: number;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  /** Tổng hiệu số cộng dồn. */
  diff: number;
  /** Hiệu số trung bình mỗi trận. Đây là chỉ số dùng để xếp hạng. */
  avgDiff: number;
  /** Thứ hạng bắt đầu từ 1; người đồng hạng nhận cùng số. */
  rank: number;
  /** Đủ số trận tối thiểu để vào bảng chính. */
  eligible: boolean;
  /** Còn thiếu bao nhiêu trận nữa mới đủ điều kiện. */
  gamesNeeded: number;
  /** Có trận nào tính vào là trận dở dang không. */
  hasPartial: boolean;
  /** Người này đã rời cuộc chơi. */
  hasLeft: boolean;
}

export interface Standings {
  /** Những người đủ số trận tối thiểu, đã xếp hạng. */
  main: StandingRow[];
  /** Những người chưa đủ số trận, hiện riêng bên dưới và không tranh top. */
  provisional: StandingRow[];
  /** Số trận tối thiểu để vào bảng chính. */
  threshold: number;
  medianGames: number;
}

export interface StandingsInput {
  matches: Match[];
  players: Array<{ id: PlayerId; name: string; hasLeft: boolean }>;
  config: EventConfig;
}

export function standingsFromState(state: EventState): Standings {
  return computeStandings({
    matches: state.matches,
    players: state.players
      .filter((p) => p.presence.length > 0 || p.status === "active")
      .map((p) => ({ id: p.id, name: p.name, hasLeft: p.status === "left" })),
    config: state.config,
  });
}

export function computeStandings(input: StandingsInput): Standings {
  const rows = new Map<PlayerId, StandingRow>();
  for (const p of input.players) {
    rows.set(p.id, {
      playerId: p.id,
      name: p.name,
      games: 0,
      wins: 0,
      losses: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      diff: 0,
      avgDiff: 0,
      rank: 0,
      eligible: false,
      gamesNeeded: 0,
      hasPartial: false,
      hasLeft: p.hasLeft,
    });
  }

  /** Tổng hiệu số khi hai người gặp nhau trực tiếp, dùng để phá thế hoà. */
  const head = new Map<string, number>();

  for (const m of input.matches) {
    if (!countsForStandings(m, input.config)) continue;
    const r = m.result;
    if (!r) continue;

    const teamA = { ids: [...m.teamA], own: r.scoreA, other: r.scoreB };
    const teamB = { ids: [...m.teamB], own: r.scoreB, other: r.scoreA };

    for (const team of [teamA, teamB]) {
      for (const id of team.ids) {
        const row = rows.get(id);
        if (!row) continue;
        row.games += 1;
        row.pointsFor += team.own;
        row.pointsAgainst += team.other;
        row.diff += team.own - team.other;
        if (team.own > team.other) row.wins += 1;
        else row.losses += 1;
        if (r.partial) row.hasPartial = true;
      }
    }

    for (const mine of teamA.ids) {
      for (const theirs of teamB.ids) {
        addHead(head, mine, theirs, r.scoreA - r.scoreB);
        addHead(head, theirs, mine, r.scoreB - r.scoreA);
      }
    }
  }

  const all = [...rows.values()];
  for (const row of all) {
    row.avgDiff = row.games > 0 ? row.diff / row.games : 0;
  }

  const played = all.filter((r) => r.games > 0);
  const medianGames = median(played.map((r) => r.games));
  const threshold = Math.max(
    1,
    Math.ceil(medianGames * input.config.eligibilityRatio),
  );

  for (const row of all) {
    row.eligible = row.games >= threshold;
    row.gamesNeeded = Math.max(0, threshold - row.games);
  }

  const main = played.filter((r) => r.eligible).sort(compare(head));
  const provisional = played.filter((r) => !r.eligible).sort(compare(head));

  assignRanks(main, head);
  assignRanks(provisional, head);

  return { main, provisional, threshold, medianGames };
}

/**
 * Thứ tự so sánh: hiệu số TB, rồi số trận thắng, rồi đối đầu trực tiếp, rồi tổng
 * điểm ghi được.
 *
 * Đối đầu trực tiếp đứng sau số trận thắng vì hai người có thể chưa từng gặp nhau
 * lần nào. Khi đó tiêu chí này im lặng và tiêu chí kế tiếp tiếp quản.
 */
function compare(head: Map<string, number>) {
  return (a: StandingRow, b: StandingRow): number => {
    if (b.avgDiff !== a.avgDiff) return b.avgDiff - a.avgDiff;
    if (b.wins !== a.wins) return b.wins - a.wins;

    const h = headToHead(head, a.playerId, b.playerId);
    if (h !== 0) return -h;

    if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor;
    return a.name.localeCompare(b.name, "vi");
  };
}

/** Người đồng hạng nhận cùng số hạng, hạng kế tiếp bị nhảy cóc: 1, 2, 2, 4. */
function assignRanks(rows: StandingRow[], head: Map<string, number>): void {
  const cmp = compare(head);
  rows.forEach((row, i) => {
    const prev = rows[i - 1];
    row.rank = prev && cmp(prev, row) === 0 ? prev.rank : i + 1;
  });
}

function addHead(
  head: Map<string, number>,
  a: PlayerId,
  b: PlayerId,
  diff: number,
): void {
  const key = `${a} ${b}`;
  head.set(key, (head.get(key) ?? 0) + diff);
}

function headToHead(head: Map<string, number>, a: PlayerId, b: PlayerId): number {
  const v = head.get(`${a} ${b}`);
  if (v === undefined) return 0;
  return Math.sign(v);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
