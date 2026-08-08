/**
 * Lịch Whist — lời giải tối ưu có sẵn cho một số cỡ nhóm.
 *
 * Với vài cỡ nhất định, bài toán "chia đôi sao cho ai cũng gặp nhiều người" có
 * lời giải hoàn hảo đã biết từ lâu trong toán tổ hợp: **mỗi người bắt cặp với
 * mỗi người khác đúng một lần, và gặp mỗi người khác đúng hai lần**. Không lịch
 * nào đa dạng hơn thế được nữa.
 *
 * Điều kiện để dùng được: **mọi sân đều kín**, tức số người đúng bằng `4×sân`
 * (ai cũng đánh mọi vòng) hoặc `4×sân + 1` (mỗi vòng đúng một người nghỉ, và
 * suất nghỉ xoay đủ một vòng). Buổi 6 người 1 sân không nằm trong nhóm này —
 * hai người nghỉ mỗi vòng thì đây là bài toán khác, và bộ tìm kiếm vẫn lo.
 *
 * Vì sao đáng làm: đo bằng chính hàm chi phí của ứng dụng, lịch Whist rẻ hơn
 * lịch bộ tìm kiếm tự dò ra, mà `deficit` và `bye` thì **y hệt**. Nói cách khác
 * nó mua thêm đa dạng bạn đôi chứ không đánh đổi công bằng để lấy — nếu có đánh
 * đổi thì đã không dùng.
 *
 * Chỗ này chỉ cho ra một **phương án khởi đầu**. Người quyết định vẫn là hàm chi
 * phí ở `cost.ts`: `plan.ts` chấm điểm cả hai phương án rồi mới chọn. Nhờ vậy khi
 * lịch Whist không hợp hoàn cảnh — có người khai vắng, có trận đã ghim, danh sách
 * vừa đổi làm lệch cách đánh số — nó tự bị loại, không cần luật riêng nào.
 *
 * Tham khảo: Padel-Americano (github.com/ptzimmerman/Padel-Americano) dùng cùng
 * ý này. Bảng dưới đây do `scripts/whist-tables.mjs` sinh ra và được
 * `tests/whist.test.ts` kiểm lại từ đầu, nên không phải tin bảng — kiểm được.
 */

/** Một trận: [A1, A2, B1, B2]. A1 đôi với A2, B1 đôi với B2. */
export type WhistQuad = [number, number, number, number];

/**
 * "Vòng gốc" của các cỡ dựng được theo lối xoay vòng.
 *
 * Cách khai triển: gọi `m` là số vòng (`v-1` nếu `v` chia hết cho 4, ngược lại
 * `v`). Vòng thứ `r` là vòng gốc cộng thêm `r` theo modulo `m`. Với `v` chia hết
 * cho 4, chỉ số `v-1` là "điểm vô cực" — nó đứng yên trong mọi vòng.
 *
 * Bảng chỉ ghi vòng gốc chứ không ghi cả lịch: ngắn hơn mười lần, và cái đáng
 * kiểm là lịch sau khai triển chứ không phải mấy con số này.
 */
const BASE: Readonly<Record<number, readonly WhistQuad[]>> = {
  4: [[0, 1, 2, 3]],
  5: [[1, 4, 2, 3]],
  8: [[0, 1, 2, 4], [3, 6, 5, 7]],
  12: [[0, 1, 2, 5], [3, 7, 8, 10], [4, 9, 6, 11]],
  13: [[1, 4, 2, 7], [3, 12, 6, 8], [5, 11, 9, 10]],
  16: [[0, 1, 2, 6], [3, 13, 4, 10], [5, 8, 12, 15], [7, 14, 9, 11]],
  17: [[1, 7, 2, 3], [4, 8, 12, 15], [5, 10, 11, 13], [6, 14, 9, 16]],
  20: [[0, 1, 2, 4], [3, 17, 9, 12], [5, 19, 11, 15], [6, 13, 10, 18], [7, 16, 8, 14]],
  21: [[1, 2, 3, 6], [4, 13, 12, 19], [5, 18, 8, 14], [7, 17, 10, 15], [9, 11, 16, 20]],
};

/**
 * 9 người phải ghi cả lịch ra.
 *
 * Cỡ này không có lời giải xoay vòng nào — đã dò hết. Lý do: 9 không phải số
 * nguyên tố, nên phép cộng modulo 9 không sinh đủ các hiệu số cần thiết. Lịch
 * dưới đây tìm bằng quay lui từng vòng một, mất khoảng ba giây.
 */
const EXPLICIT: Readonly<Record<number, readonly (readonly WhistQuad[])[]>> = {
  9: [
    [[1, 2, 3, 4], [5, 6, 7, 8]],
    [[0, 5, 2, 6], [3, 7, 4, 8]],
    [[0, 7, 1, 8], [3, 5, 4, 6]],
    [[0, 4, 6, 8], [1, 7, 2, 5]],
    [[0, 3, 5, 7], [1, 6, 2, 8]],
    [[0, 8, 2, 3], [1, 4, 6, 7]],
    [[0, 2, 4, 7], [1, 5, 3, 8]],
    [[0, 6, 1, 3], [2, 4, 5, 8]],
    [[0, 1, 4, 5], [2, 7, 3, 6]],
  ],
};

/** Có lịch Whist cho cỡ nhóm này không. */
export function hasWhistDesign(players: number): boolean {
  return players in BASE || players in EXPLICIT;
}

/** Số vòng của lịch, sau đó nó lặp lại. `0` nghĩa là không có lịch cho cỡ này. */
export function whistPeriod(players: number): number {
  if (players in EXPLICIT) return EXPLICIT[players]!.length;
  if (players in BASE) return players % 4 === 0 ? players - 1 : players;
  return 0;
}

/**
 * Các trận của vòng thứ `round` (đếm từ 0), hoặc `null` nếu cỡ này không có lịch.
 *
 * `round` được lấy modulo chu kỳ, nên buổi đánh dài hơn chu kỳ vẫn gọi được —
 * lúc đó lịch bắt đầu lặp lại, và đó là điều không tránh được: đã bắt cặp hết
 * mọi người thì cặp tiếp theo buộc phải là cặp cũ.
 */
export function whistRound(players: number, round: number): WhistQuad[] | null {
  const period = whistPeriod(players);
  if (period === 0) return null;
  const r = ((round % period) + period) % period;

  const explicit = EXPLICIT[players];
  if (explicit) return explicit[r]!.map((q) => [...q] as WhistQuad);

  const base = BASE[players]!;
  const m = players % 4 === 0 ? players - 1 : players;
  // Chỉ số >= m là điểm vô cực: đứng yên. Còn lại xoay theo modulo m.
  return base.map(
    (q) => q.map((x) => (x >= m ? x : (x + r) % m)) as WhistQuad,
  );
}
