/**
 * Xóa mềm một sự kiện.
 *
 * Cố ý **không** dùng `resolveContext`: hàm đó trả `410` cho buổi đã xóa, nên một
 * lệnh xóa gọi lại lần hai — chuyện thường gặp khi mạng ở sân chập chờn — sẽ báo
 * lỗi thay vì im lặng thành công. Ở đây đọc thẳng từ `EventRepo` rồi để
 * `deleteEventUseCase` xét quyền, đúng một chỗ duy nhất.
 */

import { NextResponse, type NextRequest } from "next/server";
import { fail, readJson } from "@/lib/api/context";
import { currentUser } from "@/lib/api/user";
import { deleteEventUseCase } from "@/lib/api/event-deletion";
import { isDeleteConfirmationValid } from "@/lib/domain/event-deletion";
import {
  getEventDeletionRepo,
  getRepo,
  invalidateClubEvents,
  invalidateEvent,
  invalidateEventDeletions,
  withEventLock,
} from "@/lib/sheets/cache";

interface DeleteBody {
  confirmation?: unknown;
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code: rawCode } = await params;
  const code = rawCode.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,6}$/.test(code)) return fail(404, "Không tìm thấy sự kiện.");

  const user = await currentUser(request);
  if (!user?.account.email) {
    return fail(401, "Hãy đăng nhập Google bằng tài khoản Chủ sự kiện để xóa.");
  }

  const parsed = await readJson<DeleteBody>(request);
  if (!parsed.ok) return parsed.response;
  // Máy chủ kiểm lại đúng điều kiện của hộp xác nhận. Giao diện không bao giờ là
  // hàng rào duy nhất trước một thao tác khó nhìn thấy hậu quả như thế này.
  if (!isDeleteConfirmationValid(code, parsed.body.confirmation)) {
    return fail(400, `Nhập lại đúng mã ${code} để xác nhận xóa.`);
  }

  const actor = { userId: user.account.userId, email: user.account.email };
  const result = await withEventLock(code, () =>
    deleteEventUseCase({
      code,
      actor,
      now: Date.now(),
      repo: getRepo(),
      deletions: getEventDeletionRepo(),
    }),
  );

  if (!result.ok) {
    if (result.reason === "not-found") return fail(404, "Không tìm thấy sự kiện.");
    if (result.reason === "running") {
      return fail(409, "Buổi đang đánh. Hãy kết thúc hoặc kết thúc sớm trước khi xóa.");
    }
    if (result.reason === "invalid-status") {
      return fail(409, "Chỉ xóa được buổi chưa bắt đầu hoặc đã kết thúc.");
    }
    return fail(403, "Chỉ Chủ sự kiện bằng tài khoản Google hoặc App admin mới được xóa.");
  }

  invalidateEventDeletions();
  invalidateEvent(code);
  if (result.clubId) invalidateClubEvents(result.clubId);
  return NextResponse.json({ deleted: true, code, repeated: result.repeated });
}
