/**
 * Đọc trạng thái sự kiện.
 *
 * Đây là đường bị gọi nhiều nhất: mỗi điện thoại đang mở app hỏi lại vài giây một
 * lần. Nó đi qua bộ nhớ đệm trong `lib/sheets/cache.ts` nên hai mươi người cùng
 * xem vẫn chỉ tốn một lần đọc Google Sheet.
 */

import { NextResponse, type NextRequest } from "next/server";
import { isResponse, resolveContext } from "@/lib/api/context";
import { publicEventSnapshot } from "@/lib/api/public-state";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const ctx = await resolveContext(request, code.toUpperCase());
  if (isResponse(ctx)) return ctx;

  const etag = `W/\"${ctx.event.state.seq}-${ctx.event.state.processed}-${ctx.role}-${ctx.me?.id ?? "-"}-${ctx.event.record.ownerUserId ? "owned" : "claimable"}-${ctx.event.record.playerPassHash ? "player-pass" : "open"}\"`;
  const headers = {
    ETag: etag,
    Vary: "Cookie",
    "Cache-Control": "private, no-cache, must-revalidate",
  };
  if (request.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers });
  }

  return NextResponse.json(
    {
      ...publicEventSnapshot(ctx.event.state, ctx.deviceId, ctx.userId),
      role: ctx.role,
      capabilities: ctx.capabilities,
      roleLabel: ctx.roleLabel,
    /**
     * Người chơi nào là người đang xem.
     *
     * Máy chủ trả lời thay vì để trình duyệt tự dò, vì chỉ máy chủ mới đọc được
     * cookie tài khoản (`httpOnly`). Không có nó thì người vừa đổi điện thoại mở
     * app lên sẽ không thấy mình đâu cả dù đã đăng nhập.
     */
    myPlayerId: ctx.me?.id ?? null,
    myPlayerHasAccount: Boolean(ctx.me?.userId),
    /** Sự kiện có đặt mật khẩu người chơi hay không, để giao diện biết có cần hỏi. */
    requiresPlayerPassword: ctx.event.record.playerPassHash !== "",
    /**
     * Bạn là chủ nhờ tài khoản đã tạo ra buổi này. Đây là điều kiện để hiện khối
     * đổi mật khẩu — quyền đó cố ý không cho người chỉ biết mật khẩu.
     */
    ownerByAccount: ctx.ownerByAccount,
    /** Buổi legacy chưa có chủ tài khoản; không trả mã/email của bất kỳ ai. */
    ownerClaimable: ctx.event.record.ownerUserId === "",
    /**
     * Ảnh chụp trạng thái vừa phải dựng lại từ nhật ký. Giao diện không cần làm
     * gì, nhưng đưa ra để còn chẩn đoán được nếu nó xảy ra liên tục.
     */
      repaired: ctx.event.repaired,
    },
    { headers },
  );
}
