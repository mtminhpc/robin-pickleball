import { NextResponse, type NextRequest } from "next/server";
import { isAllowedForActor, type CommandEnvelope } from "@/lib/domain/commands";
import { apply } from "@/lib/domain/reduce";
import { commandPrecondition } from "@/lib/domain/precondition";
import {
  structurePreviewSubject,
  verifyStructurePreview,
} from "@/lib/auth/structure-preview";
import { fail, isResponse, readJson, resolveContext } from "@/lib/api/context";
import { redactEventState } from "@/lib/api/public-state";
import { getRepo, invalidateEvent, withEventLock } from "@/lib/sheets/cache";

interface ConfirmBody { token?: string }

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code: raw } = await params;
  const code = raw.toUpperCase();
  const parsed = await readJson<ConfirmBody>(request);
  if (!parsed.ok) return parsed.response;

  const ctx = await resolveContext(request, code);
  if (isResponse(ctx)) return ctx;
  const payload = verifyStructurePreview(
    parsed.body.token,
    code,
    structurePreviewSubject(ctx.role, ctx.userId, ctx.deviceId),
  );
  if (!payload) return fail(400, "Bản xem trước không hợp lệ hoặc đã hết hạn.");

  for (const command of payload.commands) {
    const target = "playerId" in command ? command.playerId : null;
    if (!isAllowedForActor(command.type, ctx.role, ctx.me?.id ?? null, target)) {
      return fail(403, "Quyền của bạn đã thay đổi. Hãy tải lại rồi xem trước lại.");
    }
  }

  const result = await withEventLock(code, async () => {
    const repo = getRepo();
    const loaded = await repo.load(code);
    if (!loaded) return { ok: false as const, status: 404, error: `Không tìm thấy sự kiện ${code}.` };
    if (loaded.state.processed !== payload.processed) {
      return {
        ok: false as const,
        status: 409,
        code: "stale-preview",
        error: "Trạng thái đã đổi sau khi xem trước. Hãy xác nhận lại trên lịch mới.",
      };
    }

    const now = Date.now();
    const commands = [...payload.commands, payload.schedule];
    const ids = [
      ...payload.commands.map((_, index) => `structure:${payload.nonce}:${index}`),
      `structure:${payload.nonce}:schedule`,
    ];
    let simulated = loaded.state;
    const envelopes: CommandEnvelope[] = [];
    for (const [index, command] of commands.entries()) {
      const envelope: CommandEnvelope = {
        id: ids[index]!,
        at: now + index,
        actor: ctx.actor,
        command,
        precondition: commandPrecondition(simulated, command),
      };
      const outcome = apply(simulated, envelope);
      if (!outcome.ok) {
        return { ok: false as const, status: 409, code: "stale-preview", error: outcome.error };
      }
      simulated = outcome.value;
      envelopes.push(envelope);
    }

    const committed = await repo.commitMany(code, envelopes, loaded, { allOrNothing: true });
    if (!committed.ok) {
      return { ok: false as const, status: 409, code: "stale-preview", error: committed.error };
    }
    const verified = await repo.load(code);
    if (!verified || ids.some((id) => !verified.state.appliedCommandIds.includes(id))) {
      return {
        ok: false as const,
        status: 409,
        code: "stale-preview",
        error: "Có thay đổi đồng thời; kế hoạch chưa được áp dụng trọn vẹn.",
      };
    }
    return { ok: true as const, state: verified.state, seq: verified.state.seq };
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, code: "code" in result ? result.code : undefined },
      { status: result.status },
    );
  }
  invalidateEvent(code);
  return NextResponse.json({
    state: redactEventState(result.state, ctx.deviceId, ctx.userId),
    seq: result.seq,
    effectiveRound: payload.effectiveRound,
    scheduleChange: result.state.scheduleChange,
  });
}
