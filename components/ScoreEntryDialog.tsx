"use client";

/**
 * Nhập tỷ số, kiểm tra, xác nhận, rồi khoá.
 *
 * Yêu cầu số 6: "ai cũng nhập được nhưng nhập xong khóa kết quả lại để khỏi bấm
 * nhầm." Nên có đúng hai lớp chặn bấm nhầm, và cả hai đều cố ý không thể lướt qua:
 *
 *   1. **Kiểm mốc điểm.** Tỷ số hoà hay âm thì chặn hẳn. Lệch mốc thì cảnh báo
 *      vàng kèm nút "Vẫn lưu" — vì trận dừng sớm do hết giờ sân là chuyện thường,
 *      chặn cứng sẽ khiến người ta bịa ra một tỷ số giả cho qua.
 *   2. **Bước xác nhận.** Hiện to đầy đủ tên bốn người và tỷ số. Đây là chỗ bắt
 *      được lỗi tai hại nhất mà kiểm tra số không bao giờ thấy: nhập đúng tỷ số
 *      nhưng vào nhầm trận.
 */

import { useEffect, useState } from "react";
import type { Command } from "@/lib/domain/commands";
import { checkScore } from "@/lib/domain/rules";
import type { EventState, Match, PlayerId } from "@/lib/domain/types";
import { Button, Dialog } from "@/components/ui";

export function ScoreEntryDialog({
  match,
  state,
  open,
  pendingScore,
  onClose,
  onSubmit,
}: {
  match: Match | null;
  state: EventState;
  open: boolean;
  /** Tỷ số đang nằm trong hàng đợi, chưa gửi được. Ưu tiên hơn tỷ số đã lưu. */
  pendingScore?: { scoreA: number; scoreB: number };
  onClose: () => void;
  onSubmit: (command: Command) => void;
}) {
  // Mở lại hộp thoại phải thấy con số mình vừa nhập, kể cả khi nó chưa gửi đi
  // được. Hiện lại số 0 sẽ khiến người ta tưởng lần nhập trước đã mất.
  const existing = pendingScore ?? match?.result;
  const [scoreA, setScoreA] = useState(0);
  const [scoreB, setScoreB] = useState(0);
  const [confirming, setConfirming] = useState(false);

  // Mở lại hộp thoại thì nạp lại tỷ số của trận đó, không giữ số của lần trước.
  useEffect(() => {
    if (!open) return;
    setScoreA(existing?.scoreA ?? 0);
    setScoreB(existing?.scoreB ?? 0);
    setConfirming(false);
  }, [open, match?.id, existing?.scoreA, existing?.scoreB]);

  if (!match) return null;

  const nameOf = (id: PlayerId) =>
    state.players.find((p) => p.id === id)?.name ?? id;
  const teamA = `${nameOf(match.teamA[0])} & ${nameOf(match.teamA[1])}`;
  const teamB = `${nameOf(match.teamB[0])} & ${nameOf(match.teamB[1])}`;

  const check = checkScore(scoreA, scoreB, state.config.scoring);
  // Chỉ là "sửa" khi máy chủ đã có kết quả. Tỷ số mới đang chờ gửi thì vẫn là
  // lần nhập đầu tiên — gửi `EditResult` cho một trận chưa có kết quả sẽ bị từ chối.
  const isEdit = match.result !== null;

  const submit = () => {
    onSubmit(
      isEdit
        ? {
            type: "EditResult",
            matchId: match.id,
            scoreA,
            scoreB,
            irregular: !check.regular,
          }
        : {
            type: "SubmitResult",
            matchId: match.id,
            scoreA,
            scoreB,
            irregular: !check.regular,
          },
    );
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isEdit ? "Sửa tỷ số" : "Nhập tỷ số"}
    >
      {confirming ? (
        <div className="space-y-5">
          <p className="text-sm text-slate-400">Kiểm tra lại lần cuối:</p>
          <div className="rounded-xl bg-slate-950 p-4 text-center">
            <div className="text-lg font-semibold">{teamA}</div>
            <div className="my-2 text-score tabular-nums">
              {scoreA} <span className="text-slate-600">–</span> {scoreB}
            </div>
            <div className="text-lg font-semibold">{teamB}</div>
          </div>
          <div className="flex gap-2">
            <Button tone="ghost" full onClick={() => setConfirming(false)}>
              Sửa lại
            </Button>
            <Button tone="primary" full onClick={submit}>
              Đúng rồi, lưu
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <ScoreStepper label={teamA} value={scoreA} onChange={setScoreA} />
          <ScoreStepper label={teamB} value={scoreB} onChange={setScoreB} />

          {check.fatal && (
            <p className="rounded-xl bg-red-500/15 p-3 text-sm text-red-200">
              {check.fatal}
            </p>
          )}
          {!check.fatal && check.warning && (
            <p className="rounded-xl bg-amber-500/15 p-3 text-sm text-amber-200">
              ⚠ {check.warning} Vẫn lưu được, kết quả sẽ có dấu riêng.
            </p>
          )}

          <div className="flex gap-2">
            <Button tone="ghost" full onClick={onClose}>
              Huỷ
            </Button>
            <Button
              tone="primary"
              full
              disabled={check.fatal !== null}
              onClick={() => setConfirming(true)}
            >
              Tiếp tục
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

/**
 * Ô nhập một bên tỷ số.
 *
 * Có cả nút cộng trừ lẫn ô gõ trực tiếp: đa số trận chỉ cần bấm cộng vài cái từ
 * số 0, nhưng nhập bù cho trận đánh xong lâu rồi thì gõ thẳng nhanh hơn nhiều.
 */
function ScoreStepper({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="rounded-xl bg-slate-950 p-3">
      <div className="mb-2 truncate text-sm font-medium text-slate-300">{label}</div>
      <div className="flex items-center gap-3">
        <Button
          tone="neutral"
          aria-label={`Giảm điểm ${label}`}
          onClick={() => onChange(Math.max(0, value - 1))}
          className="h-14 w-14 text-2xl"
        >
          −
        </Button>
        {/*
          `min-w-0` là bắt buộc chứ không phải trang trí: ô nhập số có bề rộng nội
          tại theo thuộc tính `size` (mặc định 20 ký tự), và flex item không co
          xuống dưới bề rộng nội tại của nó. Thiếu nó thì hộp thoại tràn ngang và
          nút trừ bị đẩy ra ngoài màn hình điện thoại.
        */}
        <input
          type="number"
          inputMode="numeric"
          size={2}
          value={value}
          aria-label={`Điểm của ${label}`}
          onChange={(e) => {
            const n = Number(e.target.value);
            onChange(Number.isFinite(n) ? Math.max(0, Math.min(99, Math.round(n))) : 0);
          }}
          className="h-14 w-full min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-900 text-center text-4xl font-extrabold tabular-nums focus:border-court-500 focus:outline-none"
        />
        <Button
          tone="neutral"
          aria-label={`Tăng điểm ${label}`}
          onClick={() => onChange(Math.min(99, value + 1))}
          className="h-14 w-14 text-2xl"
        >
          +
        </Button>
      </div>
    </div>
  );
}
