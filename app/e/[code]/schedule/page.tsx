"use client";

/**
 * Toàn bộ lịch, và chỗ chủ sự kiện dời trận lên xuống.
 *
 * Việc dời lịch chạy `validateMove` ngay trên trình duyệt trước khi gửi đi. Hàm
 * đó là hàm thuần và trạng thái đã có sẵn ở đây, nên xem trước hậu quả là tức
 * thì và không tốn lời gọi mạng nào. Người dùng thấy "Nam sẽ phải đánh 3 vòng
 * liên tiếp" TRƯỚC khi quyết định, chứ không phải phát hiện ra sau.
 *
 * Dùng nút lên/xuống chứ không kéo thả: ngón tay trên điện thoại kéo thả rất hay
 * trượt, mà trượt ở đây nghĩa là xáo trộn lịch của cả nhóm.
 */

import { useMemo, useState } from "react";
import type { Command } from "@/lib/domain/commands";
import { firstOpenRound } from "@/lib/domain/rounds";
import type { Match } from "@/lib/domain/types";
import { validateMove, type MoveValidation } from "@/lib/scheduler/validate";
import { useEvent } from "@/hooks/useEventState";
import { useMutationQueue } from "@/hooks/useMutationQueue";
import { MatchCard, pendingScoreFor } from "@/components/MatchCard";
import { ScoreEntryDialog } from "@/components/ScoreEntryDialog";
import { CancelMatchDialog } from "@/components/CancelMatchDialog";
import { Button, Card, Dialog, Empty } from "@/components/ui";

export default function SchedulePage() {
  const { data } = useEvent();
  const queue = useMutationQueue();

  const [scoring, setScoring] = useState<Match | null>(null);
  const [cancelling, setCancelling] = useState<Match | null>(null);
  const [move, setMove] = useState<{ match: Match; toRound: number } | null>(null);

  const rounds = useMemo(() => {
    if (!data) return [];
    const byRound = new Map<number, Match[]>();
    for (const m of data.state.matches) {
      const list = byRound.get(m.round) ?? [];
      list.push(m);
      byRound.set(m.round, list);
    }
    return [...byRound.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([round, matches]) => ({
        round,
        matches: matches.sort((a, b) => a.court - b.court),
      }));
  }, [data]);

  if (!data) return null;
  const { state, role } = data;
  const isAdmin = role === "admin";
  const open = firstOpenRound(state);

  if (rounds.length === 0) {
    return <Empty>Chưa có lịch. Bắt đầu buổi đánh để hệ thống xếp.</Empty>;
  }

  return (
    <div className="space-y-6">
      {rounds.map(({ round, matches }) => (
        <section key={round} className="space-y-2">
          <h2 className="flex items-baseline gap-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
            Vòng {round}
            {round < open && <span className="text-xs normal-case">đã xong</span>}
            {round === open && (
              <span className="text-xs normal-case text-court-100">đang tới</span>
            )}
          </h2>

          {matches.map((match) => (
            <div key={match.id} className="space-y-1">
              <MatchCard
                match={match}
                state={state}
                actor={{
                  kind: isAdmin ? "admin" : "player",
                  label: "",
                  ref: data.deviceId,
                }}
                canEnterScore={role !== "viewer"}
                pendingScore={pendingScoreFor(match.id, queue.queued)}
                onEnterScore={setScoring}
                onCancel={isAdmin ? setCancelling : undefined}
              />
              {isAdmin && match.status === "scheduled" && (
                <div className="flex justify-end gap-1.5 pr-1">
                  <Button
                    tone="ghost"
                    className="px-3 text-sm"
                    disabled={round <= open}
                    onClick={() => setMove({ match, toRound: round - 1 })}
                  >
                    ▲ Sớm hơn
                  </Button>
                  <Button
                    tone="ghost"
                    className="px-3 text-sm"
                    onClick={() => setMove({ match, toRound: round + 1 })}
                  >
                    ▼ Muộn hơn
                  </Button>
                </div>
              )}
            </div>
          ))}
        </section>
      ))}

      <ScoreEntryDialog
        match={scoring}
        state={state}
        open={scoring !== null}
        pendingScore={scoring ? pendingScoreFor(scoring.id, queue.queued) : undefined}
        onClose={() => setScoring(null)}
        onSubmit={(c: Command) => queue.send(c)}
      />
      <CancelMatchDialog
        match={cancelling}
        state={state}
        open={cancelling !== null}
        onClose={() => setCancelling(null)}
        onSubmit={(c: Command) => queue.send(c)}
      />
      <MoveDialog
        move={move}
        onClose={() => setMove(null)}
        onConfirm={(c) => {
          queue.send(c);
          setMove(null);
        }}
      />
    </div>
  );
}

function MoveDialog({
  move,
  onClose,
  onConfirm,
}: {
  move: { match: Match; toRound: number } | null;
  onClose: () => void;
  onConfirm: (command: Command) => void;
}) {
  const { data } = useEvent();

  const validation: MoveValidation | null = useMemo(() => {
    if (!move || !data) return null;
    // Sân trống đầu tiên ở vòng đích. Người dùng chỉ nghĩ theo "sớm hơn / muộn
    // hơn", còn chọn sân là việc của hệ thống.
    const taken = new Set(
      data.state.matches
        .filter((m) => m.round === move.toRound && m.status !== "cancelled")
        .map((m) => m.court),
    );
    let court = 1;
    while (taken.has(court)) court += 1;
    return validateMove(data.state, move.match.id, move.toRound, court, Date.now());
  }, [move, data]);

  if (!move || !validation || !data) return null;

  const court = validation.preview?.matches.find((m) => m.id === move.match.id)?.court ?? 1;
  const blocked = validation.severity === "block";

  return (
    <Dialog open onClose={onClose} title={`Dời sang vòng ${move.toRound}`}>
      <div className="space-y-4">
        <div className="space-y-2">
          {validation.notes.map((note, i) => (
            <p
              key={i}
              className={`rounded-xl p-3 text-sm ${
                note.severity === "block"
                  ? "bg-red-500/15 text-red-200"
                  : note.severity === "warn"
                    ? "bg-amber-500/15 text-amber-200"
                    : "bg-slate-800 text-slate-300"
              }`}
            >
              {note.severity === "block" ? "⛔ " : note.severity === "warn" ? "⚠️ " : "✅ "}
              {note.message}
            </p>
          ))}
        </div>

        {!blocked && (
          <Card className="p-3 text-xs text-slate-400">
            Trận sẽ được <strong className="text-slate-200">ghim</strong> ở vị trí
            mới. Hệ thống sẽ không tự xếp lại nó nữa, kể cả khi có người vào hoặc
            rời cuộc.
          </Card>
        )}

        <div className="flex gap-2">
          <Button tone="ghost" full onClick={onClose}>
            Quay lại
          </Button>
          <Button
            tone="primary"
            full
            disabled={blocked}
            onClick={() =>
              onConfirm({
                type: "ReorderMatch",
                matchId: move.match.id,
                toRound: move.toRound,
                toCourt: court,
              })
            }
          >
            Dời và ghim
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
