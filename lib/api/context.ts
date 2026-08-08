/**
 * Phần dùng chung của các route: xác định vai trò, và trả lỗi bằng tiếng Việt.
 *
 * Mọi thông báo lỗi ở đây được viết để hiện thẳng lên màn hình điện thoại giữa
 * sân, không phải để lập trình viên đọc. Người đang cầm điện thoại cần biết phải
 * làm gì tiếp, chứ không cần biết mã lỗi là bao nhiêu.
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { Actor, EventState, Player } from "../domain/types";
import type { Role } from "../domain/commands";
import { DEVICE_COOKIE } from "../identity/device";
import { cookieName, sessionSecret, verifySession } from "../auth/session";
import { readEvent, type CachedEvent } from "../sheets/cache";
import { currentUserId } from "./user";

export interface RequestContext {
  code: string;
  event: CachedEvent;
  role: Role;
  deviceId: string;
  /** Tài khoản đang đăng nhập, `null` với phần lớn người ra sân. */
  userId: string | null;
  /** Người chơi ứng với người gửi yêu cầu, nếu tìm được. */
  me: Player | null;
  actor: Actor;
}

/**
 * Xác định người gửi yêu cầu là ai và được làm gì.
 *
 * Không có cookie phiên thì vẫn là `viewer` chứ không phải lỗi: xem bảng xếp
 * hạng là quyền mở cho mọi người có đường dẫn, đúng như đã chọn ở mục 14.
 */
export async function resolveContext(
  request: NextRequest,
  code: string,
): Promise<RequestContext | NextResponse> {
  const event = await readEvent(code);
  if (!event) {
    return fail(404, `Không tìm thấy sự kiện có mã ${code}. Kiểm tra lại mã hoặc đường dẫn.`);
  }

  const session = verifySession(
    request.cookies.get(cookieName(code))?.value,
    code,
    sessionSecret(),
  );
  const role: Role = session?.role ?? "viewer";
  const deviceId = request.cookies.get(DEVICE_COOKIE)?.value ?? "";
  // Chỉ đọc cookie đã ký, không đọc bảng tài khoản: đây là đường bị gọi nhiều
  // nhất trong cả ứng dụng, mỗi điện thoại đang mở app hỏi lại vài giây một lần.
  const userId = currentUserId(request);
  const me = findMyPlayer(event.state, deviceId, userId);

  return {
    code,
    event,
    role,
    deviceId,
    userId,
    me,
    actor: buildActor(role, deviceId, me),
  };
}

/**
 * Người chơi ứng với người đang gửi yêu cầu.
 *
 * Tài khoản trước, máy sau. Thứ tự đó là toàn bộ điểm của việc đăng nhập: đổi
 * điện thoại giữa mùa thì cái máy mới chưa có trong sự kiện nào cả, nhưng tài
 * khoản thì có — và người dùng mong đợi mở app lên là thấy mình, không phải gõ
 * lại tên rồi ngồi chờ duyệt.
 */
export function findMyPlayer(
  state: EventState,
  deviceId: string,
  userId: string | null,
): Player | null {
  if (userId) {
    const byUser = state.players.find((p) => p.userId && p.userId === userId);
    if (byUser) return byUser;
  }
  if (deviceId) {
    return state.players.find((p) => p.deviceId && p.deviceId === deviceId) ?? null;
  }
  return null;
}

/**
 * Người thực hiện, để ghi vào nhật ký và để xét quyền tự sửa trong hai phút.
 *
 * `ref` là mã thiết bị chứ không phải mã người chơi: khi ai đó nhập điểm thay
 * cho trận của người khác thì vẫn phải chính máy đó mới được sửa lại.
 */
function buildActor(role: Role, deviceId: string, me: Player | null): Actor {
  return {
    kind: role === "admin" ? "admin" : "player",
    label: me?.name ?? (role === "admin" ? "chủ sự kiện" : "người chơi"),
    ref: deviceId || undefined,
  };
}

export function fail(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status });
}

export function isResponse(x: unknown): x is NextResponse {
  return x instanceof NextResponse;
}

/** Đọc thân JSON, trả lỗi rõ ràng thay vì để ngoại lệ lọt ra ngoài. */
export async function readJson<T>(
  request: NextRequest,
): Promise<{ ok: true; body: T } | { ok: false; response: NextResponse }> {
  try {
    return { ok: true, body: (await request.json()) as T };
  } catch {
    return { ok: false, response: fail(400, "Dữ liệu gửi lên không đọc được.") };
  }
}
