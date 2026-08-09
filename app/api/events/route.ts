/**
 * Tạo sự kiện mới.
 *
 * Người tạo nhận luôn quyền chủ sự kiện qua cookie, không phải nhập lại mật khẩu
 * admin vừa đặt — họ vừa gõ nó xong, bắt gõ lại chỉ tổ khó chịu.
 */

import { NextResponse, type NextRequest } from "next/server";
import { generateEventCode, hashPassword } from "@/lib/auth/passwords";
import {
  SESSION_TTL_SECONDS,
  cookieName,
  newSession,
  sessionSecret,
  signSession,
} from "@/lib/auth/session";
import type { CommandEnvelope } from "@/lib/domain/commands";
import { emptyState } from "@/lib/domain/reduce";
import { DEFAULT_CONFIG, type EventConfig } from "@/lib/domain/types";
import { getAppEventLimitRepo, getEventCreationReservationRepo, getRepo, invalidateEvent, withAccountLock } from "@/lib/sheets/cache";
import { fail, readJson } from "@/lib/api/context";
import {
  activeMembers,
  isClubOwner,
  memberForDevice,
  memberForUser,
} from "@/lib/domain/club";
import { deviceIdFromRequest } from "@/lib/identity/device-token";
import { getClubRepo, invalidateClubEvents, readClub } from "@/lib/sheets/cache";
import { currentUser } from "@/lib/api/user";
import { DEFAULT_EVENT_LIMIT, isAppAdminEmail } from "@/lib/domain/app-admin";

interface CreateBody {
  name?: string;
  /** Tạo từ một câu lạc bộ: cả danh bạ được thêm sẵn vào buổi này. */
  clubId?: string;
  courts?: number;
  pointsTo?: number;
  winBy2?: boolean;
  scheduledAt?: number | null;
  playerPassword?: string;
  adminPassword?: string;
}

export async function GET(request: NextRequest) {
  const user = await currentUser(request);
  if (!user || !user.account.email) return fail(401, "Hãy đăng nhập Google để xem các trận đã tạo.");
  const events = await getRepo().listByOwner(user.account.userId);
  const quota = await quotaFor(user.account.email, events.filter((item) => item.state.status !== "finished").length);
  return NextResponse.json({
    quota,
    events: events
      .map(({ record, state }) => ({
        code: record.code,
        name: state.config.name || record.name,
        status: state.status,
        scheduledAt: state.config.scheduledAt,
        createdAt: state.createdAt,
        updatedAt: record.updatedAt,
        courts: state.config.courts,
        players: state.players.length,
        sponsors: state.presentation.sponsors.map((sponsor) => ({
          id: sponsor.id,
          name: sponsor.name,
          assetId: sponsor.assetId,
        })),
      }))
      .sort((a, b) => (b.scheduledAt ?? b.createdAt) - (a.scheduledAt ?? a.createdAt)),
  });
}

