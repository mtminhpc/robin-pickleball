/** Ảnh người chơi theo mã sự kiện/player công khai, không làm lộ userId nội bộ. */
import type { NextRequest } from "next/server";
import { accountAvatarResponse, missingAvatarResponse } from "@/lib/api/account-avatar";
import { readEvent } from "@/lib/sheets/cache";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string; playerId: string }> },
) {
  const { code: raw, playerId } = await params;
  const event = await readEvent(raw.toUpperCase());
  const player = event?.state.players.find((item) => item.id === playerId);
  if (!player?.userId) return missingAvatarResponse();
  return accountAvatarResponse(request, player.userId);
}
