"use client";

/**
 * Ô tra mã sự kiện của App admin, kèm hai nút Xóa và Khôi phục.
 *
 * Đây là ngoại lệ duy nhất cho phép App admin chạm vào buổi của người khác, nên
 * màn hình này cố ý nghèo nàn: đủ để nhận ra mình đang xử lý đúng buổi nào, và
 * không hơn. Không email chủ sự kiện, không mật khẩu, không tỷ số, không danh sách
 * người chơi — muốn xem những thứ đó thì phải được Chủ trao quyền như mọi người.
 */

import { useState } from "react";
import { Button, Card, Field, inputClass } from "@/components/ui";
import { DeleteEventDialog } from "@/components/DeleteEventDialog";
import { normalizeEventCode } from "@/lib/domain/event-deletion";

interface EventLookup {
  code: string;
  name: string;
  status: "draft" | "running" | "finished";
  scheduledAt: number | null;
  createdAt: number;
  players: number;
  deleted: boolean;
  deletedAt: number | null;
}

const STATUS_LABEL: Record<EventLookup["status"], string> = {
  draft: "Sắp diễn ra",
  running: "Đang đánh",
  finished: "Đã kết thúc",
};

export function AppAdminEventTools() {
  const [input, setInput] = useState("");
  const [found, setFound] = useState<EventLookup | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");

  const lookup = async (code: string) => {
    setBusy(true);
    setError("");
    setActionError("");
    setNotice("");
    try {
      const response = await fetch(`/api/app-admin/events/${encodeURIComponent(code)}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Không tra được mã sự kiện.");
      setFound(body as EventLookup);
      return body as EventLookup;
    } catch (caught) {
      setFound(null);
      setError(caught instanceof Error ? caught.message : "Không tra được mã sự kiện.");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const act = async (kind: "delete" | "restore", code: string) => {
    setBusy(true);
    setActionError("");
    setNotice("");
    try {
      const response = await fetch(
        kind === "delete"
          ? `/api/events/${encodeURIComponent(code)}`
          : `/api/events/${encodeURIComponent(code)}/restore`,
        {
          method: kind === "delete" ? "DELETE" : "POST",
          headers: { "content-type": "application/json" },
          ...(kind === "delete" ? { body: JSON.stringify({ confirmation: code }) } : {}),
        },
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? (kind === "delete" ? "Không xóa được." : "Không khôi phục được."));
      }
      setConfirmingDelete(false);
      setNotice(kind === "delete" ? `Đã xóa ${code}.` : `Đã khôi phục ${code}.`);
      // Tra lại từ máy chủ thay vì tự sửa trạng thái trên màn hình: nếu một tab
      // khác vừa làm điều ngược lại, cái hiện ra phải là sự thật chứ không phải
      // điều mình vừa bấm.
      await lookup(code);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Thao tác không thành công.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-4 border-2 border-ink p-5">
      <div>
        <p className="eyebrow text-accent">App admin</p>
        <h2 className="mt-1 text-lg">Xóa và khôi phục sự kiện</h2>
        <p className="mt-1 text-xs text-mute-600">
          Chỉ dùng khi có người báo xóa nhầm. Không xem được mật khẩu, điểm hay đội
          điều hành, và không xóa được buổi đang đánh.
        </p>
      </div>

      <form
        className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          void lookup(normalizeEventCode(input));
        }}
      >
        <Field label="Mã sự kiện">
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            className={`${inputClass} font-mono uppercase`}
            autoComplete="off"
            spellCheck={false}
            required
          />
        </Field>
        <Button type="submit" tone="primary" className="self-end" disabled={busy}>
          Tra mã
        </Button>
      </form>

      {error && <p className="text-sm text-accent-700">{error}</p>}
      {notice && <p className="text-sm text-[#087a55]">{notice}</p>}

      {found && (
        <div className="space-y-3 border-y border-line py-3">
          <div>
            <p className="font-display text-sm font-extrabold uppercase">{found.name}</p>
            <p className="mt-1 font-mono text-xs font-bold text-[#087a55]">{found.code}</p>
            <p className="mt-1 text-[11px] text-mute-600">
              {STATUS_LABEL[found.status]} · {found.players} người ·{" "}
              {new Date(found.scheduledAt ?? found.createdAt).toLocaleString("vi-VN", {
                dateStyle: "short",
                timeStyle: "short",
              })}
            </p>
            <p className="mt-1 text-[11px] font-bold uppercase text-accent-700">
              {found.deleted
                ? `Đã xóa · ${new Date(found.deletedAt ?? 0).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" })}`
                : "Đang hoạt động"}
            </p>
          </div>

          {actionError && <p className="text-sm text-accent-700">{actionError}</p>}

          <div className="flex justify-end gap-2">
            {found.deleted ? (
              <Button
                type="button"
                tone="primary"
                disabled={busy}
                onClick={() => void act("restore", found.code)}
              >
                {busy ? "Đang khôi phục…" : "Khôi phục"}
              </Button>
            ) : (
              <Button
                type="button"
                tone="danger"
                disabled={busy || found.status === "running"}
                onClick={() => {
                  setActionError("");
                  setConfirmingDelete(true);
                }}
              >
                {found.status === "running" ? "Đang đánh — không xóa được" : "Xóa sự kiện"}
              </Button>
            )}
          </div>
        </div>
      )}

      {found && !found.deleted && (
        <DeleteEventDialog
          code={found.code}
          name={found.name}
          open={confirmingDelete}
          busy={busy}
          error={actionError}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() => void act("delete", found.code)}
        />
      )}
    </Card>
  );
}
