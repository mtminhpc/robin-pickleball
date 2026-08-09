import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/api/user";
import { fail } from "@/lib/api/context";
import {
  getEventStaffRepo,
  invalidateEventStaff,
  readEvent,
  withEventLock,
} from "@/lib/sheets/cache";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ code: string; staffId: string }> },
) {
  const { code: raw, staffId } = await params;
  const code = raw.toUpperCase();
  const [owner, event] = await Promise.all([currentUser(request), readEvent(code)]);
  if (!owner) return fail(401, "Hãy đăng nhập Google bằng tài khoản Chủ sự kiện.");
  if (!event) return fail(404, `Không tìm thấy sự kiện có mã ${code}.`);
  if (!event.record.ownerUserId || event.record.ownerUserId !== owner.account.userId) {
    return fail(403, "Chỉ Chủ sự kiện được thu hồi quyền Phó sự kiện.");
  }

  return withEventLock(`staff:${code}`, async () => {
    const removed = await getEventStaffRepo().revoke(code, staffId, Date.now());
    if (!removed) return fail(404, "Không tìm thấy Phó sự kiện này.");
    invalidateEventStaff(code);
    return NextResponse.json({ ok: true });
  });
}
