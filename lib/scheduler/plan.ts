/**
 * Điều phối việc xếp lịch: từ trạng thái sự kiện ra một lệnh `SetSchedule`.
 *
 * Có hai chế độ, khác nhau ở mức độ xáo trộn cho phép:
 *
 *   • `extend`  — giữ nguyên mọi trận đã xếp, chỉ sinh thêm các vòng còn thiếu ở
 *                 cuối cửa sổ. Dùng khi vừa đánh xong một vòng. Người chơi nhìn
 *                 lịch phía trước thấy y nguyên như lúc nãy, nên tin được nó.
 *
 *   • `rebuild` — xếp lại toàn bộ phần chưa đánh, nhưng khởi động từ chính lịch
 *                 hiện có (khởi động ấm) nên kết quả vẫn gần với lịch cũ. Dùng khi
 *                 có người vào hoặc rời cuộc, lúc đó xáo trộn là bắt buộc.
 *
 * Trận đang đánh và trận bị admin ghim luôn bất biến ở cả hai chế độ.
 */

import type { MatchSeed } from "../domain/commands";
import { firstOpenRound } from "../domain/rounds";
import { isAvailableAt, wasPresentAt, type EventState, type Match, type PlayerId } from "../domain/types";
import { DEFAULT_WEIGHTS, type CostContext, type Plan, type Slot, type Weights } from "./cost";
import { generate } from "./generate";
import { achievableStreakCap, buildHistory, type History } from "./metrics";
import { optimize, type OptimizeResult } from "./optimize";
import { makeRng, seedFrom } from "./rng";
import { hasWhistDesign, whistRound } from "./whist";

export type PlanMode = "extend" | "rebuild";

export interface PlanOptions {
  mode?: PlanMode;
  /** Ghi đè số vòng cần có phía trước; mặc định lấy `lookaheadRounds`. */
  lookahead?: number;
  weights?: Partial<Weights>;
  iterations?: number;
  timeBudgetMs?: number;
  /** Hạt giống; mặc định suy từ mã sự kiện và số thứ tự lệnh. */
  seed?: number;
}

export interface PlanOutcome {
  fromRound: number;
  matches: MatchSeed[];
  /** Không xếp được vòng nào (thiếu người) — nêu lý do cho người dùng. */
  blocked: string | null;
  optimization: OptimizeResult | null;
  /** Có phương án nào buộc phải vượt trần số vòng liên tiếp không. */
  hardViolations: number;
}

