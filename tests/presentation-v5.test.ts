import { describe, expect, it } from "vitest";
import type { Command } from "../lib/domain/commands";
import { apply, emptyState } from "../lib/domain/reduce";
import type { Actor, EventState, SponsorTier } from "../lib/domain/types";
import { withEventDefaults } from "../lib/domain/types";
import { validateEventImageDataUri } from "../lib/assets/event-image";
import { APP_ADMIN_EMAILS, DEFAULT_EVENT_LIMIT, isAppAdminEmail, validEventLimit } from "../lib/domain/app-admin";
import { FakeSheetsClient } from "../lib/sheets/client";
import { AppEventLimitRepo } from "../lib/sheets/app-event-limits";
import { EventAssetRepo } from "../lib/sheets/event-assets";
import { EventCreationReservationRepo } from "../lib/sheets/event-reservations";

const ADMIN: Actor = { kind: "admin", label: "chủ sự kiện", ref: "admin" };

function send(state: EventState, command: Command, id = crypto.randomUUID()) {
  return apply(state, { id, at: Date.now(), actor: ADMIN, command });
}

function sponsor(tier: SponsorTier, index: number): Command {
  return {
    type: "UpsertSponsor",
    sponsor: {
      id: `${tier}-${index}`,
      name: `${tier} ${index}`,
      tier,
      ...(tier === "custom" ? { tierLabel: `Hạng riêng ${index}` } : {}),
      assetId: `asset-${tier}-${index}`,
      order: index,
    },
  };
}

describe("nhà tài trợ v0.5", () => {
  // v0.6.1 bỏ trần 2 logo mỗi hạng chuẩn. Bài này giữ lại ở đây để trần cũ không
  // lặng lẽ quay về; phần thứ tự và sắp xếp sâu hơn nằm ở `tests/v061.test.ts`.
  it.each(["diamond", "gold", "silver", "partner"] as SponsorTier[])("hạng %s nhận số logo không giới hạn", (tier) => {
    let state = emptyState("V5");
    for (let index = 1; index <= 7; index++) {
      const result = send(state, sponsor(tier, index));
      expect(result.ok).toBe(true);
      if (result.ok) state = result.value;
    }
    expect(state.presentation.sponsors).toHaveLength(7);
    expect(state.presentation.sponsors.every((item) => item.tier === tier)).toBe(true);
  });

  it("hạng tự đặt không giới hạn và luôn đứng sau các hạng chuẩn", () => {
    let state = emptyState("V5");
    for (let index = 1; index <= 12; index++) {
      const result = send(state, sponsor("custom", index));
      expect(result.ok).toBe(true);
      if (result.ok) state = result.value;
    }
    const gold = send(state, sponsor("gold", 1));
    expect(gold.ok).toBe(true);
    if (gold.ok) state = gold.value;
    expect(state.presentation.sponsors).toHaveLength(13);
    expect(state.presentation.sponsors[0]?.tier).toBe("gold");
    expect(state.presentation.sponsors.at(-1)?.tier).toBe("custom");
  });

  it("đổi đủ ba hình dạng, sửa, sắp xếp và xoá vẫn phát lại được", () => {
    let state = emptyState("V5");
    for (const shape of ["square", "round", "transparent"] as const) {
      const result = send(state, { type: "SetSponsorLogoShape", shape });
      expect(result.ok).toBe(true);
      if (result.ok) state = result.value;
    }
    for (let index = 1; index <= 2; index++) {
      const result = send(state, sponsor("custom", index));
      if (result.ok) state = result.value;
    }
    const reordered = send(state, { type: "ReorderSponsors", sponsorIds: ["custom-2", "custom-1"] });
    expect(reordered.ok).toBe(true);
    if (reordered.ok) state = reordered.value;
    expect(state.presentation.sponsors.map((item) => item.id)).toEqual(["custom-2", "custom-1"]);
    const edited = send(state, { type: "UpsertSponsor", sponsor: { id: "custom-2", name: "Tên mới", tier: "custom", tierLabel: "Hạng mới", assetId: "asset-custom-2", order: 0 } });
    expect(edited.ok).toBe(true);
    if (edited.ok) state = edited.value;
    expect(state.presentation.sponsors[0]?.name).toBe("Tên mới");
    const removed = send(state, { type: "RemoveSponsor", sponsorId: "custom-1" });
    expect(removed.ok).toBe(true);
  });
});

