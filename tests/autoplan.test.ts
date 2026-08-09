/**
 * Kiểm thử luật tự xếp lại lịch.
 *
 * Người dùng không bao giờ bấm "xếp lịch" — họ nhập điểm, duyệt người mới, báo
 * người kia đã về, và lịch phải tự đúng theo. Bảng luật này quyết định khi nào
 * điều đó xảy ra, nên nó phải được kiểm từng dòng.
 *
 * Hai hướng sai đều tệ: xếp lại quá ít thì buổi đánh đứng hình hoặc người mới
 * không bao giờ được vào; xếp lại quá nhiều thì lịch phía trước nhấp nháy liên
 * tục và không ai canh được giờ nghỉ của mình.
 */

import { describe, expect, it } from "vitest";
import { nextScheduleCommand, rescheduleMode } from "../lib/domain/autoplan";
import { firstOpenRound } from "../lib/domain/rounds";
import { EventSim } from "../lib/testing/harness";

const FAST = { iterations: 4_000, timeBudgetMs: 150 } as const;

function names(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `P${i + 1}`);
}

/** Sự kiện đã bắt đầu và đã có lịch, không dùng `sim.start()` để tự kiểm soát. */
function running(players = 12, courts = 2) {
  const sim = new EventSim({ seed: 5, config: { courts }, planning: FAST });
  sim.addPlayers(names(players));
  sim.send({ type: "StartEvent" });
  const first = nextScheduleCommand(sim.state, { type: "StartEvent" }, FAST);
  if (first) sim.send(first);
  return sim;
}

describe("khi nào phải xếp lại", () => {
  it("chưa bắt đầu thì không xếp gì cả", () => {
    const sim = new EventSim({ seed: 1, planning: FAST });
    sim.addPlayers(names(8));
    expect(
      rescheduleMode(sim.state, {
        type: "AddPlayer",
        player: { id: "x", name: "X", avatarId: "" },
      }),
    ).toBeNull();
  });

  it("bắt đầu thì sinh lịch", () => {
    const sim = new EventSim({ seed: 1, planning: FAST });
    sim.addPlayers(names(8));
    sim.send({ type: "StartEvent" });
    expect(rescheduleMode(sim.state, { type: "StartEvent" })).toBe("extend");
  });

  it("thay đổi danh sách người chơi thì xếp lại phần chưa đánh", () => {
    const sim = running();
    for (const type of [
      "ApproveJoin",
      "MarkArrived",
      "PlayerLeft",
      "PausePlayer",
      "ResumePlayer",
      "RemovePlayer",
      "GrantCatchUp",
      "CancelMatch",
    ] as const) {
      const command = { type, playerId: "p", matchId: "m", games: 1, reason: "x" };
      expect(
        rescheduleMode(sim.state, command as never),
        `${type} phải kéo theo xếp lại`,
      ).toBe("rebuild");
    }
  });

  it("khai trước có mặt thì xếp lại phần chưa đánh", () => {
    // Thiếu nhánh này thì lời khai nằm im cho tới khi có việc khác tình cờ kích
    // hoạt xếp lại — người dùng bấm xong thấy lịch không đổi gì và kết luận là
    // nút hỏng.
    const sim = running();
    expect(
      rescheduleMode(sim.state, {
        type: "DeclareAvailability",
        playerId: "p",
        fromRound: null,
        toRound: 5,
      }),
    ).toBe("rebuild");
  });

  it("admin dời trận thì KHÔNG tự xếp lại", () => {
    // Tự xếp lại ngay sẽ đá lại chính thao tác họ vừa làm bằng tay.
    const sim = running();
    expect(
      rescheduleMode(sim.state, {
        type: "ReorderMatch",
        matchId: "m",
        toRound: 3,
        toCourt: 1,
      }),
    ).toBeNull();
  });

  it("đổi số sân thì xếp lại, đổi cấu hình khác thì không", () => {
    const sim = running();
    expect(
      rescheduleMode(sim.state, { type: "UpdateConfig", patch: { courts: 3 } }),
    ).toBe("rebuild");
    expect(
      rescheduleMode(sim.state, {
        type: "UpdateConfig",
        patch: { countPartialMatches: false },
      }),
    ).toBeNull();
  });
});

