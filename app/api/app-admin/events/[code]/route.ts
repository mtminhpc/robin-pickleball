/**
 * Tra một mã sự kiện cho App admin, đủ để biết mình đang xóa/khôi phục cái gì.
 *
 * Đây là ngoại lệ duy nhất cho phép App admin nhìn vào một buổi họ không được trao
 * quyền, nên phần trả về được cắt tới mức tối thiểu: **không** email chủ sự kiện,
 * không mật khẩu, không tỷ số, không danh sách người chơi. Ngoại lệ này chỉ phục vụ
 * việc xóa nhầm/khôi phục, không phải một cửa hậu để xem buổi của người khác.
 */

import { NextResponse, type NextRequest } from "next/server";
import { fail } from "@/lib/api/context";
import { currentUser } from "@/lib/api/user";
import { isAppAdminEmail } from "@/lib/domain/app-admin";
import { getEventDeletionRepo, getRepo } from "@/lib/sheets/cache";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const user = await currentUser(request);
  if (!user || !isAppAdminEmail(user.account.email)) {
    return fail(403, "Chỉ quản trị viên ứng dụng được tra mã sự kiện.");
  }

  const { code: rawCode } = await params;
  const code = rawCode.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,6}$/.test(code)) return fail(400, "Mã sự kiện không hợp lệ.");

  // Repo thô, không phải `readEvent`: buổi đã xóa vẫn phải tra ra được thì mới
  // khôi phục được.
  const loaded = await getRepo().load(code);
  if (!loaded) return fail(404, `Không tìm thấy sự kiện có mã ${code}.`);

  const latest = await getEventDeletionRepo().latest(code);
  const deleted = latest?.action === "delete";
  return NextResponse.json({
    code: loaded.record.code,
    name: loaded.state.config.name || loaded.record.name,
    status: loaded.state.status,
    scheduledAt: loaded.state.config.scheduledAt,
    createdAt: loaded.state.createdAt,
    players: loaded.state.players.length,
    deleted,
    deletedAt: deleted ? latest.createdAt : null,
  });
}
