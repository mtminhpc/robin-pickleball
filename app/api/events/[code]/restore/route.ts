/**
 * Khôi phục một sự kiện đã xóa mềm. Chỉ App admin.
 *
 * Không đọc qua `readEvent`/`resolveContext` vì cả hai đã che buổi đã xóa đi —
 * đúng ý đồ với mọi đường khác, nhưng ở đây thì phải nhìn thấy nó mới gỡ được cờ.
 */

import { NextResponse, type NextRequest } from "next/server";
import { fail } from "@/lib/api/context";
import { currentUser } from "@/lib/api/user";
import { restoreEventUseCase } from "@/lib/api/event-deletion";
import {
  getEventDeletionRepo,
  getRepo,
  invalidateClubEvents,
  invalidateEvent,
  invalidateEventDeletions,
  withEventLock,
} from "@/lib/sheets/cache";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code: rawCode } = await params;
  const code = rawCode.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,6}$/.test(code)) return fail(404, "Không tìm thấy sự kiện.");

  const user = await currentUser(request);
  if (!user?.account.email) return fail(401, "Hãy đăng nhập Google.");

  const result = await withEventLock(code, () =>
    restoreEventUseCase({
      code,
      actor: { userId: user.account.userId, email: user.account.email },
      now: Date.now(),
      repo: getRepo(),
      deletions: getEventDeletionRepo(),
    }),
  );

  if (!result.ok) {
    return result.reason === "not-found"
      ? fail(404, "Không tìm thấy sự kiện.")
      : fail(403, "Chỉ App admin mới khôi phục được sự kiện đã xóa.");
  }

  invalidateEventDeletions();
  invalidateEvent(code);
  if (result.clubId) invalidateClubEvents(result.clubId);
  return NextResponse.json({ restored: true, code, repeated: result.repeated });
}
