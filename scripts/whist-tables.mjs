/**
 * Sinh bảng lịch Whist rồi in ra dạng chữ TypeScript.
 *
 * Hai cách tìm:
 *   • dạng vòng (Z-cyclic): tìm "vòng gốc" thoả điều kiện hiệu số rồi khai triển.
 *     Nhanh, nhưng không phải cỡ nào cũng có — Wh(9) là ví dụ.
 *   • trực tiếp: quay lui từng vòng một. Chậm hơn nhưng phủ được chỗ kia hụt.
 */

const SPLITS = [[0, 1, 2, 3], [0, 2, 1, 3], [0, 3, 1, 2]];

// --------------------------------------------------------------- dạng vòng

function cyclic(v) {
  const even = v % 4 === 0;
  const m = even ? v - 1 : v;
  const n = Math.floor(v / 4);
  const INF = m;

  const pd = new Int32Array(m);
  const od = new Int32Array(m);
  const bump = (a, b, arr, d) => {
    const k = (a - b + m) % m;
    arr[k] += d;
    arr[(m - k) % m] += d;
  };
  const ok = (arr, cap) => {
    for (let d = 1; d < m; d++) if (arr[d] > cap) return false;
    return true;
  };
  const apply = (q, d) => {
    const [a0, a1, b0, b1] = q;
    if (a0 !== INF && a1 !== INF) bump(a0, a1, pd, d);
    if (b0 !== INF && b1 !== INF) bump(b0, b1, pd, d);
    for (const x of [a0, a1]) for (const y of [b0, b1]) {
      if (x !== INF && y !== INF) bump(x, y, od, d);
    }
  };

  const pool = [];
  for (let x = 0; x < m; x++) if (even || x !== 0) pool.push(x);
  if (even) pool.push(INF);

  const used = new Set();
  const quads = [];

  function place() {
    if (quads.length === n) {
      for (let d = 1; d < m; d++) if (pd[d] !== 1 || od[d] !== 2) return null;
      return quads.map((q) => [...q]);
    }
    const first = pool.find((x) => !used.has(x));
    if (first === undefined) return null;
    const rest = pool.filter((x) => x !== first && !used.has(x));
    for (let i = 0; i < rest.length; i++)
      for (let j = i + 1; j < rest.length; j++)
        for (let k = j + 1; k < rest.length; k++) {
          const four = [first, rest[i], rest[j], rest[k]];
          for (const s of SPLITS) {
            const q = s.map((t) => four[t]);
            apply(q, 1);
            if (ok(pd, 1) && ok(od, 2)) {
              four.forEach((x) => used.add(x));
              quads.push(q);
              const got = place();
              if (got) return got;
              quads.pop();
              four.forEach((x) => used.delete(x));
            }
            apply(q, -1);
          }
        }
    return null;
  }

  const base = place();
  if (!base) return null;
  const rounds = [];
  for (let r = 0; r < m; r++) {
    rounds.push(base.map((q) => q.map((x) => (x === INF ? v - 1 : (x + r) % m))));
  }
  return rounds;
}

// ---------------------------------------------------------------- trực tiếp

