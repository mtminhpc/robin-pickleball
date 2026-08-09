"use client";

/**
 * Bảng xếp hạng và bảng Công bằng.
 *
 * Hai bảng nằm cùng một trang là có chủ ý. Bảng xếp hạng trả lời "ai đánh hay",
 * bảng Công bằng trả lời "hệ thống có chia đều cơ hội không" — và câu thứ hai là
 * câu người ta hỏi khi thấy mình xếp thấp. Để hai bảng cạnh nhau thì câu trả lời
 * có sẵn ngay đó, không cần đi hỏi ai.
 *
 * Bảng Công bằng hiện với MỌI người, không giấu sau quyền chủ sự kiện. Công bằng
 * chỉ đáng tin khi người chơi tự kiểm chứng được.
 *
 * Thứ hạng là hàng chứ không phải thẻ: số hạng cỡ lớn bên trái, tên ở giữa, hiệu
 * số bên phải. Mắt quét dọc theo hai cột số mà không bị khung hộp cắt ngang.
 */

import { useMemo, useState } from "react";
import { standingsFromState, type StandingRow } from "@/lib/domain/standings";
import { fairnessReport } from "@/lib/scheduler/metrics";
import { useEvent } from "@/hooks/useEventState";
import { useMutationQueue } from "@/hooks/useMutationQueue";
import { Button, Empty, Marker, SectionHead } from "@/components/ui";

