/**
 * Đổi tên hiển thị của chính mình.
 *
 * Trước bản này không có đường nào đổi tên: `AccountRepo.updateAccount` viết
 * xong từ lâu nhưng chưa route nào gọi tới, nên cái tên Google đặt lúc đăng nhập
 * đầu tiên là vĩnh viễn. Trong nhóm chơi thì người ta gọi nhau bằng biệt danh,
 * không phải "Nguyễn Văn A".
 *
 * `upsertByEmail` đã cố ý **không ghi đè tên đang có** ở những lần đăng nhập
 * sau, nên tên sửa ở đây sống sót qua đăng xuất/đăng nhập lại. Đó là nửa kia của
 * cùng một quyết định, và thiếu route này thì nửa đó chưa dùng được vào việc gì.
 *
 * Lưu ý phạm vi: đây là tên **tài khoản**, không phải tên trong một buổi đánh.
 * Tên hiện trên hàng trận là `Player.name`, do lệnh `UpdateProfile` đổi. Hai thứ
 * cố ý tách nhau — cùng một người có thể là "Nam" ở nhóm này và "anh Nam" ở nhóm
 * kia.
 */

import { NextResponse, type NextRequest } from "next/server";
import { displayNameFrom } from "@/lib/domain/account";
import { getAccountRepo, invalidateAccount } from "@/lib/sheets/cache";
import { fail, readJson } from "@/lib/api/context";
import { currentUser } from "@/lib/api/user";

interface Body {
  displayName?: unknown;
  avatarId?: unknown;
}

export async function PATCH(request: NextRequest) {
  const me = await currentUser(request);
  if (!me) return fail(401, "Cần đăng nhập mới đổi được tên.");

  const parsed = await readJson<Body>(request);
  if (!parsed.ok) return parsed.response;

  const patch: { displayName?: string; avatarId?: string } = {};

  if (parsed.body.displayName !== undefined) {
    if (typeof parsed.body.displayName !== "string") {
      return fail(400, "Tên gửi lên không đọc được.");
    }
    if (parsed.body.displayName.trim() === "") {
      return fail(400, "Tên không được để trống.");
    }
    // Dùng chung đúng một luật cắt 40 ký tự với lúc đăng nhập, thay vì viết lại
    // ở đây — hai luật cắt khác nhau là hai độ dài tên khác nhau tuỳ đường vào.
    patch.displayName = displayNameFrom(parsed.body.displayName, me.account.email);
  }

  if (parsed.body.avatarId !== undefined) {
    if (typeof parsed.body.avatarId !== "string") {
      return fail(400, "Ảnh biểu tượng gửi lên không đọc được.");
    }
    patch.avatarId = parsed.body.avatarId;
  }

  if (Object.keys(patch).length === 0) return fail(400, "Không có gì để đổi.");

  const updated = await getAccountRepo().updateAccount(me.account.userId, patch);
  if (!updated) return fail(404, "Không tìm thấy tài khoản của bạn.");

  invalidateAccount(me.account.userId);
  return NextResponse.json({
    displayName: updated.displayName,
    avatarId: updated.avatarId,
  });
}
