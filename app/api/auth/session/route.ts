/**
 * Đang đăng nhập bằng tài khoản nào, và đăng xuất.
 *
 * `enabled` trong câu trả lời là thứ giao diện dựa vào để quyết định có vẽ nút
 * đăng nhập hay không. Máy chủ chưa cấu hình OAuth mà vẫn hiện nút thì người
 * dùng bấm vào và nhận một trang lỗi — thà đừng hiện.
 */

import { NextResponse, type NextRequest } from "next/server";
import { oauthEnabled } from "@/lib/auth/google-oauth";
import { USER_COOKIE } from "@/lib/auth/user-session";
import { currentUser } from "@/lib/api/user";
import { isAppAdminEmail } from "@/lib/domain/app-admin";

export async function GET(request: NextRequest) {
  const enabled = oauthEnabled();
  if (!enabled) return NextResponse.json({ enabled: false, user: null });

  const me = await currentUser(request);
  if (!me) return NextResponse.json({ enabled: true, user: null });

  return NextResponse.json({
    enabled: true,
    user: {
      /**
       * Để trang "Của tôi" dựng được địa chỉ ảnh của chính mình.
       *
       * Không phải là để lộ thêm gì: mã tài khoản của mọi người chơi vốn đã nằm
       * trong trạng thái sự kiện gửi xuống trình duyệt. Nó là mã ngẫu nhiên,
       * không suy ra được email, và tự nó không cho phép làm gì cả — mọi đường
       * ghi đều xét cookie phiên chứ không xét mã này.
       */
      userId: me.account.userId,
      email: me.account.email,
      displayName: me.account.displayName,
      avatarId: me.account.avatarId,
      picture: me.account.prefs.picture ?? "",
      /** Có ảnh tự tải lên hay chưa — để biết có hiện nút Xoá ảnh không. */
      hasPhoto: Boolean(me.account.prefs.photo),
      devices: me.devices.length,
      isAppAdmin: isAppAdminEmail(me.account.email),
    },
  });
}

/**
 * Đăng xuất.
 *
 * Chỉ xoá cookie tài khoản. Cookie thiết bị **giữ nguyên**, và đó là chủ ý: nó
 * không phải chứng chỉ đăng nhập mà là danh tính của cái máy. Xoá nó đi thì
 * người vừa đăng xuất mất luôn quyền tự sửa tỷ số mình vừa nhập, và cả tên đang
 * hiện trong buổi đánh đang diễn ra giữa sân.
 */
export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(USER_COOKIE);
  return response;
}