export default function StandingsPage() {
  const { data } = useEvent();
  const queue = useMutationQueue();
  const [showFairness, setShowFairness] = useState(true);

  const table = useMemo(
    () => (data ? standingsFromState(data.state) : null),
    [data],
  );
  const fair = useMemo(() => (data ? fairnessReport(data.state) : null), [data]);
  // Cột "Ưu tiên" chỉ hiện khi thực sự có người đang được đuổi kịp. Mặc định
  // `catchUpFactor` là 0 nên hầu hết buổi đánh sẽ không bao giờ thấy cột này.
  const hasCatchUp = fair?.players.some((p) => p.catchUp > 0) ?? false;

  if (!data || !table || !fair) return null;
  const { state, role } = data;

  if (table.main.length === 0 && table.provisional.length === 0) {
    return (
      <div className="pt-6">
        <Empty>Chưa có trận nào xong. Bảng xếp hạng sẽ hiện ở đây.</Empty>
      </div>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)] lg:items-start lg:gap-12">
      <div>
        <SectionHead n="01" aside="hiệu số / trận">
          Xếp hạng
        </SectionHead>
        {table.main.map((row) => (
          <StandingRowView key={row.playerId} row={row} />
        ))}

        {table.provisional.length > 0 && (
          <>
            <SectionHead n="02">Chưa đủ số trận</SectionHead>
            <p className="py-2.5 text-[11px] leading-relaxed text-mute-600">
              Cần ít nhất {table.threshold} trận để vào bảng chính. Đánh ít trận
              thì hiệu số trung bình dễ may rủi, nên tách riêng cho công bằng.
            </p>
            {table.provisional.map((row) => (
              <StandingRowView
                key={row.playerId}
                row={row}
                action={
                  role === "admin" && state.status === "running" ? (
                    <Button
                      tone="neutral"
                      className="min-h-10 flex-none px-3"
                      onClick={() =>
                        queue.send({
                          type: "GrantCatchUp",
                          playerId: row.playerId,
                          games: row.gamesNeeded,
                        })
                      }
                      title={`Ưu tiên ${row.name} ở các vòng tới cho tới khi đủ ${row.gamesNeeded} trận`}
                    >
                      Xếp thêm
                    </Button>
                  ) : undefined
                }
              />
            ))}
          </>
        )}
      </div>

      <div>
        <button
          type="button"
          onClick={() => setShowFairness((v) => !v)}
          className="rule-head w-full cursor-pointer text-left"
        >
          <span className="font-display text-[11px] font-extrabold leading-none text-accent">
            {table.provisional.length > 0 ? "03" : "02"}
          </span>
          <span className="eyebrow">Công bằng</span>
          <span aria-hidden className="ml-auto text-mute-600">
            {showFairness ? "▾" : "▸"}
          </span>
        </button>

        {fair.warnings.map((w, i) => (
          <p key={i} className="mt-3 bg-accent-100 p-3 text-xs text-accent-800">
            {w}
          </p>
        ))}

        {showFairness && (
          <div className="pt-3">
            <p className="text-[11px] leading-relaxed text-mute-700">
              Cột <strong className="text-ink">Lệch</strong> mới là thước đo. Số
              trận thô lệch nhau là bình thường khi có người đến muộn hoặc về
              sớm; điều phải gần 0 là chênh lệch so với suất kỳ vọng.
              {hasCatchUp && (
                <>
                  {" "}
                  Cột <strong className="text-ink">Ưu tiên</strong> là số trận
                  người vào giữa chừng còn được xếp trước để đuổi kịp — đó là
                  phần cộng thêm, không phải thiệt thòi.
                </>
              )}
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm tabular-nums">
                <thead>
                  <tr>
                    <Th align="left">Người</Th>
                    <Th>Trận</Th>
                    <Th>Kỳ vọng</Th>
                    <Th>Lệch</Th>
                    {hasCatchUp && <Th>Ưu tiên</Th>}
                    <Th>Nghỉ</Th>
                    <Th>Chuỗi</Th>
                    <Th>Bạn đôi</Th>
                  </tr>
                </thead>
                <tbody>
                  {[...fair.players]
                    .sort((a, b) => b.games - a.games)
                    .map((p) => (
                      <tr key={p.playerId} className="border-b border-line">
                        <td className="max-w-28 truncate py-2 pr-2 font-semibold">
                          {p.name}
                        </td>
                        <Td>{p.games}</Td>
                        <Td mute>{p.expected.toFixed(1)}</Td>
                        <td
                          className={`py-2 pl-2 text-right font-semibold ${
                            Math.abs(p.deficit) > 1 ? "text-accent-700" : "text-ink"
                          }`}
                        >
                          {signed(p.deficit)}
                        </td>
                        {hasCatchUp && (
                          <td className="py-2 pl-2 text-right text-accent-700">
                            {p.catchUp > 0 ? `+${p.catchUp}` : "—"}
                          </td>
                        )}
                        <Td mute>{p.byes}</Td>
                        <Td mute>{p.longestPlayStreak}</Td>
                        <Td mute>
                          {p.distinctPartners}/{p.reachablePeers}
                        </Td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Th({
  children,
  align = "right",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className={`border-b-2 border-line pb-2 pl-2 text-[11px] font-normal uppercase tracking-[0.08em] text-mute-600 ${
        align === "left" ? "pl-0 text-left" : "text-right"
      }`}
    >
      {children}
    </th>
  );
}

function Td({ children, mute }: { children: React.ReactNode; mute?: boolean }) {
  return (
    <td className={`py-2 pl-2 text-right ${mute ? "text-mute-700" : ""}`}>
      {children}
    </td>
  );
}

function StandingRowView({
  row,
  action,
}: {
  row: StandingRow;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-3.5 border-b border-line py-3.5">
      <span className="w-7 flex-none font-display text-xl font-extrabold leading-none tracking-[-0.03em] tabular-nums text-mute-400">
        {row.rank ? String(row.rank).padStart(2, "0") : "—"}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2.5">
          <span
            className={`truncate text-[15px] font-semibold tracking-[-0.01em] ${
              row.hasLeft ? "opacity-60" : ""
            }`}
          >
            {row.name}
          </span>
          {row.hasLeft && <Marker>đã về</Marker>}
          {row.hasPartial && <Marker tone="accent">có trận dở dang</Marker>}
        </div>
        <div className="mt-0.5 text-[11px] text-mute-600">
          {row.games} trận · {row.wins}T {row.losses}B · tổng {signed(row.diff)}
          {row.gamesNeeded > 0 && ` · cần thêm ${row.gamesNeeded} trận`}
        </div>
      </div>
      <span
        className={`flex-none font-display text-[19px] font-extrabold tracking-[-0.03em] tabular-nums ${
          row.avgDiff > 0
            ? "text-accent-700"
            : row.avgDiff < 0
              ? "text-mute-600"
              : "text-ink"
        }`}
      >
        {signed(Math.round(row.avgDiff * 100) / 100)}
      </span>
      {action}
    </div>
  );
}

function signed(x: number): string {
  return x > 0 ? `+${x}` : String(x);
}
