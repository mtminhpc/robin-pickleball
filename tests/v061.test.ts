/**
 * Kiểm thử v0.6.1: tài trợ không giới hạn và xóa mềm sự kiện.
 *
 * Phần xóa được kiểm ở hai tầng, cố ý không ở tầng HTTP: chính sách thuần
 * (`canDeleteEvent`) và use-case I/O (`deleteEventUseCase`). Lý do nằm trong
 * docblock của `roleFor` — không bài nào trong dự án chạm route handler, nên logic
 * để trong route là logic không ai canh.
 */

import { describe, expect, it } from "vitest";
import type { Command, CommandEnvelope } from "../lib/domain/commands";
import { apply, emptyState, fold } from "../lib/domain/reduce";
import { DEFAULT_CONFIG, type Actor, type EventState, type SponsorTier } from "../lib/domain/types";
import { canDeleteEvent, isDeleteConfirmationValid, normalizeEventCode } from "../lib/domain/event-deletion";
import { deleteEventUseCase, restoreEventUseCase } from "../lib/api/event-deletion";
import { claimEventOwnership } from "../lib/api/event-ownership";
import { FakeSheetsClient } from "../lib/sheets/client";
import { EventDeletionRepo } from "../lib/sheets/event-deletions";
import { EventOwnerClaimRepo } from "../lib/sheets/event-owner-claims";
import { EventCreationReservationRepo } from "../lib/sheets/event-reservations";
import { EventRepo } from "../lib/sheets/repo";
import { TABS } from "../lib/sheets/schema";

const ADMIN: Actor = { kind: "admin", label: "chủ sự kiện", ref: "admin" };
const OWNER = { userId: "u-owner", email: "owner@example.com" };
const STRANGER = { userId: "u-khac", email: "khac@example.com" };
const APP_ADMIN = { userId: "u-admin", email: "mtminhpc@gmail.com" };

function send(state: EventState, command: Command, id = crypto.randomUUID()) {
  return apply(state, { id, at: Date.now(), actor: ADMIN, command });
}

