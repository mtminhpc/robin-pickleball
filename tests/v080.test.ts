import { describe, expect, it } from "vitest";
import type { Command, CommandEnvelope } from "../lib/domain/commands";
import { apply, emptyState, fold } from "../lib/domain/reduce";
import {
  activeCourtsAt,
  courtLabelAt,
  isEligibleAt,
  matchCourtName,
  normalizePlannedSpans,
  withEventDefaults,
  DEFAULT_CONFIG,
  type EventState,
} from "../lib/domain/types";
import { previewStructureChange } from "../lib/domain/structure";
import { planSchedule } from "../lib/scheduler/plan";
import { EventSim } from "../lib/testing/harness";
import { assertScheduleValid } from "./invariants";
import {
  signStructurePreview,
  structurePreviewSubject,
  verifyStructurePreview,
} from "../lib/auth/structure-preview";

const ACTOR = { kind: "admin", label: "Chủ sự kiện · TEST", ref: "owner" } as const;
const FAST = { iterations: 2_000, timeBudgetMs: 100 } as const;

describe("v0.8 — khoảng vòng và tương thích dữ liệu cũ", () => {
  it("gộp khoảng chồng/liền nhau, giữ ID khoảng đứng trước và hiểu Đến cuối", () => {
    expect(normalizePlannedSpans([
      { id: "a", from: 3, to: 5 },
      { id: "b", from: 1, to: 2 },
      { id: "c", from: 5, to: null },
    ])).toEqual([{ id: "b", from: 1, to: null }]);
  });

  it("snapshot v0.7 tự dựng sân, nhiều ca và tham chiếu sân mà không ghi migration", () => {
    const old = emptyState("LEGACY");
    delete (old as Partial<EventState>).courts;
    delete (old as Partial<EventState>).scheduleChange;
    const player = {
      id: "p1", name: "An", avatarId: "", status: "active" as const,
      presence: [{ from: 1, to: null }], catchUpCredit: 0, available: { from: 2, to: 5 }, addedAt: 1,
    };
    old.players = [player as never];
    old.matches = [{
      id: "m1", round: 2, court: 1, courtWave: 1, teamA: ["p1", "p2"], teamB: ["p3", "p4"],
      status: "scheduled", result: null, pinned: false, edits: [], createdAt: 1, startedAt: null,
    }];
    const migrated = withEventDefaults(old);
    expect(migrated.courts.map((court) => court.labels[0]?.name)).toEqual(["Sân 1", "Sân 2"]);
    expect(migrated.players[0]?.availability).toEqual([{ id: "legacy-availability", from: 2, to: 5 }]);
    expect(migrated.matches[0]).toMatchObject({ courtId: "court-1", courtLabelId: "court-1-label-1" });
  });

  it("DeclareAvailability cũ vẫn replay xác định sang availability mới", () => {
    const sim = new EventSim({ config: { courts: 1 } });
    const [id] = sim.addPlayers(["An", "Bình", "Chi", "Dũng"]);
    sim.send({ type: "DeclareAvailability", playerId: id!, fromRound: 3, toRound: null });
    const replayed = fold(sim.state.code, sim.log).state;
    expect(replayed.players.find((player) => player.id === id)?.availability).toEqual([
      { id: "legacy-availability", from: 3, to: null },
    ]);
    expect(replayed).toEqual(sim.state);
  });
});

