import { describe, expect, it } from "vitest";
import { fold, emptyState } from "../lib/domain/reduce";
import { firstOpenRound } from "../lib/domain/rounds";
import { roundRobinProgress } from "../lib/domain/round-robin";
import { withEventDefaults, type EventState } from "../lib/domain/types";
import { previewStructureChange } from "../lib/domain/structure";
import { planRoundRobinSchedule } from "../lib/scheduler/round-robin";
import { EventSim } from "../lib/testing/harness";
import { assertScheduleValid } from "./invariants";

const ACTOR = { kind: "admin", label: "Phó sự kiện", ref: "manager" } as const;

describe("v0.10 — miền chiến dịch round robin", () => {
  it("snapshot cũ mặc định Americano và không tự sinh chiến dịch", () => {
    const old = emptyState("OLD010");
    delete (old as Partial<EventState>).scheduleMode;
    delete (old as Partial<EventState>).roundRobinCampaign;
    expect(withEventDefaults(old)).toMatchObject({
      scheduleMode: "americano",
      roundRobinCampaign: null,
    });
  });

  it("trận đã chơi trước chuyển đổi được tính và replay giữ nguyên tiến độ", () => {
    const sim = running(8, 2);
    sim.playRounds(2);
    const played = sim.state.matches.filter((match) => match.status === "submitted");
    const open = firstOpenRound(sim.state);
    sim.send({
      type: "StartRoundRobinCampaign",
      campaignId: "rr-1",
      playerIds: sim.state.players.map((player) => player.id),
      effectiveRound: open,
    });
    expect(sim.state.roundRobinCampaign?.countedMatchIds).toEqual(
      expect.arrayContaining(played.map((match) => match.id)),
    );
    expect(fold(sim.state.code, sim.log).state).toEqual(sim.state);
  });

  it("không cho quay lại Americano trước khi hoàn tất", () => {
    const sim = running(8, 2);
    sim.send({
      type: "StartRoundRobinCampaign",
      campaignId: "rr-lock",
      playerIds: sim.state.players.map((player) => player.id),
      effectiveRound: firstOpenRound(sim.state),
    });
    expect(sim.trySend({
      type: "ResumeAmericano",
      campaignId: "rr-lock",
      effectiveRound: firstOpenRound(sim.state),
    })).toMatch(/hoàn tất/);
    expect(sim.trySend({
      type: "StartRoundRobinCampaign",
      campaignId: "rr-overwrite",
      playerIds: sim.state.players.map((player) => player.id),
      effectiveRound: firstOpenRound(sim.state),
    })).toMatch(/Americano/);
  });
  it("dọn lịch chờ khi cặp cuối bắt đầu nhưng vẫn giữ trận ghim", () => {
    const sim = running(4, 2);
    sim.send({
      type: "StartRoundRobinCampaign",
      campaignId: "rr-cleanup",
      playerIds: sim.state.players.map((player) => player.id),
      effectiveRound: firstOpenRound(sim.state),
    });
    sim.reschedule("rebuild");

    while (sim.state.roundRobinCampaign?.status === "active") {
      const scheduled = sim.state.matches.filter((match) => match.status === "scheduled");
      expect(scheduled.length).toBeGreaterThan(0);
      const next = scheduled[0]!;
      if (roundRobinProgress(sim.state)!.missingPairs.length <= 2 && scheduled.length > 1) {
        scheduled[scheduled.length - 1]!.pinned = true;
      }
      sim.send({ type: "StartMatch", matchId: next.id });
      if (sim.state.roundRobinCampaign?.status === "active") {
        sim.send({
          type: "SubmitResult",
          matchId: next.id,
          scoreA: 11,
          scoreB: 7,
          irregular: false,
        });
        sim.reschedule("extend");
      }
    }

    expect(
      sim.state.matches
        .filter((match) => match.status === "scheduled")
        .every((match) => match.pinned),
    ).toBe(true);
  });

  it("chỉ đếm trận đã ra sân và không mất độ phủ khi gỡ tỷ số", () => {
    const sim = running(8, 2);
    const [cancelled, abandoned, submitted] = sim.state.matches.filter(
      (match) => match.status === "scheduled",
    );
    sim.send({ type: "CancelMatch", matchId: cancelled!.id, reason: "Chưa bắt đầu" });
    sim.send({ type: "StartMatch", matchId: abandoned!.id });
    sim.send({ type: "AbandonMatch", matchId: abandoned!.id, reason: "Mưa" });
    sim.send({ type: "SubmitResult", matchId: submitted!.id, scoreA: 11, scoreB: 8, irregular: false });
    sim.send({
      type: "StartRoundRobinCampaign",
      campaignId: "rr-evidence",
      playerIds: sim.state.players.map((player) => player.id),
      effectiveRound: firstOpenRound(sim.state),
    });

    expect(sim.state.roundRobinCampaign?.countedMatchIds).toContain(abandoned!.id);
    expect(sim.state.roundRobinCampaign?.countedMatchIds).toContain(submitted!.id);
    expect(sim.state.roundRobinCampaign?.countedMatchIds).not.toContain(cancelled!.id);
    const cancelledTeams = [cancelled!.teamA, cancelled!.teamB]
      .map((team) => [...team].sort().join(":"));
    const replacement = planRoundRobinSchedule(sim.state, { mode: "rebuild", lookahead: 100 });
    const replacementTeams = replacement.matches
      .flatMap((match) => [match.teamA, match.teamB])
      .map((team) => [...team].sort().join(":"));
    expect(cancelledTeams.every((team) => replacementTeams.includes(team))).toBe(true);
    const covered = roundRobinProgress(sim.state)!.coveredPairs;
    sim.send({ type: "RevertResult", matchId: submitted!.id, note: "Nhập nhầm" });
    expect(roundRobinProgress(sim.state)!.coveredPairs).toBe(covered);
  });

  it("kết thúc sớm ghi chiến dịch chưa hoàn tất cùng các cặp còn thiếu", () => {
    const sim = running(8, 2);
    sim.send({
      type: "StartRoundRobinCampaign",
      campaignId: "rr-early",
      playerIds: sim.state.players.map((player) => player.id),
      effectiveRound: firstOpenRound(sim.state),
    });
    const missingBefore = roundRobinProgress(sim.state)!.missingPairs.length;
    sim.send({ type: "EndEventEarly", reason: "Hết giờ thuê sân" });
    expect(sim.state.status).toBe("finished");
    expect(sim.state.roundRobinCampaign?.status).toBe("incomplete");
    expect(roundRobinProgress(sim.state)!.missingPairs).toHaveLength(missingBefore);
  });
});

