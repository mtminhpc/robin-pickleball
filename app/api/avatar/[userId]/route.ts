/** Ảnh tài khoản cho chính chủ và các màn hình legacy; dữ liệu sự kiện không còn phát userId. */
import type { NextRequest } from "next/server";
import { accountAvatarResponse } from "@/lib/api/account-avatar";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  return accountAvatarResponse(request, (await params).userId);
}