export function planSchedule(
  state: EventState,
  options: PlanOptions = {},
): PlanOutcome {
  const mode = options.mode ?? "extend";
  const fromRound = firstOpenRound(state);
  const activeIds = state.players.filter((p) => p.status === "active").map((p) => p.id);

  if (activeIds.length < 4) {
    return {
      fromRound,
      matches: [],
      blocked: `Mới có ${activeIds.length} người đang chơi — cần ít nhất 4 người.`,
      optimization: null,
      hardViolations: 0,
    };
  }

  const courts = Math.max(1, state.config.courts);
  const usableCourts = Math.min(courts, Math.floor(activeIds.length / 4));
  if (usableCourts < 1) {
    return {
      fromRound,
      matches: [],
      blocked: `${activeIds.length} người không đủ cho một trận đôi.`,
      optimization: null,
      hardViolations: 0,
    };
  }

  const lookahead = Math.max(1, options.lookahead ?? state.config.lookaheadRounds);
  const history = buildHistory(state, activeIds);
  const index = history.index;

  // Các trận trong cửa sổ, chia theo mức độ được phép xê dịch.
  const horizonRounds: number[] = [];
  for (let r = fromRound; r < fromRound + lookahead; r++) horizonRounds.push(r);

  const existing = state.matches.filter((m) => m.round >= fromRound);

  const frozenByRound = new Map<number, Slot[]>();
  const warmByRound = new Map<number, Slot[]>();
  /**
   * Trận mà `reduce` sẽ tự giữ lại khi áp lệnh `SetSchedule` (đang đánh hoặc bị
   * ghim). Không được phát lại chúng trong lệnh, nếu không sẽ có hai bản.
   */
  const keptByReduce = new Set<string>();
  /** Sân bị trận đã đánh chiếm mà không dựng được `Slot`. Xem `blockedByRound`. */
  const blockedByRound = new Map<number, { courts: Set<number>; busy: Set<number> }>();
  /**
   * Vòng (theo vị trí trong cửa sổ) đã có trận không thể dời đi đâu được.
   *
   * Gộp cả ba nguồn: trận đông cứng, trận chiếm sân mà không dựng được `Slot`,
   * và trận `reduce` tự giữ lại. Nguồn thứ ba là nguồn dễ quên nhất — ở chế độ
   * `rebuild`, một trận đã đánh xong KHÔNG bị đánh dấu đông cứng, nhưng `reduce`
   * vẫn giữ nó. Chỉ dùng những vòng ngoài tập này thì mới chắc không đặt hai
   * trận lên cùng một sân.
   */
  const roundsToKeep = new Set<number>();

  const byId = new Map(state.players.map((p) => [p.id, p] as const));
  /** Trận này có xếp ai vào vòng họ đã báo trước là không có mặt không. */
  const viPhamKhaiBao = (m: Match): boolean =>
    [...m.teamA, ...m.teamB].some((id) => {
      const p = byId.get(id);
      return p ? !isAvailableAt(p, m.round) : false;
    });

  for (const m of existing) {
    const offsetOf = m.round - fromRound;

    // Huỷ trận nghĩa là ô sân/vòng đó không còn dùng được; bỏ dở nghĩa là sân
    // và bốn người đã thực sự bận ở ô đó. Cả hai đều được `reduce` giữ lại như
    // một phần của nhật ký. Nếu đưa chúng qua đường xếp lịch bình thường thì bộ
    // sinh sẽ lấp ngay đúng ô vừa huỷ/bỏ dở, tạo cảm giác nút Huỷ không có tác
    // dụng (và với trận bỏ dở còn có thể xếp một người hai trận cùng vòng).
    if (
      (m.status === "cancelled" || m.status === "abandoned") &&
      offsetOf >= 0 &&
      offsetOf < lookahead
    ) {
      const entry = blockedByRound.get(offsetOf) ?? {
        courts: new Set<number>(),
        busy: new Set<number>(),
      };
      entry.courts.add(m.court);
      if (m.status === "abandoned") {
        for (const id of [...m.teamA, ...m.teamB]) {
          const i = index.get(id);
          if (i !== undefined) entry.busy.add(i);
        }
      }
      blockedByRound.set(offsetOf, entry);
      keptByReduce.add(m.id);
      roundsToKeep.add(offsetOf);
      continue;
    }

    const slot = toSlot(m, index);

    if (!slot) {
      // Trận nhắc tới người không còn được xếp lịch.
      //
      // Nếu nó CHƯA đánh thì bỏ qua là đúng: người kia đã về, trận đó sẽ được
      // xếp lại. Nhưng nếu nó ĐÃ đánh (hoặc đang đánh, hoặc bị ghim) thì bỏ qua
      // là mất dấu một cái sân đang bị chiếm — và bước sinh sẽ đặt chồng thêm
      // một trận nữa lên đúng sân ấy, gọi ba người ra hai trận cùng một lúc.
      const daDienRa = m.status !== "scheduled" || m.pinned;
      if (daDienRa && offsetOf >= 0 && offsetOf < lookahead) {
        const entry = blockedByRound.get(offsetOf) ?? {
          courts: new Set<number>(),
          busy: new Set<number>(),
        };
        entry.courts.add(m.court);
        for (const id of [...m.teamA, ...m.teamB]) {
          const i = index.get(id);
          if (i !== undefined) entry.busy.add(i);
        }
        blockedByRound.set(offsetOf, entry);
        keptByReduce.add(m.id);
        roundsToKeep.add(offsetOf);
      }
      continue;
    }

    const offset = offsetOf;
    if (offset < 0 || offset >= lookahead) continue;

    if (m.status !== "scheduled" || m.pinned) {
      keptByReduce.add(m.id);
      roundsToKeep.add(offset);
    }

    // Ở chế độ `extend`, chỉ mấy vòng sát nút mới bị đông cứng. Nếu đông cứng tất
    // thì mỗi lần chỉ còn đúng một vòng mới để tối ưu, và thuật toán mất hẳn khả
    // năng nhìn xa — đúng lúc cần nhất là khi số người vừa khít số chỗ trên sân.
    const committed = m.round < fromRound + state.config.commitRounds;
    const immovable =
      m.status !== "scheduled" ||
      m.pinned ||
      (mode === "extend" && committed);

    // Lịch cũ vi phạm lời khai trước thì VỨT đi thay vì mang vào khởi động ấm.
    //
    // Khởi động ấm đưa lịch cũ vào làm phương án ban đầu và bước sinh coi những
    // chỗ đó là đã kín, nên nó không dựng lại. Phần tinh chỉnh sau đó vẫn gỡ
    // được, nhưng đó là trông chờ vào may rủi của luyện kim mô phỏng để thoả một
    // ràng buộc cứng — đo được: còn sót 2 trên 4 vòng. Bỏ hẳn trận vi phạm ra
    // thì bước sinh xếp lại vòng đó từ đầu, và nó vốn đã lọc theo lời khai.
    if (!immovable && viPhamKhaiBao(m)) continue;

    if (immovable) roundsToKeep.add(offset);

    const bucket = immovable ? frozenByRound : warmByRound;
    const list = bucket.get(offset) ?? [];
    list.push({ ...slot, frozen: immovable });
    bucket.set(offset, list);
  }

  // Nới ngưỡng tới mức khả thi thay vì hạ trọng số.
  //
  // Đòi hỏi một điều không thể rồi phạt thật nặng sẽ khiến tổng chi phí chỉ phản
  // ánh thứ không sửa được, và mọi mục tiêu còn lại chìm nghỉm. Đặt đúng ngưỡng
  // đạt được thì hình phạt lại có nghĩa: với 20 người trên 4 sân, "đừng quá 3
  // vòng" là bất khả thi nhưng "đừng quá 4 vòng" thì làm được, và ép đúng mức 4
  // tốt hơn nhiều so với buông cho tới 8.
  const best = achievableStreakCap(activeIds.length, courts);
  const weights = { ...DEFAULT_WEIGHTS, ...options.weights };
  if (!Number.isFinite(best)) {
    // Không ai nghỉ được thì hai hình phạt này chỉ còn là nhiễu.
    weights.softStreak = 0;
    weights.hardStreak = 0;
    weights.restStreak = 0;
  }

  // Bảng "ai không có mặt ở vòng nào", theo lời khai trước của từng người.
  // Chỉ dựng khi thật sự có người khai — phần lớn buổi thì không ai khai gì, và
  // khi đó cả bước này lẫn khoản phạt trong hàm chi phí đều được bỏ qua.
  const coKhaiBao = activeIds.some((id) => byId.get(id)?.available);
  let unavailable: Uint8Array | undefined;
  if (coKhaiBao) {
    unavailable = new Uint8Array(activeIds.length * lookahead);
    activeIds.forEach((id, i) => {
      const p = byId.get(id);
      if (!p) return;
      for (let r = 0; r < lookahead; r++) {
        if (!isAvailableAt(p, fromRound + r)) unavailable![i * lookahead + r] = 1;
      }
    });
  }

  const ctx: CostContext = {
    history,
    weights,
    softMax: Math.max(state.config.softMaxConsecutive, Number.isFinite(best) ? best : 0),
    hardMax: Math.max(state.config.hardMaxConsecutive, Number.isFinite(best) ? best : 0),
    unavailable,
    blockedBusy: blockedBusyMatrix(blockedByRound, activeIds.length, lookahead),
    lookahead,
  };

  const seed = options.seed ?? seedFrom(`${state.code}:${state.seq}:${mode}`);
  const rng = makeRng(seed);

  // `rebuild` được gọi đúng lúc hoàn cảnh đã đổi (người vào/rời, khai lịch...).
  // Mang toàn bộ lịch cũ vào làm điểm xuất phát khi đó dễ giữ nguyên món nợ của
  // cấu hình trước: đo được ở ca 10 → 9 → 10 người, một người bị giữ tới 11 trận
  // trong khi hai người khác chỉ có 9. Dựng mới phần chưa chốt từ lịch sử thật;
  // các trận đã đánh/đang đánh/ghim vẫn nằm trong `frozenByRound` và không đổi.
  const initialByRound =
    mode === "rebuild"
      ? frozenByRound
      : mergeWarmStart(frozenByRound, warmByRound, lookahead);

  const seeded = generate({
    history,
    courts,
    rounds: lookahead,
    softMax: ctx.softMax,
    hardMax: ctx.hardMax,
    frozenByRound: initialByRound,
    blockedByRound,
    unavailable,
    rng,
  });

  // Khởi động ấm: các trận lấy từ lịch cũ được đưa vào phương án ban đầu nhưng
  // KHÔNG bị đông cứng, nên thuật toán sửa được nếu cần mà vẫn bám sát lịch cũ.
  const start =
    mode === "rebuild" ? seeded : unfreezeWarmStart(seeded, warmByRound);

  /**
   * Cả nhóm có mặt từ vòng đầu, và không ai đang bị thiệt hay được ưu tiên.
   *
   * Thiết kế Whist chia đều cho một nhóm CỐ ĐỊNH: ai cũng đánh mọi vòng, hoặc
   * suất nghỉ xoay đúng một lượt cho mỗi người. Nó không biết gì về khoản nợ của
   * người vào giữa chừng — mà `credit` sinh ra chính là để trả khoản nợ đó.
   *
   * Các trận Whist bị đông cứng nên bộ tìm kiếm không còn đường bù. Buổi nào có
   * người tới trễ là phải trả quyền lại cho nó ngay, vì trả nợ cho người vào
   * giữa chừng là việc chỉ nó làm được.
   *
   * Nói thẳng: **chưa bài kiểm thử nào chạm tới được lớp chặn này** — xoá nó đi
   * thì cả 342 bài vẫn xanh. Lý do là `followingDesign` gần như luôn chặn trước:
   * hễ danh sách người chơi đổi thì cách đánh số đổi theo, và những trận đã đánh
   * lập tức không khớp thiết kế nữa. Giữ lại vì hai lẽ: nó rẻ, và thứ nó canh —
   * người tới trễ không bao giờ được trả nợ — là loại lỗi im lặng, người dùng
   * chỉ phát hiện sau khi đã chịu thiệt cả buổi. Đừng xoá vì thấy nó "thừa".
   */
  function nhomCoDinhTuDau(): boolean {
    for (let i = 0; i < history.n; i++) {
      if (history.credit[i] !== 0) return false;
    }
    return activeIds.every((id) => {
      const p = byId.get(id);
      return p ? wasPresentAt(p, 1) : false;
    });
  }

  /**
   * Mọi trận không sửa được nữa có khớp với lịch Whist không.
   *
   * Chỉ so cặp đôi chứ không so sân hay bên nào là đội A: thiết kế Whist không
   * nói gì về hai thứ đó, mà lời hứa "bắt cặp mỗi người đúng một lần" thì nằm
   * trọn ở cặp đôi.
   *
   * Trận nhắc tới người không còn trong danh sách xếp lịch cũng bị coi là lệch —
   * lúc ấy cách đánh số người chơi đã đổi và cả thiết kế mất nghĩa.
   */
  function followingDesign(people: number): boolean {
    for (const m of state.matches) {
      // Lịch Whist tiến theo từng vòng đủ trận. Một vòng bị huỷ/bỏ dở làm nhịp
      // đó đứt; tiếp tục lấy số vòng tuyệt đối làm pha xoay sẽ cho cùng một số
      // người nghỉ quá nhiều (đo được ở 5 người: 11 trận so với người khác 9).
      // Từ đây trả lại quyền cho bộ tối ưu dựa trên lịch sử thực đã diễn ra.
      if (m.status === "cancelled" || m.status === "abandoned") return false;
      // Trận sắp được xếp lại thì không cần khớp — nó chưa xảy ra. Chỉ những
      // trận sẽ còn nguyên sau lệnh này mới quyết định thiết kế còn sống hay không.
      const seRoiDi =
        m.round >= fromRound &&
        m.round < fromRound + lookahead &&
        !roundsToKeep.has(m.round - fromRound);
      if (seRoiDi) continue;

      const quads = whistRound(people, m.round - 1);
      if (!quads) return false;
      const pairs = new Set(
        quads.flatMap((q) => [
          [q[0], q[1]].sort((a, b) => a - b).join(","),
          [q[2], q[3]].sort((a, b) => a - b).join(","),
        ]),
      );
      for (const team of [m.teamA, m.teamB]) {
        const a = index.get(team[0]);
        const b = index.get(team[1]);
        if (a === undefined || b === undefined) return false;
        if (!pairs.has([a, b].sort((x, y) => x - y).join(","))) return false;
      }
    }
    return true;
  }

  /**
   * Dựng phương án từ lịch Whist, hoặc `null` nếu hoàn cảnh không cho phép.
   *
   * Năm điều kiện, và điều nào hụt thì bỏ hẳn lịch Whist chứ không dùng một nửa:
   *
   *   • **Số sân phải đủ kín** — thiết kế xếp đúng `⌊người/4⌋` trận mỗi vòng, ít
   *     sân hơn thì không đặt hết, mà cắt bớt là hỏng cả thiết kế.
   *   • **Không ai khai vắng mặt** — thiết kế cố định ai đánh vòng nào, không
   *     chừa chỗ cho lời khai. Có người khai thì trả quyền lại cho bộ tìm kiếm,
   *     vì lời khai là ràng buộc cứng còn đa dạng bạn đôi chỉ là mong muốn.
   *   • **Cả nhóm có mặt từ vòng đầu và không ai đang mang nợ** — xem
   *     `nhomCoDinhTuDau`.
   *   • **Buổi đánh từ đầu tới giờ vẫn đang đi đúng thiết kế** — xem
   *     `followingDesign`.
   *   • **Vòng nào nằm trong `roundsToKeep` thì để nguyên vòng đó** — ở đó có
   *     trận `reduce` sẽ giữ lại dù lệnh mới không nhắc tới, nên đặt trận khác
   *     lên đúng cái sân ấy là thành hai trận cùng chỗ và ba người bị gọi ra hai
   *     trận cùng lúc.
   *
   * Các trận sinh ra ở đây được đánh dấu **đông cứng**, tức bước tinh chỉnh không
   * được đụng vào. Đó là chỗ khác biệt so với mọi phương án khởi đầu khác, và nó
   * cố ý:
   *
   * Hàm chi phí chỉ nhìn được `lookaheadRounds` vòng phía trước, còn lịch Whist
   * tối ưu trên trọn chu kỳ 11 hay 15 vòng. Cắt sáu vòng đầu của thiết kế ra so
   * riêng thì nó THUA — bộ tìm kiếm trải đối thủ đều hơn trong sáu vòng ấy, đúng
   * trong cửa sổ và sai cho cả buổi. Đo được: để hai bên thi nhau bằng chi phí
   * thì 12 và 16 người không bao giờ dùng tới thiết kế, kể cả vòng đầu.
   *
   * Ghi đè hàm chi phí là chuyện lớn, nên nói rõ vì sao ở đây là đúng: trong
   * phạm vi các điều kiện trên, thiết kế Whist **không đánh đổi công bằng để lấy
   * đa dạng**. Ai cũng đánh mọi vòng (hoặc nghỉ đúng một lần mỗi chu kỳ), nên
   * `deficit` và `bye` bằng đúng phương án tốt nhất bộ tìm kiếm dò ra — đã đo,
   * bằng nhau tới từng đơn vị. Cái nó đổi được là chuỗi vòng đánh liên tiếp đạt
   * đúng mức `achievableStreakCap`, tức mức tốt nhất có thể.
   */
  function whistStart(base: Plan): Plan | null {
    const people = activeIds.length;
    if (!hasWhistDesign(people)) return null;
    if (Math.floor(people / 4) > courts) return null;
    if (unavailable) return null;
    if (!nhomCoDinhTuDau()) return null;
    if (!followingDesign(people)) return null;

    let used = false;
    const plan: Plan = [];
    for (let offset = 0; offset < lookahead; offset++) {
      if (roundsToKeep.has(offset)) {
        plan.push(base[offset] ?? []);
        continue;
      }
      // Vòng đánh đếm từ 1, lịch Whist đếm từ 0.
      const quads = whistRound(people, fromRound + offset - 1);
      if (!quads) return null;
      used = true;
      plan.push(
        quads.map((quad, i) => ({
          // Xoay sân theo vòng: thiết kế Whist không nói gì về sân, mà đặt cố
          // định thì có người mắc kẹt ở một sân suốt buổi.
          court: ((i + offset) % quads.length) + 1,
          quad,
          frozen: true,
        })),
      );
    }
    return used ? plan : null;
  }

  // Cỡ nhóm nào có lời giải Whist sẵn thì dùng nó, còn lại để bộ tìm kiếm lo.
  const chosen = whistStart(start) ?? start;

  const result = optimize(chosen, {
    ctx,
    rng,
    iterations: options.iterations,
    timeBudgetMs: options.timeBudgetMs,
  });

  const matches = toSeeds(result.plan, history, fromRound, state.seq, keptByReduce);

  return {
    fromRound,
    matches,
    blocked: null,
    optimization: result,
    hardViolations: result.hardViolations,
  };
}


