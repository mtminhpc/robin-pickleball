import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { generateEventCode } from "@/lib/auth/passwords";
import { resolveContext, fail, readJson } from "@/lib/api/context";
import { currentUser } from "@/lib/api/user";
import { DEFAULT_EVENT_LIMIT, isAppAdminEmail } from "@/lib/domain/app-admin";
import type { CommandEnvelope } from "@/lib/domain/commands";
import { emptyState } from "@/lib/domain/reduce";
import { courtLabelAt } from "@/lib/domain/types";
import {
  excludeDeletedEvents,
  getAppEventLimitRepo,
  getEventAssetRepo,
  getEventCopyRepo,
  getEventCreationReservationRepo,
  getRepo,
  invalidateEvent,
  withAccountLock,
} from "@/lib/sheets/cache";

interface CopyBody {
  idempotencyKey?: unknown;
}

/** Sao chép phần cấu hình/roster của một sự kiện đã kết thúc, không chép thành tích. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code: rawCode } = await params;
  const code = rawCode.toUpperCase();
  const ctx = await resolveContext(request, code);
  if (ctx instanceof NextResponse) return ctx;
  if (!ctx.capabilities.canCopyEvent || ctx.role !== "owner") {
    return fail(403, "Chỉ Chủ sự kiện bằng tài khoản Google mới được sao chép.");
  }
  if (ctx.event.state.status !== "finished") {
    return fail(409, "Chỉ sao chép được sự kiện đã kết thúc.");
  }
  const user = await currentUser(request);
  if (!user?.account.email || user.account.userId !== ctx.userId) {
    return fail(401, "Hãy đăng nhập lại tài khoản Chủ sự kiện.");
  }
  const parsed = await readJson<CopyBody>(request);
  if (!parsed.ok) return parsed.response;
  const key = typeof parsed.body.idempotencyKey === "string"
    ? parsed.body.idempotencyKey.trim()
    : request.headers.get("idempotency-key")?.trim() ?? "";
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(key)) {
    return fail(400, "Idempotency key không hợp lệ.");
  }

  const userId = user.account.userId;
  return withAccountLock(userId, async () => {
    const repo = getRepo();
    const copies = getEventCopyRepo();
    const priorClaim = await copies.find(userId, code, key);
    if (priorClaim?.status === "complete") {
      const prior = await repo.load(priorClaim.code);
      if (prior) return NextResponse.json({ code: priorClaim.code, copied: true, repeated: true });
      await copies.fail({ ownerUserId: userId, sourceCode: code, idempotencyKey: key, token: priorClaim.token, code: priorClaim.code, at: Date.now() });
    } else if (priorClaim?.status === "reserved") {
      if (Date.now() - priorClaim.createdAt < 120_000) {
        return fail(409, "Bản sao đang được tạo. Hãy thử lại sau ít giây với cùng yêu cầu.");
      }
      await copies.fail({ ownerUserId: userId, sourceCode: code, idempotencyKey: key, token: priorClaim.token, code: priorClaim.code, at: Date.now() });
    }

    const owned = await excludeDeletedEvents(await repo.listByOwner(userId));
    // Nếu lần trước dừng sau khi đã tạo dòng event, đó vẫn là cùng một bản sao
    // đang được hoàn tất, không phải một sự kiện mới thứ hai để tính quota.
    const retryCode = priorClaim?.status === "failed" ? priorClaim.code : "";
    const activeCount = owned.filter(
      (event) => event.record.code !== retryCode && event.state.status !== "finished",
    ).length;
    const limit = await eventLimit(user.account.email);
    if (limit !== null && activeCount >= limit) {
      return fail(409, `Bạn đang có ${activeCount}/${limit} sự kiện chưa kết thúc.`);
    }
    const reservations = getEventCreationReservationRepo();
    const ticket = limit === null
      ? null
      : await reservations.acquire(userId, limit - activeCount, Date.now());
    if (limit !== null && !ticket) return fail(409, "Hạn mức sự kiện vừa được dùng hết.");

    let claim: Awaited<ReturnType<typeof copies.reserve>> | null = null;
    try {
      const candidate = await pickUnusedCode(repo);
      claim = await copies.reserve({
        ownerUserId: userId,
        sourceCode: code,
        idempotencyKey: key,
        newCode: candidate,
        at: Date.now(),
      });
      if (!claim.winner) {
        if (ticket) await reservations.finish(ticket, "released", Date.now());
        const prior = await repo.load(claim.code);
        return prior && claim.status === "complete"
          ? NextResponse.json({ code: claim.code, copied: true, repeated: true })
          : fail(409, "Một thiết bị khác đang tạo cùng bản sao. Hãy thử lại.");
      }

      const source = ctx.event.state;
      const newCode = claim.code;
      const now = Date.now();
      const config = {
        ...source.config,
        name: `${source.config.name} — bản sao`.slice(0, 80),
        scheduledAt: null,
      };
      const copiedCourts = source.courts.map((court, index) => {
        const name = courtLabelAt(court, Math.max(1, source.lastRound + 1)).name;
        const id = randomUUID();
        return {
          id,
          order: index + 1,
          labels: [{ id: randomUUID(), name, effectiveFromRound: 1 }],
          availability: [{ from: 1, to: null }],
          archived: false,
        };
      });
      const existingTarget = await repo.load(newCode);
      const record = existingTarget?.record ?? await repo.create({
          code: newCode,
          clubId: source.clubId,
          name: config.name,
          status: "draft",
          ownerUserId: userId,
          playerPassHash: "",
          adminPassHash: "",
        }, now);
      const actor = { kind: "admin", label: `Chủ sự kiện · ${user.account.displayName}` } as const;
      const envelopes: CommandEnvelope[] = [{
        id: `copy-${newCode}-create`,
        at: now,
        actor,
        command: {
          type: "CreateEvent",
          code: newCode,
          clubId: source.clubId,
          config,
          courts: copiedCourts,
        },
      }];
      for (const [index, player] of source.players.filter((item) => item.status !== "rejected").entries()) {
        envelopes.push({
          id: `copy-${newCode}-player-${index}`,
          at: now + envelopes.length,
          actor,
          command: {
            type: "AddPlayer",
            asActive: false,
            player: {
              id: randomUUID(),
              name: player.name,
              avatarId: player.avatarId,
              ...(player.userId ? { userId: player.userId } : {}),
            },
          },
        });
      }
      envelopes.push({
        id: `copy-${newCode}-shape`,
        at: now + envelopes.length,
        actor,
        command: { type: "SetSponsorLogoShape", shape: source.presentation.sponsorLogoShape },
      });
      const assetRepo = getEventAssetRepo();
      const sourceAssets = new Map(
        (await assetRepo.listForEvent(code)).map((asset) => [asset.assetId, asset]),
      );
      const copiedAssets = [];
      for (const [index, sponsor] of source.presentation.sponsors.entries()) {
        const oldAsset = sourceAssets.get(sponsor.assetId);
        if (!oldAsset) continue;
        const newAssetId = randomUUID();
        copiedAssets.push({
          ...oldAsset,
          eventCode: newCode,
          assetId: newAssetId,
          createdBy: userId,
          createdAt: now,
          updatedAt: now,
        });
        envelopes.push({
          id: `copy-${newCode}-sponsor-${index}`,
          at: now + envelopes.length,
          actor,
          command: {
            type: "UpsertSponsor",
            sponsor: { ...sponsor, assetId: newAssetId },
          },
        });
      }
      await assetRepo.putMany(copiedAssets);
      const committed = await repo.commitMany(newCode, envelopes, {
        record,
        state: existingTarget?.state ?? emptyState(newCode),
        repaired: existingTarget?.repaired ?? false,
        skipped: existingTarget?.skipped ?? [],
      });
      if (!committed.ok) throw new Error(committed.error);
      await copies.complete({ ownerUserId: userId, sourceCode: code, idempotencyKey: key, token: claim.token, code: newCode, at: Date.now() });
      if (ticket) await reservations.finish(ticket, "consumed", Date.now());
      invalidateEvent(newCode);
      return NextResponse.json({ code: newCode, copied: true });
    } catch (error) {
      if (claim?.winner) {
        await copies.fail({ ownerUserId: userId, sourceCode: code, idempotencyKey: key, token: claim.token, code: claim.code, at: Date.now() });
      }
      if (ticket) await reservations.finish(ticket, "released", Date.now());
      return fail(500, error instanceof Error ? error.message : "Không sao chép được sự kiện.");
    }
  });
}

async function eventLimit(email: string): Promise<number | null> {
  if (isAppAdminEmail(email)) return null;
  const override = await getAppEventLimitRepo().byEmail(email);
  return override ? override.limit : DEFAULT_EVENT_LIMIT;
}

async function pickUnusedCode(repo: ReturnType<typeof getRepo>): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateEventCode();
    if (!(await repo.load(code))) return code;
  }
  throw new Error("Không sinh được mã bản sao. Hãy thử lại.");
}
