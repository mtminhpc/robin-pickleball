"use client";

/**
 * Tổng kết tuần và tháng của câu lạc bộ.
 *
 * Một buổi đánh riêng lẻ chỉ nói được ai thắng tối nay. Trang này trả lời câu hỏi
 * người chơi đều đặn thực sự quan tâm: tháng này mình đi mấy buổi, đánh bao nhiêu
 * trận, phong độ ra sao so với cả nhóm.
 */

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { PeriodRollup, PeriodType } from "@/lib/domain/rollup";
import { Avatar } from "@/components/Avatar";
import { Button, Card, Empty, Tag } from "@/components/ui";

interface SummaryResponse {
  period: PeriodType;
  periods: PeriodRollup[];
  club: { id: string; name: string };
}

export default function ClubSummaryPage() {
  const { id } = useParams<{ id: string }>();
  const [period, setPeriod] = useState<PeriodType>("week");

  const { data, isLoading, error } = useQuery<SummaryResponse>({
    queryKey: ["club-summary", id, period],
    queryFn: async () => {
      const res = await fetch(
        `/api/clubs/${encodeURIComponent(id)}/summary?period=${period}`,
      );
      const body = (await res.json()) as SummaryResponse & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Không tải được tổng kết.");
      return body;
    },
    retry: false,
  });

  return (
    <main className="mx-auto min-h-dvh max-w-md space-y-6 px-4 py-8">
      <header className="space-y-1">
        <Link href={`/c/${id}`} className="text-sm text-mute-600 hover:text-mute-800">
          ← {data?.club.name ?? "Câu lạc bộ"}
        </Link>
        <h1 className="text-2xl font-bold">Tổng kết</h1>
      </header>

      <div className="flex gap-2 rounded-xl bg-surface p-1">
        <PeriodTab active={period === "week"} onClick={() => setPeriod("week")}>
          Theo tuần
        </PeriodTab>
        <PeriodTab active={period === "month"} onClick={() => setPeriod("month")}>
          Theo tháng
        </PeriodTab>
      </div>

      {isLoading && <Empty>Đang tính…</Empty>}
      {error && <Empty>{(error as Error).message}</Empty>}
      {data && data.periods.length === 0 && (
        <Empty>Câu lạc bộ chưa có buổi đánh nào để tổng kết.</Empty>
      )}

      {data?.periods.map((p) => (
        <PeriodCard key={p.periodKey} period={p} />
      ))}
    </main>
  );
}

function PeriodTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-tap flex-1 rounded-lg text-sm font-semibold ${
        active ? "bg-mute-300 text-ink" : "text-mute-700"
      }`}
    >
      {children}
    </button>
  );
}

function PeriodCard({ period }: { period: PeriodRollup }) {
  const [open, setOpen] = useState(false);
  const live = period.events.some((e) => e.live);

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h2 className="font-semibold">{period.label}</h2>
        <span className="text-xs text-mute-600">
          {period.events.length} buổi · {period.totalGames} trận
        </span>
      </div>

      {live && (
        <p className="rounded-xl bg-accent-100 p-2 text-xs text-accent-800">
          Có buổi chưa kết thúc — số liệu còn chạy tiếp.
        </p>
      )}

      <Card className="overflow-hidden">
        <table className="w-full text-sm tabular-nums">
          <thead className="text-xs text-mute-600">
            <tr className="text-left">
              <th className="p-3 font-medium">#</th>
              <th className="p-3 font-medium">Người</th>
              <th className="p-3 text-right font-medium">Buổi</th>
              <th className="p-3 text-right font-medium">Trận</th>
              <th className="p-3 text-right font-medium">TB/trận</th>
            </tr>
          </thead>
          <tbody>
            {period.players.map((p) => (
              <tr key={p.key} className="border-t border-mute-300">
                <td className="p-3 text-mute-600">{p.rank}</td>
                <td className="p-3">
                  <span className="flex items-center gap-2">
                    <Avatar name={p.name} avatarId={p.avatarId} size="sm" />
                    <span className="truncate">{p.name}</span>
                  </span>
                </td>
                <td className="p-3 text-right text-mute-700">{p.events}</td>
                <td className="p-3 text-right text-mute-700">{p.games}</td>
                <td
                  className={`p-3 text-right font-semibold ${
                    p.avgDiff > 0 ? "text-accent-700" : "text-mute-800"
                  }`}
                >
                  {p.avgDiff > 0 ? "+" : ""}
                  {p.avgDiff}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <button
        className="text-sm text-mute-600 hover:text-mute-800"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "▾" : "▸"} Các buổi trong kỳ
      </button>

      {open && (
        <div className="space-y-2">
          {period.events.map((e) => (
            <Link key={e.code} href={`/e/${e.code}/standings`} className="block">
              <Card className="flex items-center justify-between p-3 text-sm">
                <span className="min-w-0 flex-1 truncate">{e.name}</span>
                {e.live && <Tag tone="warn">đang đánh</Tag>}
                <span className="ml-3 shrink-0 text-xs text-mute-600">
                  {e.players} người · {e.games} trận
                </span>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
