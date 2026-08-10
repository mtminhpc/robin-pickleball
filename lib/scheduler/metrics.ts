/**
 * Đo công bằng.
 *
 * "Công bằng" ở đây không phải là chia đều số trận — khi người đến trễ, người về
 * sớm và trận bị huỷ thì chia đều là sai. Thước đo dùng trong toàn bộ ứng dụng là
 * **suất kỳ vọng**: mỗi vòng có mặt, một người đáng được `min(1, 4·số trận / số
 * người có mặt)` lượt đánh. Cộng dồn qua các vòng người đó CÓ MẶT rồi trừ đi số
 * trận thực đánh, ta được `deficit` — ai dương là đang bị thiệt.
 *
 * Cách này khiến ba tình huống khó tự xử lý đúng mà không cần luật riêng:
 *   • người vào vòng 5 không bị coi là "đang thiếu 4 trận";
 *   • người về sớm không bị coi là "được ưu ái";
 *   • trận bị huỷ làm suất kỳ vọng của cả nhóm giảm theo, nên không ai chịu thiệt.
 */

import { firstOpenRound } from "../domain/rounds";
import type { EventState, Match, Player, PlayerId } from "../domain/types";
import { activeCourtsAt, isAvailableAt, wasPresentAt } from "../domain/types";

/** Trận thực sự đã diễn ra (kể cả bỏ dở) — trận huỷ khi chưa đánh thì không. */
export function didHappen(m: Match): boolean {
  return m.status === "submitted" || m.status === "playing" || m.status === "abandoned";
}

/**
 * Trận được tính là "đã có lượt đánh" cho người chơi.
 *
 * Trận bỏ dở không tính: bốn người đó đã tốn sức nhưng không được trận nào, nên
 * họ vẫn đang bị thiệt và xứng đáng được ưu tiên xếp lại. Ngược lại về mặt thể
 * lực họ vừa mới ra sân, nên `playStreak` bên dưới lại có tính — hai chiều này cố
 * ý khác nhau.
 */
export function countsAsGame(m: Match): boolean {
  return m.status === "submitted" || m.status === "playing";
}

export interface History {
  /** index người chơi trong các mảng phẳng bên dưới. */
  index: Map<PlayerId, number>;
  ids: PlayerId[];
  n: number;
  games: Float64Array;
  expected: Float64Array;
  /** Khoản "nợ" của người vào giữa chừng — xem `catchUpFactor` trong cấu hình. */
  credit: Float64Array;
  /** expected + credit − games. Dương nghĩa là đang bị thiệt. */
  deficit: Float64Array;
  byes: Float64Array;
  /** n×n, đối xứng. Số lần hai người đứng cùng đội. */
  partner: Int32Array;
  /** n×n, đối xứng. Số lần hai người đối đầu. */
  opponent: Int32Array;
  /** n×courts. Số lần mỗi người đánh ở từng sân. */
  courtUse: Int32Array;
  courts: number;
  /** Số vòng đã đánh liên tiếp tính tới vòng ngay trước cửa sổ xếp lịch. */
  playStreak: Int32Array;
  /** Số vòng đã nghỉ liên tiếp tính tới vòng ngay trước cửa sổ xếp lịch. */
  restStreak: Int32Array;
  longestPlayStreak: Int32Array;
}

/**
 * Dựng bộ đếm lịch sử cho một tập người chơi.
 *
 * `ids` thường là danh sách người đang active (để xếp lịch), nhưng khi tính bảng
 * Công bằng thì truyền cả người đã về để họ vẫn hiện trong bảng.
 */
/**
 * @param throughRound Vòng cuối cùng được tính vào lịch sử.
 *
 * Mặc định là vòng ngay trước cửa sổ xếp lịch — đúng cho **thuật toán**, vì nó
 * chỉ được phép dựa vào quá khứ đã chốt.
 *
 * Nhưng bảng Công bằng hiển thị cho người đọc thì cần mốc khác. Một trận có thể
 * được nhập tỷ số ở vòng nằm SAU cửa sổ đó: chủ sân ghim một vòng rồi cả nhóm
 * đánh vòng sau trước, hoặc bấm nhập điểm từ tab Lịch. Lấy mốc mặc định thì
 * những trận ấy không được đếm, và bảng Công bằng báo ít trận hơn thực tế trong
 * khi bảng Xếp hạng — vốn duyệt mọi trận — lại báo đúng. Hai bảng cãi nhau ngay
 * trên cùng một màn hình.
 */
