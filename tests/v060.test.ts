import { describe, expect, it } from "vitest";
import { capabilitiesForRole } from "../lib/domain/commands";
import { roleFor } from "../lib/api/context";
import { apply, emptyState } from "../lib/domain/reduce";
import { commandPrecondition } from "../lib/domain/precondition";
import { nextScheduleCommand } from "../lib/domain/autoplan";
import { DEFAULT_CONFIG, type Actor, type EventState } from "../lib/domain/types";
import { suggestedPromotions, validatePromoteMatch } from "../lib/scheduler/validate";
import { FakeSheetsClient } from "../lib/sheets/client";
import { EventStaffRepo } from "../lib/sheets/event-staff";
import { EventAuthRepo } from "../lib/sheets/event-auth";
import { EventCopyRepo } from "../lib/sheets/event-copies";
import { EventAssetRepo } from "../lib/sheets/event-assets";
import { EventSim } from "../lib/testing/harness";
import { assertScheduleValid } from "./invariants";

const OWNER: Actor = { kind: "admin", label: "Chủ sự kiện · TEST", ref: "owner" };

describe("ma trận điều hành v0.6", () => {
  it("tách Chủ, Phó, mật khẩu giới hạn và admin legacy", () => {
    const owned = { ownerUserId: "owner-1" };
    const legacy = { ownerUserId: "" };
    expect(roleFor(owned, "admin", "other-user")).toBe("operator");
    expect(roleFor(owned, null, "manager-user", true)).toBe("manager");
    expect(roleFor(owned, null, "owner-1", true)).toBe("owner");
    expect(roleFor(legacy, "admin", null)).toBe("admin");

    const owner = capabilitiesForRole("owner");
    const manager = capabilitiesForRole("manager");
    const operator = capabilitiesForRole("operator");
    expect(owner.canManageStaff && owner.canEndEarly && owner.canCopyEvent).toBe(true);
    expect(manager.canFinishNormally).toBe(true);
    expect(manager.canEndEarly || manager.canManageStaff || manager.canManagePresentation).toBe(false);
    expect(operator.canManageSchedule).toBe(true);
    expect(operator.canEditAnyScore || operator.canFinishNormally || operator.canChangePasswords).toBe(false);
  });

  it("lời mời chờ tự kích hoạt, thu hồi giải phóng tư cách và không đọc chéo sự kiện", async () => {
    const sheets = new FakeSheetsClient();
    const repo = new EventStaffRepo(sheets);
    const pending = await repo.invite({ eventCode: "ABC123", email: " Pho@Example.com ", grantedBy: "owner", at: 1 });
    expect(pending.status).toBe("pending");
    expect(await repo.eventCodesFor({ userId: "", email: "pho@example.com" })).toEqual(["ABC123"]);
    const active = await repo.activate(pending, { userId: "u-pho", displayName: "Phó TEST" }, 2);
    expect(active.status).toBe("active");
    expect((await repo.membership("ABC123", { userId: "u-pho", email: "" }))?.displayName).toBe("Phó TEST");
    expect(await repo.membership("OTHER", { userId: "u-pho", email: "" })).toBeNull();
    expect(await repo.revoke("ABC123", pending.staffId, 3)).toBe(true);
    expect(await repo.eventCodesFor({ userId: "u-pho", email: "pho@example.com" })).toEqual([]);
  });

  it("phiên bản mật khẩu tăng append-only", async () => {
    const repo = new EventAuthRepo(new FakeSheetsClient());
    expect(await repo.version("ABC123")).toBe(0);
    expect(await repo.bump("ABC123", 1)).toBe(1);
    expect(await repo.bump("ABC123", 2)).toBe(2);
    expect(await repo.version("ABC123")).toBe(2);
  });
});

