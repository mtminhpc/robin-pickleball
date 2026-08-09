import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalFileSheetsClient } from "../lib/sheets/local";
import { EventRepo } from "../lib/sheets/repo";
import { seedTestData, TEST_EVENT_CODE } from "../scripts/seed-test-data";

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
  });
});
