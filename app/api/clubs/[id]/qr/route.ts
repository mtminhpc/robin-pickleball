/**
 * Mã QR mời vào câu lạc bộ.
 *
 * Trỏ tới mã MỜI chứ không phải mã câu lạc bộ: mã mời đổi được khi cần khoá cửa
 * lại, còn mã câu lạc bộ thì theo suốt đời.
 */

import type { NextRequest } from "next/server";
import QRCode from "qrcode";
import { getClubRepo, readClub } from "@/lib/sheets/cache";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const loaded = (await readClub(id)) ?? (await getClubRepo().byInviteCode(id));
  if (!loaded) return new Response("Không tìm thấy câu lạc bộ", { status: 404 });

  const url = new URL(`/c/${loaded.club.inviteCode}/join`, request.nextUrl.origin);
  const svg = await QRCode.toString(url.toString(), {
    type: "svg",
    margin: 1,
    errorCorrectionLevel: "H",
  });

  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml",
      "cache-control": "public, max-age=3600",
    },
  });
}
