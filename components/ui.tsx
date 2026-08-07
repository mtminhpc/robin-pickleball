"use client";

/**
 * Mấy mảnh giao diện dùng lại khắp nơi.
 *
 * Cỡ bấm tối thiểu 3rem ở mọi nút không phải để cho đẹp: người dùng đang đứng ở
 * sân, tay ướt mồ hôi, nhìn màn hình dưới nắng. Nút nhỏ là nút bấm nhầm.
 */

import { useEffect, useRef, type ReactNode } from "react";

type ButtonTone = "primary" | "neutral" | "danger" | "ghost";

const TONES: Record<ButtonTone, string> = {
  primary: "bg-court-500 text-white hover:bg-court-600 disabled:bg-court-700/40",
  neutral: "bg-slate-800 text-slate-100 hover:bg-slate-700 disabled:opacity-40",
  danger: "bg-red-600 text-white hover:bg-red-700 disabled:opacity-40",
  ghost: "text-slate-300 hover:bg-slate-800 disabled:opacity-40",
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
      className={`min-h-tap rounded-xl px-5 font-semibold transition disabled:cursor-not-allowed ${
        TONES[tone]
      } ${full ? "w-full" : ""} ${className}`}
    />
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border border-slate-800 bg-slate-900 ${className}`}>
      {children}
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
      <span className="text-sm font-medium text-slate-300">{label}</span>
      {children}
      {hint && <span className="block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "min-h-tap w-full rounded-xl border border-slate-700 bg-slate-950 px-4 text-slate-100 " +
  "placeholder:text-slate-600 focus:border-court-500 focus:outline-none";

/**
 * Hộp thoại.
 *
 * Dùng thẻ `<dialog>` gốc của trình duyệt để được phím Esc, khoá tiêu điểm và
 * lớp nền mờ miễn phí — tự dựng lại mấy thứ đó bằng tay luôn sai ở đâu đó, và
 * cái sai thường rơi vào người dùng bàn phím hoặc trình đọc màn hình.
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
      className="w-[min(28rem,calc(100vw-1.5rem))] rounded-2xl border border-slate-700 bg-slate-900 p-0 text-slate-100 backdrop:bg-black/70"
    >
      {open && (
        <div className="space-y-4 p-5">
          <h2 className="text-lg font-bold">{title}</h2>
          {children}
        </div>
      )}
    </dialog>
  );
}

/** Nhãn nhỏ cho trạng thái: đã về, đang nghỉ, chờ duyệt. */
export function Tag({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "warn" | "danger" | "ok";
  children: ReactNode;
}) {
  const palette = {
    neutral: "bg-slate-800 text-slate-300",
    warn: "bg-amber-500/15 text-amber-300",
    danger: "bg-red-500/15 text-red-300",
    ok: "bg-court-500/15 text-court-100",
  }[tone];
  return (
    <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${palette}`}>
      {children}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-800 p-8 text-center text-slate-500">
      {children}
    </div>
  );
}
