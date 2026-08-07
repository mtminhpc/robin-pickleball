/**
 * Tổng kết nhiều buổi đánh theo tuần và theo tháng.
 *
 * Một buổi đánh riêng lẻ chỉ nói được ai thắng tối nay. Người chơi đều đặn thì
 * muốn biết thứ khác: tháng này mình đi mấy buổi, đánh bao nhiêu trận, phong độ
 * lên hay xuống. Đó là việc của tệp này.
 *
 * Toàn bộ ở đây là hàm thuần, kể cả phần chia mốc thời gian: múi giờ được truyền
 * vào chứ không đọc từ máy chủ. Máy chủ Vercel chạy giờ UTC, nên nếu để nó tự
 * đoán thì một buổi đánh tối thứ hai lúc 20 giờ Việt Nam sẽ rơi vào thứ hai UTC
 * — nhưng buổi đánh tối chủ nhật lúc 21 giờ lại nhảy sang **tuần sau**. Người
 * dùng sẽ thấy con số nhảy lung tung mà không hiểu vì sao.
 */

import type { EventState } from "./types";
import { countsForStandings } from "./types";

export type PeriodType = "week" | "month";

/** Việt Nam là UTC+7 quanh năm, không có giờ mùa hè. */
export const VN_OFFSET_MINUTES = 7 * 60;

const MS_PER_DAY = 86_400_000;

export interface PlayerRollup {
  /** Khoá gộp người xuyên các buổi. Xem `identityKey`. */
  key: string;
  name: string;
  avatarId: string;
  /** Số buổi có mặt và đánh ít nhất một trận. */
  events: number;
  games: number;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  diff: number;
  /** Hiệu số trung bình mỗi trận — chỉ số dùng để xếp hạng, như bảng từng buổi. */
  avgDiff: number;
  rank: number;
}

export interface EventBrief {
  code: string;
  name: string;
  at: number;
  players: number;
  games: number;
  /** Buổi chưa kết thúc: số liệu còn chạy tiếp. */
  live: boolean;
}

export interface PeriodRollup {
  periodType: PeriodType;
  periodKey: string;
  label: string;
  from: number;
  to: number;
  events: EventBrief[];
  players: PlayerRollup[];
  totalGames: number;
}

export interface RollupSource {
  code: string;
  name: string;
  /** Lúc buổi đánh bắt đầu; chưa bắt đầu thì lấy lúc tạo. */
  at: number;
  state: EventState;
}

// ---------------------------------------------------------------------------
// Mốc thời gian
// ---------------------------------------------------------------------------

/**
 * Mã kỳ của một thời điểm: `2026-W32` hoặc `2026-08`.
 *
 * Tuần bắt đầu từ **thứ hai**, theo cách người Việt nói "tuần này" và theo chuẩn
 * ISO 8601. Chủ nhật là ngày cuối tuần chứ không phải ngày đầu.
 */