describe("v0.8 — danh mục sân", () => {
  it("đổi tên theo vòng không làm nhãn trận cũ đổi theo", () => {
    const sim = running(8, 1);
    const match = sim.state.matches[0]!;
    const oldName = matchCourtName(sim.state, match);
    sim.send({
      type: "RenameCourt",
      courtId: match.courtId!,
      labelId: "label-new",
      name: "Sân số 9",
      effectiveRound: match.round + 1,
    });
    expect(matchCourtName(sim.state, sim.state.matches.find((item) => item.id === match.id)!)).toBe(oldName);
    expect(courtLabelAt(sim.state.courts[0]!, match.round + 1).name).toBe("Sân số 9");
  });

  it("chặn tên trùng không phân biệt hoa thường trong ca chồng nhau", () => {
    const sim = new EventSim({ config: { courts: 1 } });
    const error = sim.trySend({
      type: "AddCourt",
      effectiveRound: 1,
      court: {
        id: "c2", order: 2, archived: false,
        labels: [{ id: "c2-l1", name: "  SÂN 1  ", effectiveFromRound: 1 }],
        availability: [{ from: 2, to: null }],
      },
    });
    expect(error).toMatch(/bị trùng/);
  });

  it("cho nhiều sân trong catalog nhưng không quá 8 sân hoạt động đồng thời", () => {
    const sim = new EventSim({ config: { courts: 8 } });
    expect(sim.trySend({
      type: "AddCourt",
      effectiveRound: 9,
      court: {
        id: "c9", order: 9, archived: false,
        labels: [{ id: "c9-l1", name: "Sân 9", effectiveFromRound: 9 }],
        availability: [{ from: 9, to: null }],
      },
    })).toMatch(/8 sân/);
    sim.send({ type: "SetCourtAvailability", courtId: "court-8", availability: [{ from: 1, to: 8 }], effectiveRound: 1 });
    expect(sim.trySend({
      type: "AddCourt", effectiveRound: 9,
      court: { id: "c9", order: 9, archived: false, labels: [{ id: "c9-l1", name: "Sân 9", effectiveFromRound: 9 }], availability: [{ from: 9, to: null }] },
    })).toBeNull();
  });
});

describe("v0.8 — ca người chơi và planner động", () => {
  it("kế hoạch chưa xác nhận không đủ điều kiện; xác nhận đúng từng ca", () => {
    const sim = running(8, 1);
    const player = sim.state.players[0]!;
    sim.send({
      type: "SetPlayerPlan",
      playerId: player.id,
      effectiveRound: 1,
      availability: [
        { id: "shift-a", from: 1, to: 2 },
        { id: "shift-b", from: 4, to: null },
      ],
    });
    expect(isEligibleAt(sim.state.players[0]!, 1)).toBe(false);
    sim.send({ type: "ConfirmPlayerSpan", playerId: player.id, spanId: "shift-a" });
    expect(isEligibleAt(sim.state.players[0]!, 1)).toBe(true);
    expect(isEligibleAt(sim.state.players[0]!, 3)).toBe(false);
    expect(isEligibleAt(sim.state.players[0]!, 4)).toBe(false);
    sim.send({ type: "PausePlayer", playerId: player.id });
    sim.send({ type: "ConfirmPlayerSpan", playerId: player.id, spanId: "shift-b" });
    expect(isEligibleAt(sim.state.players[0]!, 4)).toBe(true);
  });

  it("0 sân là tạm dừng hợp lệ và preview xoá phần lịch chờ", () => {
    const sim = running(8, 1);
    const preview = previewStructureChange(sim.state, {
      type: "set-court-availability",
      courtId: "court-1",
      availability: [],
      requestedFromRound: 1,
    }, ACTOR, 100, FAST);
    expect(preview.blocked).toEqual([]);
    expect(preview.warnings.join(" ")).toMatch(/chưa có sân/);
    expect(activeCourtsAt(preview.after, 1)).toHaveLength(0);
    expect(preview.after.matches.filter((match) => match.status === "scheduled")).toHaveLength(0);
  });

  it.each([
    { players: 4, courts: 1 },
    { players: 12, courts: 3 },
    { players: 40, courts: 8 },
  ])("xếp đúng người/sân với $players người và $courts sân biến đổi", ({ players, courts }) => {
    const sim = new EventSim({ seed: players * 100 + courts, config: { courts, lookaheadRounds: 5 } });
    sim.addPlayers(Array.from({ length: players }, (_, index) => `P${index + 1}`));
    for (const court of sim.state.courts) {
      const from = court.order % 2 === 0 ? 2 : 1;
      sim.send({ type: "SetCourtAvailability", courtId: court.id, availability: [{ from, to: null }], effectiveRound: 1 });
    }
    sim.send({ type: "StartEvent" });
    const startedAt = performance.now();
    const outcome = planSchedule(sim.state, { mode: "rebuild", iterations: 5_000, timeBudgetMs: 600 });
    const elapsedMs = performance.now() - startedAt;
    expect(outcome.blocked).toBeNull();
    expect(elapsedMs, `planner ${players}×${courts} phải dưới 4 giây`).toBeLessThan(4_000);
    sim.send({ type: "SetSchedule", fromRound: outcome.fromRound, matches: outcome.matches });
    assertScheduleValid(sim.state);
    for (const match of sim.state.matches) {
      expect(activeCourtsAt(sim.state, match.round).some((court) => court.id === match.courtId)).toBe(true);
    }
  });
});