export function buildHistory(
  state: EventState,
  ids: PlayerId[],
  throughRound?: number,
): History {
  const n = ids.length;
  const courts = Math.max(1, state.courts.length);
  const index = new Map<PlayerId, number>();
  ids.forEach((id, i) => index.set(id, i));

  const h: History = {
    index,
    ids,
    n,
    games: new Float64Array(n),
    expected: new Float64Array(n),
    credit: new Float64Array(n),
    deficit: new Float64Array(n),
    byes: new Float64Array(n),
    partner: new Int32Array(n * n),
    opponent: new Int32Array(n * n),
    courtUse: new Int32Array(n * courts),
    courts,
    playStreak: new Int32Array(n),
    restStreak: new Int32Array(n),
    longestPlayStreak: new Int32Array(n),
  };

  const byId = new Map(state.players.map((p) => [p.id, p] as const));
  const lastPast = throughRound ?? firstOpenRound(state) - 1;

  for (let round = 1; round <= lastPast; round++) {
    const happened = state.matches.filter((m) => m.round === round && didHappen(m));

    // Vòng không có trận nào diễn ra thì coi như không tồn tại.
    //
    // Sau khi kết thúc sớm, các vòng phía sau chỉ còn toàn trận đã huỷ. Nếu vẫn
    // duyệt qua chúng thì ai cũng bị cộng thêm một lần nghỉ cho mỗi vòng đó, và
    // bảng Công bằng sẽ báo "nghỉ 7 lần" trong một buổi mới đánh 4 vòng.
    if (happened.length === 0) continue;

    // Ai có mặt ở vòng này trong tập đang xét — dùng để cập nhật bộ đếm của
    // những người mà bên gọi cần xếp lịch.
    const present: number[] = [];
    for (let i = 0; i < n; i++) {
      const p = byId.get(ids[i]!);
      if (!p) continue;
      if (!wasPresentAt(p, round)) continue;
      // Đã khai trước là vòng này mình không có mặt thì cũng không hưởng suất
      // của vòng đó. Thiếu chỗ này thì người báo "7 giờ tôi mới tới" vẫn được
      // cộng suất cho những vòng họ còn đang trên đường, rồi bảng Công bằng hiện
      // họ THIẾU mấy trận — và thuật toán sẽ đi bù cho một khoản nợ không có thật,
      // lấy suất của những người có mặt từ đầu.
      if (!isAvailableAt(p, round)) continue;
      present.push(i);
    }
    if (present.length === 0) continue;

    // Mẫu số phải là TOÀN BỘ người thật sự có mặt ở vòng lịch sử, không chỉ tập
    // `ids`. Bộ xếp lịch truyền vào những người đang active; nếu một người vừa
    // về mà bị loại khỏi mẫu số quá khứ, mọi người còn lại lập tức nhận thêm
    // một khoản nợ ảo. Đo được ở ca 5 → 6 → 5 người: bốn người bị cộng sai đúng
    // 1 suất dù bảng Công bằng (vốn còn giữ người đã về) vẫn tính đúng.
    let allPresent = 0;
    for (const p of state.players) {
      if (wasPresentAt(p, round) && isAvailableAt(p, round)) allPresent += 1;
    }
    if (allPresent === 0) continue;

    const share = Math.min(1, (4 * happened.length) / allPresent);
    for (const i of present) h.expected[i] += share;

    const playedThisRound = new Set<number>();
    for (const m of happened) {
      const a0 = index.get(m.teamA[0]);
      const a1 = index.get(m.teamA[1]);
      const b0 = index.get(m.teamB[0]);
      const b1 = index.get(m.teamB[1]);
      const quad = [a0, a1, b0, b1];

      for (const q of quad) if (q !== undefined) playedThisRound.add(q);

      if (a0 !== undefined && a1 !== undefined) bump(h.partner, n, a0, a1);
      if (b0 !== undefined && b1 !== undefined) bump(h.partner, n, b0, b1);
      for (const x of [a0, a1]) {
        for (const y of [b0, b1]) {
          if (x !== undefined && y !== undefined) bump(h.opponent, n, x, y);
        }
      }

      const courtIdx = Math.min(courts - 1, Math.max(0, m.court - 1));
      for (const q of quad) {
        if (q !== undefined) h.courtUse[q * courts + courtIdx] += 1;
      }

      if (countsAsGame(m)) {
        for (const q of quad) if (q !== undefined) h.games[q] += 1;
      }
    }

    for (const i of present) {
      if (playedThisRound.has(i)) {
        h.playStreak[i] += 1;
        h.restStreak[i] = 0;
        if (h.playStreak[i] > h.longestPlayStreak[i]) {
          h.longestPlayStreak[i] = h.playStreak[i];
        }
      } else {
        h.byes[i] += 1;
        h.restStreak[i] += 1;
        h.playStreak[i] = 0;
      }
    }
  }

  for (let i = 0; i < n; i++) {
    const p = byId.get(ids[i]!);
    h.credit[i] = p ? p.catchUpCredit : 0;
    h.deficit[i] = h.expected[i] + h.credit[i] - h.games[i];
  }

  return h;
}