function sponsorCommand(tier: SponsorTier, index: number): Command {
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

// ---------------------------------------------------------------------------

describe("tài trợ không giới hạn v0.6.1", () => {
  it("nhận nhiều logo ở mọi hạng chuẩn và giữ nguyên thứ tự hạng", () => {
    let state = emptyState("V61");
    // Cố ý xen kẽ hạng khi thêm: thứ tự hiển thị phải do hạng quyết định, không
    // phải do người quản lý tình cờ thêm theo trình tự nào.
    for (let index = 1; index <= 5; index++) {
      for (const tier of ["partner", "silver", "gold", "diamond", "custom"] as SponsorTier[]) {
        const result = send(state, sponsorCommand(tier, index));
        expect(result.ok).toBe(true);
        if (result.ok) state = result.value;
      }
    }

    expect(state.presentation.sponsors).toHaveLength(25);
    expect(state.presentation.sponsors.map((item) => item.tier)).toEqual([
      ...Array<SponsorTier>(5).fill("diamond"),
      ...Array<SponsorTier>(5).fill("gold"),
      ...Array<SponsorTier>(5).fill("silver"),
      ...Array<SponsorTier>(5).fill("partner"),
      ...Array<SponsorTier>(5).fill("custom"),
    ]);
    // Trong cùng một hạng thì `order` quyết định, giữ đúng thứ tự người ta xếp.
    expect(
      state.presentation.sponsors.filter((item) => item.tier === "gold").map((item) => item.id),
    ).toEqual(["gold-1", "gold-2", "gold-3", "gold-4", "gold-5"]);
  });

  it("sửa, sắp xếp và xóa vẫn đúng khi một hạng có nhiều hơn hai logo", () => {
    let state = emptyState("V61");
    for (let index = 1; index <= 4; index++) {
      const result = send(state, sponsorCommand("diamond", index));
      if (result.ok) state = result.value;
    }

    const reordered = send(state, {
      type: "ReorderSponsors",
      sponsorIds: ["diamond-4", "diamond-3", "diamond-2", "diamond-1"],
    });
    expect(reordered.ok).toBe(true);
    if (reordered.ok) state = reordered.value;
    expect(state.presentation.sponsors.map((item) => item.id)).toEqual([
      "diamond-4",
      "diamond-3",
      "diamond-2",
      "diamond-1",
    ]);

    // Sửa một logo giữa danh sách không được đẩy nó ra chỗ khác.
    const edited = send(state, {
      type: "UpsertSponsor",
      sponsor: {
        id: "diamond-3",
        name: "Tên mới",
        tier: "diamond",
        assetId: "asset-diamond-3",
        order: 1,
      },
    });
    expect(edited.ok).toBe(true);
    if (edited.ok) state = edited.value;
    expect(state.presentation.sponsors[1]?.name).toBe("Tên mới");

    const removed = send(state, { type: "RemoveSponsor", sponsorId: "diamond-4" });
    expect(removed.ok).toBe(true);
    if (removed.ok) state = removed.value;
    expect(state.presentation.sponsors).toHaveLength(3);
  });

  it("phát lại nhật ký ra đúng danh sách, không lệnh nào bị bỏ", () => {
    const commands: Command[] = [
      { type: "CreateEvent", code: "V61", clubId: null, config: { ...DEFAULT_CONFIG, name: "V61" } },
      ...[1, 2, 3, 4, 5].map((index) => sponsorCommand("gold", index)),
      ...[1, 2, 3].map((index) => sponsorCommand("silver", index)),
    ];
    const log: CommandEnvelope[] = commands.map((command, index) => ({
      id: `v61-${index}`,
      at: 1000 + index,
      actor: ADMIN,
      command,
    }));

    const replayed = fold("V61", log);
    expect(replayed.skipped).toEqual([]);
    expect(replayed.state.presentation.sponsors).toHaveLength(8);
    expect(
      replayed.state.presentation.sponsors.filter((item) => item.tier === "gold"),
    ).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------

describe("chính sách xóa sự kiện", () => {
  it("Chủ xóa được buổi chưa bắt đầu và buổi đã kết thúc", () => {
    for (const status of ["draft", "finished"]) {
      expect(
        canDeleteEvent({ ownerUserId: OWNER.userId, status, actor: OWNER }),
      ).toEqual({ allowed: true, actorKind: "owner" });
    }
  });

  it("buổi đang đánh bị chặn với mọi người, kể cả App admin", () => {
    for (const actor of [OWNER, APP_ADMIN]) {
      expect(
        canDeleteEvent({ ownerUserId: OWNER.userId, status: "running", actor }),
      ).toEqual({ allowed: false, reason: "running" });
    }
  });

  it("người không phải Chủ bị chặn, App admin thì được", () => {
    expect(
      canDeleteEvent({ ownerUserId: OWNER.userId, status: "draft", actor: STRANGER }),
    ).toEqual({ allowed: false, reason: "forbidden" });
    expect(
      canDeleteEvent({ ownerUserId: OWNER.userId, status: "finished", actor: APP_ADMIN }),
    ).toEqual({ allowed: true, actorKind: "app-admin" });
  });

  it("buổi legacy chưa có chủ chỉ App admin xóa được", () => {
    // `userId` rỗng không được khớp với `ownerUserId` rỗng — nếu khớp thì bất kỳ ai
    // cũng thành Chủ của mọi buổi cũ, đúng cái bẫy `roleFor` đã tránh.
    expect(
      canDeleteEvent({ ownerUserId: "", status: "draft", actor: { userId: "", email: "" } }),
    ).toEqual({ allowed: false, reason: "forbidden" });
    expect(
      canDeleteEvent({ ownerUserId: "", status: "draft", actor: STRANGER }),
    ).toEqual({ allowed: false, reason: "forbidden" });
    expect(
      canDeleteEvent({ ownerUserId: "", status: "draft", actor: APP_ADMIN }),
    ).toEqual({ allowed: true, actorKind: "app-admin" });
  });

  it("xác nhận phải khớp mã sau khi bỏ khoảng trắng và không phân biệt hoa thường", () => {
    expect(isDeleteConfirmationValid("ABC123", " abc123 ")).toBe(true);
    expect(isDeleteConfirmationValid("ABC123", "ABC124")).toBe(false);
    expect(isDeleteConfirmationValid("ABC123", "")).toBe(false);
    expect(isDeleteConfirmationValid("ABC123", null)).toBe(false);
    // Mã rỗng không được tự khớp với chuỗi rỗng.
    expect(isDeleteConfirmationValid("", "")).toBe(false);
    expect(normalizeEventCode(" hy62pj ")).toBe("HY62PJ");
  });
});

// ---------------------------------------------------------------------------

describe("nhật ký xóa mềm", () => {
  async function rowCount(sheets: FakeSheetsClient): Promise<number> {
    const [range] = await sheets.batchGet([`${TABS.eventDeletions}!A:E`]);
    return (range?.values ?? []).length;
  }

  it("xóa rồi khôi phục theo dòng mới nhất, và cả hai đều idempotent", async () => {
    const sheets = new FakeSheetsClient();
    const repo = new EventDeletionRepo(sheets);
    const actor = { actorUserId: OWNER.userId, actorKind: "owner" as const };

    expect(await repo.isDeleted("ABC123")).toBe(false);

    expect(await repo.delete({ eventCode: "ABC123", createdAt: 1, ...actor })).toEqual({
      alreadyDeleted: false,
    });
    expect(await repo.isDeleted("ABC123")).toBe(true);
    const afterDelete = await rowCount(sheets);

    // Gọi lặp: không thêm dòng nào, và cũng không báo lỗi.
    expect(await repo.delete({ eventCode: "ABC123", createdAt: 2, ...actor })).toEqual({
      alreadyDeleted: true,
    });
    expect(await rowCount(sheets)).toBe(afterDelete);

    expect(
      await repo.restore({ eventCode: "ABC123", createdAt: 3, actorUserId: APP_ADMIN.userId, actorKind: "app-admin" }),
    ).toEqual({ alreadyRestored: false });
    expect(await repo.isDeleted("ABC123")).toBe(false);
    expect(
      await repo.restore({ eventCode: "ABC123", createdAt: 4, actorUserId: APP_ADMIN.userId, actorKind: "app-admin" }),
    ).toEqual({ alreadyRestored: true });

    // Xóa lại lần nữa vẫn phải ăn: cờ theo dòng cuối, không phải một chiều.
    expect(await repo.delete({ eventCode: "ABC123", createdAt: 5, ...actor })).toEqual({
      alreadyDeleted: false,
    });
    expect((await repo.latest("ABC123"))?.createdAt).toBe(5);
  });

  it("chỉ trả về mã đang bị xóa, và chuẩn hóa chữ hoa", async () => {
    const repo = new EventDeletionRepo(new FakeSheetsClient());
    await repo.delete({ eventCode: "aaa111", createdAt: 1, actorUserId: "u", actorKind: "owner" });
    await repo.delete({ eventCode: "BBB222", createdAt: 2, actorUserId: "u", actorKind: "owner" });
    await repo.restore({ eventCode: "BBB222", createdAt: 3, actorUserId: "u", actorKind: "app-admin" });

    expect((await repo.deletedCodes()).sort()).toEqual(["AAA111"]);
    expect(await repo.isDeleted("aaa111")).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("use-case xóa và khôi phục", () => {
  async function fixture(status: "draft" | "running" | "finished", ownerUserId = OWNER.userId) {
    const sheets = new FakeSheetsClient();
    const repo = new EventRepo(sheets);
    const deletions = new EventDeletionRepo(sheets);
    await repo.create(
      {
        code: "DEL001",
        clubId: "club-1",
        name: "Buổi thử",
        status: "draft",
        ownerUserId,
        playerPassHash: "",
        adminPassHash: "hash-admin",
      },
      1000,
    );

    const commands: Command[] = [
      { type: "CreateEvent", code: "DEL001", clubId: "club-1", config: { ...DEFAULT_CONFIG, name: "Buổi thử" } },
      ...Array.from({ length: 4 }, (_, index) => ({
        type: "AddPlayer" as const,
        player: { id: `p${index + 1}`, name: `P${index + 1}`, avatarId: "a01" },
        asActive: true,
      })),
      ...(status === "draft" ? [] : [{ type: "StartEvent" as const }]),
      ...(status === "finished" ? [{ type: "FinishEvent" as const }] : []),
    ];
    const loaded = (await repo.load("DEL001"))!;
    const written = await repo.commitMany(
      "DEL001",
      commands.map((command, index) => ({
        id: `setup-${index}`,
        at: 1100 + index,
        actor: ADMIN,
        command,
      })),
      loaded,
    );
    expect(written.ok).toBe(true);
    expect((await repo.load("DEL001"))!.state.status).toBe(status);
    return { repo, deletions };
  }

  it("Chủ xóa buổi draft, gọi lặp báo repeated và không đụng snapshot", async () => {
    const { repo, deletions } = await fixture("draft");
    const before = (await repo.load("DEL001"))!;

    const first = await deleteEventUseCase({ code: "DEL001", actor: OWNER, now: 2000, repo, deletions });
    expect(first).toEqual({ ok: true, repeated: false, actorKind: "owner", clubId: "club-1" });

    const again = await deleteEventUseCase({ code: "DEL001", actor: OWNER, now: 2001, repo, deletions });
    expect(again).toEqual({ ok: true, repeated: true, actorKind: "owner", clubId: "club-1" });

    // Điểm mấu chốt của xóa mềm: dòng events, snapshot và số dòng nhật ký y nguyên.
    const after = (await repo.load("DEL001"))!;
    expect(after.state).toEqual(before.state);
    expect(after.record.seq).toBe(before.record.seq);
    expect(after.record.updatedAt).toBe(before.record.updatedAt);
  });

  it("chặn buổi đang đánh và chặn người không phải Chủ", async () => {
    const running = await fixture("running");
    await expect(
      deleteEventUseCase({ code: "DEL001", actor: OWNER, now: 2000, repo: running.repo, deletions: running.deletions }),
    ).resolves.toEqual({ ok: false, reason: "running" });
    await expect(
      deleteEventUseCase({ code: "DEL001", actor: APP_ADMIN, now: 2000, repo: running.repo, deletions: running.deletions }),
    ).resolves.toEqual({ ok: false, reason: "running" });
    expect(await running.deletions.isDeleted("DEL001")).toBe(false);

    const draft = await fixture("draft");
    await expect(
      deleteEventUseCase({ code: "DEL001", actor: STRANGER, now: 2000, repo: draft.repo, deletions: draft.deletions }),
    ).resolves.toEqual({ ok: false, reason: "forbidden" });
    expect(await draft.deletions.isDeleted("DEL001")).toBe(false);
  });

  it("mã không tồn tại trả not-found, không ghi dòng nào", async () => {
    const { repo, deletions } = await fixture("draft");
    await expect(
      deleteEventUseCase({ code: "NOPE01", actor: APP_ADMIN, now: 2000, repo, deletions }),
    ).resolves.toEqual({ ok: false, reason: "not-found" });
    expect(await deletions.deletedCodes()).toEqual([]);
  });

  it("chỉ App admin khôi phục được, và dữ liệu trở lại nguyên vẹn", async () => {
    const { repo, deletions } = await fixture("finished");
    const before = (await repo.load("DEL001"))!;
    await deleteEventUseCase({ code: "DEL001", actor: OWNER, now: 2000, repo, deletions });

    await expect(
      restoreEventUseCase({ code: "DEL001", actor: OWNER, now: 2100, repo, deletions }),
    ).resolves.toEqual({ ok: false, reason: "forbidden" });
    expect(await deletions.isDeleted("DEL001")).toBe(true);

    await expect(
      restoreEventUseCase({ code: "DEL001", actor: APP_ADMIN, now: 2200, repo, deletions }),
    ).resolves.toEqual({ ok: true, repeated: false, clubId: "club-1" });
    expect(await deletions.isDeleted("DEL001")).toBe(false);

    const after = (await repo.load("DEL001"))!;
    expect(after.state).toEqual(before.state);
    expect(after.state.players).toHaveLength(4);
    expect(after.record.seq).toBe(before.record.seq);
  });
});

// ---------------------------------------------------------------------------

describe("quota sau khi xóa", () => {
  it("buổi đã xóa không còn chiếm hạn mức khi nhận lại buổi cũ", async () => {
    const sheets = new FakeSheetsClient();
    const repo = new EventRepo(sheets);
    for (const code of ["OWN001", "OWN002", "OWN003"]) {
      await repo.create(
        { code, clubId: null, name: code, status: "draft", ownerUserId: "u1", playerPassHash: "", adminPassHash: "" },
        1000,
      );
    }
    await repo.create(
      { code: "OLD001", clubId: null, name: "OLD001", status: "draft", ownerUserId: "", playerPassHash: "", adminPassHash: "hash" },
      1000,
    );

    const ctx = {
      repo,
      reservations: new EventCreationReservationRepo(sheets),
      claims: new EventOwnerClaimRepo(sheets),
    };

    // Đầy 3/3 thì không nhận thêm được.
    const full = await claimEventOwnership({ code: "OLD001", userId: "u1", limit: 3, now: 2000, ...ctx });
    expect(full).toMatchObject({ ok: false, reason: "quota-full", used: 3 });

    // Xóa một buổi phải trả lại đúng một lượt.
    const freed = await claimEventOwnership({
      code: "OLD001",
      userId: "u1",
      limit: 3,
      now: 2100,
      deletedCodes: new Set(["OWN002"]),
      ...ctx,
    });
    expect(freed).toEqual({ ok: true, alreadyOwned: false });
  });
});