describe("dời một trận lên lượt sân bổ sung", () => {
  it("đưa đúng một trận hợp lệ lên, giữ cặp và đánh dấu courtWave", () => {
    let state = promotionFixture();
    const validation = validatePromoteMatch(state, "m2", 1, 1, true, 100);
    expect(validation.severity).not.toBe("block");
    expect(suggestedPromotions(state, 1, 1, 100).map((item) => item.matchId)).toContain("m2");
    const outcome = send(state, { type: "PromoteMatch", matchId: "m2", toRound: 1, toCourt: 1, startNow: true }, "promote");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    state = outcome.value;
    const moved = state.matches.find((match) => match.id === "m2")!;
    expect(moved.round).toBe(1);
    expect(moved.courtWave).toBe(2);
    expect(moved.status).toBe("playing");
    expect([...moved.teamA, ...moved.teamB]).toEqual(["p5", "p6", "p7", "p8"]);
    const follow = nextScheduleCommand(state, { type: "PromoteMatch", matchId: "m2", toRound: 1, toCourt: 1, startNow: true }, { iterations: 500, timeBudgetMs: 20 });
    if (follow) state = success(send(state, follow, "replan"));
    expect(state.matches.find((match) => match.id === "m2")?.courtWave).toBe(2);
  });

  it("chặn người đã có trận trong logical round và không cho cưỡng ép", () => {
    const state = promotionFixture();
    const blocked = validatePromoteMatch(state, "m3", 1, 1, false, 100);
    expect(blocked.severity).toBe("block");
    expect(blocked.notes.some((note) => /đã có trận/.test(note.message))).toBe(true);
    expect(suggestedPromotions(state, 1, 1, 100).map((item) => item.matchId)).not.toContain("m3");
  });

  it.each([4, 5, 6, 7, 8, 9, 10, 11])(
    "kiểm hết trận tương lai với %i người và không phá bất biến công bằng",
    (playerCount) => {
      const sim = new EventSim({
        seed: 6_000 + playerCount,
        config: { courts: 1, lookaheadRounds: 6 },
        planning: { iterations: 2_000, timeBudgetMs: 80 },
      });
      sim.addPlayers(Array.from({ length: playerCount }, (_, index) => `P${index + 1}`));
      sim.start();

      const firstRound = Math.min(...sim.state.matches.map((match) => match.round));
      const first = sim.state.matches.find(
        (match) => match.round === firstRound && match.status === "scheduled",
      );
      expect(first).toBeDefined();
      if (!first) return;
      sim.send({
        type: "SubmitResult",
        matchId: first.id,
        scoreA: 11,
        scoreB: 7,
        irregular: false,
      });

      const future = sim.state.matches.filter(
        (match) => match.status === "scheduled" && match.round > firstRound,
      );
      const expected = future.filter(
        (match) => validatePromoteMatch(sim.state, match.id, firstRound, 1, false, 100).severity !== "block",
      );
      const suggestions = suggestedPromotions(sim.state, firstRound, 1, 100);
      expect(suggestions.map((item) => item.matchId)).toEqual(expected.map((match) => match.id));

      for (const suggestion of suggestions) {
        expect(suggestion.validation.preview).not.toBeNull();
        if (!suggestion.validation.preview) continue;
        const trigger = {
          type: "PromoteMatch",
          matchId: suggestion.matchId,
          toRound: firstRound,
          toCourt: 1,
          startNow: false,
        } as const;
        let checked = suggestion.validation.preview;
        const follow = nextScheduleCommand(checked, trigger, { iterations: 2_000, timeBudgetMs: 80 });
        if (follow) checked = success(send(checked, follow, `matrix-replan-${playerCount}-${suggestion.matchId}`));
        assertScheduleValid(checked);
        const prefixCounts = checked.players
          .filter((player) => player.status === "active")
          .map((player) => checked.matches.filter(
            (match) =>
              match.round <= firstRound &&
              match.status !== "cancelled" &&
              match.status !== "abandoned" &&
              [...match.teamA, ...match.teamB].includes(player.id),
          ).length);
        expect(Math.max(...prefixCounts) - Math.min(...prefixCounts)).toBeLessThanOrEqual(1);
      }
    },
  );

  it.each(["paused", "left"] as const)(
    "chặn trận có người %s, cho phép lại sau khi quay lại",
    (status) => {
      const state = promotionFixture();
      const unavailable = structuredClone(state);
      unavailable.players.find((player) => player.id === "p5")!.status = status;
      expect(validatePromoteMatch(unavailable, "m2", 1, 1, false, 100).severity).toBe("block");
      unavailable.players.find((player) => player.id === "p5")!.status = "active";
      expect(validatePromoteMatch(unavailable, "m2", 1, 1, false, 100).severity).not.toBe("block");
    },
  );
});

