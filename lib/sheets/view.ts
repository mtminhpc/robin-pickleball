/**
 * Bản in dễ đọc trong Google Sheet.
 *
 * Người dùng chọn Google Sheet làm kho dữ liệu một phần vì muốn mở ra xem được.
 * Nhưng nhật ký lệnh và ảnh chụp JSON thì không ai đọc nổi, nên mỗi sự kiện có
 * thêm một tab nhìn như bảng Excel bình thường: lịch từng vòng kèm tỷ số, rồi
 * bảng xếp hạng, rồi bảng công bằng.
 *
 * Tab này là kết quả suy ra, không phải dữ liệu. Xoá đi hay sửa tay cũng không
 * ảnh hưởng gì — lần ghi sau nó được vẽ lại từ đầu.
 */

import { standingsFromState } from "../domain/standings";
import type { EventState, Match, PlayerId } from "../domain/types";
import { fairnessReport } from "../scheduler/metrics";

export interface RenderedView {
  rows: string[][];
  width: number;
}

/**
 * Số dòng trống chèn thêm ở cuối.
 *
 * Bản in được ghi đè từ ô A1 xuống. Khi nội dung ngắn lại — người chơi bị xoá,
 * trận bị huỷ — thì phần thừa của lần ghi trước vẫn nằm đó và trông như dữ liệu
 * thật. Đệm sẵn một khoảng trống để nó bị xoá theo.
 */
const TRAILING_BLANKS = 30;

const STATUS_LABEL: Record<Match["status"], string> = {
  scheduled: "chưa đánh",
  playing: "đang đánh",
  submitted: "đã xong",
  cancelled: "đã huỷ",
  abandoned: "bỏ dở",
};

export function renderView(state: EventState): RenderedView {
  const nameOf = new Map(state.players.map((p) => [p.id, p.name] as const));
  const team = (ids: readonly [PlayerId, PlayerId]) =>
    `${nameOf.get(ids[0]) ?? ids[0]} & ${nameOf.get(ids[1]) ?? ids[1]}`;

  const rows: string[][] = [];

  rows.push([state.config.name || "Buổi đánh Pickleball"]);
  rows.push([
    `Mã ${state.code}`,
    statusLabel(state),
    `${state.config.courts} sân`,
    `tới ${state.config.scoring.pointsTo} điểm${state.config.scoring.winBy2 ? ", hơn 2" : ""}`,
    `cập nhật ${formatTime(state.updatedAt)}`,
  ]);
  rows.push([]);

  // -- lịch thi đấu ---------------------------------------------------------
  rows.push(["LỊCH THI ĐẤU"]);
  rows.push(["Vòng", "Sân", "Đội A", "Đội B", "Điểm A", "Điểm B", "Trạng thái", "Ghi chú"]);

  const sorted = [...state.matches].sort(
    (a, b) => a.round - b.round || a.court - b.court,
  );
  for (const m of sorted) {
    rows.push([
      String(m.round),
      String(m.court),
      team(m.teamA),
      team(m.teamB),
      m.result ? String(m.result.scoreA) : "",
      m.result ? String(m.result.scoreB) : "",
      STATUS_LABEL[m.status],
      matchNote(m),
    ]);
  }
  rows.push([]);

  // -- bảng xếp hạng --------------------------------------------------------
  const table = standingsFromState(state);
  rows.push(["BẢNG XẾP HẠNG", `xếp theo hiệu số trung bình mỗi trận`]);
  rows.push(["Hạng", "Người", "Trận", "Thắng", "Thua", "Điểm ghi", "Hiệu số", "TB/trận"]);
  for (const r of table.main) {
    rows.push([
      String(r.rank),
      r.name + (r.hasLeft ? " (đã về)" : ""),
      String(r.games),
      String(r.wins),
      String(r.losses),
      String(r.pointsFor),
      String(r.diff),
      r.avgDiff.toFixed(2),
    ]);
  }

  if (table.provisional.length > 0) {
    rows.push([]);
    rows.push([
      `CHƯA ĐỦ SỐ TRẬN`,
      `cần ít nhất ${table.threshold} trận để vào bảng chính`,
    ]);
    for (const r of table.provisional) {
      rows.push([
        "",
        r.name + (r.hasLeft ? " (đã về)" : ""),
        String(r.games),
        String(r.wins),
        String(r.losses),
        String(r.pointsFor),
        String(r.diff),
        r.avgDiff.toFixed(2),
      ]);
    }
  }
  rows.push([]);

  // -- bảng công bằng -------------------------------------------------------
  const fair = fairnessReport(state);
  rows.push([
    "CÔNG BẰNG",
    "cột Lệch mới là thước đo; số trận thô lệch nhau là bình thường khi có người đến muộn hoặc về sớm",
  ]);
  rows.push([
    "Người",
    "Trận",
    "Kỳ vọng",
    "Lệch",
    "Nghỉ",
    "Chuỗi dài nhất",
    "Bạn đôi",
    "Đối thủ",
  ]);
  for (const p of [...fair.players].sort((a, b) => b.games - a.games)) {
    rows.push([
      p.name,
      String(p.games),
      p.expected.toFixed(1),
      p.deficit.toFixed(2),
      String(p.byes),
      String(p.longestPlayStreak),
      `${p.distinctPartners}/${p.reachablePeers}`,
      `${p.distinctOpponents}/${p.reachablePeers}`,
    ]);
  }

  for (const warning of fair.warnings) {
    rows.push([]);
    rows.push([`Lưu ý: ${warning}`]);
  }

  const width = Math.max(1, ...rows.map((r) => r.length));
  for (let i = 0; i < TRAILING_BLANKS; i++) rows.push([]);

  return {
    rows: rows.map((row) => {
      const padded = [...row];
      while (padded.length < width) padded.push("");
      return padded;
    }),
    width,
  };
}

function statusLabel(state: EventState): string {
  if (state.status === "draft") return "chưa bắt đầu";
  if (state.status === "running") return "đang đánh";
  return state.endedEarly ? "kết thúc sớm" : "đã xong";
}

function matchNote(m: Match): string {
  const parts: string[] = [];
  if (m.cancelReason) parts.push(m.cancelReason);
  if (m.result?.partial) parts.push("tỷ số dở dang");
  else if (m.result?.irregular) parts.push("lệch mốc điểm");
  if (m.pinned) parts.push("đã ghim");
  if (m.edits.some((e) => e.from !== null)) parts.push(`đã sửa ${m.edits.length} lần`);
  return parts.join(" · ");
}

function formatTime(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
}