describe("trao giải v0.5", () => {
  function finished(): EventState {
    let state = emptyState("V5");
    for (let index = 1; index <= 4; index++) {
      const result = send(state, { type: "AddPlayer", player: { id: `p${index}`, name: `P${index}`, avatarId: "a01" }, asActive: true });
      if (result.ok) state = result.value;
    }
    state.status = "finished";
    return state;
  }

  it("cấm trao trước khi kết thúc", () => {
    const state = emptyState("V5");
    const result = send(state, { type: "UpsertAward", award: { id: "a1", kind: "custom", label: "Fair Play", recipientIds: ["p1"], trophyMode: "framed" } });
    expect(result.ok).toBe(false);
  });

  it("cho đồng giải, cúp tùy chỉnh và nhiều giải khác nhau cho cùng người", () => {
    let state = finished();
    const first = send(state, { type: "UpsertAward", award: { id: "a1", kind: "champion", label: "Vô địch", recipientIds: ["p1", "p2", "p2"], trophyAssetId: "cup-1", trophyMode: "transparent" } });
    expect(first.ok).toBe(true);
    if (first.ok) state = first.value;
    expect(state.presentation.awards[0]?.recipientIds).toEqual(["p1", "p2"]);
    const custom = send(state, { type: "UpsertAward", award: { id: "a2", kind: "custom", label: "Fair Play", recipientIds: ["p1"], trophyMode: "framed" } });
    expect(custom.ok).toBe(true);
  });

  it("mỗi bậc chuẩn chỉ có một giải nhưng giải tự đặt không giới hạn", () => {
    let state = finished();
    const first = send(state, { type: "UpsertAward", award: { id: "a1", kind: "third", label: "Giải ba", recipientIds: ["p1"], trophyMode: "framed" } });
    if (first.ok) state = first.value;
    expect(send(state, { type: "UpsertAward", award: { id: "a2", kind: "third", label: "Giải ba", recipientIds: ["p2"], trophyMode: "framed" } }).ok).toBe(false);
    for (let index = 1; index <= 5; index++) {
      const result = send(state, { type: "UpsertAward", award: { id: `c${index}`, kind: "custom", label: `Giải riêng ${index}`, recipientIds: ["p1"], trophyMode: "framed" } });
      expect(result.ok).toBe(true);
      if (result.ok) state = result.value;
    }
  });
});

