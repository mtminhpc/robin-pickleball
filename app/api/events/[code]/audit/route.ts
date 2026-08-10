import { NextResponse, type NextRequest } from "next/server";
import { fail, isResponse, resolveContext } from "@/lib/api/context";
import { publicRoleAudit } from "@/lib/api/audit";
import { freshRoleState } from "@/lib/api/event-roles";
import type { Command, CommandEnvelope } from "@/lib/domain/commands";
import { getRepo } from "@/lib/sheets/cache";

const MANAGEMENT_COMMANDS = new Set<Command["type"]>([
  "AddPlayer", "ApproveJoin", "RejectJoin", "PausePlayer", "ResumePlayer",
  "PlayerLeft", "RemovePlayer", "DeclareAvailability", "SetPlayerPlan",
  "ConfirmPlayerSpan", "AddCourt", "RenameCourt", "ReorderCourts",
  "SetCourtAvailability", "ArchiveCourt", "TransferMatch", "SetSchedule",
]);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const code = (await params).code.toUpperCase();
  const ctx = await resolveContext(request, code);
  if (isResponse(ctx)) return ctx;
  if (!ctx.capabilities.canViewIdentityFlags) {
    return fail(403, "Chỉ Chủ hoặc Phó sự kiện được xem nhật ký quản lý.");
  }
  const offset = Math.max(0, Number.parseInt(request.nextUrl.searchParams.get("cursor") ?? "0", 10) || 0);
  const [commands, roles] = await Promise.all([getRepo().readLog(code), freshRoleState(ctx)]);
  const items = [
    ...commands.filter((entry) => MANAGEMENT_COMMANDS.has(entry.command.type)).map(commandAudit),
    ...roles.actions.map(publicRoleAudit),
  ].sort((a, b) => b.at - a.at || b.id.localeCompare(a.id));
  const page = items.slice(offset, offset + 50);
  return NextResponse.json({
    items: page,
    nextCursor: offset + page.length < items.length ? String(offset + page.length) : null,
  });
}

function commandAudit(entry: CommandEnvelope) {
  return {
    id: `command:${entry.id}`,
    actorLabel: entry.actor.label,
    at: entry.at,
    type: entry.command.type,
    effectiveRound: effectiveRound(entry.command),
    summary: commandSummary(entry.command),
  };
}

function effectiveRound(command: Command): number | null {
  if ("effectiveRound" in command && typeof command.effectiveRound === "number") return command.effectiveRound;
  if (command.type === "SetSchedule") return command.fromRound;
  if (command.type === "DeclareAvailability") return command.fromRound;
  return null;
}

function commandSummary(command: Command): string {
  switch (command.type) {
    case "AddCourt": return "Thêm sân vào danh mục";
    case "RenameCourt": return `Đổi tên sân thành “${command.name}”`;
    case "ReorderCourts": return "Đổi thứ tự sân";
    case "SetCourtAvailability": return "Đổi ca hoạt động của sân";
    case "ArchiveCourt": return command.archived ? "Lưu trữ sân" : "Khôi phục sân";
    case "TransferMatch": return "Chuyển trận sang sân khác";
    case "SetPlayerPlan": return "Đổi kế hoạch tham gia của người chơi";
    case "ConfirmPlayerSpan": return "Xác nhận người chơi đã đến/quay lại";
    case "RemovePlayer": return "Xoá người chưa thi đấu";
    case "PlayerLeft": return "Đánh dấu người chơi đã về";
    case "PausePlayer": return "Cho người chơi nghỉ tạm";
    case "ResumePlayer": return "Cho người chơi quay lại";
    case "AddPlayer": return "Thêm người chơi";
    case "ApproveJoin": return "Duyệt người chơi";
    case "RejectJoin": return "Từ chối người chơi";
    case "DeclareAvailability": return "Đổi khoảng tham gia kiểu cũ";
    case "SetSchedule": return "Cập nhật phần lịch chưa bắt đầu";
    default: return "Thay đổi quản lý";
  }
}
