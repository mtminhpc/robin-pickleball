/**
 * Chạy toàn bộ mẫu thử và in ra bảng số.
 *
 *   npm run scenarios              — bảng tổng hợp mọi kịch bản × mọi cỡ nhóm
 *   npm run scenarios -- --detail  — kèm bảng Công bằng đầy đủ của từng lượt
 *   npm run scenarios -- --only toi-tre
 *
 * Lời hứa "công bằng nhất có thể" chỉ đáng tin khi nhìn được bằng số, và đây là
 * chỗ nhìn. Bộ kiểm thử `tests/scenarios.test.ts` canh đúng những luật này, nên
 * bảng dưới đây và `npm test` không bao giờ nói khác nhau.
 */

import { checkAll, type Problem } from "../lib/testing/checks";
import { SCENARIOS, SIZES, type ScenarioSetup } from "../lib/testing/scenarios";
import { fairnessReport } from "../lib/scheduler/metrics";
import { standingsFromState } from "../lib/domain/standings";

const argv = process.argv.slice(2);
const detail = argv.includes("--detail");
const onlyIndex = argv.indexOf("--only");
const only = onlyIndex === -1 ? null : argv[onlyIndex + 1];

interface Row {
  scenario: string;
  setup: ScenarioSetup;
  worstDeficit: number;
  spread: number;
  maxStreak: number;
  repeats: string;
  problems: Problem[];
}

const rows: Row[] = [];
let totalProblems = 0;

for (const scenario of SCENARIOS) {
  if (only && scenario.key !== only) continue;

  console.log("\n" + "━".repeat(88));
  console.log(`${scenario.title}  [${scenario.key}]`);
  console.log(`  ${scenario.why}`);
  console.log("━".repeat(88));

  for (const setup of SIZES) {
    const { sim, events, streakAllowance } = scenario.run(setup);
    const problems = checkAll(sim.state, {
      streakAllowance,
      stableRoster: scenario.stableRoster,
      tolerance: scenario.tolerance,
    });

    const fair = fairnessReport(sim.state);
    const games = fair.players.map((p) => p.games);
    const deficits = fair.players.map((p) => Math.abs(p.deficit));
    const worstDeficit = deficits.length ? Math.max(...deficits) : 0;
    const spread = games.length ? Math.max(...games) - Math.min(...games) : 0;
    const maxStreak = fair.players.length
      ? Math.max(...fair.players.map((p) => p.longestPlayStreak))
      : 0;

    rows.push({
      scenario: scenario.key,
      setup,
      worstDeficit,
      spread,
      maxStreak,
      repeats: partnerRepeats(sim.state),
      problems,
    });
    totalProblems += problems.length;

    const label = `${setup.players} người / ${setup.courts} sân`;
    const flag = problems.length ? `  ✗ ${problems.length} vấn đề` : "  ✓";
    console.log(
      "  " +
        pad(label, 18) +
        pad(`lệch tệ nhất ${worstDeficit.toFixed(2)}`, 22) +
        pad(`trận ${Math.min(...games)}–${Math.max(...games)}`, 14) +
        pad(`chuỗi ${maxStreak}`, 11) +
        pad(`cặp lặp ${partnerRepeats(sim.state)}`, 16) +
        flag,
    );

    if (events.length > 0) {
      for (const e of events) console.log(`      · ${e}`);
    }
    for (const p of problems) {
      console.log(`      ✗ [${p.rule}] ${p.detail}`);
    }
    for (const w of fair.warnings) {
      console.log(`      ! ${w}`);
    }

    if (detail) printFairness(sim.state);
  }
}

// ---------------------------------------------------------------------------

console.log("\n" + "═".repeat(88));
console.log("TỔNG KẾT");
console.log("═".repeat(88));

const byRule = new Map<string, number>();
for (const r of rows) {
  for (const p of r.problems) byRule.set(p.rule, (byRule.get(p.rule) ?? 0) + 1);
}

console.log(`${rows.length} lượt chạy · ${totalProblems} vấn đề`);
if (byRule.size > 0) {
  console.log("\nTheo luật bị vi phạm:");
  for (const [rule, count] of [...byRule].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${pad(rule, 26)} ${count}`);
  }
  console.log("\nCác lượt có vấn đề:");
  for (const r of rows.filter((x) => x.problems.length > 0)) {
    console.log(`  ${pad(r.scenario, 24)} ${r.setup.players} người / ${r.setup.courts} sân`);
  }
}

const worst = rows.reduce((a, b) => (b.worstDeficit > a.worstDeficit ? b : a), rows[0]!);
console.log(
  `\nLệch so với suất kỳ vọng, tệ nhất toàn bộ: ${worst.worstDeficit.toFixed(2)} trận ` +
    `(${worst.scenario}, ${worst.setup.players} người / ${worst.setup.courts} sân)`,
);
console.log(
  "Cột 'Lệch' mới là thước đo công bằng, không phải cột 'Trận'. Có người tới trễ " +
    "hay về sớm thì\nsố trận thô lệch nhau là đúng — ép chúng bằng nhau mới là bất công.",
);

process.exit(totalProblems === 0 ? 0 : 1);

// ---------------------------------------------------------------------------

function printFairness(state: Parameters<typeof fairnessReport>[0]): void {
  const fair = fairnessReport(state);
  const table = standingsFromState(state);
  console.log(
    "\n      " +
      pad("Người", 12) + pad("Trận", 6) + pad("Kỳ vọng", 9) + pad("Lệch", 8) +
      pad("Nghỉ", 6) + pad("Chuỗi", 7) + pad("Bạn đôi", 9) + "Trạng thái",
  );
  console.log("      " + "-".repeat(70));
  for (const p of [...fair.players].sort((a, b) => b.games - a.games)) {
    console.log(
      "      " +
        pad(p.name, 12) +
        pad(String(p.games), 6) +
        pad(p.expected.toFixed(1), 9) +
        pad(signed(p.deficit), 8) +
        pad(String(p.byes), 6) +
        pad(String(p.longestPlayStreak), 7) +
        pad(`${p.distinctPartners}/${p.reachablePeers}`, 9) +
        statusLabel(p.status),
    );
  }
  console.log(`      xếp hạng: ${table.main.length} người đủ trận, ${table.provisional.length} tạm tính\n`);
}

function partnerRepeats(state: Parameters<typeof fairnessReport>[0]): string {
  const seen = new Map<string, number>();
  let total = 0;
  for (const m of state.matches) {
    if (m.status !== "submitted") continue;
    for (const team of [m.teamA, m.teamB]) {
      const key = [...team].sort().join("|");
      seen.set(key, (seen.get(key) ?? 0) + 1);
      total += 1;
    }
  }
  let repeats = 0;
  for (const count of seen.values()) repeats += count - 1;
  return `${repeats}/${total}`;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n - 1) + " " : s + " ".repeat(n - s.length);
}

function signed(x: number): string {
  return x > 0 ? `+${x}` : String(x);
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    active: "đang chơi",
    left: "đã về",
    paused: "nghỉ tạm",
    confirmed: "chưa tới",
    invited: "đã mời",
  };
  return map[status] ?? status;
}
