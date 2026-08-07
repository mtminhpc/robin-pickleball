/**
 * Danh sách câu lạc bộ của thiết bị này, và tạo câu lạc bộ mới.
 *
 * Người tạo trở thành thành viên đầu tiên ngay trong cùng một lời gọi ghi — một
 * câu lạc bộ rỗng là trạng thái vô nghĩa, không nên tồn tại dù chỉ một giây.
 */

import { NextResponse, type NextRequest } from "next/server";
import { checkClubName, checkMemberName } from "@/lib/domain/club";
import { DEVICE_COOKIE } from "@/lib/identity/device";
import { getClubRepo, invalidateClub } from "@/lib/sheets/cache";
import { fail, readJson } from "@/lib/api/context";

interface CreateBody {
  name?: string;
  ownerName?: string;
  ownerAvatarId?: string;
  defaultCourts?: number;
  defaultPointsTo?: number;
}

export async function GET(request: NextRequest) {
  const deviceId = request.cookies.get(DEVICE_COOKIE)?.value ?? "";
  const clubs = await getClubRepo().forDevice(deviceId);
  return NextResponse.json({ clubs });
}

export async function POST(request: NextRequest) {
  const parsed = await readJson<CreateBody>(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  const nameError = checkClubName(body.name ?? "");
  if (nameError) return fail(400, nameError);

  const ownerName = body.ownerName ?? "";
  const ownerError = checkMemberName(ownerName);
  if (ownerError) return fail(400, `Tên của bạn: ${ownerError.toLowerCase()}`);

  const deviceId = request.cookies.get(DEVICE_COOKIE)?.value ?? "";
  if (!deviceId) {
    return fail(
      400,
      "Trình duyệt đang chặn cookie nên không nhận ra được máy này. Bật cookie rồi tải lại trang.",
    );
  }

  const created = await getClubRepo().create({
    name: body.name!,
    ownerRef: deviceId,
    ownerName,
    ownerAvatarId: body.ownerAvatarId ?? "e01-c01",
    settings: {
      ...(body.defaultCourts ? { defaultCourts: clamp(body.defaultCourts, 1, 8) } : {}),
      ...(body.defaultPointsTo ? { defaultPointsTo: clamp(body.defaultPointsTo, 5, 50) } : {}),
    },
    at: Date.now(),
  });

  invalidateClub(created.club.id);
  return NextResponse.json(created);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.round(n)));
}
