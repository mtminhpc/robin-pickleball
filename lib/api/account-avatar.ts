import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { checkPhotoDataUri } from "../avatars/photo";
import { readAccount, readAccountAsset } from "../sheets/cache";

const CACHE = "public, max-age=60, stale-while-revalidate=86400";

/** Phục vụ byte ảnh của tài khoản mà không đưa thông tin tài khoản vào JSON công khai. */
export async function accountAvatarResponse(
  request: NextRequest,
  userId: string,
): Promise<NextResponse> {
  const found = await readAccount(userId);
  if (!found) return missingAvatarResponse();
  const { prefs } = found.account;

  if (prefs.photoAssetId) {
    const asset = await readAccountAsset(userId, prefs.photoAssetId);
    if (asset) return binaryResponse(request, asset.dataUri, asset.mime);
  }

  if (prefs.photo) {
    const checked = checkPhotoDataUri(prefs.photo);
    if (checked.ok) {
      return binaryResponse(
        request,
        `data:${checked.mime};base64,${checked.base64}`,
        checked.mime,
      );
    }
  }

  const picture = safePicture(prefs.picture);
  if (picture) return NextResponse.redirect(picture, 307);
  return missingAvatarResponse();
}

export function missingAvatarResponse(): NextResponse {
  return new NextResponse(null, {
    status: 404,
    headers: { "X-Content-Type-Options": "nosniff" },
  });
}

function binaryResponse(
  request: NextRequest,
  dataUri: string,
  mime: string,
): NextResponse {
  const base64 = dataUri.slice(dataUri.indexOf(",") + 1);
  const etag = `"${createHash("sha1").update(base64).digest("hex").slice(0, 16)}"`;
  const headers = {
    ETag: etag,
    "Cache-Control": CACHE,
    "Content-Type": mime,
    "X-Content-Type-Options": "nosniff",
  };
  if (request.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers });
  }
  return new NextResponse(Buffer.from(base64, "base64"), { headers });
}

function safePicture(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}
