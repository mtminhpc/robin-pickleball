/**
 * Tổng kết theo tuần hoặc theo tháng cho một câu lạc bộ.
 *
 * Chỉ thành viên mới xem được: đây là số liệu của cả nhóm qua nhiều buổi, khác
 * với bảng xếp hạng một buổi vốn mở cho ai có đường dẫn.
 */

import { NextResponse, type NextRequest } from "next/server";
import { rollupEvents, type PeriodType } from "@/lib/domain/rollup";
import { readClubEvents } from "@/lib/sheets/cache";
import { resolveClub } from "@/lib/api/club-context";
import { fail, isResponse } from "@/lib/api/context";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ctx = await resolveClub(request, id);
  if (isResponse(ctx)) return ctx;
  if (ctx.role === "guest") {
    return fail(403, "Chỉ người trong câu lạc bộ mới xem được tổng kết.");
  }

  const raw = request.nextUrl.searchParams.get("period");
  const period: PeriodType = raw === "month" ? "month" : "week";

  const events = await readClubEvents(ctx.loaded.club.id);
  const periods = rollupEvents(
    events.map(({ record, state }) => ({
      code: record.code,
      name: record.name,
      // Buổi chưa bấm Bắt đầu thì lấy lúc tạo — vẫn phải xếp được vào một tuần.
      at: state.startedAt ?? record.updatedAt,
      state,
    })),
    period,
  );

  return NextResponse.json({ period, periods, club: ctx.loaded.club });
}
