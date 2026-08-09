/**
 * Bỏ một cái máy ra khỏi tài khoản.
 *
 * Việc này **không cắt được cái điện thoại**, và giao diện phải nói đúng như vậy.
 * Cookie thiết bị nằm trong chính cái máy đó nên máy chủ không xoá được, và danh
 * bạ câu lạc bộ vẫn nhận nó theo `device_id` qua `ClubRepo.forDevice`. Thứ duy
 * nhất bị cắt là việc **gộp số liệu**: máy đó thôi được tính vào trang "Của tôi",
 * và danh sách buổi của nó không còn theo tài khoản sang máy khác nữa.
 *
 * `deviceId` đi trong thân yêu cầu chứ không phải query string, để nó không nằm
 * lại trong nhật ký truy cập của máy chủ.
 */

import { NextResponse, type NextRequest } from "next/server";
import { deviceIdFromRequest } from "@/lib/identity/device-token";
import { getAccountRepo, invalidateAccount } from "@/lib/sheets/cache";
import { fail, readJson } from "@/lib/api/context";
import { currentUser } from "@/lib/api/user";

interface Body {
  deviceId?: string;
}

export async function DELETE(request: NextRequest) {
  const me = await currentUser(request);
  if (!me) return fail(401, "Cần đăng nhập mới gỡ được máy khỏi tài khoản.");

  const parsed = await readJson<Body>(request);
  if (!parsed.ok) return parsed.response;

  const deviceId = (parsed.body.deviceId ?? "").trim();
  if (!deviceId) return fail(400, "Thiếu mã máy.");

  // Máy đang cầm thì dùng Đăng xuất. Gỡ nó chỉ tạo ra một trạng thái khó hiểu:
  // vẫn đang đăng nhập bằng cookie, mà máy thì không còn thuộc tài khoản nào —
  // rồi lần đăng nhập sau nó tự gắn lại.
  if (deviceIdFromRequest(request) === deviceId) {
    return fail(400, "Đây là máy bạn đang dùng. Muốn rời tài khoản thì bấm Đăng xuất.");
  }

  const ok = await getAccountRepo().unlinkDevice(me.account.userId, deviceId);
  if (!ok) return fail(404, "Không tìm thấy máy này trong tài khoản của bạn.");

  invalidateAccount(me.account.userId);
  return NextResponse.json({ removed: true });
}
