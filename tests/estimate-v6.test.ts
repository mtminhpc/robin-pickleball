import { describe, expect, it } from "vitest";
import { estimateEvent, formatEstimatedDuration } from "../lib/domain/estimate";

describe("ước tính thời lượng v0.6", () => {
  it("tính đúng ví dụ 8 người, 2 sân, 6 trận mỗi người", () => {
    expect(
      estimateEvent({
        players: 8,
        courts: 2,
        targetGamesPerPlayer: 6,
        matchMinutes: 15,
        turnoverMinutes: 3,
      }),
    ).toEqual({
      usableCourts: 2,
      totalMatches: 12,
      waves: 6,
      durationMinutes: 105,
      minGamesPerPlayer: 6,
      maxGamesPerPlayer: 6,
      averageWaitMinutes: 3,
    });
  });

  it.each(Array.from({ length: 8 }, (_, i) => i + 4))(
    "trả ước tính hữu hạn cho %i người",
    (players) => {
      const estimate = estimateEvent({
        players,
        courts: 2,
        targetGamesPerPlayer: 6,
        matchMinutes: 15,
        turnoverMinutes: 3,
      });
      expect(estimate?.totalMatches).toBe(Math.ceil((players * 6) / 4));
      expect(estimate?.durationMinutes).toBeGreaterThan(0);
      expect(estimate?.averageWaitMinutes).toBeGreaterThanOrEqual(0);
    },
  );

  it("không tính khi đầu vào thiếu hoặc ngoài giới hạn", () => {
    expect(
      estimateEvent({
        players: 3,
        courts: 2,
        targetGamesPerPlayer: 6,
        matchMinutes: 15,
        turnoverMinutes: 3,
      }),
    ).toBeNull();
  });

  it("định dạng thời lượng dễ đọc", () => {
    expect(formatEstimatedDuration(105)).toBe("1 giờ 45 phút");
    expect(formatEstimatedDuration(60)).toBe("1 giờ");
    expect(formatEstimatedDuration(45)).toBe("45 phút");
  });
});