export function periodKeyOf(
  at: number,
  type: PeriodType,
  offsetMinutes: number = VN_OFFSET_MINUTES,
): string {
  const local = new Date(at + offsetMinutes * 60_000);
  if (type === "month") {
    return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}`;
  }
  const { year, week } = isoWeek(local);
  return `${year}-W${pad(week)}`;
}

/** Khoảng thời gian mà một mã kỳ bao phủ, tính bằng mốc UTC. */
export function periodRange(
  key: string,
  type: PeriodType,
  offsetMinutes: number = VN_OFFSET_MINUTES,
): { from: number; to: number } {
  const shift = offsetMinutes * 60_000;
  if (type === "month") {
    const [y, m] = key.split("-").map(Number);
    const from = Date.UTC(y!, m! - 1, 1) - shift;
    const to = Date.UTC(m! === 12 ? y! + 1 : y!, m! === 12 ? 0 : m!, 1) - shift;
    return { from, to };
  }
  const [y, w] = key.split("-W").map(Number);
  const monday = isoWeekStart(y!, w!);
  return { from: monday - shift, to: monday + 7 * MS_PER_DAY - shift };
}

/** Nhãn đọc được: "Tuần 04/08 – 10/08/2026" hoặc "Tháng 8/2026". */
export function periodLabel(
  key: string,
  type: PeriodType,
  offsetMinutes: number = VN_OFFSET_MINUTES,
): string {
  if (type === "month") {
    const [y, m] = key.split("-").map(Number);
    return `Tháng ${m}/${y}`;
  }
  const { from, to } = periodRange(key, type, offsetMinutes);
  const shift = offsetMinutes * 60_000;
  const a = new Date(from + shift);
  const b = new Date(to + shift - MS_PER_DAY);
  return `Tuần ${pad(a.getUTCDate())}/${pad(a.getUTCMonth() + 1)} – ${pad(
    b.getUTCDate(),
  )}/${pad(b.getUTCMonth() + 1)}/${b.getUTCFullYear()}`;
}

// ---------------------------------------------------------------------------
// Gộp số liệu
// ---------------------------------------------------------------------------

/**
 * Khoá để nhận ra "vẫn là người đó" qua nhiều buổi.
 *
 * Ưu tiên `memberId` của câu lạc bộ, rồi tới thiết bị. Hết cách thì đành gộp
 * theo tên đã chuẩn hoá — không chắc chắn bằng, nhưng người khách vãng lai không
 * có gì khác để bám vào, và bỏ họ ra khỏi tổng kết thì tệ hơn. Hai người trùng
 * tên trong cùng một câu lạc bộ sẽ bị gộp làm một; đó là lý do lúc vào danh bạ
 * có cảnh báo trùng tên.
 */
export function identityKey(p: {
  memberId?: string;
  deviceId?: string;
  name: string;
}): string {
  if (p.memberId) return `m:${p.memberId}`;
  if (p.deviceId) return `d:${p.deviceId}`;
  return `n:${p.name.trim().toLowerCase()}`;
}

/**
 * Gộp một danh sách buổi đánh thành các kỳ, mới nhất lên đầu.
 *
 * Chỉ tính những trận có tỷ số được công nhận (`countsForStandings`), đúng cùng
 * một luật với bảng xếp hạng từng buổi — hai chỗ nói khác nhau về cùng một trận
 * là kiểu sai khiến người dùng mất lòng tin vào cả hai.
 */
export function rollupEvents(
  sources: RollupSource[],
  type: PeriodType,
  offsetMinutes: number = VN_OFFSET_MINUTES,
): PeriodRollup[] {
  const byPeriod = new Map<string, RollupSource[]>();
  for (const source of sources) {
    const key = periodKeyOf(source.at, type, offsetMinutes);
    const list = byPeriod.get(key) ?? [];
    list.push(source);
    byPeriod.set(key, list);
  }

  return [...byPeriod.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, list]) => buildPeriod(key, type, list, offsetMinutes));
}

function buildPeriod(
  key: string,
  type: PeriodType,
  sources: RollupSource[],
  offsetMinutes: number,
): PeriodRollup {
  const acc = new Map<string, PlayerRollup>();
  const events: EventBrief[] = [];
  let totalGames = 0;

  for (const source of sources.sort((a, b) => a.at - b.at)) {
    const state = source.state;
    const byId = new Map(state.players.map((p) => [p.id, p] as const));
    const playedHere = new Set<string>();
    let eventGames = 0;

    for (const match of state.matches) {
      if (!countsForStandings(match, state.config)) continue;
      const { scoreA, scoreB } = match.result!;
      eventGames += 1;

      for (const [team, mine, theirs] of [
        [match.teamA, scoreA, scoreB],
        [match.teamB, scoreB, scoreA],
      ] as const) {
        for (const id of team) {
          const player = byId.get(id);
          if (!player) continue;
          const row = ensureRow(acc, player);
          playedHere.add(row.key);
          row.games += 1;
          row.pointsFor += mine;
          row.pointsAgainst += theirs;
          if (mine > theirs) row.wins += 1;
          else if (mine < theirs) row.losses += 1;
        }
      }
    }

    for (const k of playedHere) acc.get(k)!.events += 1;
    totalGames += eventGames;
    events.push({
      code: source.code,
      name: source.name,
      at: source.at,
      players: playedHere.size,
      games: eventGames,
      live: state.status !== "finished",
    });
  }

  const players = [...acc.values()].map((row) => ({
    ...row,
    diff: row.pointsFor - row.pointsAgainst,
    avgDiff: row.games === 0 ? 0 : round2((row.pointsFor - row.pointsAgainst) / row.games),
  }));

  // Xếp theo hiệu số trung bình, giống bảng xếp hạng từng buổi. Người đánh nhiều
  // hơn được ưu tiên khi bằng điểm: cùng phong độ thì ai ra sân đều hơn xếp trên.
  players.sort((a, b) => b.avgDiff - a.avgDiff || b.games - a.games || a.name.localeCompare(b.name, "vi"));
  let rank = 0;
  let previous: number | null = null;
  players.forEach((row, i) => {
    if (previous === null || row.avgDiff !== previous) rank = i + 1;
    previous = row.avgDiff;
    row.rank = rank;
  });

  const { from, to } = periodRange(key, type, offsetMinutes);
  return {
    periodType: type,
    periodKey: key,
    label: periodLabel(key, type, offsetMinutes),
    from,
    to,
    events: events.reverse(),
    players,
    totalGames,
  };
}

function ensureRow(
  acc: Map<string, PlayerRollup>,
  player: { id: string; name: string; avatarId: string; memberId?: string; deviceId?: string },
): PlayerRollup {
  const key = identityKey(player);
  const existing = acc.get(key);
  if (existing) return existing;

  const row: PlayerRollup = {
    key,
    name: player.name,
    avatarId: player.avatarId,
    events: 0,
    games: 0,
    wins: 0,
    losses: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    diff: 0,
    avgDiff: 0,
    rank: 0,
  };
  acc.set(key, row);
  return row;
}

// ---------------------------------------------------------------------------

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Số tuần ISO của một ngày (đã dịch sang giờ địa phương).
 *
 * Tuần 1 là tuần chứa ngày thứ năm đầu tiên của năm. Nghe vặn vẹo nhưng đó là
 * chuẩn, và nó khiến mọi tuần đều có đúng bảy ngày — không có tuần cụt đầu năm
 * để người dùng thắc mắc.
 */
function isoWeek(local: Date): { year: number; week: number } {
  const d = new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()),
  );
  // Dời tới thứ năm cùng tuần: năm của thứ năm mới là năm của tuần.
  const day = (d.getUTCDay() + 6) % 7; // thứ hai = 0
  d.setUTCDate(d.getUTCDate() - day + 3);
  const year = d.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  const firstDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * MS_PER_DAY));
  return { year, week };
}

/** Thứ hai đầu tuần ISO thứ `week` của năm `year`, tính theo giờ địa phương. */
function isoWeekStart(year: number, week: number): number {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const day = (jan4.getUTCDay() + 6) % 7;
  const week1Monday = jan4.getTime() - day * MS_PER_DAY;
  return week1Monday + (week - 1) * 7 * MS_PER_DAY;
}
