/**
 * Công cụ mô phỏng dòng lệnh.
 *
 * Chạy thử một buổi đánh rồi in ra số liệu công bằng, để duyệt thuật toán trước
 * khi có giao diện. Lời hứa "công bằng nhất có thể" chỉ đáng tin khi nhìn được
 * bằng số, và đây là chỗ nhìn.
 *
 *   pnpm sim --players 13 --courts 3 --rounds 15
 *   pnpm sim --players 12 --courts 2 --rounds 14 --join 5 --leave 9
 *   pnpm sim --matrix
 */

import { standingsFromState } from "../lib/domain/standings";
import { achievableStreakCap, fairnessReport } from "../lib/scheduler/metrics";
import { EventSim } from "../lib/testing/harness";

interface Args {
  players: number;
  courts: number;
  rounds: number;
  /** Thêm một người mới ở vòng này (0 = không). */
  join: number;
  /** Cho một người về sớm ở vòng này (0 = không). */
  leave: number;
  seed: number;
  matrix: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string, fallback: number): number => {
    const i = argv.indexOf(`--${name}`);
    if (i === -1) return fallback;
    const v = Number(argv[i + 1]);
    return Number.isFinite(v) ? v : fallback;
  };
  return {
    players: get("players", 12),
    courts: get("courts", 2),
    rounds: get("rounds", 12),
    join: get("join", 0),
    leave: get("leave", 0),
    seed: get("seed", 42),
    matrix: argv.includes("--matrix"),
  };
}

const NAMES = [
  "An", "Bình", "Cường", "Dũng", "Giang", "Hà", "Hùng", "Khánh",
  "Lan", "Linh", "Minh", "Nam", "Ngọc", "Oanh", "Phúc", "Quân",
  "Sơn", "Thảo", "Trung", "Vy", "Xuân", "Yến", "Đạt", "Ân",
];

function nameFor(i: number): string {
  const base = NAMES[i % NAMES.length]!;
  return i < NAMES.length ? base : `${base} ${Math.floor(i / NAMES.length) + 1}`;
}

function runOne(args: Args): void {
  const sim = new EventSim({
    seed: args.seed,
    config: { courts: args.courts, name: "Mô phỏng" },
  });

  sim.addPlayers(Array.from({ length: args.players }, (_, i) => nameFor(i)));
  sim.start();

  const events: string[] = [];
  for (let r = 1; r <= args.rounds; r++) {
    if (args.join === r) {
      const id = sim.joinMidEvent(nameFor(args.players));
      events.push(`vòng ${r}: ${sim.state.players.find((p) => p.id === id)?.name} vào giữa chừng`);
    }
    if (args.leave === r) {
      const leaving = sim.state.players.find((p) => p.status === "active");
      if (leaving) {
        sim.leave(leaving.id);
        events.push(`vòng ${r}: ${leaving.name} về sớm`);
      }
    }
    if (sim.playNextRound() === 0) break;
  }

  report(sim, args, events);
}

function report(sim: EventSim, args: Args, events: string[]): void {
  const fair = fairnessReport(sim.state);
  const table = standingsFromState(sim.state);

  const header = `${args.players} người / ${args.courts} sân / ${args.rounds} vòng (hạt giống ${args.seed})`;
  console.log("\n" + "=".repeat(78));
  console.log(header);
  console.log("=".repeat(78));

  if (events.length > 0) {
    console.log("\nBiến động giữa chừng:");
    for (const e of events) console.log(`  - ${e}`);
  }

  if (fair.warnings.length > 0) {
    console.log("\nCảnh báo khả thi:");
    for (const w of fair.warnings) console.log(`  ! ${w}`);
  }

  console.log("\nCÔNG BẰNG");
  console.log(
    pad("Người", 12) +
      pad("Trận", 6) +
      pad("Kỳ vọng", 9) +
      pad("Lệch", 7) +
      pad("Nghỉ", 6) +
      pad("Chuỗi", 7) +
      pad("Bạn đôi", 9) +
      pad("Đối thủ", 9) +
      "Trạng thái",
  );
  console.log("-".repeat(78));
  for (const p of [...fair.players].sort((a, b) => b.games - a.games)) {
    console.log(
      pad(p.name, 12) +
        pad(String(p.games), 6) +
        pad(p.expected.toFixed(1), 9) +
        pad(signed(p.deficit), 7) +
        pad(String(p.byes), 6) +
        pad(String(p.longestPlayStreak), 7) +
        pad(`${p.distinctPartners}/${p.reachablePeers}`, 9) +
        pad(`${p.distinctOpponents}/${p.reachablePeers}`, 9) +
        statusLabel(p.status),
    );
  }

  const games = fair.players.map((p) => p.games);
  const streaks = fair.players.map((p) => p.longestPlayStreak);
  const deficits = fair.players.map((p) => Math.abs(p.deficit));
  console.log("-".repeat(78));
  // Cột "Lệch" mới là thước đo công bằng, không phải cột "Trận". Khi có người đến
  // muộn hoặc về sớm thì số trận thô KHÔNG nên bằng nhau — bằng nhau mới là bất
  // công. Thứ phải gần 0 là chênh lệch so với suất kỳ vọng.
  console.log(
    `Lệch so với suất kỳ vọng: tệ nhất ${Math.max(...deficits).toFixed(2)} trận   ` +
      `Chuỗi liên tiếp dài nhất: ${Math.max(...streaks)}`,
  );
  console.log(
    `Số trận thô: ${Math.min(...games)}–${Math.max(...games)} ` +
      `(chênh ${Math.max(...games) - Math.min(...games)}; chênh là bình thường nếu có người đến muộn hoặc về sớm)`,
  );

  console.log(`\nXẾP HẠNG (ngưỡng ${table.threshold} trận, trung vị ${table.medianGames})`);
  console.log(
    pad("#", 4) + pad("Người", 12) + pad("Trận", 6) + pad("T-B", 8) +
      pad("Hiệu số", 9) + "TB/trận",
  );
  console.log("-".repeat(78));
  for (const row of table.main) {
    console.log(
      pad(String(row.rank), 4) +
        pad(row.name + (row.hasLeft ? " (về)" : ""), 12) +
        pad(String(row.games), 6) +
        pad(`${row.wins}-${row.losses}`, 8) +
        pad(signed(row.diff), 9) +
        signed(Math.round(row.avgDiff * 100) / 100),
    );
  }
  if (table.provisional.length > 0) {
    console.log("\n  Chưa đủ số trận:");
    for (const row of table.provisional) {
      console.log(
        "  " +
          pad("-", 4) +
          pad(row.name, 12) +
          pad(String(row.games), 6) +
          pad(`${row.wins}-${row.losses}`, 8) +
          pad(signed(row.diff), 9) +
          `${signed(Math.round(row.avgDiff * 100) / 100)}  (cần thêm ${row.gamesNeeded})`,
      );
    }
  }
}