export async function POST(request: NextRequest) {
  const parsed = await readJson<CreateBody>(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  const user = await currentUser(request);
  if (!user || !user.account.email) {
    return fail(401, "Hãy đăng nhập Google để tạo sự kiện mới.");
  }

  const name = (body.name ?? "").trim();
  if (name.length < 2) return fail(400, "Đặt tên cho buổi đánh (ít nhất 2 ký tự).");

  const courts = Math.round(body.courts ?? DEFAULT_CONFIG.courts);
  if (courts < 1 || courts > 8) return fail(400, "Số sân phải từ 1 đến 8.");

  const pointsTo = Math.round(body.pointsTo ?? DEFAULT_CONFIG.scoring.pointsTo);
  if (pointsTo < 5 || pointsTo > 50) return fail(400, "Mốc điểm phải từ 5 đến 50.");

  const adminPassword = body.adminPassword ?? "";
  if (adminPassword.length < 4) {
    return fail(400, "Mật khẩu chủ sự kiện phải ít nhất 4 ký tự.");
  }
  // Mật khẩu người chơi để trống nghĩa là ai có đường dẫn cũng nhập điểm được.
  // Hợp lý với nhóm quen nhau, nên cho phép chứ không ép đặt.
  const playerPassword = body.playerPassword ?? "";

  const config: EventConfig = {
    ...DEFAULT_CONFIG,
    name,
    scheduledAt: validScheduledAt(body.scheduledAt),
    courts,
    scoring: { pointsTo, winBy2: body.winBy2 ?? DEFAULT_CONFIG.scoring.winBy2 },
  };

  // Tạo từ câu lạc bộ: kéo cả danh bạ vào. Chỉ người trong câu lạc bộ mới làm
  // được, nếu không thì ai biết mã cũng lôi được danh sách tên của nhóm khác ra.
  const deviceId = deviceIdFromRequest(request);
  const userId = user.account.userId;
  let roster: Array<{
    id: string;
    name: string;
    avatarId: string;
    memberId: string;
    userId?: string;
  }> = [];
  let clubId: string | null = null;

  if (body.clubId) {
    const club = await readClub(body.clubId);
    if (!club) return fail(404, "Không tìm thấy câu lạc bộ này.");
    const inClub =
      isClubOwner(club.club, { deviceId, userId }) ||
      memberForUser(club.members, userId ?? "") !== null ||
      memberForDevice(club.members, deviceId) !== null;
    if (!inClub) {
      return fail(403, "Chỉ người trong câu lạc bộ mới tạo buổi đánh cho câu lạc bộ.");
    }
    clubId = club.club.id;
    // Chép luôn `userId` của những người đã đăng nhập. Miễn phí — danh bạ đang
    // nằm sẵn trong tay — mà không có nó thì người đổi điện thoại giữa mùa mở
    // buổi đánh lên sẽ không thấy mình đâu trong danh sách.
    roster = activeMembers(club.members).map((m) => ({
      id: m.memberId,
      name: m.displayName,
      avatarId: m.avatarId,
      memberId: m.memberId,
      ...(m.userId ? { userId: m.userId } : {}),
    }));
  }

  return withAccountLock(userId, async () => {
    const repo = getRepo();
    const owned = await repo.listByOwner(userId);
    const activeCount = owned.filter((item) => item.state.status !== "finished").length;
    const quota = await quotaFor(user.account.email, activeCount);
    if (quota.limit !== null && activeCount >= quota.limit) {
      return fail(409, `Bạn đang có ${activeCount}/${quota.limit} sự kiện chưa kết thúc. Hãy kết thúc một sự kiện trước khi tạo thêm.`);
    }

    const reservations = getEventCreationReservationRepo();
    const reservation = quota.limit === null
      ? null
      : await reservations.acquire(userId, quota.limit - activeCount, Date.now());
    if (quota.limit !== null && !reservation) {
      return fail(409, "Một yêu cầu tạo khác vừa dùng hết hạn mức. Tải lại danh sách rồi thử lại.");
    }

    // Sau khi lấy vé, đọc lại: một instance khác chỉ có thể nhả vé sau khi đã
    // tạo xong sự kiện, nên bước này bắt được cả khe thời gian giữa hai request.
    const refreshedCount = (await repo.listByOwner(userId)).filter((item) => item.state.status !== "finished").length;
    if (quota.limit !== null && refreshedCount >= quota.limit) {
      if (reservation) await reservations.finish(reservation, "released", Date.now());
      return fail(409, `Bạn đang có ${refreshedCount}/${quota.limit} sự kiện chưa kết thúc.`);
    }

    const code = await pickUnusedCode(repo);
    const now = Date.now();

    const record = await repo.create(
    {
      code,
      clubId,
      name,
      status: "draft",
      // Chủ sự kiện vẫn xác thực bằng mật khẩu như cũ; ghi mã tài khoản ở đây
      // chỉ để sau này trả lời được "những buổi nào do tôi tạo".
      ownerUserId: userId,
      playerPassHash: playerPassword ? await hashPassword(playerPassword) : "",
      adminPassHash: await hashPassword(adminPassword),
    },
    now,
  );

    const actor = { kind: "admin", label: "chủ sự kiện" } as const;
    const envelopes: CommandEnvelope[] = [
    {
      id: `create-${code}`,
      at: now,
      actor,
      command: { type: "CreateEvent", code, clubId, config },
    },
    // Cả danh bạ vào ở trạng thái "đã mời", KHÔNG phải "đang chơi". Hôm nay ai đi
    // ai không thì phải hỏi, không được đoán — đoán sai là xếp lịch cho người
    // không có mặt, cả sân đứng chờ.
    ...roster.map((m, i) => ({
      id: `create-${code}-p${i}`,
      at: now + 1 + i,
      actor,
      command: {
        type: "AddPlayer" as const,
        player: {
          id: m.id,
          name: m.name,
          avatarId: m.avatarId,
          memberId: m.memberId,
          // Người đã đăng nhập thì mang theo mã tài khoản, để họ đổi điện thoại
          // giữa mùa vẫn được nhận ra trong chính buổi đánh này.
          ...(m.userId ? { userId: m.userId } : {}),
        },
        asActive: false,
      },
    })),
  ];

  // Dùng thẳng trạng thái rỗng thay vì đọc lại từ kho: sự kiện vừa được tạo nên
  // chắc chắn nhật ký còn trống, và một lần đọc thừa là một phần hạn mức bị phí.
    const committed = await repo.commitMany(code, envelopes, {
    record,
    state: emptyState(code),
    repaired: false,
    skipped: [],
  });
    if (!committed.ok) {
      if (reservation) await reservations.finish(reservation, "released", Date.now());
      return fail(500, committed.error);
    }
    if (reservation) await reservations.finish(reservation, "consumed", Date.now());

    invalidateEvent(code);
  // Buổi mới của một câu lạc bộ phải hiện ngay trong trang tổng kết, chứ không
  // đợi hết một phút đệm rồi mới xuất hiện.
    if (clubId) invalidateClubEvents(clubId);

    const response = NextResponse.json({ code, name, invited: roster.length });
    response.cookies.set(
    cookieName(code),
    signSession(newSession(code, "admin", now), sessionSecret()),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: SESSION_TTL_SECONDS,
      path: "/",
    },
  );
    return response;
  });
}

function validScheduledAt(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp)) return null;
  const min = Date.UTC(2020, 0, 1);
  const max = Date.UTC(2100, 0, 1);
  return timestamp >= min && timestamp <= max ? Math.floor(timestamp) : null;
}

async function quotaFor(email: string, used: number) {
  const admin = isAppAdminEmail(email);
  const override = admin ? null : await getAppEventLimitRepo().byEmail(email);
  const limit = admin ? null : override ? override.limit : DEFAULT_EVENT_LIMIT;
  return { used, limit, remaining: limit === null ? null : Math.max(0, limit - used), isAppAdmin: admin };
}

/**
 * Sinh mã chưa ai dùng.
 *
 * Không gian mã đủ lớn để va chạm gần như không xảy ra, nhưng "gần như" thì vẫn
 * là có — và một mã trùng sẽ khiến hai buổi đánh ghi đè lên nhau, kiểu hỏng tệ
 * nhất có thể. Ba lần thử là thừa đủ.
 */
async function pickUnusedCode(repo: ReturnType<typeof getRepo>): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = generateEventCode();
    if (!(await repo.load(code))) return code;
  }
  throw new Error("Không sinh được mã sự kiện mới. Thử lại sau.");
}