describe("nối thêm vòng sau khi nhập điểm", () => {
  it("còn đủ vòng phía trước thì chưa sinh thêm", () => {
    // Bốn sân báo kết quả lệch nhau vài giây; nếu xếp lại sau từng trận thì lịch
    // phía trước nhấp nháy liên tục.
    const sim = running();
    const submit = { type: "SubmitResult" as const, matchId: "m", scoreA: 11, scoreB: 5, irregular: false };
    expect(rescheduleMode(sim.state, submit)).toBeNull();
  });

  it("hết vòng dự trữ thì sinh thêm", () => {
    const sim = running();
    // Đánh cho tới khi số vòng còn lại tụt xuống dưới mức cấu hình.
    sim.playRounds(3);
    const pending = new Set(
      sim.state.matches
        .filter((m) => m.status === "scheduled")
        .map((m) => m.round),
    );
    if (pending.size < sim.state.config.lookaheadRounds) {
      const submit = {
        type: "SubmitResult" as const,
        matchId: "m",
        scoreA: 11,
        scoreB: 5,
        irregular: false,
      };
      expect(rescheduleMode(sim.state, submit)).toBe("extend");
    }
  });

  it("luôn giữ đủ số vòng nhìn trước trong suốt buổi", () => {
    const sim = running(12, 2);
    for (let i = 0; i < 10; i++) {
      sim.playNextRound();
      const open = firstOpenRound(sim.state);
      const ahead = new Set(
        sim.state.matches
          .filter((m) => m.round >= open && m.status === "scheduled")
          .map((m) => m.round),
      );
      expect(
        ahead.size,
        `sau vòng ${i + 1} chỉ còn ${ahead.size} vòng nhìn trước`,
      ).toBeGreaterThanOrEqual(sim.state.config.lookaheadRounds);
    }
  });
});

describe("lệnh xếp lịch sinh ra", () => {
  it("thiếu người thì không sinh lệnh nào", () => {
    const sim = new EventSim({ seed: 2, planning: FAST });
    sim.addPlayers(names(4));
    sim.send({ type: "StartEvent" });
    sim.send({ type: "PlayerLeft", playerId: sim.state.players[0]!.id });

    expect(
      nextScheduleCommand(sim.state, { type: "PlayerLeft", playerId: "x" }, FAST),
    ).toBeNull();
  });

  it("lịch sinh ra bắt đầu từ vòng còn mở, không đụng quá khứ", () => {
    const sim = running();
    sim.playRounds(3);
    const open = firstOpenRound(sim.state);

    const command = nextScheduleCommand(
      sim.state,
      { type: "ApproveJoin", playerId: "x" },
      FAST,
    );
    expect(command?.type).toBe("SetSchedule");
    if (command?.type !== "SetSchedule") return;

    expect(command.fromRound).toBe(open);
    for (const m of command.matches) {
      expect(m.round, "lịch mới không được chạm vào vòng đã đánh").toBeGreaterThanOrEqual(open);
    }
  });

  it("chỉ xếp người đang chơi", () => {
    const sim = running();
    sim.playRounds(2);
    sim.send({ type: "PlayerLeft", playerId: sim.state.players[0]!.id });

    const command = nextScheduleCommand(
      sim.state,
      { type: "PlayerLeft", playerId: sim.state.players[0]!.id },
      FAST,
    );
    if (command?.type !== "SetSchedule") return;

    const active = new Set(
      sim.state.players.filter((p) => p.status === "active").map((p) => p.id),
    );
    for (const m of command.matches) {
      for (const id of [...m.teamA, ...m.teamB]) {
        expect(active.has(id), `${id} không còn chơi mà vẫn bị xếp lịch`).toBe(true);
      }
    }
  });
});
