import { afterEach, describe, expect, it } from "vitest";
import { claimEventOwnership } from "../lib/api/event-ownership";
import type { CommandEnvelope } from "../lib/domain/commands";
import { DEFAULT_CONFIG } from "../lib/domain/types";
import {
  loadRecentEvents,
  recentEventsForAccount,
  saveAccountRecentEvents,
  saveRecentEvents,
} from "../lib/identity/device";
import { scheduledAtFromInputs } from "../lib/scheduled-at";
import { FakeSheetsClient } from "../lib/sheets/client";
import { EventOwnerClaimRepo } from "../lib/sheets/event-owner-claims";
import { EventCreationReservationRepo } from "../lib/sheets/event-reservations";
import { EventRepo } from "../lib/sheets/repo";

describe("ngày giờ tạo buổi v0.5.1", () => {
  it("cho phép để trống cả hai ô", () => {
    expect(scheduledAtFromInputs("", "")).toEqual({ value: null, error: null });
  });

  it("bắt nhập đủ giờ và ngày", () => {
    expect(scheduledAtFromInputs("2026-08-09", "").error).toMatch(/đủ cả giờ/);
    expect(scheduledAtFromInputs("", "19:30").error).toMatch(/đủ cả giờ/);
  });

  it("ghép theo giờ địa phương và từ chối ngày không tồn tại", () => {
    const result = scheduledAtFromInputs("2026-08-09", "19:30");
    expect(result.error).toBeNull();
    const date = new Date(result.value!);
    expect([
      date.getFullYear(),
      date.getMonth() + 1,
      date.getDate(),
      date.getHours(),
      date.getMinutes(),
    ]).toEqual([2026, 8, 9, 19, 30]);
    expect(scheduledAtFromInputs("2026-02-30", "19:30").error).toMatch(/không hợp lệ/);
  });
});

describe("lịch sử gần đây theo tài khoản", () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  });

  it("nhận dữ liệu legacy vào Gmail đầu tiên nhưng không chuyển sang Gmail khác", () => {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          getItem: (key: string) => values.get(key) ?? null,
          setItem: (key: string, value: string) => values.set(key, value),
        },
      },
    });

    saveRecentEvents([
      { code: "hy62pj", name: "Test sân", lastOpenedAt: 1000 },
    ]);
    expect(recentEventsForAccount("u-phone").map((event) => event.code)).toEqual([
      "HY62PJ",
    ]);

    saveAccountRecentEvents("u-phone", loadRecentEvents());
    expect(recentEventsForAccount("u-phone")).toHaveLength(1);
    expect(recentEventsForAccount("u-computer")).toEqual([]);
  });
});

describe("nhận quyền sở hữu buổi cũ", () => {
  async function createEvent(repo: EventRepo, code: string, ownerUserId = "") {
    return repo.create(
      {
        code,
        clubId: null,
        name: code,
        status: "draft",
        ownerUserId,
        playerPassHash: "",
        adminPassHash: "hash-admin",
      },
      1000,
    );
  }

  async function finishEvent(repo: EventRepo, code: string) {
    const loaded = (await repo.load(code))!;
    const commands: CommandEnvelope["command"][] = [
      { type: "CreateEvent", code, clubId: null, config: { ...DEFAULT_CONFIG, name: code } },
      ...Array.from({ length: 4 }, (_, index) => ({
        type: "AddPlayer" as const,
        player: { id: `p${index + 1}`, name: `P${index + 1}`, avatarId: "a01" },
        asActive: true,
      })),
      { type: "StartEvent" },
      { type: "FinishEvent" },
    ];
    const result = await repo.commitMany(
      code,
      commands.map((command, index) => ({
        id: `finish-${code}-${index}`,
        at: 1100 + index,
        actor: { kind: "admin" as const, label: "chủ sân" },
        command,
      })),
      loaded,
    );
    expect(result.ok).toBe(true);
    expect((await repo.load(code))!.state.status).toBe("finished");
  }

  function repos() {
    const sheets = new FakeSheetsClient();
    return {
      sheets,
      repo: new EventRepo(sheets),
      reservations: new EventCreationReservationRepo(sheets),
      claims: new EventOwnerClaimRepo(sheets),
    };
  }

  it("chỉ ghi owner_user_id, giữ nguyên toàn bộ snapshot và gọi lặp an toàn", async () => {
    const ctx = repos();
    await createEvent(ctx.repo, "OLD001");
    const before = (await ctx.repo.load("OLD001"))!;

    const first = await claimEventOwnership({
      code: "OLD001",
      userId: "u1",
      limit: 3,
      now: 2000,
      ...ctx,
    });
    expect(first).toEqual({ ok: true, alreadyOwned: false });

    const after = (await ctx.repo.load("OLD001"))!;
    expect(after.record.ownerUserId).toBe("u1");
    expect(after.state).toEqual(before.state);
    expect(after.record.seq).toBe(before.record.seq);
    expect(after.record.updatedAt).toBe(before.record.updatedAt);

    await expect(
      claimEventOwnership({
        code: "OLD001",
        userId: "u1",
        limit: 3,
        now: 3000,
        ...ctx,
      }),
    ).resolves.toEqual({ ok: true, alreadyOwned: true });
  });

  it("không nhận thêm buổi đang mở khi tài khoản đã đầy quota", async () => {
    const ctx = repos();
    for (const code of ["OWN001", "OWN002", "OWN003"]) {
      await createEvent(ctx.repo, code, "u1");
    }
    await createEvent(ctx.repo, "OLD002");

    const result = await claimEventOwnership({
      code: "OLD002",
      userId: "u1",
      limit: 3,
      now: 2000,
      ...ctx,
    });
    expect(result).toEqual({
      ok: false,
      reason: "quota-full",
      used: 3,
      limit: 3,
    });
    expect((await ctx.repo.load("OLD002"))!.record.ownerUserId).toBe("");
  });

  it("buổi đã kết thúc được nhận lại mà không chiếm quota", async () => {
    const ctx = repos();
    for (const code of ["OWN011", "OWN012", "OWN013"]) {
      await createEvent(ctx.repo, code, "u1");
    }
    await createEvent(ctx.repo, "OLD012");
    await finishEvent(ctx.repo, "OLD012");

    await expect(
      claimEventOwnership({
        code: "OLD012",
        userId: "u1",
        limit: 3,
        now: 2000,
        ...ctx,
      }),
    ).resolves.toEqual({ ok: true, alreadyOwned: false });
  });

  it("hai tài khoản tranh cùng lúc chỉ một tài khoản thắng", async () => {
    const ctx = repos();
    await createEvent(ctx.repo, "OLD003");

    const results = await Promise.all(
      ["u1", "u2"].map((userId) =>
        claimEventOwnership({
          code: "OLD003",
          userId,
          limit: null,
          now: 2000,
          ...ctx,
        }),
      ),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(1);
    expect(["u1", "u2"]).toContain((await ctx.repo.load("OLD003"))!.record.ownerUserId);
  });

  it("sổ append-only giữ người đến trước kể cả khi hai nơi cùng ghi", async () => {
    const sheets = new FakeSheetsClient();
    const claims = new EventOwnerClaimRepo(sheets);
    const results = await Promise.all([
      claims.acquire("RACE01", "u1", 1),
      claims.acquire("RACE01", "u2", 1),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});