function direct(v) {
  const even = v % 4 === 0;
  const R = even ? v - 1 : v; // số vòng
  const n = Math.floor(v / 4);
  const P = Array.from({ length: v }, () => new Int32Array(v));
  const O = Array.from({ length: v }, () => new Int32Array(v));
  const rounds = [];

  const touch = (q, d) => {
    const [a0, a1, b0, b1] = q;
    P[a0][a1] += d; P[a1][a0] += d; P[b0][b1] += d; P[b1][b0] += d;
    for (const x of [a0, a1]) for (const y of [b0, b1]) { O[x][y] += d; O[y][x] += d; }
  };
  const fits = (q) => {
    const [a0, a1, b0, b1] = q;
    if (P[a0][a1] >= 1 || P[b0][b1] >= 1) return false;
    for (const x of [a0, a1]) for (const y of [b0, b1]) if (O[x][y] >= 2) return false;
    return true;
  };

  // Với v lẻ, người nghỉ ở vòng r là chính người r — tịnh tiến được nên không mất tổng quát.
  function fillRound(r, pool, quads) {
    if (quads.length === n) {
      rounds.push(quads.map((q) => [...q]));
      const got = fillFrom(r + 1);
      if (got) return true;
      rounds.pop();
      return false;
    }
    const first = pool[0];
    const rest = pool.slice(1);
    for (let i = 0; i < rest.length; i++)
      for (let j = i + 1; j < rest.length; j++)
        for (let k = j + 1; k < rest.length; k++) {
          const four = [first, rest[i], rest[j], rest[k]];
          const left = rest.filter((_, t) => t !== i && t !== j && t !== k);
          for (const s of SPLITS) {
            const q = s.map((t) => four[t]);
            if (!fits(q)) continue;
            touch(q, 1);
            quads.push(q);
            if (fillRound(r, left, quads)) return true;
            quads.pop();
            touch(q, -1);
          }
        }
    return false;
  }

  function fillFrom(r) {
    if (r === R) return true;
    const pool = [];
    for (let x = 0; x < v; x++) {
      if (!even && x === r) continue; // người nghỉ vòng này
      pool.push(x);
    }
    return fillRound(r, pool, []);
  }

  return fillFrom(0) ? rounds : null;
}

// ------------------------------------------------------------ kiểm chứng

function verify(v, rounds) {
  const expected = v % 4 === 0 ? v - 1 : v;
  if (rounds.length !== expected) return `có ${rounds.length} vòng, cần ${expected}`;
  const P = Array.from({ length: v }, () => new Int32Array(v));
  const O = Array.from({ length: v }, () => new Int32Array(v));
  const byes = new Int32Array(v);
  for (const round of rounds) {
    const seen = new Set();
    for (const [a0, a1, b0, b1] of round) {
      for (const x of [a0, a1, b0, b1]) {
        if (x < 0 || x >= v) return `chỉ số ngoài khoảng: ${x}`;
        if (seen.has(x)) return `người ${x} đánh hai trận trong một vòng`;
        seen.add(x);
      }
      P[a0][a1]++; P[a1][a0]++; P[b0][b1]++; P[b1][b0]++;
      for (const x of [a0, a1]) for (const y of [b0, b1]) { O[x][y]++; O[y][x]++; }
    }
    for (let x = 0; x < v; x++) if (!seen.has(x)) byes[x]++;
  }
  for (let i = 0; i < v; i++) {
    for (let j = i + 1; j < v; j++) {
      if (P[i][j] !== 1) return `cặp ${i}-${j} đánh đôi ${P[i][j]} lần`;
      if (O[i][j] !== 2) return `cặp ${i}-${j} gặp nhau ${O[i][j]} lần`;
    }
  }
  const b0 = byes[0];
  for (let i = 1; i < v; i++) if (byes[i] !== b0) return `số vòng nghỉ không đều`;
  return null;
}

// ------------------------------------------------------------------ chạy

const out = [];
for (const v of [4, 5, 8, 9, 12, 13, 16, 17, 20, 21]) {
  const t = Date.now();
  let rounds = cyclic(v);
  let how = "vòng";
  if (!rounds || verify(v, rounds)) {
    rounds = direct(v);
    how = "trực tiếp";
  }
  if (!rounds) {
    console.error(`// ${v}: KHÔNG TÌM RA`);
    continue;
  }
  const bad = verify(v, rounds);
  if (bad) {
    console.error(`// ${v}: SAI — ${bad}`);
    continue;
  }
  console.error(`// ${v}: đạt qua cách ${how}, ${rounds.length} vòng, ${Date.now() - t}ms`);
  out.push([v, rounds]);
}

for (const [v, rounds] of out) {
  const body = rounds
    .map((round) => "    [" + round.map((q) => `[${q.join(",")}]`).join(", ") + "],")
    .join("\n");
  console.log(`  ${v}: [\n${body}\n  ],`);
}