describe("v0.10 — planner hoàn thiện độ phủ", () => {
  it.each([
    [4, 1],
    [5, 1],
    [8, 2],
    [9, 2],
    [12, 3],
  ])("%i người/%i sân phủ đủ mọi cặp", (players, courts) => {
    const sim = running(players, courts);
    sim.playRounds(2);
    sim.send({
      type: "StartRoundRobinCampaign",
      campaignId: `rr-${players}`,
      playerIds: sim.state.players.map((player) => player.id),
      effectiveRound: firstOpenRound(sim.state),
    });
    sim.reschedule("rebuild");
    sim.playRounds(players * 4 + 20);
    const progress = roundRobinProgress(sim.state)!;
    expect(progress.missingPairs).toEqual([]);
    expect(sim.state.roundRobinCampaign?.status).toBe("completed");
    assertScheduleValid(sim.state);
  });

  it("preview chốt đúng người trong ca và trả dự báo đầy đủ", () => {
    const sim = running(8, 2);
    const preview = previewStructureChange(sim.state, {
      type: "start-round-robin",
      campaignId: "rr-preview",
      requestedFromRound: firstOpenRound(sim.state),
    }, ACTOR, Date.now(), { iterations: 1_000, timeBudgetMs: 100 });
    expect(preview.blocked).toEqual([]);
    expect(preview.roundRobin?.cohortPlayerIds).toHaveLength(8);
    expect(preview.roundRobin?.totalPairs).toBe(28);
    expect(preview.roundRobin?.projectedMatches).toBeGreaterThan(0);
  });

  it("preview cho phép bắt đầu khi 0 sân và ghi nhận người ngoài ca", () => {
    const sim = running(8, 1);
    const outside = sim.state.players[0]!;
    sim.send({ type: "PausePlayer", playerId: outside.id });
    const open = firstOpenRound(sim.state);
    sim.send({
      type: "SetCourtAvailability",
      courtId: "court-1",
      availability: [],
      effectiveRound: open,
    });
    const preview = previewStructureChange(sim.state, {
      type: "start-round-robin",
      campaignId: "rr-zero-preview",
      requestedFromRound: open,
    }, ACTOR, Date.now(), { iterations: 1_000, timeBudgetMs: 100 });

    expect(preview.blocked).toEqual([]);
    expect(preview.warnings.join(" ")).toMatch(/Chưa thể xếp/);
    expect(preview.roundRobin?.cohortPlayerIds).toHaveLength(7);
    expect(preview.roundRobin?.outsideCohortPlayers.map((player) => player.id)).toContain(outside.id);
    expect(preview.after.status).toBe("running");
    expect(preview.after.scheduleMode).toBe("round-robin");
  });

  it("giữ trận đang chơi và coi trận ghim là ràng buộc tương lai", () => {
    const sim = running(8, 2);
    const playingId = sim.state.matches.find((match) => match.status === "scheduled")!.id;
    sim.send({ type: "StartMatch", matchId: playingId });
    const playing = sim.state.matches.find((match) => match.id === playingId)!;
    const pinned = sim.state.matches.find(
      (match) => match.status === "scheduled" && match.round > playing.round,
    )!;
    sim.send({ type: "PinMatch", matchId: pinned.id, pinned: true });
    const snapshot = JSON.stringify({
      id: playing.id,
      round: playing.round,
      courtId: playing.courtId,
      teamA: playing.teamA,
      teamB: playing.teamB,
      startedAt: playing.startedAt,
    });

    const preview = previewStructureChange(sim.state, {
      type: "start-round-robin",
      campaignId: "rr-frozen",
      requestedFromRound: playing.round,
    }, ACTOR, Date.now(), { iterations: 1_000, timeBudgetMs: 100 });

    expect(preview.blocked).toEqual([]);
    expect(JSON.stringify(preview.after.matches.find((match) => match.id === playing.id) && {
      id: preview.after.matches.find((match) => match.id === playing.id)!.id,
      round: preview.after.matches.find((match) => match.id === playing.id)!.round,
      courtId: preview.after.matches.find((match) => match.id === playing.id)!.courtId,
      teamA: preview.after.matches.find((match) => match.id === playing.id)!.teamA,
      teamB: preview.after.matches.find((match) => match.id === playing.id)!.teamB,
      startedAt: preview.after.matches.find((match) => match.id === playing.id)!.startedAt,
    })).toBe(snapshot);
    expect(preview.after.matches.find((match) => match.id === pinned.id)?.pinned).toBe(true);
    const pinnedPartnerships = [pinned.teamA, pinned.teamB].map((team) => [...team].sort().join(":"));
    const generatedPartnerships = preview.schedule.matches
      .filter((match) => match.id !== pinned.id)
      .flatMap((match) => [match.teamA, match.teamB])
      .map((team) => [...team].sort().join(":"));
    expect(generatedPartnerships.filter((team) => pinnedPartnerships.includes(team))).toEqual([]);
  });

  it("không tạo cặp lặp mới khi còn ghép được hai cạnh thiếu tương thích", () => {
    const sim = running(8, 2);
    sim.playRounds(1);
    sim.send({
      type: "StartRoundRobinCampaign",
      campaignId: "rr-no-repeat",
      playerIds: sim.state.players.map((player) => player.id),
      effectiveRound: firstOpenRound(sim.state),
    });
    const covered = new Set(
      sim.state.matches
        .filter((match) => match.status === "submitted")
        .flatMap((match) => [match.teamA, match.teamB])
        .map((team) => [...team].sort().join(":")),
    );
    const outcome = planRoundRobinSchedule(sim.state, { mode: "rebuild", lookahead: 100 });
    const futureTeams = outcome.matches.flatMap((match) => [match.teamA, match.teamB]);
    expect(outcome.forecast?.unavoidableRepeatMatches).toBe(0);
    expect(futureTeams.filter((team) => covered.has([...team].sort().join(":")))).toEqual([]);
  });

  it("giữ nhóm mục tiêu khi người mới đến và vẫn cho người ngoài nhóm có suất", () => {
    const sim = running(8, 2);
    const target = sim.state.players.map((player) => player.id);
    sim.send({
      type: "StartRoundRobinCampaign",
      campaignId: "rr-outsider",
      playerIds: target,
      effectiveRound: firstOpenRound(sim.state),
    });
    const outsider = sim.joinMidEvent("Đến sau");
    expect(sim.state.roundRobinCampaign?.playerIds).toEqual(target);
    expect(roundRobinProgress(sim.state)?.outsiderPlayerIds).toContain(outsider);
    const outcome = planRoundRobinSchedule(sim.state, { mode: "rebuild", lookahead: 100 });
    expect(outcome.matches.some((match) => [...match.teamA, ...match.teamB].includes(outsider))).toBe(true);
  });

  it("tạm chờ người nghỉ, tiếp tục khi quay lại và cho loại người đã về", () => {
    const sim = running(8, 2);
    const absent = sim.state.players[0]!.id;
    sim.send({
      type: "StartRoundRobinCampaign",
      campaignId: "rr-absence",
      playerIds: sim.state.players.map((player) => player.id),
      effectiveRound: firstOpenRound(sim.state),
    });
    sim.send({ type: "PausePlayer", playerId: absent });
    const paused = planRoundRobinSchedule(sim.state, { mode: "rebuild" });
    expect(paused.forecast?.excludedPlayerIds).toContain(absent);
    expect(paused.matches.every((match) => ![...match.teamA, ...match.teamB].includes(absent))).toBe(true);

    sim.send({ type: "ResumePlayer", playerId: absent });
    expect(planRoundRobinSchedule(sim.state, { mode: "rebuild" }).forecast?.unresolvedPairs).toEqual([]);
    sim.send({ type: "PlayerLeft", playerId: absent });
    expect(sim.state.roundRobinCampaign?.playerIds).toContain(absent);
    sim.send({
      type: "RemoveRoundRobinPlayer",
      campaignId: "rr-absence",
      playerId: absent,
      effectiveRound: firstOpenRound(sim.state),
    });
    expect(sim.state.roundRobinCampaign?.playerIds).not.toContain(absent);
    expect(roundRobinProgress(sim.state)?.missingPairs.some(
      (pair) => pair.a === absent || pair.b === absent,
    )).toBe(false);
  });

  it("0 sân chỉ tạm dừng và mở sân lại thì lập lịch tiếp", () => {
    const sim = running(8, 1);
    sim.send({
      type: "StartRoundRobinCampaign",
      campaignId: "rr-courts",
      playerIds: sim.state.players.map((player) => player.id),
      effectiveRound: firstOpenRound(sim.state),
    });
    const open = firstOpenRound(sim.state);
    sim.send({ type: "SetCourtAvailability", courtId: "court-1", availability: [], effectiveRound: open });
    const paused = planRoundRobinSchedule(sim.state, { mode: "rebuild" });
    expect(paused.blocked).toMatch(/Chưa thể xếp/);
    expect(sim.state.status).toBe("running");

    sim.send({
      type: "SetCourtAvailability",
      courtId: "court-1",
      availability: [{ from: open, to: null }],
      effectiveRound: open,
    });
    const resumed = planRoundRobinSchedule(sim.state, { mode: "rebuild" });
    expect(resumed.blocked).toBeNull();
    expect(resumed.matches.length).toBeGreaterThan(0);
  });

  it("planner 40×8 dựng dự báo trong ngân sách", () => {
    const sim = running(40, 8);
    sim.send({
      type: "StartRoundRobinCampaign",
      campaignId: "rr-40",
      playerIds: sim.state.players.map((player) => player.id),
      effectiveRound: firstOpenRound(sim.state),
    });
    const started = performance.now();
    const outcome = planRoundRobinSchedule(sim.state, { mode: "rebuild" });
    expect(performance.now() - started).toBeLessThan(4_000);
    expect(outcome.forecast?.unresolvedPairs).toEqual([]);
    expect(outcome.matches.length).toBeGreaterThan(0);
    expect(JSON.stringify({
      type: "SetSchedule",
      fromRound: outcome.fromRound,
      matches: outcome.matches,
    }).length).toBeLessThan(45_000);
  });
});

function running(players: number, courts: number) {
  const sim = new EventSim({
    code: `R${players}C${courts}`,
    seed: players * 10 + courts,
    config: { courts, lookaheadRounds: 6 },
    planning: { iterations: 2_000, timeBudgetMs: 100 },
  });
  sim.addPlayers(Array.from({ length: players }, (_, index) => `P${index + 1}`));
  sim.start();
  return sim;
}
