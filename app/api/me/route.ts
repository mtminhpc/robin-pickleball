/**
 * Thống kê của chính người đang xem.
 *
 * Chạy được ở hai chế độ, và cả hai đều là chế độ chính:
 *
 * - **Chưa đăng nhập** — số liệu của đúng cái máy này. Mục 13 trong yêu cầu: giữ
 *   lại mọi thứ kể cả khi người chơi không tạo tài khoản. Danh sách buổi nằm
 *   trong `localStorage`, gửi lên đây để tính.
 * - **Đã đăng nhập** — gộp thêm các buổi từ mọi máy khác của cùng tài khoản, và
 *   nhận ra người chơi qua danh bạ câu lạc bộ đã gắn về tài khoản đó. Đây là
 *   điều duy nhất mà việc đăng nhập mua được ở trang này, nên nó phải đúng.
 *
 * Nhận mã buổi từ phía trình duyệt chứ không tự dò trong kho, và đó là chủ ý:
 * quét cả bảng sự kiện của mọi người để tìm một thiết bị vừa tốn hạn mức vừa cho
 * phép người tò mò moi ra buổi đánh của nhóm khác.
 */

import { NextResponse, type NextRequest } from "next/server";
import { rollupEvents } from "@/lib/domain/rollup";
import { deviceIdFromRequest } from "@/lib/identity/device-token";
import { excludeDeletedEvents, getAccountRepo, getClubRepo, getRepo } from "@/lib/sheets/cache";
import { readJson } from "@/lib/api/context";
import { currentUser } from "@/lib/api/user";

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

  const deviceId = deviceIdFromRequest(request);
  const name = (parsed.body.name ?? "").trim().toLowerCase();
  const fromBrowser = parsed.body.codes ?? [];

  const me = await currentUser(request);
  const userId = me?.account.userId ?? "";

  // Máy nào của tài khoản này cũng tính là "máy của tôi": người chơi có thể đã
  // nhập điểm từ điện thoại cũ, và kết quả đó vẫn là của họ.
  const myDeviceIds = new Set(
    [deviceId, ...(me?.devices.map((d) => d.deviceId) ?? [])].filter(Boolean),
  );

  // Câu lạc bộ của tôi, gộp qua tài khoản lẫn từng máy. Cần cho hai việc: lấy mã
  // thành viên, và tìm ra những buổi mà cái máy này chưa bao giờ mở.
  const myClubs = await clubsOf(myDeviceIds, userId);

  // Chép danh sách của trình duyệt lên Sheet để máy khác của cùng tài khoản đọc
  // được. Chỉ ghi khi thật sự có gì mới — trang này mở ra là gọi tới đây.
  if (userId && deviceId && fromBrowser.length > 0) {
    await rememberQuietly(deviceId, fromBrowser, userId);
  }

  const repo = getRepo();
  const codes = dedupe([
    ...fromBrowser,
    ...(me?.devices.flatMap((d) => d.recentEvents) ?? []),
    // Buổi đánh của câu lạc bộ mình. Vẫn không quét cả bảng sự kiện của mọi
    // người — chỉ những nhóm mình thật sự là thành viên.
    ...(myClubs.length > 0 ? await repo.codesByClubs(myClubs.map((c) => c.id)) : []),
  ]).slice(0, MAX_CODES);

  if (codes.length === 0) {
    return NextResponse.json({
      events: [],
      totals: emptyTotals(),
      periods: [],
      account: accountInfo(me, deviceId),
    });
  }

  // Mã thành viên của tôi ở mọi câu lạc bộ: buổi tạo từ câu lạc bộ dùng memberId
  // làm mã người chơi, nên không có bước này thì chúng không khớp được.
  const myMemberIds = await memberIdsOf(myClubs, myDeviceIds, userId);

  const loaded = await excludeDeletedEvents(await repo.listByCodes(codes));

  const events = [];
  const totals = emptyTotals();
  const sources = [];

  for (const { record, state } of loaded) {
    const me = findMe(state, userId, myDeviceIds, myMemberIds, name);
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
        (row.key.startsWith("d:") && myDeviceIds.has(row.key.slice(2))) ||
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

  return NextResponse.json({
    events,
    totals,
    periods,
    account: accountInfo(me, deviceId),
  });
}

/**
 * Câu lạc bộ của tôi, tìm qua cả tài khoản lẫn từng thiết bị.
 *
 * Phải đi cả hai đường: dòng danh bạ tạo trước khi đăng nhập chỉ mang `deviceId`
 * cho tới lần đăng nhập kế tiếp gắn nó lại.
 */