// ---------------------------------------------------------------------------

/** Dẹt hoá người đã bận ngoài `Plan` để mọi phép đổi của bộ tối ưu cùng tôn trọng. */
function blockedBusyMatrix(
  blocked: Map<number, { courts: Set<number>; busy: Set<number> }>,
  players: number,
  lookahead: number,
): Uint8Array | undefined {
  if (![...blocked.values()].some((entry) => entry.busy.size > 0)) return undefined;
  const out = new Uint8Array(players * lookahead);
  for (const [round, entry] of blocked) {
    for (const player of entry.busy) out[player * lookahead + round] = 1;
  }
  return out;
}

function toSlot(m: Match, index: Map<PlayerId, number>): Slot | null {
  const quad = [m.teamA[0], m.teamA[1], m.teamB[0], m.teamB[1]].map((id) =>
    index.get(id),
  );
  if (quad.some((q) => q === undefined)) return null;
  return {
    court: m.court,
    quad: quad as [number, number, number, number],
    frozen: false,
    sourceId: m.id,
  };
}

/**
 * Gộp trận đông cứng và trận khởi động ấm để bước sinh biết chỗ nào đã có người.
 * Cả hai đều được đánh dấu đông cứng ở bước này, rồi `unfreezeWarmStart` mở khoá
 * lại nhóm thứ hai — nhờ vậy bước sinh không xếp trùng chỗ.
 */
