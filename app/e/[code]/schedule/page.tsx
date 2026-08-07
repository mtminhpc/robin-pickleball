"use client";

/**
 * Toàn bộ lịch, và chỗ chủ sự kiện dời trận lên xuống.
 *
 * Nút "sớm hơn / muộn hơn" đổi chỗ CẢ HAI VÒNG cho nhau chứ không nhấc riêng một
 * trận sang chỗ khác. Ở lịch kín sân thì vòng nào cũng đủ người, nên nhét thêm
 * bốn người vào một vòng là có kẻ phải đánh hai trận — đo trên lịch thật thì
 * cách dời một trận hỏng 22 trên 24 lần. Đổi cả vòng thì không ai thêm hay bớt
 * trận nào, không ai đổi bạn đôi, chỉ thứ tự trước sau thay đổi.
 *
 * Việc đổi chỗ chạy `validateRoundSwap` ngay trên trình duyệt trước khi gửi đi.
 * Hàm đó là hàm thuần và trạng thái đã có sẵn ở đây, nên xem trước hậu quả là
 * tức thì và không tốn lời gọi mạng nào. Người dùng thấy "Nam sẽ phải đánh 3
 * vòng liên tiếp" TRƯỚC khi quyết định, chứ không phải phát hiện ra sau.
 *
 * Dùng nút lên/xuống chứ không kéo thả: ngón tay trên điện thoại kéo thả rất hay
 * trượt, mà trượt ở đây nghĩa là xáo trộn lịch của cả nhóm.
 */

import { useMemo, useState } from "react";
import type { Command } from "@/lib/domain/commands";
import { firstUnplayedRound } from "@/lib/domain/rounds";
import type { Match } from "@/lib/domain/types";
import { validateRoundSwap, type MoveValidation } from "@/lib/scheduler/validate";
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
  const [swap, setSwap] = useState<{ from: number; to: number } | null>(null);

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
  // Mốc "đã đánh chưa", không phải mốc "thuật toán còn xếp lại được": vòng vừa
  // bị ghim vẫn chưa đánh, dán nhãn "đã xong" cho nó là nói sai với người dùng.
  const open = firstUnplayedRound(state);

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
                    onClick={() => setSwap({ from: round, to: round - 1 })}
                  >
                    ▲ Sớm hơn
                  </Button>
                  <Button
                    tone="ghost"
                    className="px-3 text-sm"
                    onClick={() => setSwap({ from: round, to: round + 1 })}
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
      <SwapDialog
        swap={swap}
        onClose={() => setSwap(null)}
        onConfirm={(c) => {
          queue.send(c);
          setSwap(null);
        }}
      />
    </div>
  );
}

function SwapDialog({
  swap,
  onClose,
  onConfirm,
}: {
  swap: { from: number; to: number } | null;
  onClose: () => void;
  onConfirm: (command: Command) => void;
}) {
  const { data } = useEvent();

  const validation: MoveValidation | null = useMemo(() => {
    if (!swap || !data) return null;
    return validateRoundSwap(data.state, swap.from, swap.to, Date.now());
  }, [swap, data]);

  if (!swap || !validation || !data) return null;

  const blocked = validation.severity === "block";
  const earlier = Math.min(swap.from, swap.to);
  const later = Math.max(swap.from, swap.to);

  return (
    <Dialog open onClose={onClose} title={`Đổi chỗ vòng ${earlier} và vòng ${later}`}>
      <div className="space-y-4">
        <Card className="p-3 text-sm text-slate-300">
          Mọi trận của <strong className="text-slate-100">vòng {swap.from}</strong> sẽ
          chuyển sang <strong className="text-slate-100">vòng {swap.to}</strong>, và
          ngược lại.
        </Card>

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

        <div className="flex gap-2">
          <Button tone="ghost" full onClick={onClose}>
            Quay lại
          </Button>
          <Button
            tone="primary"
            full
            disabled={blocked}
            onClick={() =>
              onConfirm({ type: "SwapRounds", roundA: swap.from, roundB: swap.to })
            }
          >
            Đổi chỗ
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
