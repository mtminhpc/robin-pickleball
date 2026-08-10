"use client";

import type { StructurePreviewResponse } from "@/hooks/useStructureChange";
import { Button, Dialog } from "@/components/ui";

export function StructurePreviewDialog({
  open,
  title,
  preview,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  preview: StructurePreviewResponse | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (token: string) => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <h2 className="font-display text-lg font-extrabold uppercase">{title}</h2>
      {!preview ? (
        <p className="mt-4 text-sm text-mute-600">Đang tính lại phần lịch chưa bắt đầu…</p>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="border-l-4 border-accent bg-surface p-3 text-sm">
            <strong>Áp dụng từ vòng {preview.effectiveRound}</strong>
            {preview.before && preview.after && (
              <p className="mt-1 text-xs text-mute-700">
                Lịch chờ: {preview.before.scheduledMatches} → {preview.after.scheduledMatches} trận ·
                sân: {preview.before.courts} → {preview.after.courts}.
              </p>
            )}
            <p className="mt-1 text-xs text-mute-700">
              Thêm {preview.diff.matchesAdded}, bỏ {preview.diff.matchesRemoved}, chuyển {preview.diff.matchesMoved} trận.
            </p>
          </div>
          {preview.roundRobin && (
            <div className="space-y-2 border border-line bg-paper p-3 text-xs">
              <p className="font-bold uppercase tracking-wide">Dự báo round robin</p>
              <p>
                Nhóm {preview.roundRobin.cohortPlayers.length} người · đã phủ {preview.roundRobin.coveredPairs}/{preview.roundRobin.totalPairs} cặp.
              </p>
              <p>
                Còn {preview.roundRobin.missingPairs.length} cặp · dự kiến {preview.roundRobin.projectedMatches} trận / {preview.roundRobin.projectedRounds} vòng / khoảng {preview.roundRobin.estimatedMinutes} phút.
              </p>
              <p>Giữ nguyên {preview.roundRobin.preservedMatches} trận đang chơi hoặc đã ghim.</p>
              <p className="text-mute-700">
                {preview.roundRobin.cohortPlayers.map((player) => player.name).join(" · ")}
              </p>
              {preview.roundRobin.outsideCohortPlayers.length > 0 && (
                <p className="text-mute-700">
                  Ngoài nhóm tại mốc này: {preview.roundRobin.outsideCohortPlayers.map((player) => player.name).join(" · ")}.
                </p>
              )}
              {preview.roundRobin.repeatedPairs > 0 && (
                <p>Lịch sử hiện có {preview.roundRobin.repeatedPairs} lượt cặp bị lặp; kết quả cũ vẫn giữ nguyên.</p>
              )}
              {preview.roundRobin.unavoidableRepeatMatches > 0 && (
                <p>Cần {preview.roundRobin.unavoidableRepeatMatches} trận dùng đội phụ đã lặp để phủ cạnh lẻ.</p>
              )}
              {preview.roundRobin.unresolvedPairs.length > 0 && (
                <p className="font-semibold text-accent-800">
                  Chưa đặt được {preview.roundRobin.unresolvedPairs.length} cặp theo ca hiện tại.
                </p>
              )}
            </div>
          )}
          {preview.warnings.map((warning) => (
            <p key={warning} className="border border-line bg-paper p-3 text-xs">{warning}</p>
          ))}
          {preview.blocked.map((block) => (
            <p key={block} className="border-l-4 border-accent bg-accent-100 p-3 text-xs font-semibold text-accent-800">{block}</p>
          ))}
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" onClick={onClose}>Huỷ</Button>
            <Button
              type="button"
              tone="primary"
              disabled={busy || !preview.token || preview.blocked.length > 0}
              onClick={() => preview.token && onConfirm(preview.token)}
            >
              {busy ? "Đang áp dụng…" : "Xác nhận"}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