describe("v0.8 — chuyển sân, pinned và preview token", () => {
  it("chuyển trận đang chơi sang sân mới giữ nguyên mọi dữ liệu trận", () => {
    const sim = running(8, 1);
    const match = sim.state.matches[0]!;
    sim.send({ type: "StartMatch", matchId: match.id });
    const before = structuredClone(sim.state.matches.find((item) => item.id === match.id)!);
    sim.send({
      type: "TransferMatch",
      matchId: match.id,
      toCourtId: "court-new",
      toCourtLabelId: "court-new-label",
      effectiveRound: match.round,
      closeSourceAfter: true,
      newCourt: {
        id: "court-new", order: 2, archived: false,
        labels: [{ id: "court-new-label", name: "Sân dự phòng", effectiveFromRound: match.round }],
        availability: [{ from: match.round, to: null }],
      },
    });
    const moved = sim.state.matches.find((item) => item.id === match.id)!;
    expect(moved).toMatchObject({
      id: before.id, teamA: before.teamA, teamB: before.teamB,
      status: before.status, startedAt: before.startedAt, result: before.result,
      courtId: "court-new", courtLabelId: "court-new-label",
    });
    expect(activeCourtsAt(sim.state, match.round).map((court) => court.id)).toEqual(["court-new"]);
  });

  it("pinned conflict chặn preview, không tự bỏ ghim", () => {
    const sim = running(8, 1);
    const pinned = sim.state.matches.find(
      (match) => match.status === "scheduled" && match.round > 1,
    )!;
    sim.send({ type: "PinMatch", matchId: pinned.id, pinned: true });
    const preview = previewStructureChange(sim.state, {
      type: "set-court-availability", courtId: pinned.courtId!, availability: [], requestedFromRound: 1,
    }, ACTOR, 100, FAST);
    expect(preview.blocked.join(" ")).toMatch(/Trận ghim/);
    expect(sim.state.matches.find((match) => match.id === pinned.id)?.pinned).toBe(true);
  });

  it("token preview bị sửa/hết hạn/sai người đều bị từ chối", () => {
    const subject = structurePreviewSubject("owner", "owner-1", "");
    const payload = {
      v: 1 as const, code: "ABC123", processed: 4, issuedAt: 1_000, expiresAt: 301_000,
      nonce: "nonce", subject, effectiveRound: 3,
      commands: [{ type: "ArchiveCourt" as const, courtId: "c1", archived: true, effectiveRound: 3 }],
      schedule: { type: "SetSchedule" as const, fromRound: 3, matches: [] },
      diff: { courtsAdded: [], courtsChanged: ["c1"], playersChanged: [], matchesAdded: 0, matchesRemoved: 1, matchesMoved: 0, transferredMatchId: null },
      warnings: [],
    };
    const token = signStructurePreview(payload);
    expect(verifyStructurePreview(token, "ABC123", subject, 2_000)).not.toBeNull();
    expect(verifyStructurePreview(`${token}x`, "ABC123", subject, 2_000)).toBeNull();
    expect(verifyStructurePreview(token, "ABC123", structurePreviewSubject("owner", "owner-2", ""), 2_000)).toBeNull();
    expect(verifyStructurePreview(token, "ABC123", subject, 400_000)).toBeNull();
  });
});

function running(players: number, courts: number) {
  const sim = new EventSim({ seed: players + courts, config: { courts, lookaheadRounds: 4 }, planning: FAST });
  sim.addPlayers(Array.from({ length: players }, (_, index) => `P${index + 1}`));
  sim.start();
  return sim;
}

function send(state: EventState, command: Command, id: string): EventState {
  const envelope: CommandEnvelope = { id, at: Date.now(), actor: ACTOR, command };
  const result = apply(state, envelope);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
