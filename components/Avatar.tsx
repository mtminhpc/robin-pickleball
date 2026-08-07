"use client";

import { resolveAvatar } from "@/lib/avatars/presets";

const SIZES = {
  sm: "h-7 w-7 text-sm",
  md: "h-10 w-10 text-lg",
  lg: "h-16 w-16 text-3xl",
} as const;

export function Avatar({
  name,
  avatarId,
  size = "md",
  dimmed = false,
}: {
  name: string;
  avatarId?: string;
  size?: keyof typeof SIZES;
  /** Người đã về hoặc đang nghỉ tạm: vẫn thấy được nhưng lùi ra sau. */
  dimmed?: boolean;
}) {
  const avatar = resolveAvatar(avatarId, name);
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full ${SIZES[size]} ${
        dimmed ? "opacity-45 grayscale" : ""
      }`}
      style={{ backgroundColor: avatar.color }}
      // Ảnh chỉ là trang trí, tên luôn hiện ngay bên cạnh nên không cần đọc lên.
      aria-hidden
      title={name}
    >
      {avatar.glyph}
    </span>
  );
}
