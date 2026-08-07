/**
 * Thống kê của chính thiết bị này, không cần tài khoản.
 *
 * Mục 13 trong yêu cầu: lưu lại mọi thứ kể cả khi không tạo tài khoản, miễn là
 * người chơi vẫn dùng đúng máy đó. Máy nhớ mã các buổi đã mở (trong localStorage),
 * còn số liệu thì tính ở đây.
 *
 * Nhận mã buổi từ phía trình duyệt chứ không tự dò trong kho, và đó là chủ ý:
 * quét cả bảng sự kiện của mọi người để tìm một thiết bị vừa tốn hạn mức vừa cho
 * phép người tò mò moi ra buổi đánh của nhóm khác.
 */

import { NextResponse, type NextRequest } from "next/server";
import { rollupEvents } from "@/lib/domain/rollup";
import { DEVICE_COOKIE } from "@/lib/identity/device";
import { getClubRepo, getRepo } from "@/lib/sheets/cache";
import { fail, readJson } from "@/lib/api/context";

/** Chặn danh sách quá dài: một người không mở nổi vài trăm buổi đánh. */
const MAX_CODES = 60;

interface Body {
  codes?: string[];
  /** Tên trên máy này, để nhận ra những buổi do chủ sân gõ tên hộ. */
  name?: string;
}

export async function POST(request: NextRequest) {
  const parsed = await readJson<Body>(request);
  if (!parsed.ok) return parsed.response;

  const codes = (parsed.body.codes ?? []).slice(0, MAX_CODES);
  const deviceId = request.cookies.get(DEVICE_COOKIE)?.value ?? "";
  const name = (parsed.body.name ?? "").trim().toLowerCase();

  if (codes.length === 0) {
    return NextResponse.json({ events: [], totals: emptyTotals(), periods: [] });
  }

  // Mã thành viên của thiết bị này ở mọi câu lạc bộ: buổi tạo từ câu lạc bộ dùng
  // memberId làm mã người chơi, nên không có bước này thì chúng không khớp được.
  const myMemberIds = await memberIdsOf(deviceId);

  const loaded = await getRepo().listByCodes(codes);

  const events = [];
  const totals = emptyTotals();
  const sources = [];

  for (const { record, state } of loaded) {
    const me = findMe(state, deviceId, myMemberIds, name);
    if (!me) continue;

    const stats = statsFor(state, me.id);
    if (stats.games === 0 && state.status !== "finished") continue;

    events.push({
      code: record.code,
      name: record.name,
      at: state.startedAt ?? record.updatedAt,
      status: state.status,
      myName: me.name,
      ...stats,
    });
    totals.events += 1;
    totals.games += stats.games;
    totals.wins += stats.wins;
    totals.losses += stats.losses;
    totals.pointsFor += stats.pointsFor;
    totals.pointsAgainst += stats.pointsAgainst;

    sources.push({ code: record.code, name: record.name, at: state.startedAt ?? record.updatedAt, state });
  }

  totals.diff = totals.pointsFor - totals.pointsAgainst;
  totals.avgDiff = totals.games === 0 ? 0 : Math.round((totals.diff / totals.games) * 100) / 100;
  events.sort((a, b) => b.at - a.at);

  // Kỳ theo tháng, để thấy phong độ đi lên hay đi xuống qua thời gian.
  const periods = rollupEvents(sources, "month").map((p) => {
    const mine = p.players.find(
      (row) =>
        myMemberIds.has(row.key.replace(/^m:/, "")) ||
        row.key === `d:${deviceId}` ||
        (name !== "" && row.key === `n:${name}`),
    );
    return {
      periodKey: p.periodKey,
      label: p.label,
      events: p.events.length,
      games: mine?.games ?? 0,
      avgDiff: mine?.avgDiff ?? 0,
      rank: mine?.rank ?? 0,
      of: p.players.length,
    };
  });

  return NextResponse.json({ events, totals, periods });
}

/** Mọi mã thành viên mà thiết bị này mang, gộp từ các câu lạc bộ nó đã vào. */
async function memberIdsOf(deviceId: string): Promise<Set<string>> {
  if (!deviceId) return new Set();
  const repo = getClubRepo();
  const clubs = await repo.forDevice(deviceId);
  const ids = await Promise.all(
    clubs.map(async (c) => {
      const loaded = await repo.load(c.id);
      return (loaded?.members ?? [])
        .filter((m) => m.deviceId === deviceId && m.status === "active")
        .map((m) => m.memberId);
    }),
  );
  return new Set(ids.flat());
}

/**
 * Tìm chính mình trong một buổi đánh.
 *
 * Ba đường, theo thứ tự chắc chắn giảm dần. Tên là đường cuối vì nó có thể trùng,
 * nhưng bỏ nó đi thì mọi buổi mà chủ sân gõ tên hộ sẽ biến mất khỏi trang này —
 * và đó là phần lớn các buổi.
 */
function findMe(
  state: { players: Array<{ id: string; name: string; memberId?: string; deviceId?: string }> },
  deviceId: string,
  memberIds: Set<string>,
  lowerName: string,
) {
  if (deviceId) {
    const byDevice = state.players.find((p) => p.deviceId === deviceId);
    if (byDevice) return byDevice;
  }
  const byMember = state.players.find((p) => p.memberId && memberIds.has(p.memberId));
  if (byMember) return byMember;
  if (lowerName) {
    return state.players.find((p) => p.name.trim().toLowerCase() === lowerName) ?? null;
  }
  return null;
}

function statsFor(
  state: Parameters<typeof rollupEvents>[0][number]["state"],
  playerId: string,
) {
  let games = 0, wins = 0, losses = 0, pointsFor = 0, pointsAgainst = 0;
  for (const m of state.matches) {
    if (m.status !== "submitted" || !m.result) continue;
    const inA = m.teamA.includes(playerId);
    const inB = m.teamB.includes(playerId);
    if (!inA && !inB) continue;
    const mine = inA ? m.result.scoreA : m.result.scoreB;
    const theirs = inA ? m.result.scoreB : m.result.scoreA;
    games += 1;
    pointsFor += mine;
    pointsAgainst += theirs;
    if (mine > theirs) wins += 1;
    else if (mine < theirs) losses += 1;
  }
  const diff = pointsFor - pointsAgainst;
  return {
    games, wins, losses, pointsFor, pointsAgainst, diff,
    avgDiff: games === 0 ? 0 : Math.round((diff / games) * 100) / 100,
  };
}

function emptyTotals() {
  return {
    events: 0, games: 0, wins: 0, losses: 0,
    pointsFor: 0, pointsAgainst: 0, diff: 0, avgDiff: 0,
  };
}
