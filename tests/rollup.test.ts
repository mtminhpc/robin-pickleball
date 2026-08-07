/**
 * Kiểm thử tổng kết tuần và tháng.
 *
 * Phần dễ sai nhất không phải là phép cộng mà là mốc thời gian. Máy chủ chạy giờ
 * UTC còn người chơi sống ở UTC+7, nên một buổi đánh tối chủ nhật lúc 21 giờ rất
 * dễ bị đẩy sang tuần sau mà không ai để ý cho tới khi có người hỏi "sao tuần này
 * tôi đi hai buổi mà chỉ hiện một".
 */

import { describe, expect, it } from "vitest";
import {
  VN_OFFSET_MINUTES,
  identityKey,
  periodKeyOf,
  periodLabel,
  periodRange,
  rollupEvents,
  type RollupSource,
} from "../lib/domain/rollup";
import { EventSim } from "../lib/testing/harness";

/** Mốc UTC ứng với một giờ Việt Nam cho trước. */
function vn(y: number, m: number, d: number, hh = 20, mm = 0): number {
  return Date.UTC(y, m - 1, d, hh, mm) - VN_OFFSET_MINUTES * 60_000;
}

describe("mốc thời gian", () => {
  it("tuần bắt đầu từ thứ hai theo giờ Việt Nam", () => {
    // 03/08/2026 là thứ hai, 09/08 là chủ nhật.
    const monday = periodKeyOf(vn(2026, 8, 3, 6), "week");
    const sunday = periodKeyOf(vn(2026, 8, 9, 21), "week");
    const nextMonday = periodKeyOf(vn(2026, 8, 10, 6), "week");

    expect(sunday, "chủ nhật phải cùng tuần với thứ hai trước đó").toBe(monday);
    expect(nextMonday).not.toBe(monday);
  });

  it("buổi đánh tối chủ nhật không bị đẩy sang tuần sau", () => {
    // Đây là lỗi thật sẽ xảy ra nếu quên múi giờ: 21 giờ chủ nhật ở Việt Nam là
    // 14 giờ chủ nhật UTC — vẫn chủ nhật. Nhưng 21 giờ THỨ HAI thì UTC vẫn thứ
    // hai, còn 6 giờ sáng thứ hai ở Việt Nam là 23 giờ CHỦ NHẬT UTC, tức tuần
    // trước. Kiểm cả hai đầu.
    const sundayNight = vn(2026, 8, 9, 21);
    const mondayMorning = vn(2026, 8, 10, 6);

    expect(periodKeyOf(sundayNight, "week")).toBe("2026-W32");
    expect(periodKeyOf(mondayMorning, "week")).toBe("2026-W33");

    // Không truyền múi giờ thì mặc định vẫn phải là Việt Nam.
    expect(periodKeyOf(mondayMorning, "week", VN_OFFSET_MINUTES)).toBe(
      periodKeyOf(mondayMorning, "week"),
    );
    // Còn nếu tính theo UTC thì sáng thứ hai rơi nhầm về tuần trước.
    expect(periodKeyOf(mondayMorning, "week", 0)).toBe("2026-W32");
  });

  it("tháng cũng theo giờ Việt Nam", () => {
    // 01/08/2026 lúc 6 giờ sáng Việt Nam = 23 giờ 31/07 UTC.
    expect(periodKeyOf(vn(2026, 8, 1, 6), "month")).toBe("2026-08");
    expect(periodKeyOf(vn(2026, 7, 31, 23), "month")).toBe("2026-07");
    expect(periodKeyOf(vn(2026, 12, 31, 23), "month")).toBe("2026-12");
  });

  it("khoảng thời gian của một kỳ khớp với mã kỳ", () => {
    for (const key of ["2026-W01", "2026-W32", "2026-W53", "2025-W01"]) {
      const { from, to } = periodRange(key, "week");
      expect(to - from, `${key} phải đúng 7 ngày`).toBe(7 * 86_400_000);
      expect(periodKeyOf(from, "week"), `${key}: đầu kỳ`).toBe(key);
      expect(periodKeyOf(to - 1, "week"), `${key}: cuối kỳ`).toBe(key);
    }
    for (const key of ["2026-01", "2026-08", "2026-12"]) {
      const { from, to } = periodRange(key, "month");
      expect(periodKeyOf(from, "month")).toBe(key);
      expect(periodKeyOf(to - 1, "month")).toBe(key);
    }
  });

  it("nhãn đọc được bằng tiếng Việt", () => {
    expect(periodLabel("2026-08", "month")).toBe("Tháng 8/2026");
    expect(periodLabel("2026-W32", "week")).toBe("Tuần 03/08 – 09/08/2026");
  });

  it("chuyển giao năm không tạo ra tuần cụt", () => {
    // 31/12/2025 là thứ tư, nên nó thuộc tuần 1 của 2026 theo ISO.
    const key = periodKeyOf(vn(2025, 12, 31, 20), "week");
    const { from, to } = periodRange(key, "week");
    expect(to - from).toBe(7 * 86_400_000);
    expect(periodKeyOf(from, "week")).toBe(key);
  });
});

