import { NextResponse, type NextRequest } from "next/server";
import { fail, readJson } from "@/lib/api/context";
import { currentUser } from "@/lib/api/user";
import { verifyPassword } from "@/lib/auth/passwords";
import { checkRateLimit, clearRateLimit } from "@/lib/auth/ratelimit";
import { DEFAULT_EVENT_LIMIT, isAppAdminEmail } from "@/lib/domain/app-admin";
import { claimEventOwnership } from "@/lib/api/event-ownership";
import {
  getAppEventLimitRepo,
  getEventCreationReservationRepo,
  getEventOwnerClaimRepo,
  getRepo,
  invalidateAccount,
  invalidateEvent,
  withAccountLock,
  withEventLock,
} from "@/lib/sheets/cache";

interface Body {
  adminPassword?: unknown;
}

/** Nhận lại một buổi legacy chưa từng được gắn với tài khoản Google. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code: rawCode } = await params;
  const code = rawCode.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,6}$/.test(code)) return fail(404, "Không tìm thấy sự kiện.");

  const user = await currentUser(request);
  if (!user?.account.email) {
    return fail(401, "Hãy đăng nhập Google trước khi gắn buổi này với tài khoản.");
  }

  const parsed = await readJson<Body>(request);
  if (!parsed.ok) return parsed.response;
  const password =
    typeof parsed.body.adminPassword === "string"
      ? parsed.body.adminPassword
      : "";
  if (!password || password.length > 200) {
    return fail(400, "Mật khẩu chủ sự kiện không hợp lệ.");
  }

  const initial = await getRepo().load(code);
  if (!initial) return fail(404, "Không tìm thấy sự kiện.");
  if (initial.record.ownerUserId === user.account.userId) {
    return NextResponse.json({ claimed: true, code, alreadyOwned: true });
  }
  if (initial.record.ownerUserId !== "") {
    return fail(409, "Buổi này đã được gắn với một tài khoản khác.");
  }

  const clientIp =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rateKey = `${clientIp}:${code}:ownership`;
  const limitCheck = checkRateLimit(rateKey);
  if (!limitCheck.allowed) {
    return fail(
      429,
      `Nhập sai nhiều lần. Thử lại sau ${limitCheck.retryAfterSeconds} giây.`,
    );
  }
  if (!(await verifyPassword(password, initial.record.adminPassHash))) {
    return fail(
      401,
      `Mật khẩu chủ sự kiện không đúng. Còn ${limitCheck.remaining} lần thử trong phút này.`,
    );
  }
  clearRateLimit(rateKey);

  const userId = user.account.userId;
  return withAccountLock(userId, () =>
    withEventLock(`ownership:${code}`, async () => {
      const quota = await eventQuota(user.account.email);
      const result = await claimEventOwnership({
        code,
        userId,
        limit: quota.limit,
        now: Date.now(),
        repo: getRepo(),
        reservations: getEventCreationReservationRepo(),
        claims: getEventOwnerClaimRepo(),
      });
      if (!result.ok) {
        if (result.reason === "not-found") return fail(404, "Không tìm thấy sự kiện.");
        if (result.reason === "quota-full") {
          return fail(
            409,
            `Bạn đang có ${result.used}/${result.limit} sự kiện chưa kết thúc. Hãy kết thúc một sự kiện trước khi nhận thêm.`,
          );
        }
        if (result.reason === "reservation-lost") {
          return fail(409, "Một yêu cầu khác vừa dùng hết hạn mức sự kiện. Hãy thử lại.");
        }
        return fail(409, "Buổi này vừa được gắn với một tài khoản khác.");
      }

      invalidateEvent(code);
      invalidateAccount(userId);
      return NextResponse.json({ claimed: true, code, alreadyOwned: result.alreadyOwned });
    }),
  );
}

async function eventQuota(email: string) {
  if (isAppAdminEmail(email)) return { limit: null as number | null };
  const override = await getAppEventLimitRepo().byEmail(email);
  return { limit: override ? override.limit : DEFAULT_EVENT_LIMIT };
}