describe("asset và idempotency v0.6", () => {
  it("lưu lại metadata biên tập ảnh trong event_assets", async () => {
    const repo = new EventAssetRepo(new FakeSheetsClient());
    const metadata = { fit: "contain" as const, zoom: 1.2, offsetX: 0.1, offsetY: -0.1, rotation: 15, trim: true, crop: { x: 1, y: 2, width: 200, height: 180 }, output: { width: 256 as const, height: 256 as const } };
    await repo.put({ eventCode: "ABC123", assetId: "asset-1", kind: "sponsor", mime: "image/png", dataUri: "data:image/png;base64,AAAA", metadata, createdBy: "owner", createdAt: 1, updatedAt: 1 });
    expect((await repo.get("ABC123", "asset-1"))?.metadata).toEqual(metadata);
  });

  it("chia ảnh lớn qua nhiều ô Sheet rồi ghép lại nguyên vẹn", async () => {
    const repo = new EventAssetRepo(new FakeSheetsClient());
    const dataUri = `data:image/webp;base64,${"A".repeat(120_000)}`;
    await repo.put({
      eventCode: "ABC123",
      assetId: "asset-chunked",
      kind: "sponsor",
      mime: "image/webp",
      dataUri,
      createdBy: "owner",
      createdAt: 1,
      updatedAt: 1,
    });
    expect((await repo.get("ABC123", "asset-chunked"))?.dataUri).toBe(dataUri);
  });

  it("bỏ qua metadata ảnh hỏng thay vì đưa dữ liệu sai vào giao diện", async () => {
    const sheets = new FakeSheetsClient();
    const repo = new EventAssetRepo(sheets);
    await repo.put({
      eventCode: "ABC123",
      assetId: "asset-invalid-metadata",
      kind: "sponsor",
      mime: "image/png",
      dataUri: "data:image/png;base64,AAAA",
      metadata: { fit: "contain", zoom: 1, offsetX: 0, offsetY: 0, rotation: 0, trim: false, crop: { x: 0, y: 0, width: 256, height: 256 }, output: { width: 256, height: 256 } },
      createdBy: "owner",
      createdAt: 1,
      updatedAt: 1,
    });
    const rows = sheets.dump("event_assets");
    const metadataColumn = rows[0]!.indexOf("metadata_json");
    rows[1]![metadataColumn] = JSON.stringify({ fit: "contain", zoom: 999 });
    await sheets.batch([{ kind: "update", range: "event_assets!A2:Z2", values: [rows[1]!] }]);
    expect((await repo.get("ABC123", "asset-invalid-metadata"))?.metadata).toBeUndefined();
  });

  it("hai yêu cầu sao chép cùng key chỉ có một người thắng", async () => {
    const repo = new EventCopyRepo(new FakeSheetsClient());
    const [a, b] = await Promise.all([
      repo.reserve({ ownerUserId: "u1", sourceCode: "OLD123", idempotencyKey: "same-key-123", newCode: "NEW111", at: 1 }),
      repo.reserve({ ownerUserId: "u1", sourceCode: "OLD123", idempotencyKey: "same-key-123", newCode: "NEW222", at: 1 }),
    ]);
    expect([a.winner, b.winner].filter(Boolean)).toHaveLength(1);
    expect(a.code).toBe(b.code);
    expect((await repo.find("u1", "OLD123", "same-key-123"))?.code).toBe(a.code);
  });

  it("cho cùng idempotency key thử lại sau một lần tạo thất bại", async () => {
    const repo = new EventCopyRepo(new FakeSheetsClient());
    const first = await repo.reserve({ ownerUserId: "u1", sourceCode: "OLD123", idempotencyKey: "retry-key-123", newCode: "NEW111", at: 1 });
    await repo.fail({ ownerUserId: "u1", sourceCode: "OLD123", idempotencyKey: "retry-key-123", token: first.token, code: first.code, at: 2 });
    const retry = await repo.reserve({ ownerUserId: "u1", sourceCode: "OLD123", idempotencyKey: "retry-key-123", newCode: "NEW222", at: 3 });
    expect(retry.winner).toBe(true);
    expect(retry.code).toBe("NEW111");
    await repo.complete({ ownerUserId: "u1", sourceCode: "OLD123", idempotencyKey: "retry-key-123", token: retry.token, code: retry.code, at: 4 });
    expect((await repo.find("u1", "OLD123", "retry-key-123"))?.status).toBe("complete");
  });
});

