/**
 * Khung chung của một sự kiện: nạp dữ liệu lần đầu ở máy chủ, rồi trao cho các
 * provider phía trình duyệt lo việc hỏi lại và gửi lệnh.
 *
 * Dựng sẵn ở máy chủ để lượt mở đầu tiên đã có nội dung — người quét mã QR ở sân
 * thấy ngay bảng đấu chứ không phải nhìn vòng xoay chờ.
 */

import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { cookies } from "next/headers";
import { cookieName, sessionSecret, verifySession } from "@/lib/auth/session";
import { USER_COOKIE, verifyUserSession } from "@/lib/auth/user-session";
import { capabilitiesForResolvedRole, findMyPlayer, isOwnerByAccount, roleFor } from "@/lib/api/context";
import { roleLabel } from "@/lib/domain/commands";
import { foldEventRoles, roleForIdentity } from "@/lib/domain/event-roles";
import { DEVICE_COOKIE } from "@/lib/identity/device";
import { verifyDeviceToken } from "@/lib/identity/device-token";
import { googleLinkedPlayerIds, publicEventSnapshot } from "@/lib/api/public-state";
import {
  readAccount,
  readEvent,
  readEventAuthVersion,
  readEventStaff,
  readEventRoleActions,
} from "@/lib/sheets/cache";
import { EventShell } from "@/components/EventShell";

export default async function EventLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ code: string }>;
}) {
  const { code: raw } = await params;
  const code = raw.toUpperCase();

  const event = await readEvent(code);
  if (!event) notFound();

  const jar = await cookies();
  const rawSession = verifySession(
    jar.get(cookieName(code))?.value,
    code,
    sessionSecret(),
  );

  // Đọc header để Next hiểu trang này phụ thuộc yêu cầu và không dựng tĩnh nhầm.
  await headers();

  const deviceId =
    verifyDeviceToken(jar.get(DEVICE_COOKIE)?.value, sessionSecret()) ?? "";
  // Trả lời "ai là tôi" ngay ở lượt dựng đầu tiên, cùng cách route state trả
  // lời. Để trống rồi chờ lần hỏi sau thì trang tham gia loé lên form gõ tên
  // trước khi kịp nhận ra người đã đăng nhập.
  const userId = verifyUserSession(
    jar.get(USER_COOKIE)?.value,
    sessionSecret(),
  )?.uid ?? null;

  const account = userId ? await readAccount(userId) : null;
  const [staff, roleActions] = await Promise.all([
    readEventStaff(code),
    readEventRoleActions(code),
  ]);
  const authVersion =
    rawSession?.role === "admin" ? await readEventAuthVersion(code) : 0;
  const session =
    rawSession?.role === "admin" && (rawSession.pv ?? 0) !== authVersion
      ? null
      : rawSession;

  // Cùng một hàm với `resolveContext`, không phải bản chép tay. Xem docblock của
  // `roleFor` để biết vì sao đó là điều kiện bắt buộc chứ không phải cho gọn.
  const me = findMyPlayer(event.state, deviceId, userId);
  const roleState = foldEventRoles({
    eventCode: code,
    ownerUserId: event.record.ownerUserId,
    state: event.state,
    legacyStaff: staff,
    actions: roleActions,
  });
  const eventRole = roleForIdentity(roleState, {
    userId,
    email: account?.account.email,
    me,
  });
  const role = roleFor(event.record, session?.role ?? null, userId, eventRole ?? false);
  const ownerByAccount = isOwnerByAccount(event.record, userId);
  const capabilities = capabilitiesForResolvedRole(role, ownerByAccount);

  return (
    <EventShell
      code={code}
      initialIdentity={userId ?? "anonymous"}
      initial={{
        ...publicEventSnapshot(event.state, deviceId, userId),
        role,
        capabilities,
        roleLabel: roleLabel(role),
        ...(capabilities.canViewIdentityFlags
          ? {
              googleLinkedPlayerIds: googleLinkedPlayerIds(event.state),
            }
          : {}),
        myPlayerId: me?.id ?? null,
        myPlayerHasAccount: Boolean(me?.userId),
        requiresPlayerPassword: event.record.playerPassHash !== "",
        ownerByAccount,
        ownerClaimable: event.record.ownerUserId === "",
        repaired: event.repaired,
      }}
    >
      {children}
    </EventShell>
  );
}
