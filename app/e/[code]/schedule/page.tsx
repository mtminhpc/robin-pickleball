"use client";

/**
 * Toàn bộ lịch, và chỗ chủ sự kiện dời trận lên xuống.
 *
 * Mỗi vòng là một khối, mỗi trận là một hàng gọn: sân, đội A, tỷ số, đội B. Cả
 * buổi nhìn hết trong một màn hình thay vì phải cuộn qua hàng chục thẻ. Bấm vào
 * hàng là mở đúng hộp nhập tỷ số như ở màn hình chính.
 *
 * Nút "sớm hơn / muộn hơn" nằm ở mức VÒNG chứ không ở mức trận, vì `SwapRounds`
 * vốn đổi cả hai vòng cho nhau. Ở lịch kín sân thì vòng nào cũng đủ người, nên
 * nhét thêm bốn người vào một vòng là có kẻ phải đánh hai trận — đo trên lịch
 * thật thì cách dời riêng một trận hỏng 22 trên 24 lần. Đổi cả vòng thì không ai
 * thêm hay bớt trận nào, không ai đổi bạn đôi, chỉ thứ tự trước sau thay đổi.
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
import type { EventState, Match, PlayerId } from "@/lib/domain/types";
import { validateRoundSwap, type MoveValidation } from "@/lib/scheduler/validate";
import { useEvent } from "@/hooks/useEventState";
import { useMutationQueue } from "@/hooks/useMutationQueue";
import { Avatar } from "@/components/Avatar";
import { pendingScoreFor } from "@/components/MatchCard";
import { ScoreEntryDialog } from "@/components/ScoreEntryDialog";
import { Button, Dialog, Empty, SectionHead } from "@/components/ui";

export default function SchedulePage() {
  const { data } = useEvent();
  const queue = useMutationQueue();

  const [scoring, setScoring] = useState<Match | null>(null);
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
    return (
      <div className="pt-6">
        <Empty>Chưa có lịch. Bắt đầu buổi đánh để hệ thống xếp.</Empty>
      </div>
    );
  }

  return (
    <>
      <div className="grid lg:grid-cols-2 lg:gap-x-10">
        {rounds.map(({ round, matches }) => {
          const canMove =
            isAdmin && round > open && matches.every((m) => m.status === "scheduled");
          return (
            <section key={round} className="mb-2">
              <SectionHead
                n={String(round).padStart(2, "0")}
                aside={
                  round < open ? "đã xong" : round === open ? "đang tới" : "chưa đánh"
                }
              >
                Vòng
              </SectionHead>

              {matches.map((m) => (
                <ScheduleRow
                  key={m.id}
                  match={m}
                  state={state}
                  pending={pendingScoreFor(m.id, queue.queued)}
                  onOpen={role !== "viewer" ? setScoring : undefined}
                />
              ))}

              {canMove && (
                <div className="flex gap-2 pt-3.5">
                  <Button
                    className="min-h-11"
                    disabled={round - 1 <= open - 1}
                    onClick={() => setSwap({ from: round, to: round - 1 })}
                  >
                    Sớm hơn
                  </Button>
                  <Button
                    className="min-h-11"
                    onClick={() => setSwap({ from: round, to: round + 1 })}
                  >
                    Muộn hơn
                  </Button>
                </div>
              )}
            </section>
          );
        })}
      </div>

      <ScoreEntryDialog
        match={scoring}
        state={state}
        open={scoring !== null}
        pendingScore={
          scoring ? pendingScoreFor(scoring.id, queue.queued) : undefined
        }
        onClose={() => setScoring(null)}
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
    </>
  );
}

/** Một trận, dạng hàng gọn. Bấm vào là mở hộp nhập tỷ số nếu được phép. */
function ScheduleRow({
  match,
  state,
  pending,
  onOpen,
}: {
  match: Match;
  state: EventState;
  pending?: { scoreA: number; scoreB: number };
  onOpen?: (m: Match) => void;
}) {
  const shown = pending ?? match.result;
  const dead = match.status === "cancelled" || match.status === "abandoned";
  const clickable = !!onOpen && !dead;

  const body = (
    <>
      <span className="w-4 flex-none font-display text-[11px] font-extrabold text-mute-600">
        {match.court}
      </span>
      <TeamCell ids={match.teamA} state={state} />
      <span
        className={`flex-none font-display text-[15px] font-extrabold tracking-[-0.02em] tabular-nums ${
          pending ? "animate-pulse text-mute-600" : shown ? "text-ink" : "text-mute-400"
        }`}
      >
        {shown ? `${shown.scoreA}–${shown.scoreB}` : "·"}
      </span>
      <TeamCell ids={match.teamB} state={state} align="right" />
    </>
  );

  const cls = `flex w-full items-center gap-3 border-b border-line py-3.5 text-left ${
    dead ? "opacity-50 line-through" : ""
  }`;

  if (!clickable) return <div className={cls}>{body}</div>;
  return (
    <button type="button" onClick={() => onOpen!(match)} className={`${cls} hover:bg-ink/[0.04]`}>
      {body}
    </button>
  );
}

