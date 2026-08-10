import { NextResponse, type NextRequest } from "next/server";
import { fail, readJson } from "@/lib/api/context";
import { currentUser } from "@/lib/api/user";
import { MAX_DEVICE_EVENTS, mergeRecentEvents } from "@/lib/domain/account";
import { deviceIdFromRequest } from "@/lib/identity/device-token";
import {
  excludeDeletedEvents,
  getAccountRepo,
  getRepo,
  invalidateAccount,
} from "@/lib/sheets/cache";

interface RecentInput {
  code?: unknown;
  lastOpenedAt?: unknown;
}

interface Body {
  events?: unknown;
}

/** Đồng bộ các lối tắt "Gần đây" giữa những thiết bị của cùng tài khoản. */
export async function POST(request: NextRequest) {
  const user = await currentUser(request);
  if (!user) return fail(401, "Hãy đăng nhập Google để đồng bộ các buổi gần đây.");

  const deviceId = deviceIdFromRequest(request);
  if (!deviceId) return fail(400, "Không nhận ra thiết bị đang dùng.");

  const parsed = await readJson<Body>(request);
  if (!parsed.ok) return parsed.response;
  if (!Array.isArray(parsed.body.events)) {
    return fail(400, "Danh sách buổi gần đây không hợp lệ.");
  }
  if (parsed.body.events.length > MAX_DEVICE_EVENTS) {
    return fail(400, `Chỉ đồng bộ tối đa ${MAX_DEVICE_EVENTS} buổi mỗi lần.`);
  }

  const now = Date.now();
  const localEvents: Array<{ code: string; lastOpenedAt: number }> = [];
  for (const item of parsed.body.events as RecentInput[]) {
    const code = typeof item?.code === "string" ? item.code.trim().toUpperCase() : "";
    const lastOpenedAt = Number(item?.lastOpenedAt);
    if (
      !/^[A-Z0-9]{4,6}$/.test(code) ||
      !Number.isFinite(lastOpenedAt) ||
      lastOpenedAt < 0 ||
      lastOpenedAt > now + 5 * 60_000
    ) {
      return fail(400, "Danh sách buổi gần đây có dữ liệu không hợp lệ.");
    }
    if (!localEvents.some((event) => event.code === code)) {
      localEvents.push({ code, lastOpenedAt: Math.floor(lastOpenedAt) });
    }
  }

  const accounts = getAccountRepo();
  const currentLink = await accounts.deviceLink(deviceId);
  const localCodes = localEvents.map((event) => event.code);
  if (!currentLink || currentLink.userId !== user.account.userId) {
    await accounts.linkDevice({
      deviceId,
      userId: user.account.userId,
      displayName: user.account.displayName,
      avatarId: user.account.avatarId,
      recentEvents: localCodes,
      at: now,
    });
  } else if (localCodes.length > 0) {
    await accounts.rememberEvents(deviceId, localCodes, now, user.account.userId);
  }
  invalidateAccount(user.account.userId);

  const orderedCodes = mergeRecentEvents(
    user.devices.flatMap((device) => device.recentEvents),
    localCodes,
  );
  // Mã của buổi đã xóa vẫn nằm trong lịch sử thiết bị và không bị gỡ khỏi đó —
  // chỉ đơn giản là không dựng thành lối tắt được nữa.
  const loaded = await excludeDeletedEvents(await getRepo().listByCodes(orderedCodes));
  const byCode = new Map(loaded.map((item) => [item.record.code.toUpperCase(), item]));
  const localTimes = new Map(localEvents.map((event) => [event.code, event.lastOpenedAt]));

  return NextResponse.json({
    events: orderedCodes.flatMap((code) => {
      const event = byCode.get(code.toUpperCase());
      if (!event) return [];
      return [{
        code: event.record.code,
        name: event.state.config.name || event.record.name,
        lastOpenedAt:
          localTimes.get(code.toUpperCase()) ??
          event.state.createdAt ??
          event.record.updatedAt,
      }];
    }),
  });
}
