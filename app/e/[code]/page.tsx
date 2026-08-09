"use client";

/**
 * Màn hình chính: vòng đang đánh.
 *
 * Đây là màn hình người chơi nhìn nhiều nhất trong buổi, nên nó chỉ trả lời đúng
 * ba câu hỏi và không thêm gì khác: tôi có đang đánh không, ai đang nghỉ, và bao
 * giờ tới lượt tôi. Ba câu đó là ba mục được đánh số 01–03.
 *
 * Trên máy tính, mục 01 chiếm cột rộng bên trái còn 02–03 dồn sang cột hẹp bên
 * phải: việc đang diễn ra đáng nhiều chỗ hơn việc sắp diễn ra.
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
import { Button, Empty, SectionHead } from "@/components/ui";

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
      <>
        <SectionHead n="01">Chưa bắt đầu</SectionHead>
        <p className="pt-4 text-sm text-mute-700">
          {state.players.filter((p) => p.status === "confirmed").length} người đã
          xác nhận. Chủ sự kiện bấm Bắt đầu ở trang Quản lý là hệ thống xếp lịch.
        </p>
        <Link href={`/e/${code}/players`} className="mt-4 block">
          <Button tone="primary" full>
            Xem danh sách người chơi
          </Button>
        </Link>
      </>
    );
  }

  const canEnterScore = data.role !== "viewer";

  return (
    <>
      {!canEnterScore && <PasswordGate code={code} />}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)] lg:items-start lg:gap-12">
        <section>
          <SectionHead n="01" aside={`${state.config.courts} sân`}>
            {state.status === "finished" ? "Trận cuối" : "Đang đánh"}
          </SectionHead>

          {view.current.length === 0 ? (
            <div className="pt-4">
              <Empty>
                {state.status === "finished"
                  ? "Buổi đánh đã kết thúc. Xem bảng xếp hạng để biết kết quả."
                  : "Chưa có trận nào được xếp."}
              </Empty>
            </div>
          ) : (
            view.current.map((match) => (
              <MatchCard
                key={match.id}
                match={match}
                state={state}
                actor={{
                  kind: data.role === "admin" ? "admin" : "player",
                  label: "",
                  ref: data.deviceId,
                }}
                canEnterScore={canEnterScore}
                pendingScore={pendingScoreFor(match.id, queue.queued)}
                onEnterScore={setScoring}
                onCancel={data.role === "admin" ? setCancelling : undefined}
              />
            ))
          )}
        </section>

        <section>
          {view.resting.length > 0 && (
            <>
              <SectionHead n="02">Đang nghỉ</SectionHead>
              <div className="flex flex-wrap border-b border-line pb-4 pt-3.5">
                {view.resting.map((p) => (
                  <span
                    key={p.id}
                    className="mr-3.5 border-r border-line pr-3.5 text-sm font-semibold last:mr-0 last:border-r-0 last:pr-0"
                  >
                    {p.name}
                  </span>
                ))}
              </div>
            </>
          )}

          {view.next.length > 0 && (
            <>
              <SectionHead n="03">Vòng sau</SectionHead>
              {view.next.map((m) => (
                <NextUpRow key={m.id} match={m} state={state} />
              ))}
              <Link href={`/e/${code}/schedule`} className="mt-3 inline-block">
                <Button tone="ghost" className="px-0">
                  Xem toàn bộ lịch →
                </Button>
              </Link>
            </>
          )}
        </section>
      </div>

      <ScoreEntryDialog
        match={scoring}
        state={state}
        open={scoring !== null}
        pendingScore={
          scoring ? pendingScoreFor(scoring.id, queue.queued) : undefined
        }
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
    <div className="flex items-center gap-3 border-b border-line py-3.5 text-[13px]">
      <span className="w-4 flex-none font-display text-[11px] font-extrabold text-mute-600">
        {match.court}
      </span>
      <span className="min-w-0 flex-1 truncate font-semibold">
        {name(match.teamA[0])} & {name(match.teamA[1])}
      </span>
      <span className="text-[10px] tracking-[0.1em] text-mute-600">VS</span>
      <span className="min-w-0 flex-1 truncate text-right font-semibold">
        {name(match.teamB[0])} & {name(match.teamB[1])}
      </span>
    </div>
  );
}
