import { NextResponse, type NextRequest } from "next/server";
import { getEventAssetRepo } from "@/lib/sheets/cache";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ code: string; assetId: string }> },
) {
  const { code: rawCode, assetId } = await params;
  const asset = await getEventAssetRepo().get(rawCode.toUpperCase(), assetId);
  if (!asset) return NextResponse.json({ error: "Không tìm thấy ảnh." }, { status: 404 });
  const base64 = asset.dataUri.slice(asset.dataUri.indexOf(",") + 1);
  return new NextResponse(Buffer.from(base64, "base64"), {
    headers: {
      "Content-Type": asset.mime,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