/**
 * Một đôi trong hàng lịch: hai ảnh cỡ nhỏ nhất rồi tới tên.
 *
 * Bốn người trên một hàng ở màn hình điện thoại là chỗ chật nhất trong cả ứng
 * dụng. Ngân sách bề ngang ở máy 375px: 343 còn lại sau lề, trừ 16 cho số sân,
 * 40 cho tỷ số và 36 cho các khoảng cách, còn 125 mỗi đôi. Hai ảnh 20px cộng
 * khoảng cách chiếm 42, để lại khoảng 75px cho chữ — vừa đủ "Linh & Nam", tên
 * dài hơn thì `truncate` cắt bớt như nó vẫn làm từ trước.
 */
function TeamCell({
  ids,
  state,
  align = "left",
}: {
  ids: readonly [PlayerId, PlayerId];
  state: EventState;
  align?: "left" | "right";
}) {
  const players = ids.map((id) => state.players.find((p) => p.id === id) ?? null);
  const label = players.map((p, i) => p?.name ?? ids[i]).join(" & ");

  return (
    <span
      className={`flex min-w-0 flex-1 items-center gap-2 ${
        align === "right" ? "flex-row-reverse" : ""
      }`}
    >
      <span className={`flex flex-none gap-0.5 ${align === "right" ? "flex-row-reverse" : ""}`}>
        {players.map((p, i) => (
          <Avatar
            key={ids[i]}
            name={p?.name ?? ids[i]!}
            avatarId={p?.avatarId}
            userId={p?.userId}
            size="xs"
          />
        ))}
      </span>
      <span className="min-w-0 truncate text-[13px] font-semibold">{label}</span>
    </span>
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
      <p className="eyebrow text-mute-600">Đổi chỗ hai vòng</p>
      <p className="mt-3.5 bg-surface p-3 text-sm">
        Mọi trận của <strong>vòng {swap.from}</strong> sẽ chuyển sang{" "}
        <strong>vòng {swap.to}</strong>, và ngược lại.
      </p>

      <div className="mt-3 space-y-2">
        {validation.notes.map((note, i) => (
          <p
            key={i}
            className={`p-3 text-sm ${
              note.severity === "block"
                ? "bg-accent text-paper"
                : note.severity === "warn"
                  ? "border border-ink"
                  : "bg-surface text-mute-800"
            }`}
          >
            {note.message}
          </p>
        ))}
      </div>

      <div className="mt-4.5 flex gap-2.5">
        <Button className="min-h-[3.25rem] flex-1" onClick={onClose}>
          Quay lại
        </Button>
        <Button
          tone="primary"
          className="min-h-[3.25rem] flex-1"
          disabled={blocked}
          onClick={() =>
            onConfirm({ type: "SwapRounds", roundA: swap.from, roundB: swap.to })
          }
        >
          Đổi chỗ
        </Button>
      </div>
    </Dialog>
  );
}