function bump(m: Int32Array, n: number, a: number, b: number): void {
  m[a * n + b] += 1;
  m[b * n + a] += 1;
}

// ---------------------------------------------------------------------------
// Bảng "Công bằng" hiển thị trong ứng dụng
// ---------------------------------------------------------------------------

export interface PlayerFairness {
  playerId: PlayerId;
  name: string;
  status: Player["status"];
  games: number;
  /** Suất đáng được hưởng, cộng dồn qua các vòng người này CÓ MẶT. */
  expected: number;
  /**
   * Thiệt thòi thật: `expected − games`. Cố ý không cộng khoản đuổi kịp vào.
   *
   * Bảng Công bằng là thứ người chơi mở ra để tự kiểm chứng, nên con số ở đây
   * phải trả lời đúng một câu: "tôi có bị thiệt không". Cộng thêm khoản ưu tiên
   * của người mới vào sẽ khiến họ hiện lệch +7 ngay lúc vừa đặt chân tới sân,
   * trong khi họ chưa mất suất nào cả.
   */
  deficit: number;
  /** Khoản ưu tiên đuổi kịp còn lại của người vào giữa chừng, hiện thành cột riêng. */
  catchUp: number;
  byes: number;
  currentPlayStreak: number;
  longestPlayStreak: number;
  distinctPartners: number;
  distinctOpponents: number;
  /** Số người khác từng có mặt cùng lúc — mẫu số của hai cột trên. */
  reachablePeers: number;
}

export interface FairnessReport {
  players: PlayerFairness[];
  /** Cảnh báo trung thực khi ràng buộc không thể thoả mãn về mặt toán học. */
  warnings: string[];
}

/** Vòng cuối cùng có ít nhất một trận đã diễn ra. `0` nếu chưa đánh gì. */
function lastRoundThatHappened(state: EventState): number {
  let last = 0;
  for (const m of state.matches) {
    if (didHappen(m) && m.round > last) last = m.round;
  }
  return last;
}

