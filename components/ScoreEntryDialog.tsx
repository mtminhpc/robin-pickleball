"use client";

/**
 * Nhập tỷ số, kiểm tra, xác nhận, rồi khoá.
 *
 * Yêu cầu số 6: "ai cũng nhập được nhưng nhập xong khóa kết quả lại để khỏi bấm
 * nhầm." Nên có đúng hai lớp chặn bấm nhầm, và cả hai đều cố ý không thể lướt qua:
 *
 *   1. **Kiểm mốc điểm.** Tỷ số hoà hay âm thì chặn hẳn. Lệch mốc thì cảnh báo
 *      kèm nút vẫn lưu được — vì trận dừng sớm do hết giờ sân là chuyện thường,
 *      chặn cứng sẽ khiến người ta bịa ra một tỷ số giả cho qua.
 *   2. **Bước xác nhận.** Hiện trên KHỐI TỐI, to hết cỡ, đủ tên bốn người và tỷ
 *      số. Đây là chỗ bắt được lỗi tai hại nhất mà kiểm tra số không bao giờ
 *      thấy: nhập đúng tỷ số nhưng vào nhầm trận. Khối tối để bước này trông
 *      khác hẳn bước nhập — đổi nền là cách nhanh nhất báo "đây là bước khác".
 */

