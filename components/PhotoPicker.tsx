"use client";

/**
 * Chọn ảnh đại diện thật.
 *
 * Dùng ở ba chỗ với ba đường lưu khác nhau, nên đường lưu là **tham số** chứ
 * không gắn cứng:
 *
 *   • `/me` → `/api/me/avatar`, ảnh gắn với tài khoản Google.
 *   • Trang Tham gia → `/api/events/[code]/players/[id]/photo`, người quét mã QR
 *     tự đặt ảnh cho mình mà **không cần tài khoản nào**.
 *   • Hộp Sửa của chủ sự kiện → cùng đường đó, đặt hộ người không mang điện thoại.
 *
 * Ảnh được thu nhỏ ngay trên máy người dùng trước khi gửi (xem
 * [lib/avatars/resize.ts](../lib/avatars/resize.ts)) — ảnh chụp điện thoại 4MB
 * gửi thẳng lên là bốn megabyte đi qua mạng 3G giữa sân. Sau khi lưu xong thì
 * hiện luôn tấm vừa chọn thay vì đi tải lại từ máy chủ: nó đã nằm sẵn trong bộ
 * nhớ, và chờ một vòng mạng chỉ để thấy đúng tấm mình vừa chọn là chờ vô ích.
 */

import { useState } from "react";
import { Avatar } from "@/components/Avatar";
import { ImageEditor, type ImageEditorValue } from "@/components/ImageEditor";
import { Button, Dialog } from "@/components/ui";

export function PhotoPicker({
  name,
  avatarId,
  photoSrc,
  endpoint,
  canEdit,
  hasPhoto,
  size = "lg",
  onChanged,
}: {
  name: string;
  avatarId?: string;
  /** Địa chỉ ảnh đang có. Bỏ trống thì chỉ vẽ biểu tượng suy từ tên. */
  photoSrc?: string;
  /** Đường nhận `PUT { photo }` và `DELETE`. */
  endpoint: string;
  /** Chưa đủ điều kiện đổi thì vẫn hiện ảnh, chỉ giấu hai nút đi. */
  canEdit: boolean;
  hasPhoto: boolean;
  size?: "md" | "lg";
  /** Gọi sau khi lưu hoặc xoá xong, để bên ngoài tải lại phần của nó. */
  onChanged?: () => void;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [bust, setBust] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [edited, setEdited] = useState<ImageEditorValue | null>(null);

  const src =
    preview ??
    (photoSrc ? `${photoSrc}${bust > 0 ? `?v=${bust}` : ""}` : undefined);

  const save = async () => {
    if (!edited) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ photo: edited.image, editMetadata: edited.editMetadata }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Không lưu được ảnh.");
      setPreview(edited.image);
      setEditing(false);
      setEdited(null);
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không lưu được ảnh.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(endpoint, { method: "DELETE" });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Không xoá được ảnh.");
      setPreview(null);
      // Ảnh cũ còn nằm trong bộ nhớ đệm trình duyệt tới một phút. Đổi địa chỉ là
      // cách chắc chắn để thấy ngay kết quả của việc mình vừa bấm.
      setBust((n) => n + 1);
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không xoá được ảnh.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-3">
        <Avatar name={name} avatarId={avatarId} src={src} size={size} dimmed={busy} />
        {canEdit && (
          <div className="flex flex-col items-start gap-1">
            <button
              type="button"
              disabled={busy}
              onClick={() => setEditing(true)}
              className="eyebrow min-h-9 text-accent-700 underline underline-offset-4 disabled:opacity-40"
            >
              {busy ? "Đang lưu…" : hasPhoto || preview ? "Đổi ảnh" : "Tải ảnh lên"}
            </button>
            {(preview !== null || hasPhoto) && (
              <button
                type="button"
                disabled={busy}
                onClick={remove}
                className="eyebrow min-h-9 font-normal text-mute-600 underline underline-offset-4 disabled:opacity-40"
              >
                Xoá ảnh
              </button>
            )}
          </div>
        )}
      </div>
      {error && <p className="mt-2 bg-accent p-2 text-xs text-paper">{error}</p>}
      <Dialog open={editing} onClose={() => setEditing(false)} title="Chỉnh ảnh đại diện">
        <div className="space-y-4">
          <h2 className="text-lg uppercase">Chỉnh ảnh đại diện</h2>
          <ImageEditor label="Chọn ảnh" defaultFit="cover" shape="round" required onChange={(value, reason) => { setEdited(value); setError(reason ?? null); }} />
          <div className="flex gap-2">
            <Button type="button" tone="ghost" full onClick={() => setEditing(false)}>Huỷ</Button>
            <Button type="button" tone="primary" full disabled={busy || !edited} onClick={() => void save()}>{busy ? "Đang lưu…" : "Lưu ảnh"}</Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