describe("xung đột nhiều Vercel instance", () => {
  it("hai máy không thể bắt đầu hai trận có chung người", () => {
    let state = promotionFixture();
    const first = { type: "StartMatch", matchId: "m2" } as const;
    const second = { type: "StartMatch", matchId: "m3" } as const;
    const firstCondition = commandPrecondition(state, first);
    const secondCondition = commandPrecondition(state, second);
    state = success(apply(state, { id: "start-shared-a", at: 19, actor: OWNER, command: first, precondition: firstCondition }));
    const losing = apply(state, { id: "start-shared-b", at: 20, actor: OWNER, command: second, precondition: secondCondition });
    expect(losing.ok).toBe(false);
  });

  it("kiểm tra lại người đã nghỉ ngay trước lúc bắt đầu trận", () => {
    const state = promotionFixture();
    state.players.find((player) => player.id === "p5")!.status = "paused";
    const outcome = send(state, { type: "StartMatch", matchId: "m2" }, "start-with-paused-player");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toMatch(/không có mặt/);
  });

  it("chỉ nhận một trong hai lệnh cùng sửa một tỷ số", () => {
    const state = promotionFixture();
    const a = { type: "EditResult", matchId: "m1", scoreA: 11, scoreB: 8, irregular: false, note: "Sửa A" } as const;
    const b = { type: "EditResult", matchId: "m1", scoreA: 9, scoreB: 11, irregular: false, note: "Sửa B" } as const;
    const shared = commandPrecondition(state, a);

    const first = apply(state, { id: "edit-a", at: 20, actor: OWNER, command: a, precondition: shared });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = apply(first.value, { id: "edit-b", at: 21, actor: OWNER, command: b, precondition: shared });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toMatch(/Xung đột dữ liệu/);
    expect(first.value.matches.find((match) => match.id === "m1")?.result).toMatchObject({ scoreA: 11, scoreB: 8 });
  });

  it("không chặn hai lệnh độc lập chỉ vì revision toàn sự kiện đổi", () => {
    let state = promotionFixture();
    state = success(send(state, { type: "StartMatch", matchId: "m2" }, "start-m2"));
    state = success(send(state, { type: "SubmitResult", matchId: "m2", scoreA: 11, scoreB: 6, irregular: false }, "score-m2"));
    const editOne = { type: "EditResult", matchId: "m1", scoreA: 11, scoreB: 9, irregular: false, note: "Sửa sân 1" } as const;
    const editTwo = { type: "EditResult", matchId: "m2", scoreA: 11, scoreB: 7, irregular: false, note: "Sửa sân 2" } as const;
    const firstCondition = commandPrecondition(state, editOne);
    const secondCondition = commandPrecondition(state, editTwo);

    state = success(apply(state, { id: "independent-a", at: 30, actor: OWNER, command: editOne, precondition: firstCondition }));
    const second = apply(state, { id: "independent-b", at: 31, actor: OWNER, command: editTwo, precondition: secondCondition });
    expect(second.ok).toBe(true);
  });
});

function promotionFixture(): EventState {
  let state = emptyState("V6TEST");
  state = success(send(state, { type: "CreateEvent", code: "V6TEST", clubId: null, config: { ...DEFAULT_CONFIG, courts: 1 } }, "create"));
  for (let index = 1; index <= 8; index++) {
    state = success(send(state, { type: "AddPlayer", player: { id: `p${index}`, name: `P${index}`, avatarId: "a" }, asActive: true }, `p${index}`));
  }
  state = success(send(state, { type: "StartEvent" }, "start"));
  state = success(send(state, { type: "SetSchedule", fromRound: 1, matches: [
    { id: "m1", round: 1, court: 1, teamA: ["p1", "p2"], teamB: ["p3", "p4"] },
    { id: "m2", round: 2, court: 1, teamA: ["p5", "p6"], teamB: ["p7", "p8"] },
    { id: "m3", round: 3, court: 1, teamA: ["p1", "p5"], teamB: ["p2", "p6"] },
  ] }, "schedule"));
  state = success(send(state, { type: "SubmitResult", matchId: "m1", scoreA: 11, scoreB: 7, irregular: false }, "score"));
  return state;
}

function send(state: EventState, command: Parameters<typeof apply>[1]["command"], id: string) {
  return apply(state, { id, at: 10, actor: OWNER, command });
}

function success(result: ReturnType<typeof apply>): EventState {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
