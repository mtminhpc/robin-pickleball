import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalFileSheetsClient } from "../lib/sheets/local";
import { EventRepo } from "../lib/sheets/repo";
import {
  seedTestData,
  TEST_EVENT_CODE,
  TEST_V5_EVENT_CODE,
  TEST_V6_EVENT_CODE,
  TEST_V8_EVENT_CODE,
} from "../scripts/seed-test-data";

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("dữ liệu sân TEST bền vững", () => {
  it("tạo đủ 11 người và chạy lại không reset hay nhân đôi", async () => {
    const dir = mkdtempSync(join(tmpdir(), "robin-test-data-"));
    dirs.push(dir);
    const path = join(dir, "sandbox.json");

    await seedTestData(path);
    const first = readFileSync(path, "utf8");
    await seedTestData(path);
    const second = readFileSync(path, "utf8");

    expect(second, "seed lần hai không được sửa buổi đang thử dở").toBe(first);

    const loaded = await new EventRepo(new LocalFileSheetsClient(path)).load(TEST_EVENT_CODE);
    expect(loaded?.state.clubId).toBeTruthy();
    expect(loaded?.state.config.name).toBe("SÂN TEST · 4–11 NGƯỜI");
    expect(loaded?.state.players.filter((p) => p.status === "active")).toHaveLength(11);
    expect(loaded?.state.matches.some((m) => m.status === "scheduled")).toBe(true);

    const v5 = await new EventRepo(new LocalFileSheetsClient(path)).load(TEST_V5_EVENT_CODE);
    expect(v5?.state.status).toBe("finished");
    expect(v5?.state.matches.filter((match) => match.status === "submitted")).toHaveLength(3);
    expect(v5?.state.presentation.sponsors).toHaveLength(9);
    expect(v5?.state.presentation.awards).toHaveLength(3);

    const v6 = await new EventRepo(new LocalFileSheetsClient(path)).load(TEST_V6_EVENT_CODE);
    expect(v6?.state.status).toBe("running");
    expect(v6?.state.config.venueAddress).toContain("Sân TEST");
    expect(v6?.state.presentation.sponsors).toHaveLength(3);
    expect(v6?.state.matches.find((match) => match.id === "testv6-m1")?.status).toBe("submitted");

    const v8 = await new EventRepo(new LocalFileSheetsClient(path)).load(TEST_V8_EVENT_CODE);
    expect(v8?.state.status).toBe("running");
    expect(v8?.state.courts.map((court) => court.labels[0]?.name)).toEqual([
      "Sân số 7",
      "Sân số 9",
      "Sân Mái Kính",
    ]);
    expect(v8?.state.players.find((player) => player.id === "testv8-p1")?.availability).toHaveLength(2);
    expect(v8?.state.matches.some((match) => match.courtId === "testv8-court-7")).toBe(true);
  });
});
