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
import {
  capabilitiesForRole,
  roleLabel,
  type EventCapabilities,
  type Role,
} from "../domain/commands";
import { cookieName, sessionSecret, verifySession, type SessionRole } from "../auth/session";
import { deviceIdFromRequest } from "../identity/device-token";
import {
  getEventStaffRepo,
  invalidateEventStaff,
  readAccount,
  readEvent,
  readEventAuthVersion,
  readEventStaff,
  type CachedEvent,
} from "../sheets/cache";
import type { EventRecord } from "../sheets/repo";
import { currentUserId } from "./user";

export interface RequestContext {
  code: string;
  event: CachedEvent;
  role: Role;
  capabilities: EventCapabilities;
  roleLabel: string;
  deviceId: string;
  /** Tài khoản đang đăng nhập, `null` với phần lớn người ra sân. */
  userId: string | null;
  /** Người này là chủ buổi đánh nhờ tài khoản, không phải nhờ gõ mật khẩu. */
  ownerByAccount: boolean;
  /** Người chơi ứng với người gửi yêu cầu, nếu tìm được. */
  me: Player | null;
  actor: Actor;
}

/**
 * Vai trò trong một buổi đánh: mật khẩu, hoặc tài khoản đã tạo ra buổi đó.
 *
 * **Hàm này phải là nơi duy nhất trả lời câu hỏi đó.** Vai trò được tính ở hai
 * chỗ — `resolveContext` cho các route, và `app/e/[code]/layout.tsx` cho lượt
 * dựng đầu tiên ở máy chủ. Để hai chỗ tự tính lấy thì chúng sẽ lệch nhau, và
 * kiểu lệch ấy hiện ra rất khó chịu: trang vẽ lần đầu ở "chế độ xem" rồi nháy
 * sang "chủ sự kiện" khi trình duyệt hỏi lại, mà trong khoảnh khắc đó các nút
 * quản trị chưa có nên người dùng bấm hụt.
 *
 * Tách thành hàm thuần còn vì một lý do nữa: **không bài kiểm thử nào trong dự
 * án chạm tới route handler hay layout**, nên logic nằm trong đó là logic không
 * ai canh. Ở đây thì kiểm được.
 *
 * Hai phép `&&` không thừa. `ownerUserId` là chuỗi rỗng với mọi buổi tạo lúc
 * chưa đăng nhập — thiếu chúng thì một `userId` rỗng sẽ khớp với một
 * `ownerUserId` rỗng, và **người lạ bất kỳ thành chủ mọi buổi đánh cũ**.
 */
export function roleFor(
  record: Pick<EventRecord, "ownerUserId">,
  sessionRole: SessionRole | "viewer" | null,
  userId: string | null,
  isManager = false,
): Role {
  if (userId && record.ownerUserId && userId === record.ownerUserId) return "owner";
  if (userId && isManager) return "manager";
  if (sessionRole === "admin") return record.ownerUserId ? "operator" : "admin";
  if (sessionRole === "player") return "player";
  return "viewer";
}

/** Chủ buổi đánh nhờ tài khoản. Quyền này không mượn được như mật khẩu. */
export function isOwnerByAccount(
  record: Pick<EventRecord, "ownerUserId">,
  userId: string | null,
): boolean {
  return Boolean(userId && record.ownerUserId && userId === record.ownerUserId);
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

  const rawSession = verifySession(
    request.cookies.get(cookieName(code))?.value,
    code,
    sessionSecret(),
  );
  const deviceId = deviceIdFromRequest(request);
  // Chỉ đọc cookie đã ký, không đọc bảng tài khoản: đây là đường bị gọi nhiều
  // nhất trong cả ứng dụng, mỗi điện thoại đang mở app hỏi lại vài giây một lần.
  const userId = currentUserId(request);
  const account = userId ? await readAccount(userId) : null;
  const staff = account ? await readEventStaff(code) : [];
  let membership = account
    ? staff.find(
        (member) =>
          member.userId === account.account.userId ||
          member.email === account.account.email.toLowerCase(),
      ) ?? null
    : null;
  if (membership?.status === "pending" && account) {
    membership = await getEventStaffRepo().activate(
      membership,
      {
        userId: account.account.userId,
        displayName: account.account.displayName,
      },
      Date.now(),
    );
    invalidateEventStaff(code);
  }
  const currentPasswordVersion =
    rawSession?.role === "admin" ? await readEventAuthVersion(code) : 0;
  const session =
    rawSession?.role === "admin" && (rawSession.pv ?? 0) !== currentPasswordVersion
      ? null
      : rawSession;
  const role = roleFor(event.record, session?.role ?? null, userId, Boolean(membership));
  const me = findMyPlayer(event.state, deviceId, userId);

  return {
    code,
    event,
    role,
    capabilities: capabilitiesForRole(role),
    roleLabel: roleLabel(role),
    deviceId,
    userId,
    ownerByAccount: isOwnerByAccount(event.record, userId),
    me,
    actor: buildActor(role, deviceId, me, account?.account.displayName, userId),
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
function buildActor(
  role: Role,
  deviceId: string,
  me: Player | null,
  accountName?: string,
  userId?: string | null,
): Actor {
  const privileged =
    role === "owner" ||
    role === "manager" ||
    role === "operator" ||
    role === "admin";
  return {
    kind: privileged ? "admin" : "player",
    label:
      role === "owner"
        ? `Chủ sự kiện${accountName ? ` · ${accountName}` : ""}`
        : role === "manager"
          ? `Phó sự kiện${accountName ? ` · ${accountName}` : ""}`
          : role === "operator"
            ? "Điều hành bằng mật khẩu"
            : role === "admin"
              ? "Quản trị sự kiện cũ"
              : me?.name ?? "người chơi",
    ref: userId || deviceId || undefined,
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
