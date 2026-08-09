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
import { findMyPlayer, isOwnerByAccount, roleFor } from "@/lib/api/context";
import { DEVICE_COOKIE } from "@/lib/identity/device";
import { verifyDeviceToken } from "@/lib/identity/device-token";
import { publicEventSnapshot } from "@/lib/api/public-state";
import { readEvent } from "@/lib/sheets/cache";
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
  const session = verifySession(
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

  // Cùng một hàm với `resolveContext`, không phải bản chép tay. Xem docblock của
  // `roleFor` để biết vì sao đó là điều kiện bắt buộc chứ không phải cho gọn.
  const role = roleFor(event.record, session?.role ?? null, userId);

  return (
    <EventShell
      code={code}
      initial={{
        ...publicEventSnapshot(event.state, deviceId),
        role,
        myPlayerId: findMyPlayer(event.state, deviceId, userId)?.id ?? null,
        requiresPlayerPassword: event.record.playerPassHash !== "",
        ownerByAccount: isOwnerByAccount(event.record, userId),
        ownerClaimable: event.record.ownerUserId === "",
        repaired: event.repaired,
      }}
    >
      {children}
    </EventShell>
  );
}
