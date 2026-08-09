/**
 * Danh sách câu lạc bộ của thiết bị này, và tạo câu lạc bộ mới.
 *
 * Người tạo trở thành thành viên đầu tiên ngay trong cùng một lời gọi ghi — một
 * câu lạc bộ rỗng là trạng thái vô nghĩa, không nên tồn tại dù chỉ một giây.
 */

import { NextResponse, type NextRequest } from "next/server";
import { checkClubName, checkMemberName } from "@/lib/domain/club";
import { deviceIdFromRequest } from "@/lib/identity/device-token";
import { getClubRepo, invalidateClub } from "@/lib/sheets/cache";
import { fail, readJson } from "@/lib/api/context";
import { currentUserId } from "@/lib/api/user";

interface CreateBody {
  name?: string;
  ownerName?: string;
  ownerAvatarId?: string;
  defaultCourts?: number;
  defaultPointsTo?: number;
}

/**
 * Câu lạc bộ của người gửi yêu cầu.
 *
 * Gộp hai đường: câu lạc bộ mà cái máy này đã vào, và câu lạc bộ mà tài khoản
 * này đã vào từ máy khác. Người vừa đăng nhập trên điện thoại mới phải thấy đủ
 * cả hai — đó chính là điều họ đăng nhập để có.
 */
export async function GET(request: NextRequest) {
  const deviceId = deviceIdFromRequest(request);
  const userId = currentUserId(request);

  const repo = getClubRepo();
  const [byDevice, byUser] = await Promise.all([
    repo.forDevice(deviceId),
    userId ? repo.forUser(userId) : Promise.resolve([]),
  ]);

  const seen = new Set<string>();
  const clubs = [...byDevice, ...byUser].filter((club) => {
    if (seen.has(club.id)) return false;
    seen.add(club.id);
    return true;
  });
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

  const deviceId = deviceIdFromRequest(request);
  if (!deviceId) {
    return fail(
      400,
      "Trình duyệt đang chặn cookie nên không nhận ra được máy này. Bật cookie rồi tải lại trang.",
    );
  }

  const userId = currentUserId(request);
  const created = await getClubRepo().create({
    name: body.name!,
    ownerDeviceId: deviceId,
    ...(userId ? { ownerUserId: userId } : {}),
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