function mergeWarmStart(
  frozen: Map<number, Slot[]>,
  warm: Map<number, Slot[]>,
  lookahead: number,
): Map<number, Slot[]> {
  const merged = new Map<number, Slot[]>();
  for (let r = 0; r < lookahead; r++) {
    const list = [...(frozen.get(r) ?? []), ...(warm.get(r) ?? [])];
    if (list.length > 0) merged.set(r, list.map((s) => ({ ...s, frozen: true })));
  }
  return merged;
}

/** Mở khoá lại các trận chỉ dùng để khởi động ấm. */
function unfreezeWarmStart(plan: Plan, warm: Map<number, Slot[]>): Plan {
  const warmIds = new Set<string>();
  for (const list of warm.values()) {
    for (const s of list) if (s.sourceId) warmIds.add(s.sourceId);
  }
  return plan.map((round) =>
    round.map((s) =>
      s.sourceId && warmIds.has(s.sourceId) ? { ...s, frozen: false } : s,
    ),
  );
}

/**
 * Đổi phương án về dạng lệnh.
 *
 * Trận giữ nguyên vị trí thì giữ nguyên id để giao diện không nhấp nháy và để
 * trận đã ghim không bị mất dấu. Trận mới nhận id có kèm số thứ tự lệnh, nên
 * không bao giờ đụng id của một trận cũ đã bị dời đi chỗ khác.
 */
function toSeeds(
  plan: Plan,
  history: History,
  fromRound: number,
  seq: number,
  keptByReduce: Set<string>,
): MatchSeed[] {
  const out: MatchSeed[] = [];
  plan.forEach((round, offset) => {
    const roundNo = fromRound + offset;
    for (const slot of round) {
      if (slot.sourceId && keptByReduce.has(slot.sourceId)) continue;
      const [a0, a1, b0, b1] = slot.quad;
      out.push({
        id: slot.sourceId ?? `m${seq}-${roundNo}-${slot.court}`,
        round: roundNo,
        court: slot.court,
        teamA: [history.ids[a0] as PlayerId, history.ids[a1] as PlayerId],
        teamB: [history.ids[b0] as PlayerId, history.ids[b1] as PlayerId],
      });
    }
  });
  return out.sort((a, b) => a.round - b.round || a.court - b.court);
}
