/**
 * Phần dùng chung của các route: xác định vai trò, và trả lỗi bằng tiếng Việt.
 *
 * Mọi thông báo lỗi ở đây được viết để hiện thẳng lên màn hình điện thoại giữa
 * sân, không phải để lập trình viên đọc. Người đang cầm điện thoại cần biết phải
 * làm gì tiếp, chứ không cần biết mã lỗi là bao nhiêu.
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { Actor, EventState } from "../domain/types";
import type { Role } from "../domain/commands";
import { DEVICE_COOKIE } from "../identity/device";
import { cookieName, sessionSecret, verifySession } from "../auth/session";
import { readEvent, type CachedEvent } from "../sheets/cache";

export interface RequestContext {
  code: string;
  event: CachedEvent;
  role: Role;
  deviceId: string;
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

  return {
    code,
    event,
    role,
    deviceId,
    actor: buildActor(role, deviceId, event.state),
  };
}

/**
 * Người thực hiện, để ghi vào nhật ký và để xét quyền tự sửa trong hai phút.
 *
 * `ref` là mã thiết bị chứ không phải mã người chơi: khi ai đó nhập điểm thay
 * cho trận của người khác thì vẫn phải chính máy đó mới được sửa lại.
 */
function buildActor(role: Role, deviceId: string, state: EventState): Actor {
  const player = state.players.find((p) => p.deviceId && p.deviceId === deviceId);
  return {
    kind: role === "admin" ? "admin" : "player",
    label: player?.name ?? (role === "admin" ? "chủ sự kiện" : "người chơi"),
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
