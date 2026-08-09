"use client";

/**
 * Chọn ảnh đại diện thật cho tài khoản của mình.
 *
 * Chỉ hiện khi đã đăng nhập, vì ảnh gắn với tài khoản chứ không với cái máy —
 * lưu theo máy thì đổi điện thoại là mất, đúng thứ tài khoản sinh ra để chữa.
 * Chưa đăng nhập thì vẫn thấy ảnh biểu tượng suy từ tên, y như trước.
 *
 * Ảnh được thu nhỏ ngay trên máy người dùng trước khi gửi (xem
 * [lib/avatars/resize.ts](../lib/avatars/resize.ts)). Sau khi lưu xong thì hiện
 * luôn tấm vừa chọn thay vì đi tải lại từ máy chủ: nó đã nằm sẵn trong bộ nhớ,
 * và chờ một vòng mạng chỉ để thấy đúng tấm ảnh mình vừa chọn là chờ vô ích.
 */

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { shrinkToDataUri } from "@/lib/avatars/resize";
import { ACCOUNT_KEY, useAccount } from "@/hooks/useAccount";
import { Avatar } from "@/components/Avatar";

export function PhotoPicker({
  fallbackName,
  fallbackAvatarId,
}: {
  /** Tên và ảnh biểu tượng lấy từ máy này, dùng khi chưa đăng nhập. */
  fallbackName: string;
  fallbackAvatarId?: string;
}) {
  const { data } = useAccount();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [preview, setPreview] = useState<string | null>(null);
  const [bust, setBust] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const user = data?.user ?? null;
  const name = user?.displayName || fallbackName;

  const src =
    preview ??
    (user
      ? `/api/avatar/${encodeURIComponent(user.userId)}${bust > 0 ? `?v=${bust}` : ""}`
      : undefined);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const photo = await shrinkToDataUri(file);
      const res = await fetch("/api/me/avatar", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ photo }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Không lưu được ảnh.");
      setPreview(photo);
      queryClient.invalidateQueries({ queryKey: ACCOUNT_KEY });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không lưu được ảnh.");
    } finally {
      setBusy(false);
      // Xoá giá trị ô chọn tệp, nếu không thì chọn lại đúng tấm vừa lỗi sẽ không
      // kích hoạt `change` lần nữa và người dùng tưởng nút hỏng.
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/me/avatar", { method: "DELETE" });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Không xoá được ảnh.");
      setPreview(null);
      // Ảnh cũ còn nằm trong bộ nhớ đệm trình duyệt tới một phút. Đổi địa chỉ là
      // cách chắc chắn để thấy ngay kết quả của việc mình vừa bấm.
      setBust((n) => n + 1);
      queryClient.invalidateQueries({ queryKey: ACCOUNT_KEY });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không xoá được ảnh.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-3">
        <Avatar
          name={name}
          avatarId={user?.avatarId ?? fallbackAvatarId}
          src={src}
          size="lg"
          dimmed={busy}
        />
        {user && (
          <div className="flex flex-col items-start gap-1">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => pick(e.target.files?.[0])}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className="eyebrow min-h-9 text-accent-700 underline underline-offset-4 disabled:opacity-40"
            >
              {busy ? "Đang lưu…" : "Đổi ảnh"}
            </button>
            {(preview !== null || user.hasPhoto) && (
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
    </div>
  );
}