async function clubsOf(
  deviceIds: Set<string>,
  userId: string,
): Promise<Array<{ id: string }>> {
  const repo = getClubRepo();
  const clubs = [
    ...(userId ? await repo.forUser(userId) : []),
    ...(await Promise.all([...deviceIds].map((id) => repo.forDevice(id)))).flat(),
  ];
  return [...new Map(clubs.map((c) => [c.id, c])).values()];
}

/**
 * Mọi mã thành viên của tôi trong các câu lạc bộ đó.
 *
 * Buổi tạo từ câu lạc bộ dùng `memberId` làm mã người chơi, nên không có bước
 * này thì số liệu của chính mình không khớp được vào đâu cả.
 */
async function memberIdsOf(
  clubs: Array<{ id: string }>,
  deviceIds: Set<string>,
  userId: string,
): Promise<Set<string>> {
  const repo = getClubRepo();
  const ids = await Promise.all(
    clubs.map(async (c) => {
      const loaded = await repo.load(c.id);
      return (loaded?.members ?? [])
        .filter(
          (m) =>
            m.status === "active" &&
            ((userId !== "" && m.userId === userId) || deviceIds.has(m.deviceId)),
        )
        .map((m) => m.memberId);
    }),
  );
  return new Set(ids.flat());
}

/**
 * Tìm chính mình trong một buổi đánh.
 *
 * Bốn đường, theo thứ tự chắc chắn giảm dần. Tài khoản đứng đầu vì nó đúng trên
 * mọi máy. Tên là đường cuối vì nó có thể trùng, nhưng bỏ nó đi thì mọi buổi mà
 * chủ sân gõ tên hộ sẽ biến mất khỏi trang này — và đó là phần lớn các buổi.
 */
function findMe(
  state: {
    players: Array<{
      id: string;
      name: string;
      memberId?: string;
      userId?: string;
      deviceId?: string;
    }>;
  },
  userId: string,
  deviceIds: Set<string>,
  memberIds: Set<string>,
  lowerName: string,
) {
  if (userId) {
    const byUser = state.players.find((p) => p.userId === userId);
    if (byUser) return byUser;
  }
  const byDevice = state.players.find((p) => p.deviceId && deviceIds.has(p.deviceId));
  if (byDevice) return byDevice;
  const byMember = state.players.find((p) => p.memberId && memberIds.has(p.memberId));
  if (byMember) return byMember;
  if (lowerName) {
    return state.players.find((p) => p.name.trim().toLowerCase() === lowerName) ?? null;
  }
  return null;
}

/**
 * Cho giao diện biết đang gộp số liệu của mấy máy, để nói thật về phạm vi.
 *
 * Kèm luôn danh sách máy để trang "Của tôi" gỡ được máy cũ. Không tốn thêm lần
 * đọc Sheet nào: `currentUser` đi qua `readAccount`, vốn đã trả về cả `DeviceLink[]`.
 */
function accountInfo(
  me: Awaited<ReturnType<typeof currentUser>>,
  thisDeviceId: string,
) {
  if (!me) return null;
  return {
    email: me.account.email,
    displayName: me.account.displayName,
    devices: me.devices.length,
    deviceList: me.devices
      .map((d) => ({
        deviceId: d.deviceId,
        displayName: d.displayName,
        lastSeen: d.lastSeen,
        current: d.deviceId === thisDeviceId,
      }))
      // Máy đang cầm lên đầu, còn lại mới dùng gần đây đứng trước.
      .sort((a, b) =>
        a.current !== b.current ? (a.current ? -1 : 1) : b.lastSeen - a.lastSeen,
      ),
  };
}

function dedupe(codes: string[]): string[] {
  const seen = new Set<string>();
  return codes.filter((code) => {
    const trimmed = code.trim();
    if (trimmed === "" || seen.has(trimmed)) return false;
    seen.add(trimmed);
    return true;
  });
}

/**
 * Ghi danh sách buổi lên Sheet, nuốt lỗi.
 *
 * Đây là việc phụ. Hạn mức Sheets hết hay mạng chập thì người dùng vẫn phải xem
 * được số liệu của mình — không có lý do gì để cả trang hỏng vì một bước đồng bộ
 * mà lần mở sau sẽ tự chạy lại.
 */
async function rememberQuietly(
  deviceId: string,
  codes: string[],
  userId: string,
): Promise<void> {
  try {
    await getAccountRepo().rememberEvents(deviceId, codes, Date.now(), userId);
  } catch (error) {
    console.error("[robin-pickleball] không chép được danh sách buổi lên Sheet:", error);
  }
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
