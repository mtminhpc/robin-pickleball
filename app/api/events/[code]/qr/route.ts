/**
 * Mã QR dẫn tới trang tự tham gia.
 *
 * Trả về SVG chứ không phải PNG: nét không vỡ khi chiếu lên màn hình lớn hay in
 * ra giấy dán ở sân, và nhẹ hơn nhiều.
 */

import type { NextRequest } from "next/server";
import QRCode from "qrcode";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const joinUrl = new URL(`/e/${code.toUpperCase()}/join`, request.nextUrl.origin);

  const svg = await QRCode.toString(joinUrl.toString(), {
    type: "svg",
    margin: 1,
    // Mức sửa lỗi cao: mã hay bị chụp xiên, thiếu sáng, hoặc dán ngoài trời mưa.
    errorCorrectionLevel: "H",
  });

  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml",
      // Mã chỉ phụ thuộc đường dẫn nên không bao giờ đổi. Cho trình duyệt giữ lại.
      "cache-control": "public, max-age=86400, immutable",
    },
  });
}