import { useEffect, useState } from "react";
import type { Command } from "@/lib/domain/commands";
import { canEditResult, checkScore } from "@/lib/domain/rules";
import type { EventState, Match, PlayerId } from "@/lib/domain/types";
import { Button, Dialog } from "@/components/ui";
import { useEvent } from "@/hooks/useEventState";

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
  const { data } = useEvent();
  // Mở lại hộp thoại phải thấy con số mình vừa nhập, kể cả khi nó chưa gửi đi
  // được. Hiện lại số 0 sẽ khiến người ta tưởng lần nhập trước đã mất.
  const existing = pendingScore ?? match?.result;
  const [scoreA, setScoreA] = useState(0);
  const [scoreB, setScoreB] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState("");

  // Mở lại hộp thoại thì nạp lại tỷ số của trận đó, không giữ số của lần trước.
  useEffect(() => {
    if (!open) return;
    setScoreA(existing?.scoreA ?? 0);
    setScoreB(existing?.scoreB ?? 0);
    setConfirming(false);
    setNote("");
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
  const actor = data?.actorRef
    ? { kind: "player" as const, label: "người nhập", ref: data.actorRef }
    : { kind: "player" as const, label: "người xem" };
  const ownWindow = isEdit
    ? canEditResult(match, actor, Date.now(), state.config).allowed
    : false;
  const canEditSaved = !isEdit || (
    state.status === "finished"
      ? data?.role === "owner"
      : Boolean(ownWindow || data?.capabilities.canEditAnyScore)
  );
  const needsReason = Boolean(
    isEdit &&
    data?.capabilities.canEditAnyScore &&
    (state.status === "finished" || !ownWindow),
  );

  const submit = () => {
    onSubmit({
      type: isEdit ? "EditResult" : "SubmitResult",
      matchId: match.id,
      scoreA,
      scoreB,
      irregular: !check.regular,
      ...(note.trim() ? { note: note.trim() } : {}),
    });
    onClose();
  };
  const revert = () => {
    onSubmit({ type: "RevertResult", matchId: match.id, ...(note.trim() ? { note: note.trim() } : {}) });
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} title={isEdit ? "Sửa tỷ số" : "Nhập tỷ số"}>
      {confirming ? (
        <div>
          <p className="eyebrow font-normal text-mute-600">Kiểm tra lại lần cuối</p>
          <div className="mt-3.5 bg-ink p-5 text-paper">
            <p className="text-[15px] font-semibold">{teamA}</p>
            <p className="my-3 font-display text-[3.75rem] font-extrabold leading-none tracking-[-0.05em] tabular-nums">
              {scoreA} – {scoreB}
            </p>
            <p className="text-[15px] font-semibold">{teamB}</p>
          </div>
          <div className="mt-4 flex gap-2.5">
            <Button className="min-h-[3.25rem] flex-1" onClick={() => setConfirming(false)}>
              Sửa lại
            </Button>
            <Button tone="primary" className="min-h-[3.25rem] flex-1" onClick={submit}>
              Đúng rồi, lưu
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <p className="eyebrow font-normal text-mute-600">
            {isEdit ? "Sửa tỷ số" : "Nhập tỷ số"} · Sân {match.court}
          </p>

          <ScoreStepper label={teamA} value={scoreA} onChange={setScoreA} />
          <ScoreStepper label={teamB} value={scoreB} onChange={setScoreB} />

          {check.fatal && (
            <p className="mt-4 bg-accent p-3 text-xs text-paper">{check.fatal}</p>
          )}
          {!check.fatal && check.warning && (
            <p className="mt-4 border border-ink p-3 text-xs">
              {check.warning} Vẫn lưu được, kết quả sẽ có dấu riêng.
            </p>
          )}
          {isEdit && !canEditSaved && (
            <p className="mt-4 bg-accent p-3 text-xs text-paper">
              {state.status === "finished"
                ? "Sau khi sự kiện kết thúc, chỉ Chủ sự kiện được sửa kết quả."
                : "Bạn không còn quyền sửa kết quả đã chốt này."}
            </p>
          )}
          {isEdit && (
            <label className="mt-4 block text-xs font-semibold">
              Lý do sửa {needsReason ? "(bắt buộc)" : "(không bắt buộc trong cửa sổ tự sửa)"}
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={200}
                className="mt-1 min-h-20 w-full border border-ink bg-transparent p-3 text-sm font-normal"
                placeholder="Ví dụ: Phó sự kiện nhập nhầm tỷ số"
              />
            </label>
          )}
          {isEdit && canEditSaved && data?.capabilities.canEditAnyScore && (
            <Button
              type="button"
              tone="ghost"
              full
              className="mt-3 text-accent-700"
              disabled={needsReason && note.trim().length < 2}
              onClick={revert}
            >
              {match.edits.some((edit) => edit.from && edit.to) ? "Hoàn tác lần sửa gần nhất" : "Gỡ kết quả này"}
            </Button>
          )}

          <div className="mt-4.5 flex gap-2.5">
            <Button className="min-h-[3.25rem] flex-1" onClick={onClose}>
              Huỷ
            </Button>
            <Button
              tone="primary"
              className="min-h-[3.25rem] flex-1"
              disabled={!canEditSaved || check.fatal !== null || (needsReason && note.trim().length < 2)}
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
 * Ô nhập một bên tỷ số: nút trừ, con số, nút cộng.
 *
 * Có cả nút cộng trừ lẫn ô gõ trực tiếp: đa số trận chỉ cần bấm cộng vài cái từ
 * số 0, nhưng nhập bù cho trận đánh xong lâu rồi thì gõ thẳng nhanh hơn nhiều.
 * Con số không có khung — chỉ một gạch đậm bên dưới, để nó đọc như một con số
 * chứ không như một ô biểu mẫu.
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
    <div className="pt-4">
      <p className="mb-2.5 truncate text-sm font-semibold">{label}</p>
      <div className="flex items-center gap-2.5">
        <StepButton label={`Giảm điểm ${label}`} onClick={() => onChange(Math.max(0, value - 1))}>
          −
        </StepButton>
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
          className="w-full min-w-0 flex-1 border-0 border-b-2 border-ink bg-transparent py-1.5 text-center font-display text-[2.625rem] font-extrabold leading-none tracking-[-0.04em] tabular-nums focus:border-accent focus:outline-none"
        />
        <StepButton label={`Tăng điểm ${label}`} onClick={() => onChange(Math.min(99, value + 1))}>
          +
        </StepButton>
      </div>
    </div>
  );
}

function StepButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex h-14 w-14 flex-none items-center justify-center border border-ink text-2xl transition hover:bg-ink/[0.07] active:bg-ink/[0.14]"
    >
      {children}
    </button>
  );
}
