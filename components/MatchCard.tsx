"use client";

/**
 * Thẻ một trận đấu.
 *
 * Hai chi tiết ở đây phục vụ trực tiếp nỗi lo "tưởng đã lưu mà chưa lưu":
 *
 *   • Tỷ số đang chờ gửi hiện MỜ kèm chấm nhấp nháy, trông khác hẳn tỷ số đã
 *     lưu. Chỉ nhìn thẻ trận là biết cái nào chắc chắn, không phải nhớ mình vừa
 *     bấm gì.
 *   • Mọi lần sửa hiện công khai ngay trên thẻ: ai sửa, lúc mấy giờ, từ bao
 *     nhiêu thành bao nhiêu. Minh bạch quan trọng hơn gọn gàng khi có tranh cãi.
 */

import type { Command } from "@/lib/domain/commands";
import { canEditResult } from "@/lib/domain/rules";
import type { Actor, EventState, Match, PlayerId } from "@/lib/domain/types";
import { Avatar } from "@/components/Avatar";
import { Button, Tag } from "@/components/ui";

export function MatchCard({
  match,
  state,
  actor,
  canEnterScore,
  pendingScore,
  onEnterScore,
  onCancel,
}: {
  match: Match;
  state: EventState;
  actor: Actor;
  canEnterScore: boolean;
  /** Tỷ số đang nằm trong hàng đợi, chưa được máy chủ xác nhận. */
  pendingScore?: { scoreA: number; scoreB: number };
  onEnterScore: (match: Match) => void;
  onCancel?: (match: Match) => void;
}) {
  const player = (id: PlayerId) => state.players.find((p) => p.id === id);
  const result = match.result;
  const shown = pendingScore ?? result;
  const editable =
    canEnterScore && result
      ? canEditResult(match, actor, Date.now(), state.config)
      : { allowed: canEnterScore, reason: null };

  const dead = match.status === "cancelled" || match.status === "abandoned";

  return (
    <div
      className={`rounded-2xl border p-4 ${
        dead
          ? "border-slate-800 bg-slate-900/40 opacity-60"
          : "border-slate-800 bg-slate-900"
      }`}
    >
      <div className="mb-3 flex items-center justify-between text-xs text-slate-400">
        <span>
          Vòng {match.round} · Sân {match.court}
        </span>
        <span className="flex items-center gap-1.5">
          {match.pinned && <Tag>đã ghim</Tag>}
          {result?.partial && <Tag tone="warn">dở dang</Tag>}
          {result?.irregular && !result.partial && <Tag tone="warn">lệch mốc</Tag>}
          {match.status === "cancelled" && <Tag tone="danger">đã huỷ</Tag>}
          {match.status === "abandoned" && <Tag tone="danger">bỏ dở</Tag>}
          {match.status === "submitted" && !pendingScore && <Tag tone="ok">đã khoá</Tag>}
        </span>
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <Team ids={match.teamA} lookup={player} align="left" />
        <div
          className={`text-center text-3xl font-extrabold tabular-nums ${
            pendingScore ? "animate-pulse text-slate-500" : "text-slate-100"
          }`}
        >
          {shown ? (
            <>
              {shown.scoreA}
              <span className="mx-1 text-slate-600">–</span>
              {shown.scoreB}
            </>
          ) : (
            <span className="text-xl text-slate-600">vs</span>
          )}
        </div>
        <Team ids={match.teamB} lookup={player} align="right" />
      </div>

      {pendingScore && (
        <p className="mt-2 text-center text-xs text-amber-300">
          Đang lưu — chưa chắc chắn
        </p>
      )}

      {match.cancelReason && (
        <p className="mt-2 text-center text-xs text-slate-400">{match.cancelReason}</p>
      )}

      {match.edits
        .filter((e) => e.from !== null)
        .map((edit, i) => (
          <p key={i} className="mt-1 text-center text-xs text-slate-500">
            Đã sửa bởi {edit.by.label} · {formatClock(edit.at)} ·{" "}
            {edit.from!.scoreA}-{edit.from!.scoreB} → {edit.to?.scoreA}-{edit.to?.scoreB}
          </p>
        ))}

      {!dead && (
        <div className="mt-3 flex gap-2">
          {editable.allowed ? (
            <Button
              tone={shown ? "neutral" : "primary"}
              full
              onClick={() => onEnterScore(match)}
            >
              {shown ? "Sửa tỷ số" : "Nhập tỷ số"}
            </Button>
          ) : (
            editable.reason && (
              <p className="flex-1 self-center text-xs text-slate-500">
                {editable.reason}
              </p>
            )
          )}
          {onCancel && match.status === "scheduled" && (
            <Button tone="ghost" onClick={() => onCancel(match)}>
              Huỷ
            </Button>
          )}
          {onCancel && match.status === "playing" && (
            <Button tone="ghost" onClick={() => onCancel(match)}>
              Bỏ dở
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function Team({
  ids,
  lookup,
  align,
}: {
  ids: readonly [PlayerId, PlayerId];
  lookup: (id: PlayerId) => { name: string; avatarId: string } | undefined;
  align: "left" | "right";
}) {
  return (
    // `min-w-0` cho phép cột lưới co lại để `truncate` có tác dụng. Thiếu nó thì
    // tên dài như "Nguyễn Văn Cường" đẩy cả thẻ trận tràn ra ngoài màn hình.
    <div
      className={`min-w-0 space-y-1.5 ${align === "right" ? "text-right" : ""}`}
    >
      {ids.map((id) => {
        const p = lookup(id);
        return (
          <div
            key={id}
            className={`flex min-w-0 items-center gap-2 ${
              align === "right" ? "flex-row-reverse" : ""
            }`}
          >
            <Avatar name={p?.name ?? id} avatarId={p?.avatarId} size="sm" />
            <span className="truncate text-sm font-medium">{p?.name ?? id}</span>
          </div>
        );
      })}
    </div>
  );
}

function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Tìm tỷ số đang chờ gửi cho một trận.
 *
 * Đặt ở đây để mọi màn hình hiện trận đều dùng chung một cách nhận biết, chứ
 * không mỗi nơi tự đoán một kiểu rồi lệch nhau.
 */
export function pendingScoreFor(
  matchId: string,
  queued: Array<{ command: Command }>,
): { scoreA: number; scoreB: number } | undefined {
  for (let i = queued.length - 1; i >= 0; i--) {
    const c = queued[i]!.command;
    if (
      (c.type === "SubmitResult" || c.type === "EditResult") &&
      c.matchId === matchId
    ) {
      return { scoreA: c.scoreA, scoreB: c.scoreB };
    }
  }
  return undefined;
}
