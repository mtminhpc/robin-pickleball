/**
 * Đọc trạng thái sự kiện.
 *
 * Đây là đường bị gọi nhiều nhất: mỗi điện thoại đang mở app hỏi lại vài giây một
 * lần. Nó đi qua bộ nhớ đệm trong `lib/sheets/cache.ts` nên hai mươi người cùng
 * xem vẫn chỉ tốn một lần đọc Google Sheet.
 */

import { NextResponse, type NextRequest } from "next/server";
import { isResponse, resolveContext } from "@/lib/api/context";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const ctx = await resolveContext(request, code.toUpperCase());
  if (isResponse(ctx)) return ctx;

  return NextResponse.json({
    state: ctx.event.state,
    role: ctx.role,
    deviceId: ctx.deviceId,
    /** Sự kiện có đặt mật khẩu người chơi hay không, để giao diện biết có cần hỏi. */
    requiresPlayerPassword: ctx.event.record.playerPassHash !== "",
    /**
     * Ảnh chụp trạng thái vừa phải dựng lại từ nhật ký. Giao diện không cần làm
     * gì, nhưng đưa ra để còn chẩn đoán được nếu nó xảy ra liên tục.
     */
    repaired: ctx.event.repaired,
  });
}
