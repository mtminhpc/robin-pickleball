"use client";

/**
 * Mấy mảnh giao diện dùng lại khắp nơi, theo hệ thống "Modernist".
 *
 * Ba luật của hệ này, giữ được thì mọi màn hình tự khớp nhau:
 *   • **Không bo góc.** Cạnh thẳng, khối rõ.
 *   • **Phân tách bằng đường kẻ, không bằng bóng đổ.** Kẻ đậm 2px cho ranh giới
 *     lớn, kẻ mảnh 1px cho từng dòng.
 *   • **Nhãn là chữ hoa giãn cách và đậm nhất; nội dung thì chữ thường.**
 *
 * Cỡ bấm tối thiểu 3rem ở mọi nút không phải để cho đẹp: người dùng đang đứng ở
 * sân, tay ướt mồ hôi, nhìn màn hình dưới nắng. Nút nhỏ là nút bấm nhầm.
 */

import { useEffect, useRef, type ReactNode } from "react";

type ButtonTone = "primary" | "neutral" | "danger" | "ghost";

const TONES: Record<ButtonTone, string> = {
  // Nút chính: khối đặc màu nhấn. Mỗi màn hình chỉ nên có một cái.
  primary: "bg-accent text-paper hover:bg-accent-600 active:bg-accent-700 disabled:bg-mute-400",
  // Nút thường: viền đậm màu chữ. Đây mới là nút hay dùng nhất.
  neutral: "border border-ink hover:bg-ink/[0.07] active:bg-ink/[0.14] disabled:opacity-40",
  // Việc không lùi được: viền nhạt, chữ đỏ sẫm. Cố ý KHÔNG phải khối đỏ đặc —
  // khối đỏ đặc trông giống nút chính, mà đây là nút người ta cần do dự.
  danger: "border border-line text-accent-700 hover:bg-accent-100 disabled:opacity-40",
  ghost: "text-accent hover:bg-accent/10 active:bg-accent/[0.18] disabled:opacity-40",
};

export function Button({
  tone = "neutral",
  full = false,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: ButtonTone;
  full?: boolean;
}) {
  return (
    <button
      {...props}
      className={`inline-flex min-h-tap items-center justify-center gap-2 px-4 font-display text-[11px] font-extrabold uppercase tracking-[0.08em] transition disabled:cursor-not-allowed ${
        TONES[tone]
      } ${full ? "w-full" : ""} ${className}`}
    />
  );
}

/**
 * Tiêu đề mục: số thứ tự màu nhấn, tên mục, và chú thích dạt phải.
 *
 * Cái số không mang thông tin gì — nó là nhịp. Nhờ nó mà mắt biết đây là một mục
 * mới chứ không phải thêm một dòng dữ liệu nữa, kể cả khi lướt nhanh.
 */
export function SectionHead({
  n,
  children,
  aside,
  className = "",
}: {
  n?: string;
  children: ReactNode;
  aside?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rule-head ${className}`}>
      {n && (
        <span className="font-display text-[11px] font-extrabold leading-none text-accent">
          {n}
        </span>
      )}
      <h2 className="eyebrow m-0">{children}</h2>
      {aside && (
        <span className="eyebrow ml-auto font-normal text-mute-600">{aside}</span>
      )}
    </div>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`bg-surface p-4 ${className}`}>{children}</div>;
}

/** Khối tối để nói một điều quan trọng. Dùng dè — nhiều quá thì hết quan trọng. */
export function InkNote({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="bg-ink p-5 text-paper">
      <div className="mb-3.5 h-1.5 w-6 bg-accent" />
      <p className="font-display text-lg font-extrabold leading-tight tracking-[-0.02em]">
        {title}
      </p>
      {children && (
        <p className="mt-3 text-xs leading-relaxed text-mute-400">{children}</p>
      )}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-xs text-mute-700">{label}</span>
      {children}
      {hint && <span className="block text-xs text-mute-600">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "min-h-tap w-full border border-line bg-surface px-3 text-ink caret-accent " +
  "placeholder:text-mute-600 focus:border-accent focus:outline-none";

/**
 * Hộp thoại.
 *
 * Dùng thẻ `<dialog>` gốc của trình duyệt để được phím Esc, khoá tiêu điểm và
 * lớp nền mờ miễn phí — tự dựng lại mấy thứ đó bằng tay luôn sai ở đâu đó, và
 * cái sai thường rơi vào người dùng bàn phím hoặc trình đọc màn hình.
 *
 * Vạch đỏ trên đỉnh là dấu "có việc cần bạn quyết", lấy từ bản thiết kế.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      aria-label={title}
      className="w-[min(26.25rem,calc(100vw-1.5rem))] border-t-[6px] border-accent bg-paper p-0 text-ink shadow-lg backdrop:bg-mute-900/50"
    >
      {open && <div className="p-4">{children}</div>}
    </dialog>
  );
}

/** Nhãn nhỏ có nền cho trạng thái: đã về, đang nghỉ, chờ duyệt. */
export function Tag({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "warn" | "danger" | "ok";
  children: ReactNode;
}) {
  const palette = {
    neutral: "bg-mute-100 text-mute-800",
    warn: "bg-accent-100 text-accent-800",
    danger: "bg-accent text-paper",
    ok: "border border-accent text-accent",
  }[tone];
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 text-[11px] tracking-[0.02em] ${palette}`}
    >
      {children}
    </span>
  );
}

/** Nhãn chữ hoa trần, không nền — dùng trong các dòng dày đặc dữ liệu. */
export function Marker({
  children,
  tone = "mute",
}: {
  children: ReactNode;
  tone?: "mute" | "accent" | "ink";
}) {
  const color = {
    mute: "text-mute-600",
    accent: "text-accent-700",
    ink: "border border-ink px-2 py-0.5 text-ink",
  }[tone];
  return (
    <span className={`text-[10px] uppercase tracking-[0.14em] ${color}`}>
      {children}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="border border-dashed border-mute-400 p-8 text-center text-mute-600">
      {children}
    </div>
  );
}
