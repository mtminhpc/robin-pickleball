"use client";

/**
 * Một trận đấu, dạng hàng ngang phân tách bằng đường kẻ.
 *
 * Không phải thẻ có khung: bản thiết kế dùng kẻ ngang thay cho hộp, nên nhiều
 * trận xếp liền nhau đọc như một danh sách chứ không như một đống hộp rời.
 *
 * Hai chi tiết ở đây phục vụ trực tiếp nỗi lo "tưởng đã lưu mà chưa lưu":
 *
 *   • Tỷ số đang chờ gửi hiện MỜ kèm nhấp nháy, trông khác hẳn tỷ số đã lưu.
 *     Chỉ nhìn là biết cái nào chắc chắn, không phải nhớ mình vừa bấm gì.
 *   • Mọi lần sửa hiện công khai ngay tại chỗ: ai sửa, lúc mấy giờ, từ bao nhiêu
 *     thành bao nhiêu. Minh bạch quan trọng hơn gọn gàng khi có tranh cãi.
 *
 * Ảnh đại diện đứng cạnh tên. Bản thiết kế Modernist ban đầu cố ý bỏ ảnh khỏi
 * đây để danh sách trận đọc như một bảng chữ — **chủ dự án đã cân nhắc và quyết
 * định đưa lại**, vì ở sân người ta nhận nhau bằng mặt nhanh hơn đọc tên, nhất
 * là khi trong nhóm có hai người trùng tên. Đừng "sửa lại cho đúng thiết kế".
 */

import type { Command } from "@/lib/domain/commands";
import { canEditResult } from "@/lib/domain/rules";
import type { Actor, EventState, Match, Player, PlayerId } from "@/lib/domain/types";
import { Avatar } from "@/components/Avatar";
import { Button, Marker } from "@/components/ui";

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
  const playerOf = (id: PlayerId) => state.players.find((p) => p.id === id);
  const result = match.result;
  const shown = pendingScore ?? result;
  const editable =
    canEnterScore && result
      ? canEditResult(match, actor, Date.now(), state.config)
      : { allowed: canEnterScore, reason: null };

  const dead = match.status === "cancelled" || match.status === "abandoned";

  return (
    <div
      className={`border-b border-line pb-5 pt-4.5 ${dead ? "opacity-50" : ""}`}
    >
      <div className="mb-4 flex items-center justify-between gap-2">
        <span className="font-display text-[11px] font-extrabold uppercase tracking-[0.16em] text-mute-700">
          Sân {match.court}
        </span>
        <span className="flex items-center gap-2">
          {match.pinned && <Marker tone="ink">đã ghim</Marker>}
          {result?.partial && <Marker tone="accent">dở dang</Marker>}
          {result?.irregular && !result.partial && (
            <Marker tone="accent">lệch mốc</Marker>
          )}
          {match.status === "cancelled" && <Marker tone="accent">đã huỷ</Marker>}
          {match.status === "abandoned" && <Marker tone="accent">bỏ dở</Marker>}
          {pendingScore && <Marker tone="accent">đang lưu</Marker>}
          {match.status === "submitted" && !pendingScore && (
            <Marker tone="ink">đã khoá</Marker>
          )}
        </span>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2.5">
        <Team ids={match.teamA} playerOf={playerOf} />
        <div
          className={`px-2 text-center font-display text-score tabular-nums ${
            pendingScore
              ? "animate-pulse text-mute-600"
              : shown
                ? "text-ink"
                : "text-mute-400"
          }`}
        >
          {shown ? `${shown.scoreA}–${shown.scoreB}` : "vs"}
        </div>
        <Team ids={match.teamB} playerOf={playerOf} align="right" />
      </div>

      {match.cancelReason && (
        <p className="mt-2 text-center text-xs text-mute-700">
          {match.cancelReason}
        </p>
      )}

      {match.edits
        .filter((e) => e.from !== null)
        .map((edit, i) => (
          <p key={i} className="mt-1 text-center text-xs text-mute-600">
            Đã sửa bởi {edit.by.label} · {formatClock(edit.at)} ·{" "}
            {edit.from!.scoreA}-{edit.from!.scoreB} → {edit.to?.scoreA}-
            {edit.to?.scoreB}
          </p>
        ))}

      {!dead && (
        <div className="mt-4.5 flex gap-2">
          {editable.allowed ? (
            <Button
              tone={shown ? "neutral" : "primary"}
              onClick={() => onEnterScore(match)}
              className="min-h-[3.125rem] flex-1 justify-start"
            >
              {shown ? "Sửa tỷ số" : "Nhập tỷ số"}
            </Button>
          ) : (
            editable.reason && (
              <p className="flex-1 self-center text-xs text-mute-600">
                {editable.reason}
              </p>
            )
          )}
          {onCancel && match.status === "scheduled" && (
            <Button
              tone="danger"
              onClick={() => onCancel(match)}
              className="min-h-[3.125rem] flex-none"
            >
              Huỷ
            </Button>
          )}
          {onCancel && match.status === "playing" && (
            <Button
              tone="danger"
              onClick={() => onCancel(match)}
              className="min-h-[3.125rem] flex-none"
            >
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
  playerOf,
  align = "left",
}: {
  ids: readonly [PlayerId, PlayerId];
  playerOf: (id: PlayerId) => Player | undefined;
  align?: "left" | "right";
}) {
  return (
    // `min-w-0` cho phép cột lưới co lại để `truncate` có tác dụng. Thiếu nó thì
    // tên dài như "Nguyễn Văn Cường" đẩy cả hàng tràn ra ngoài màn hình.
    <div
      className={`flex min-w-0 flex-col gap-2 ${align === "right" ? "items-end" : ""}`}
    >
      {ids.map((id) => {
        const player = playerOf(id);
        return (
          <span
            key={id}
            className={`flex min-w-0 max-w-full items-center gap-2 ${
              align === "right" ? "flex-row-reverse" : ""
            }`}
          >
            <Avatar
              name={player?.name ?? id}
              avatarId={player?.avatarId}
              userId={player?.userId}
              size="sm"
            />
            <span className="truncate text-[15px] font-semibold tracking-[-0.01em]">
              {player?.name ?? id}
            </span>
          </span>
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
