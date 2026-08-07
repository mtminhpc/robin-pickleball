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
 */

import { useMemo, useState } from "react";
import { standingsFromState, type StandingRow } from "@/lib/domain/standings";
import { fairnessReport } from "@/lib/scheduler/metrics";
import { useEvent } from "@/hooks/useEventState";
import { useMutationQueue } from "@/hooks/useMutationQueue";
import { Avatar } from "@/components/Avatar";
import { Button, Card, Empty, Tag } from "@/components/ui";

export default function StandingsPage() {
  const { data } = useEvent();
  const queue = useMutationQueue();
  const [showFairness, setShowFairness] = useState(false);

  const table = useMemo(
    () => (data ? standingsFromState(data.state) : null),
    [data],
  );
  const fair = useMemo(() => (data ? fairnessReport(data.state) : null), [data]);

  if (!data || !table || !fair) return null;
  const { state, role } = data;
  const avatarOf = (id: string) =>
    state.players.find((p) => p.id === id)?.avatarId;

  if (table.main.length === 0 && table.provisional.length === 0) {
    return <Empty>Chưa có trận nào xong. Bảng xếp hạng sẽ hiện ở đây.</Empty>;
  }

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Xếp hạng
          </h2>
          <span className="text-xs text-slate-500">hiệu số trung bình mỗi trận</span>
        </div>
        {table.main.map((row) => (
          <StandingCard key={row.playerId} row={row} avatarId={avatarOf(row.playerId)} />
        ))}
      </section>

      {table.provisional.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-300">
            Chưa đủ số trận
          </h2>
          <p className="text-xs text-slate-500">
            Cần ít nhất {table.threshold} trận để vào bảng chính. Đánh ít trận thì
            hiệu số trung bình dễ may rủi, nên tách riêng cho công bằng.
          </p>
          {table.provisional.map((row) => (
            <StandingCard
              key={row.playerId}
              row={row}
              avatarId={avatarOf(row.playerId)}
              action={
                role === "admin" && state.status === "running" ? (
                  <Button
                    tone="primary"
                    className="shrink-0 px-3 text-sm"
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
        </section>
      )}

      <section className="space-y-2">
        <button
          type="button"
          onClick={() => setShowFairness((v) => !v)}
          className="flex w-full items-center justify-between text-sm font-semibold uppercase tracking-wide text-slate-400"
        >
          <span>Công bằng</span>
          <span aria-hidden>{showFairness ? "▾" : "▸"}</span>
        </button>

        {fair.warnings.map((w, i) => (
          <p key={i} className="rounded-xl bg-amber-500/10 p-3 text-xs text-amber-200">
            {w}
          </p>
        ))}

        {showFairness && (
          <Card className="overflow-x-auto p-3">
            <p className="mb-3 text-xs text-slate-500">
              Cột <strong className="text-slate-300">Lệch</strong> mới là thước đo.
              Số trận thô lệch nhau là bình thường khi có người đến muộn hoặc về
              sớm; điều phải gần 0 là chênh lệch so với suất kỳ vọng.
            </p>
            <table className="w-full text-sm tabular-nums">
              <thead className="text-xs text-slate-500">
                <tr className="text-left">
                  <th className="pb-2 pr-3 font-medium">Người</th>
                  <th className="pb-2 pr-3 text-right font-medium">Trận</th>
                  <th className="pb-2 pr-3 text-right font-medium">Kỳ vọng</th>
                  <th className="pb-2 pr-3 text-right font-medium">Lệch</th>
                  <th className="pb-2 pr-3 text-right font-medium">Nghỉ</th>
                  <th className="pb-2 pr-3 text-right font-medium">Chuỗi</th>
                  <th className="pb-2 text-right font-medium">Bạn đôi</th>
                </tr>
              </thead>
              <tbody>
                {[...fair.players]
                  .sort((a, b) => b.games - a.games)
                  .map((p) => (
                    <tr key={p.playerId} className="border-t border-slate-800">
                      <td className="max-w-28 truncate py-2 pr-3">{p.name}</td>
                      <td className="py-2 pr-3 text-right">{p.games}</td>
                      <td className="py-2 pr-3 text-right text-slate-400">
                        {p.expected.toFixed(1)}
                      </td>
                      <td
                        className={`py-2 pr-3 text-right font-semibold ${
                          Math.abs(p.deficit) > 1 ? "text-amber-300" : "text-slate-300"
                        }`}
                      >
                        {signed(p.deficit)}
                      </td>
                      <td className="py-2 pr-3 text-right text-slate-400">{p.byes}</td>
                      <td className="py-2 pr-3 text-right text-slate-400">
                        {p.longestPlayStreak}
                      </td>
                      <td className="py-2 text-right text-slate-400">
                        {p.distinctPartners}/{p.reachablePeers}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </Card>
        )}
      </section>
    </div>
  );
}

function StandingCard({
  row,
  avatarId,
  action,
}: {
  row: StandingRow;
  avatarId?: string;
  action?: React.ReactNode;
}) {
  return (
    <Card className="flex items-center gap-3 p-3">
      <span className="w-6 shrink-0 text-center text-lg font-bold tabular-nums text-slate-500">
        {row.rank || "–"}
      </span>
      <Avatar name={row.name} avatarId={avatarId} dimmed={row.hasLeft} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{row.name}</span>
          {row.hasLeft && <Tag>đã về</Tag>}
          {row.hasPartial && <Tag tone="warn">có trận dở dang</Tag>}
        </div>
        <div className="text-xs text-slate-500">
          {row.games} trận · {row.wins}T {row.losses}B · tổng {signed(row.diff)}
          {row.gamesNeeded > 0 && ` · cần thêm ${row.gamesNeeded} trận`}
        </div>
      </div>
      <span
        className={`shrink-0 text-lg font-bold tabular-nums ${
          row.avgDiff > 0 ? "text-court-100" : row.avgDiff < 0 ? "text-red-300" : ""
        }`}
      >
        {signed(Math.round(row.avgDiff * 100) / 100)}
      </span>
      {action}
    </Card>
  );
}

function signed(x: number): string {
  return x > 0 ? `+${x}` : String(x);
}
