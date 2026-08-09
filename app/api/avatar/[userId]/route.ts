/**
 * Ảnh đại diện của một tài khoản.
 *
 * Ba nước, theo thứ tự ưu tiên: ảnh người dùng tự tải lên → ảnh bên Google →
 * không có gì. Nước cuối trả 404 chứ không trả một ảnh mặc định, vì phía giao
 * diện đã có sẵn ảnh suy từ tên và nó đẹp hơn bất cứ hình bóng người xám nào.
 * `<Avatar>` bắt lỗi tải ảnh rồi vẽ biểu tượng, nên 404 ở đây là một trạng thái
 * bình thường chứ không phải hỏng hóc.
 *
 * **Đường này chỉ được trả về ảnh.** Không email, không tên, không trường nào
 * khác của tài khoản. Ai xem được một buổi đánh thì cũng đọc được `userId` của
 * mọi người trong đó — trạng thái được gửi nguyên xuống trình duyệt từ trước tới
 * giờ — nên đường này ngang với "ai nhìn thấy tên bạn thì nhìn thấy mặt bạn".
 * Đó đúng là ý định. Rò rỉ email qua đây thì không.
 */

import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { checkPhotoDataUri } from "@/lib/avatars/photo";
import { readAccount } from "@/lib/sheets/cache";

/**
 * Đệm ngắn ở trình duyệt, nhưng cho phép dùng bản cũ rất lâu trong lúc hỏi lại.
 *
 * Một phút là khoảng chờ tối đa để người vừa đổi ảnh thấy ảnh mới trên máy khác.
 * `stale-while-revalidate` một ngày nghĩa là sau phút đó trình duyệt vẫn vẽ ngay
 * ảnh cũ rồi mới đi hỏi — hàng trận không bao giờ nhấp nháy chỗ trống.
 */
const CACHE = "public, max-age=60, stale-while-revalidate=86400";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;

  // `readAccount` đi qua `unstable_cache` 60 giây, nên tám tấm ảnh trong một vòng
  // đấu không thành tám lượt đọc Google Sheet.
  const found = await readAccount(userId);
  if (!found) return missing();

  const { prefs } = found.account;

  if (prefs.photo) {
    const checked = checkPhotoDataUri(prefs.photo);
    // Không hợp lệ thì bỏ qua và đi tiếp xuống ảnh Google, chứ không báo lỗi:
    // ô này người ta sửa tay trong Google Sheet được, và một ô hỏng không đáng
    // để mất luôn cả ảnh dự phòng.
    if (checked.ok) {
      const etag = `"${createHash("sha1").update(checked.base64).digest("hex").slice(0, 16)}"`;
      if (request.headers.get("if-none-match") === etag) {
        return new NextResponse(null, {
          status: 304,
          headers: {
            ETag: etag,
            "Cache-Control": CACHE,
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
      return new NextResponse(Buffer.from(checked.base64, "base64"), {
        headers: {
          "Content-Type": checked.mime,
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": CACHE,
          ETag: etag,
        },
      });
    }
  }

  // Chuyển hướng chứ không tải hộ: để máy chủ ảnh của Google làm việc của nó,
  // mình không tốn băng thông lẫn thời gian chờ. Địa chỉ hết hạn thì trình duyệt
  // báo lỗi ảnh và giao diện tự rơi về biểu tượng.
  const picture = safePicture(prefs.picture);
  if (picture) return NextResponse.redirect(picture, 307);

  return missing();
}

/**
 * Chỉ chuyển hướng tới địa chỉ `https` thật.
 *
 * `NextResponse.redirect` ném lỗi với chuỗi không phải URL, và ô này thì sửa tay
 * trong Google Sheet được — một ô gõ nhầm sẽ thành lỗi 500 cho mọi người đang
 * xem buổi đánh. Chặn cả `http` và các lược đồ lạ luôn: một địa chỉ do người
 * khác đặt mà trình duyệt tự đi theo là thứ không nên nới tay.
 */
function safePicture(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

function missing(): NextResponse {
  return new NextResponse(null, { status: 404 });
}