/** Quét nhanh nhiều cấu hình để thấy thuật toán bền tới đâu. */
function runMatrix(seed: number): void {
  console.log("\nQUÉT MA TRẬN — 14 vòng mỗi cấu hình\n");
  console.log(
    pad("Người", 7) + pad("Sân", 6) + pad("Trận min-max", 15) +
      pad("Chênh", 8) + pad("Chuỗi", 8) + pad("Tối ưu", 8) +
      pad("Nghỉ min-max", 14) + "Cặp lặp",
  );
  console.log("-".repeat(78));

  for (let players = 6; players <= 20; players++) {
    for (let courts = 1; courts <= 4; courts++) {
      if (players < courts * 4) continue;
      const sim = new EventSim({
        seed,
        config: { courts },
        planning: { iterations: 12_000, timeBudgetMs: 250 },
      });
      sim.addPlayers(Array.from({ length: players }, (_, i) => nameFor(i)));
      sim.start();
      sim.playRounds(14);

      const fair = fairnessReport(sim.state);
      const games = fair.players.map((p) => p.games);
      const byes = fair.players.map((p) => p.byes);
      const maxStreak = Math.max(...fair.players.map((p) => p.longestPlayStreak));
      const repeats = partnerRepeats(sim);

      // Mức chuỗi tốt nhất mà cấu hình này cho phép. So với nó mới có nghĩa: đòi
      // 20 người trên 4 sân phải nghỉ sau mỗi 3 vòng là đòi điều không thể.
      const best = achievableStreakCap(players, courts);
      const target = Math.max(sim.state.config.hardMaxConsecutive, Number.isFinite(best) ? best : 0);
      const bestLabel = Number.isFinite(best) ? String(best) : "mọi vòng";

      const spread = Math.max(...games) - Math.min(...games);
      const flag =
        spread > 1 || (Number.isFinite(best) && maxStreak > target) ? "  <<<" : "";
      console.log(
        pad(String(players), 7) +
          pad(String(courts), 6) +
          pad(`${Math.min(...games)}-${Math.max(...games)}`, 15) +
          pad(String(spread), 8) +
          pad(String(maxStreak), 8) +
          pad(bestLabel, 8) +
          pad(`${Math.min(...byes)}-${Math.max(...byes)}`, 14) +
          repeats +
          flag,
      );
    }
  }
  console.log(
    "\nCột 'Tối ưu' là chuỗi ngắn nhất mà số người / số sân đó cho phép về mặt toán học.",
  );
  console.log(
    "<<< đánh dấu cấu hình lệch số trận quá 1, hoặc chuỗi dài hơn mức tối ưu.",
  );
}

/** Số cặp đôi bị lặp lại, so với tổng số lần ghép — càng thấp càng đa dạng. */
function partnerRepeats(sim: EventSim): string {
  const seen = new Map<string, number>();
  let total = 0;
  for (const m of sim.state.matches) {
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
  };
  return map[status] ?? status;
}

const args = parseArgs(process.argv.slice(2));
if (args.matrix) runMatrix(args.seed);
else runOne(args);
