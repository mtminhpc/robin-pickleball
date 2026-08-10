"use client";

/**
 * Hộp xác nhận xóa sự kiện.
 *
 * Bắt gõ lại mã sự kiện chứ không phải bấm "Đồng ý": xóa là thao tác duy nhất
 * trong ứng dụng làm cả một buổi biến mất khỏi mọi danh sách, và nó nằm ngay cạnh
 * nút "Sao chép sự kiện" trên cùng một thẻ. Gõ mã buộc mắt phải đọc lại đúng buổi
 * nào đang bị chọn.
 *
 * Điều kiện khớp mã dùng **chung một hàm** với máy chủ. Nếu hai bên tự viết lấy,
 * một bên sẽ nới ra lúc nào không hay và hàng rào chỉ còn trên màn hình.
 */

import { useState } from "react";
import { Button, Dialog, Field, inputClass } from "@/components/ui";
import { isDeleteConfirmationValid } from "@/lib/domain/event-deletion";

export function DeleteEventDialog({
  code,
  name,
  open,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  code: string;
  name: string;
  open: boolean;
  busy: boolean;
  error: string;
  /** Chỉ đóng hộp thoại. Không có yêu cầu nào được gửi đi từ nhánh này. */
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [confirmation, setConfirmation] = useState("");
  const matches = isDeleteConfirmationValid(code, confirmation);

  const close = () => {
    setConfirmation("");
    onCancel();
  };

  return (
    <Dialog open={open} onClose={close} title={`Xóa sự kiện ${code}`}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (matches && !busy) onConfirm();
        }}
      >
        <div>
          <h2 className="font-display text-base font-extrabold uppercase">Xóa sự kiện</h2>
          <p className="mt-2 text-sm">
            <strong className="break-words">{name}</strong>{" "}
            <span className="font-mono text-xs">({code})</span>
          </p>
          <p className="mt-2 text-xs leading-relaxed text-mute-600">
            Buổi này sẽ biến khỏi danh sách, mục Gần đây và mọi đường dẫn công khai.
            Nhật ký, tỷ số và ảnh không bị xóa khỏi kho — chỉ App admin khôi phục được.
          </p>
        </div>

        <Field label={`Gõ lại mã ${code} để xác nhận`}>
          <input
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            className={`${inputClass} font-mono uppercase`}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            aria-label={`Gõ lại mã ${code}`}
          />
        </Field>

        {error && <p className="text-sm text-accent-700">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button type="button" onClick={close} disabled={busy}>
            Hủy
          </Button>
          <Button type="submit" tone="danger" disabled={!matches || busy}>
            {busy ? "Đang xóa…" : "Xóa sự kiện"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
