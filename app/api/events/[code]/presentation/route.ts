import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { fail, isResponse, readJson, resolveContext } from "@/lib/api/context";
import { redactEventState } from "@/lib/api/public-state";
import { validateEventImageDataUri } from "@/lib/assets/event-image";
import type { Command } from "@/lib/domain/commands";
import type { AwardKind, SponsorLogoShape, SponsorTier, TrophyMode } from "@/lib/domain/types";
import { getEventAssetRepo, getRepo, invalidateEvent, withEventLock } from "@/lib/sheets/cache";

type Body =
  | { action: "setShape"; shape: SponsorLogoShape }
  | { action: "upsertSponsor"; id?: string; name?: string; tier?: SponsorTier; tierLabel?: string; order?: number; image?: string }
  | { action: "removeSponsor"; id?: string }
  | { action: "reorderSponsors"; ids?: string[] }
  | { action: "upsertAward"; id?: string; kind?: AwardKind; label?: string; recipientIds?: string[]; trophyMode?: TrophyMode; image?: string; removeImage?: boolean }
  | { action: "removeAward"; id?: string };

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const code = (await params).code.toUpperCase();
  const parsed = await readJson<Body>(request);
  if (!parsed.ok) return parsed.response;

  const ctx = await resolveContext(request, code);
  if (isResponse(ctx)) return ctx;
  // Biết mật khẩu quản trị không đồng nghĩa là chủ sở hữu thương mại của sự kiện.
  if (!ctx.ownerByAccount || !ctx.userId) {
    return fail(403, "Chỉ tài khoản đã tạo sự kiện mới quản lý nhà tài trợ và giải thưởng.");
  }

  return withEventLock(code, async () => {
    const repo = getRepo();
    const loaded = await repo.load(code);
    if (!loaded) return fail(404, "Không tìm thấy sự kiện.");
    if (loaded.record.ownerUserId !== ctx.userId) return fail(403, "Bạn không phải chủ sự kiện.");

    const body = parsed.body;
    const assets = getEventAssetRepo();
    const now = Date.now();
    let addedAssetId: string | null = null;
    let oldAssetId: string | null = null;
    let command: Command;

    if (body.action === "setShape") {
      command = { type: "SetSponsorLogoShape", shape: body.shape };
    } else if (body.action === "reorderSponsors") {
      command = { type: "ReorderSponsors", sponsorIds: body.ids ?? [] };
    } else if (body.action === "removeSponsor") {
      const old = loaded.state.presentation.sponsors.find((item) => item.id === body.id);
      if (!old) return fail(404, "Không tìm thấy nhà tài trợ.");
      oldAssetId = old.assetId;
      command = { type: "RemoveSponsor", sponsorId: old.id };
    } else if (body.action === "upsertSponsor") {
      const id = body.id || randomUUID();
      const old = loaded.state.presentation.sponsors.find((item) => item.id === id);
      let assetId = old?.assetId ?? "";
      if (body.image) {
        const image = validateEventImageDataUri(body.image);
        if (!image) return fail(400, "Logo phải là PNG, JPEG hoặc WebP hợp lệ và không quá 128×128 sau khi thu nhỏ.");
        assetId = randomUUID();
        addedAssetId = assetId;
        oldAssetId = old?.assetId ?? null;
        await assets.put({ eventCode: code, assetId, kind: "sponsor", ...image, createdBy: ctx.userId, createdAt: now, updatedAt: now });
      }
      if (!assetId) return fail(400, "Hãy chọn ảnh logo.");
      command = {
        type: "UpsertSponsor",
        sponsor: {
          id,
          name: body.name ?? old?.name ?? "",
          tier: body.tier ?? old?.tier ?? "partner",
          ...(body.tierLabel ?? old?.tierLabel ? { tierLabel: body.tierLabel ?? old?.tierLabel } : {}),
          assetId,
          order: body.order ?? old?.order ?? loaded.state.presentation.sponsors.length,
        },
      };
    } else if (body.action === "removeAward") {
      const old = loaded.state.presentation.awards.find((item) => item.id === body.id);
      if (!old) return fail(404, "Không tìm thấy giải.");
      oldAssetId = old.trophyAssetId ?? null;
      command = { type: "RemoveAward", awardId: old.id };
    } else if (body.action === "upsertAward") {
      const id = body.id || randomUUID();
      const old = loaded.state.presentation.awards.find((item) => item.id === id);
      let trophyAssetId = body.removeImage ? undefined : old?.trophyAssetId;
      if (body.image) {
        const image = validateEventImageDataUri(body.image);
        if (!image) return fail(400, "Ảnh cúp phải là PNG, JPEG hoặc WebP hợp lệ và không quá 128×128 sau khi thu nhỏ.");
        trophyAssetId = randomUUID();
        addedAssetId = trophyAssetId;
        oldAssetId = old?.trophyAssetId ?? null;
        await assets.put({ eventCode: code, assetId: trophyAssetId, kind: "trophy", ...image, createdBy: ctx.userId, createdAt: now, updatedAt: now });
      } else if (body.removeImage) {
        oldAssetId = old?.trophyAssetId ?? null;
      }
      command = {
        type: "UpsertAward",
        award: {
          id,
          kind: body.kind ?? old?.kind ?? "custom",
          label: body.label ?? old?.label ?? "",
          recipientIds: body.recipientIds ?? old?.recipientIds ?? [],
          ...(trophyAssetId ? { trophyAssetId } : {}),
          trophyMode: body.trophyMode ?? old?.trophyMode ?? "framed",
        },
      };
    } else {
      return fail(400, "Thao tác trình bày không hợp lệ.");
    }

    const result = await repo.append(code, {
      id: `presentation-${randomUUID()}`,
      at: now,
      actor: ctx.actor,
      command,
    }, loaded);
    if (!result.ok) {
      if (addedAssetId) await assets.deactivate(code, addedAssetId, Date.now());
      return fail(409, result.error);
    }
    if (oldAssetId && oldAssetId !== addedAssetId) await assets.deactivate(code, oldAssetId, Date.now());
    invalidateEvent(code);
    return NextResponse.json({ state: redactEventState(result.state, ctx.deviceId), seq: result.seq });
  });
}