export function fairnessReport(state: EventState): FairnessReport {
  // Người đã về vẫn hiện trong bảng; người bị từ chối hoặc báo bận thì không.
  const shown = state.players.filter(
    (p) => p.presence.length > 0 || p.status === "active",
  );
  const ids = shown.map((p) => p.id);
  // Đếm tới vòng cuối cùng THẬT SỰ có trận diễn ra, không dừng ở cửa sổ xếp
  // lịch: trận đánh không theo thứ tự vòng vẫn phải được tính đủ.
  const h = buildHistory(state, ids, lastRoundThatHappened(state));
  const n = ids.length;

  const players: PlayerFairness[] = shown.map((p, i) => {
    let partners = 0;
    let opponents = 0;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      if (h.partner[i * n + j] > 0) partners += 1;
      if (h.opponent[i * n + j] > 0) opponents += 1;
    }
    return {
      playerId: p.id,
      name: p.name,
      status: p.status,
      games: h.games[i],
      expected: round2(h.expected[i]),
      deficit: round2(h.expected[i] - h.games[i]),
      // Phần dương mà khoản cộng thêm còn tạo ra trong mục tiêu của bộ xếp lịch.
      // Không được trừ toàn bộ số trận từ đầu buổi khỏi `catchUpCredit`: lệnh
      // GrantCatchUp có thể được cấp sau khi người đó đã đánh nhiều trận. Công
      // thức hiệu số này trả đúng +3 ngay sau khi cấp 3, rồi giảm dần khi họ đã
      // thật sự được xếp vượt phần suất tự nhiên của mình.
      catchUp: round2(
        Math.max(0, h.expected[i] + p.catchUpCredit - h.games[i]) -
          Math.max(0, h.expected[i] - h.games[i]),
      ),
      byes: h.byes[i],
      currentPlayStreak: h.playStreak[i],
      longestPlayStreak: h.longestPlayStreak[i],
      distinctPartners: partners,
      distinctOpponents: opponents,
      reachablePeers: Math.max(0, n - 1),
    };
  });

  return { players, warnings: feasibilityWarnings(state) };
}

/**
 * Chuỗi đánh liên tiếp ngắn nhất mà số người và số sân hiện tại cho phép.
 *
 * Để không ai đánh quá `k` vòng liền, mỗi người phải được nghỉ ít nhất một lần
 * trong mỗi `k + 1` vòng, tức cả nhóm cần `n / (k + 1)` suất nghỉ mỗi vòng. Chỉ
 * có `n − 4·sân` suất, nên `k` nhỏ nhất đạt được là `ceil(n / suất nghỉ) − 1`.
 *
 * Trả về `Infinity` khi không còn suất nghỉ nào: 16 người trên 4 sân thì ai cũng
 * phải đánh mọi vòng, không cách nào khác.
 */
export function achievableStreakCap(activeCount: number, courts: number): number {
  const usable = Math.min(courts, Math.floor(activeCount / 4));
  const restPerRound = activeCount - usable * 4;
  if (restPerRound <= 0) return Infinity;
  return Math.ceil(activeCount / restPerRound) - 1;
}

/** Có giữ được cho không ai đánh quá `cap` vòng liên tiếp hay không. */
export function canRespectStreakCap(
  activeCount: number,
  courts: number,
  cap: number,
): boolean {
  return achievableStreakCap(activeCount, courts) <= cap;
}

/**
 * Nói thẳng khi ràng buộc "không đánh liên tục" là bất khả thi.
 *
 * Với 8 người 2 sân thì mọi người buộc phải đánh mọi vòng — im lặng vi phạm rồi
 * để người chơi tự phát hiện sẽ tệ hơn nhiều so với báo trước.
 */
export function feasibilityWarnings(state: EventState): string[] {
  const out: string[] = [];
  const active = state.players.filter((p) => p.status === "active").length;
  const courts = activeCourtsAt(state, firstOpenRound(state)).length;
  const usable = Math.min(courts, Math.floor(active / 4));
  const soft = state.config.softMaxConsecutive;

  if (active === 0) return out;
  if (active < 4) {
    out.push(`Mới có ${active} người — cần ít nhất 4 người mới xếp được trận.`);
    return out;
  }
  if (usable === 0) {
    out.push(`${active} người không đủ cho một trận đôi trên ${courts} sân.`);
    return out;
  }

  const slots = usable * 4;
  const best = achievableStreakCap(active, courts);

  if (!Number.isFinite(best)) {
    out.push(
      `${active} người / ${usable} sân nên mọi người phải đánh mọi vòng — không thể xếp cho ai nghỉ giữa hiệp.`,
    );
  } else if (best > soft) {
    out.push(
      `Với ${active} người / ${usable} sân, chỉ ${active - slots} người được nghỉ mỗi vòng. ` +
        `Không giữ được mức ${soft} vòng liên tiếp; hệ thống sẽ nhắm tới ${best} vòng, là mức tốt nhất có thể.`,
    );
  }

  if (active % 4 !== 0 && slots < active) {
    out.push(
      `Số người lẻ so với sân — mỗi vòng có ${active - slots} người nghỉ, hệ thống sẽ luân phiên cho đều.`,
    );
  }
  return out;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
