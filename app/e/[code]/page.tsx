"use client";

/**
 * Màn hình chính: vòng đang đánh.
 *
 * Đây là màn hình người chơi nhìn nhiều nhất trong buổi, nên nó chỉ trả lời đúng
 * ba câu hỏi và không thêm gì khác: tôi có đang đánh không, ai đang nghỉ, và bao
 * giờ tới lượt tôi.
 */

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { Command } from "@/lib/domain/commands";
import { firstUnplayedRound } from "@/lib/domain/rounds";
import type { Match } from "@/lib/domain/types";
import { useEvent } from "@/hooks/useEventState";
import { useMutationQueue } from "@/hooks/useMutationQueue";
import { MatchCard, pendingScoreFor } from "@/components/MatchCard";
import { ScoreEntryDialog } from "@/components/ScoreEntryDialog";
import { CancelMatchDialog } from "@/components/CancelMatchDialog";
import { PasswordGate } from "@/components/PasswordGate";
import { Avatar } from "@/components/Avatar";
import { Button, Card, Empty } from "@/components/ui";

export default function LivePage() {
  const { code } = useParams<{ code: string }>();
  const { data } = useEvent();
  const queue = useMutationQueue();

  const [scoring, setScoring] = useState<Match | null>(null);
  const [cancelling, setCancelling] = useState<Match | null>(null);

  const view = useMemo(() => {
    if (!data) return null;
    const state = data.state;
    // Vòng đang tới, tính theo "đã đánh chưa". Dùng `firstOpenRound` ở đây là
    // sai: trận bị ghim cũng bị coi là đông cứng, nên chỉ cần chủ sự kiện ghim
    // một trận là màn hình này nhảy cóc qua luôn vòng đó.
    const round = firstUnplayedRound(state);
    const current = state.matches
      .filter((m) => m.round === round && m.status !== "cancelled")
      .sort((a, b) => a.court - b.court);
    const next = state.matches
      .filter((m) => m.round === round + 1 && m.status !== "cancelled")
      .sort((a, b) => a.court - b.court);

    const playing = new Set(current.flatMap((m) => [...m.teamA, ...m.teamB]));
    const resting = state.players.filter(
      (p) => p.status === "active" && !playing.has(p.id),
    );
    return { state, round, current, next, resting };
  }, [data]);

  if (!data || !view) return <Empty>Đang tải…</Empty>;
  const { state } = data;

  if (state.status === "draft") {
    return (
      <Card className="space-y-3 p-5 text-center">
        <p className="text-lg font-semibold">Buổi đánh chưa bắt đầu</p>
        <p className="text-sm text-slate-400">
          {state.players.filter((p) => p.status === "confirmed").length} người đã
          xác nhận. Chủ sự kiện bấm Bắt đầu ở trang Quản lý là hệ thống xếp lịch.
        </p>
        <Link href={`/e/${code}/players`} className="block">
          <Button tone="primary" full>
            Xem danh sách người chơi
          </Button>
        </Link>
      </Card>
    );
  }

  const canEnterScore = data.role !== "viewer";

  return (
    <>
      {!canEnterScore && <PasswordGate code={code} />}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          {state.status === "finished" ? "Trận cuối" : `Vòng ${view.round}`}
        </h2>

        {view.current.length === 0 ? (
          <Empty>
            {state.status === "finished"
              ? "Buổi đánh đã kết thúc. Xem bảng xếp hạng để biết kết quả."
              : "Chưa có trận nào được xếp."}
          </Empty>
        ) : (
          view.current.map((match) => (
            <MatchCard
              key={match.id}
              match={match}
              state={state}
              actor={{ kind: data.role === "admin" ? "admin" : "player", label: "", ref: data.deviceId }}
              canEnterScore={canEnterScore}
              pendingScore={pendingScoreFor(match.id, queue.queued)}
              onEnterScore={setScoring}
              onCancel={data.role === "admin" ? setCancelling : undefined}
            />
          ))
        )}
      </section>

      {view.resting.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Đang nghỉ vòng này
          </h2>
          <div className="flex flex-wrap gap-2">
            {view.resting.map((p) => (
              <span
                key={p.id}
                className="flex items-center gap-2 rounded-full bg-slate-900 py-1 pl-1 pr-3 text-sm"
              >
                <Avatar name={p.name} avatarId={p.avatarId} size="sm" />
                {p.name}
              </span>
            ))}
          </div>
        </section>
      )}

      {view.next.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Vòng sau
          </h2>
          {view.next.map((m) => (
            <NextUpRow key={m.id} match={m} state={state} />
          ))}
          <Link
            href={`/e/${code}/schedule`}
            className="block pt-1 text-center text-sm text-court-100 underline"
          >
            Xem toàn bộ lịch
          </Link>
        </section>
      )}

      <ScoreEntryDialog
        match={scoring}
        state={state}
        open={scoring !== null}
        pendingScore={scoring ? pendingScoreFor(scoring.id, queue.queued) : undefined}
        onClose={() => setScoring(null)}
        onSubmit={(command: Command) => queue.send(command)}
      />
      <CancelMatchDialog
        match={cancelling}
        state={state}
        open={cancelling !== null}
        onClose={() => setCancelling(null)}
        onSubmit={(command: Command) => queue.send(command)}
      />
    </>
  );
}

/** Dòng gọn cho vòng sau: chỉ cần biết mình có tên trong đó hay không. */
function NextUpRow({
  match,
  state,
}: {
  match: Match;
  state: { players: Array<{ id: string; name: string }> };
}) {
  const name = (id: string) =>
    state.players.find((p) => p.id === id)?.name ?? id;
  return (
    <div className="flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-sm">
      <span className="w-12 shrink-0 text-xs text-slate-500">Sân {match.court}</span>
      <span className="flex-1 truncate">
        {name(match.teamA[0])} & {name(match.teamA[1])}
      </span>
      <span className="text-slate-600">vs</span>
      <span className="flex-1 truncate text-right">
        {name(match.teamB[0])} & {name(match.teamB[1])}
      </span>
    </div>
  );
}
