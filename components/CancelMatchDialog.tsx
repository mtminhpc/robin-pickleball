"use client";

/**
 * Huỷ trận chưa đánh, hoặc bỏ dở trận đang đánh.
 *
 * Hai tình huống khác hẳn nhau nên hộp thoại cũng khác:
 *
 *   • **Chưa đánh** — chỉ cần lý do. Suất kỳ vọng của bốn người tự giảm theo nên
 *     không ai bị thiệt, hệ thống xếp lại phần sau.
 *   • **Đang đánh dở** — phải chọn: bỏ hẳn không tính điểm, hay ghi lại tỷ số dở
 *     dang. Đây là lựa chọn thật, không có đáp án mặc định đúng: mưa lúc 2-1 thì
 *     bỏ hẳn, còn hết giờ sân lúc 9-7 thì tỷ số đó có ý nghĩa.
 */

import { useEffect, useState } from "react";
import type { Command } from "@/lib/domain/commands";
import { matchCourtName, type EventState, type Match, type PlayerId } from "@/lib/domain/types";
import { Button, Dialog, inputClass } from "@/components/ui";

const REASONS = ["Hết giờ sân", "Mất sân", "Trời mưa", "Thiếu người"] as const;

export function CancelMatchDialog({
  match,
  state,
  open,
  onClose,
  onSubmit,
}: {
  match: Match | null;
  state: EventState;
  open: boolean;
  onClose: () => void;
  onSubmit: (command: Command) => void;
}) {
  const [reason, setReason] = useState<string>(REASONS[0]);
  const [keepScore, setKeepScore] = useState(false);
  const [scoreA, setScoreA] = useState(0);
  const [scoreB, setScoreB] = useState(0);

  useEffect(() => {
    if (!open) return;
    setReason(REASONS[0]);
    setKeepScore(false);
    setScoreA(0);
    setScoreB(0);
  }, [open, match?.id]);

  if (!match) return null;

  const nameOf = (id: PlayerId) =>
    state.players.find((p) => p.id === id)?.name ?? id;
  const started = match.status === "playing";

  const submit = () => {
    onSubmit(
      started
        ? {
            type: "AbandonMatch",
            matchId: match.id,
            reason,
            ...(keepScore ? { score: { scoreA, scoreB } } : {}),
          }
        : { type: "CancelMatch", matchId: match.id, reason },
    );
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={started ? "Bỏ dở trận đang đánh" : "Huỷ trận chưa đánh"}
    >
      <div className="space-y-4">
        <p className="rounded-xl bg-paper p-3 text-sm">
          Vòng {match.round}, {matchCourtName(state, match)}
          <br />
          <span className="text-mute-700">
            {nameOf(match.teamA[0])} & {nameOf(match.teamA[1])} vs{" "}
            {nameOf(match.teamB[0])} & {nameOf(match.teamB[1])}
          </span>
        </p>

        <div className="space-y-2">
          <span className="text-sm font-medium text-mute-800">Lý do</span>
          <div className="flex flex-wrap gap-2">
            {REASONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setReason(r)}
                className={`min-h-tap rounded-xl px-4 text-sm font-medium ${
                  reason === r ? "bg-accent text-white" : "bg-mute-300 text-mute-800"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          <input
            className={inputClass}
            value={REASONS.includes(reason as (typeof REASONS)[number]) ? "" : reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Hoặc gõ lý do khác"
          />
        </div>

        {started && (
          <div className="space-y-3 rounded-xl bg-paper p-3">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={keepScore}
                onChange={(e) => setKeepScore(e.target.checked)}
                className="mt-1 h-5 w-5 shrink-0 accent-accent"
              />
              <span className="text-sm">
                <span className="font-medium">Ghi lại tỷ số dở dang</span>
                <span className="block text-mute-700">
                  Tính vào hiệu số, có dấu riêng trong bảng xếp hạng. Bỏ trống thì
                  trận coi như không diễn ra, bốn người được ưu tiên xếp lại.
                </span>
              </span>
            </label>

            {keepScore && (
              <div className="flex items-center gap-2">
                <NumberBox
                  label={`${nameOf(match.teamA[0])} & ${nameOf(match.teamA[1])}`}
                  value={scoreA}
                  onChange={setScoreA}
                />
                <span className="text-mute-500">–</span>
                <NumberBox
                  label={`${nameOf(match.teamB[0])} & ${nameOf(match.teamB[1])}`}
                  value={scoreB}
                  onChange={setScoreB}
                />
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <Button tone="ghost" full onClick={onClose}>
            Quay lại
          </Button>
          <Button
            tone="danger"
            full
            disabled={keepScore && scoreA === scoreB}
            onClick={submit}
          >
            {started ? "Bỏ dở trận" : "Huỷ trận"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function NumberBox({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <input
      type="number"
      inputMode="numeric"
      aria-label={`Điểm của ${label}`}
      value={value}
      onChange={(e) =>
        onChange(Math.max(0, Math.min(99, Math.round(Number(e.target.value) || 0))))
      }
      className="min-h-tap w-full rounded-xl border border-mute-400 bg-surface text-center text-2xl font-bold tabular-nums focus:border-accent focus:outline-none"
    />
  );
}
