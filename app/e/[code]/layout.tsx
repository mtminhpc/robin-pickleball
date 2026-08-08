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
import type { Role } from "@/lib/domain/commands";
import { cookieName, sessionSecret, verifySession } from "@/lib/auth/session";
import { USER_COOKIE, verifyUserSession } from "@/lib/auth/user-session";
import { findMyPlayer } from "@/lib/api/context";
import { DEVICE_COOKIE } from "@/lib/identity/device";
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
  const role: Role = session?.role ?? "viewer";

  // Đọc header để Next hiểu trang này phụ thuộc yêu cầu và không dựng tĩnh nhầm.
  await headers();

  const deviceId = jar.get(DEVICE_COOKIE)?.value ?? "";
  // Trả lời "ai là tôi" ngay ở lượt dựng đầu tiên, cùng cách route state trả
  // lời. Để trống rồi chờ lần hỏi sau thì trang tham gia loé lên form gõ tên
  // trước khi kịp nhận ra người đã đăng nhập.
  const userId = verifyUserSession(
    jar.get(USER_COOKIE)?.value,
    sessionSecret(),
  )?.uid ?? null;

  return (
    <EventShell
      code={code}
      initial={{
        state: event.state,
        role,
        deviceId,
        myPlayerId: findMyPlayer(event.state, deviceId, userId)?.id ?? null,
        requiresPlayerPassword: event.record.playerPassHash !== "",
        repaired: event.repaired,
      }}
    >
      {children}
    </EventShell>
  );
}
