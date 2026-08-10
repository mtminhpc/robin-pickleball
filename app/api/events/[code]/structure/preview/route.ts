import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { isAllowedForActor } from "@/lib/domain/commands";
import type { StructureIntent } from "@/lib/domain/structure";
import { previewStructureChange } from "@/lib/domain/structure";
import {
  STRUCTURE_PREVIEW_TTL_MS,
  signStructurePreview,
  structurePreviewSubject,
} from "@/lib/auth/structure-preview";
import { fail, isResponse, readJson, resolveContext } from "@/lib/api/context";
import { getRepo } from "@/lib/sheets/cache";

interface PreviewBody {
  baseProcessed?: number;
  intent?: StructureIntent;
}

const PLANNING = { iterations: 100_000, timeBudgetMs: 3_500 } as const;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code: raw } = await params;
  const code = raw.toUpperCase();
  const parsed = await readJson<PreviewBody>(request);
  if (!parsed.ok) return parsed.response;
  const { baseProcessed, intent } = parsed.body;
  if (!intent?.type || !Number.isInteger(baseProcessed) || Number(baseProcessed) < 0) {
    return fail(400, "Thiếu intent hoặc phiên bản trạng thái để xem trước.");
  }

  const ctx = await resolveContext(request, code);
  if (isResponse(ctx)) return ctx;
  const denied = intentPermission(intent, ctx);
  if (denied) return fail(403, denied);

  const loaded = await getRepo().load(code);
  if (!loaded) return fail(404, `Không tìm thấy sự kiện ${code}.`);
  if (loaded.state.processed !== baseProcessed) {
    return NextResponse.json(
      { error: "Lịch đã thay đổi. Hãy tải trạng thái mới rồi xem trước lại.", code: "stale-state" },
      { status: 409 },
    );
  }

  const now = Date.now();
  const preview = previewStructureChange(loaded.state, intent, ctx.actor, now, PLANNING);
  if (preview.blocked.length > 0) {
    return NextResponse.json(
      {
        effectiveRound: preview.effectiveRound,
        diff: preview.diff,
        warnings: preview.warnings,
        blocked: preview.blocked,
        token: null,
      },
      { status: 422 },
    );
  }

  const nonce = randomUUID();
  const commandIds = preview.commands.map((_, index) => `structure:${nonce}:${index}`);
  const schedule = { ...preview.schedule, requiresCommandIds: commandIds };
  const payload = {
    v: 1 as const,
    code,
    processed: loaded.state.processed,
    issuedAt: now,
    expiresAt: now + STRUCTURE_PREVIEW_TTL_MS,
    nonce,
    subject: structurePreviewSubject(ctx.role, ctx.userId, ctx.deviceId),
    effectiveRound: preview.effectiveRound,
    commands: preview.commands,
    schedule,
    diff: preview.diff,
    warnings: preview.warnings,
  };

  return NextResponse.json({
    effectiveRound: preview.effectiveRound,
    before: summarize(loaded.state, preview.effectiveRound),
    after: summarize(preview.after, preview.effectiveRound),
    diff: preview.diff,
    warnings: preview.warnings,
    blocked: [],
    expiresAt: payload.expiresAt,
    token: signStructurePreview(payload),
  });
}

function intentPermission(
  intent: StructureIntent,
  ctx: Extract<Awaited<ReturnType<typeof resolveContext>>, { role: string }>,
): string | null {
  const target = "playerId" in intent ? intent.playerId : null;
  const commandType =
    intent.type === "set-player-plan"
      ? "SetPlayerPlan"
      : intent.type === "confirm-player-span"
        ? "ConfirmPlayerSpan"
        : intent.type === "add-court"
          ? "AddCourt"
          : intent.type === "set-court-availability"
            ? "SetCourtAvailability"
            : intent.type === "archive-court"
              ? "ArchiveCourt"
              : "TransferMatch";
  return isAllowedForActor(commandType, ctx.role, ctx.me?.id ?? null, target)
    ? null
    : target
      ? "Bạn chỉ được sửa ca của chính mình; Chủ hoặc Phó mới sửa cho người khác."
      : "Chỉ Chủ hoặc Phó sự kiện được thay đổi sân và lịch.";
}

function summarize(state: { courts: unknown[]; players: unknown[]; matches: Array<{ round: number; status: string }> }, fromRound: number) {
  return {
    courts: state.courts.length,
    players: state.players.length,
    scheduledMatches: state.matches.filter(
      (match) => match.round >= fromRound && match.status === "scheduled",
    ).length,
  };
}