describe("ảnh sự kiện và tương thích snapshot", () => {
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAYAAABccqhmAAAACXBIWXMAAAPoAAAD6AG1e1JrAAABFUlEQVR4nO3BMQEAAADCoPVP7WsIoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA6AwBPAABo9vSmwAAAABJRU5ErkJggg==";
  it("đối chiếu magic bytes và chặn SVG/GIF hoặc ảnh giả nhãn", () => {
    expect(validateEventImageDataUri(png)?.mime).toBe("image/png");
    expect(validateEventImageDataUri("data:image/png;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==")).toBeNull();
    expect(validateEventImageDataUri("data:image/gif;base64,R0lGODlh")).toBeNull();
    expect(validateEventImageDataUri("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=")).toBeNull();
  });

  it("chặn ảnh sai kích thước 256×256 và ảnh vượt 512 KB", () => {
    const source = Buffer.from(png.slice(png.indexOf(",") + 1), "base64");
    const wrongSize = Buffer.from(source);
    wrongSize.writeUInt32BE(257, 16);
    expect(validateEventImageDataUri(`data:image/png;base64,${wrongSize.toString("base64")}`)).toBeNull();

    const oversized = Buffer.concat([source, Buffer.alloc(512 * 1024 + 1 - source.length)]);
    expect(validateEventImageDataUri(`data:image/png;base64,${oversized.toString("base64")}`)).toBeNull();
  });

  it("asset tách khỏi trạng thái, xoá mềm và không đọc chéo sự kiện", async () => {
    const repo = new EventAssetRepo(new FakeSheetsClient());
    await repo.put({ eventCode: "V5", assetId: "logo", kind: "sponsor", mime: "image/png", dataUri: png, createdBy: "u1", createdAt: 1, updatedAt: 1 });
    expect((await repo.get("V5", "logo"))?.dataUri).toBe(png);
    expect(await repo.get("OTHER", "logo")).toBeNull();
    await repo.deactivate("V5", "logo", 2);
    expect(await repo.get("V5", "logo")).toBeNull();
  });

  it("snapshot cũ tự có trường v0.5/v0.6 mà không reset dữ liệu", () => {
    const old = emptyState("OLD") as EventState;
    delete (old.config as Partial<EventState["config"]>).scheduledAt;
    delete (old.config as Partial<EventState["config"]>).venueAddress;
    delete (old.config as Partial<EventState["config"]>).expectedPlayers;
    delete (old.config as Partial<EventState["config"]>).targetGamesPerPlayer;
    delete (old.config as Partial<EventState["config"]>).estimatedMatchMinutes;
    delete (old.config as Partial<EventState["config"]>).courtTurnoverMinutes;
    delete (old as Partial<EventState>).presentation;
    const upgraded = withEventDefaults(old);
    expect(upgraded.config.scheduledAt).toBeNull();
    expect(upgraded.config.venueAddress).toBe("");
    expect(upgraded.config.expectedPlayers).toBe(8);
    expect(upgraded.config.targetGamesPerPlayer).toBe(6);
    expect(upgraded.config.estimatedMatchMinutes).toBe(15);
    expect(upgraded.config.courtTurnoverMinutes).toBe(3);
    expect(upgraded.presentation).toEqual({ sponsorLogoShape: "square", sponsors: [], awards: [] });
    expect(upgraded.players).toEqual(old.players);
    expect(old.players).toEqual([]);
  });
});

describe("quota và app admin", () => {
  it("nhận đúng hai app admin và kiểm hạn mức 3–100 hoặc vô hạn", () => {
    expect(APP_ADMIN_EMAILS.size).toBe(2);
    expect(isAppAdminEmail(" MTMINHPC@GMAIL.COM ")).toBe(true);
    expect(isAppAdminEmail("prolathevt02@gmail.com")).toBe(true);
    expect(isAppAdminEmail("player@example.com")).toBe(false);
    expect(DEFAULT_EVENT_LIMIT).toBe(3);
    expect(validEventLimit(3)).toBe(true);
    expect(validEventLimit(100)).toBe(true);
    expect(validEventLimit(null)).toBe(true);
    expect(validEventLimit(2)).toBe(false);
    expect(validEventLimit(101)).toBe(false);
  });

  it("lưu, sửa, vô hạn và thu hồi hạn mức theo email chuẩn hoá", async () => {
    const repo = new AppEventLimitRepo(new FakeSheetsClient());
    await repo.upsert(" Player@Example.COM ", 5, "admin", 1);
    expect((await repo.byEmail("player@example.com"))?.limit).toBe(5);
    await repo.upsert("player@example.com", null, "admin", 2);
    expect((await repo.byEmail("PLAYER@example.com"))?.limit).toBeNull();
    expect(await repo.revoke("player@example.com", "admin", 3)).toBe(true);
    expect(await repo.byEmail("player@example.com")).toBeNull();
  });

  it("nhiều yêu cầu đồng thời chỉ cấp đúng số vé còn lại", async () => {
    const repo = new EventCreationReservationRepo(new FakeSheetsClient());
    const results = await Promise.all(Array.from({ length: 8 }, () => repo.acquire("u1", 1, 1_000)));
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});