describe("nhận ra người qua nhiều buổi", () => {
  it("ưu tiên mã thành viên, rồi thiết bị, cuối cùng mới tới tên", () => {
    expect(identityKey({ memberId: "m1", deviceId: "d1", name: "Nam" })).toBe("m:m1");
    expect(identityKey({ deviceId: "d1", name: "Nam" })).toBe("d:d1");
    expect(identityKey({ name: "  NAM  " })).toBe("n:nam");
  });

  it("cùng một thành viên đổi tên vẫn là một người", () => {
    expect(identityKey({ memberId: "m1", name: "Nam" })).toBe(
      identityKey({ memberId: "m1", name: "Nam Nguyễn" }),
    );
  });
});

describe("gộp số liệu", () => {
  it("cộng dồn đúng qua nhiều buổi trong cùng một tuần", () => {
    const a = playedEvent("E1", vn(2026, 8, 3), 8, 4);
    const b = playedEvent("E2", vn(2026, 8, 6), 8, 4);

    const [week] = rollupEvents([a, b], "week");
    expect(week!.periodKey).toBe("2026-W32");
    expect(week!.events).toHaveLength(2);
    expect(week!.totalGames).toBe(a.state.matches.filter((m) => m.result).length +
      b.state.matches.filter((m) => m.result).length);

    for (const p of week!.players) {
      expect(p.events, `${p.name} phải được tính là đi 2 buổi`).toBe(2);
      expect(p.wins + p.losses).toBe(p.games);
      expect(p.diff).toBe(p.pointsFor - p.pointsAgainst);
    }
  });

  it("tách đúng ra hai tuần khác nhau, mới nhất lên đầu", () => {
    const periods = rollupEvents(
      [
        playedEvent("E1", vn(2026, 8, 3), 8, 3),
        playedEvent("E2", vn(2026, 8, 12), 8, 3),
      ],
      "week",
    );
    expect(periods.map((p) => p.periodKey)).toEqual(["2026-W33", "2026-W32"]);
  });

  it("gộp cả tháng thành một kỳ", () => {
    const periods = rollupEvents(
      [
        playedEvent("E1", vn(2026, 8, 3), 8, 3),
        playedEvent("E2", vn(2026, 8, 12), 8, 3),
        playedEvent("E3", vn(2026, 9, 2), 8, 3),
      ],
      "month",
    );
    expect(periods.map((p) => p.periodKey)).toEqual(["2026-09", "2026-08"]);
    expect(periods[1]!.events).toHaveLength(2);
  });

  it("xếp hạng theo hiệu số trung bình, đi đều hơn thì đứng trên khi bằng điểm", () => {
    const [week] = rollupEvents([playedEvent("E1", vn(2026, 8, 3), 8, 4)], "week");
    const players = week!.players;
    for (let i = 1; i < players.length; i++) {
      expect(players[i - 1]!.avgDiff).toBeGreaterThanOrEqual(players[i]!.avgDiff);
    }
    expect(players[0]!.rank).toBe(1);
    // Người đồng hiệu số phải cùng hạng.
    for (let i = 1; i < players.length; i++) {
      if (players[i]!.avgDiff === players[i - 1]!.avgDiff) {
        expect(players[i]!.rank).toBe(players[i - 1]!.rank);
      }
    }
  });

  it("chỉ tính người thực sự có đánh, không tính người báo bận", () => {
    const sim = new EventSim({ seed: 9, config: { courts: 1 } });
    for (let i = 1; i <= 5; i++) sim.addPlayer(`P${i}`);
    // Người thứ sáu chỉ có tên trong danh sách, không tới sân.
    sim.send({ type: "AddPlayer", player: { id: "p6", name: "Vắng", avatarId: "a" }, asActive: false });
    sim.start();
    sim.playRounds(4);

    const [week] = rollupEvents(
      [{ code: "E1", name: "Buổi", at: vn(2026, 8, 3), state: sim.state }],
      "week",
    );
    expect(week!.players.some((p) => p.name === "Vắng")).toBe(false);
  });

  it("đánh dấu buổi chưa kết thúc để người đọc biết số còn chạy", () => {
    const running = playedEvent("E1", vn(2026, 8, 3), 8, 2);
    const [week] = rollupEvents([running], "week");
    expect(week!.events[0]!.live).toBe(true);

    const finished = playedEvent("E2", vn(2026, 8, 4), 8, 2);
    finished.state = { ...finished.state, status: "finished" };
    const [w2] = rollupEvents([finished], "week");
    expect(w2!.events[0]!.live).toBe(false);
  });

  it("không có buổi nào thì không có kỳ nào", () => {
    expect(rollupEvents([], "week")).toEqual([]);
    expect(rollupEvents([], "month")).toEqual([]);
  });
});

/** Một buổi đã đánh xong `rounds` vòng, dùng làm dữ liệu tổng kết. */
function playedEvent(
  code: string,
  at: number,
  players: number,
  rounds: number,
): RollupSource {
  const sim = new EventSim({ seed: 7, config: { courts: 2 } });
  for (let i = 1; i <= players; i++) sim.addPlayer(`P${i}`);
  sim.start();
  sim.playRounds(rounds);
  return { code, name: `Buổi ${code}`, at, state: sim.state };
}
