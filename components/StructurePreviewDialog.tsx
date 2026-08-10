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
