"use client";

/**
 * Chọn ảnh đại diện.
 *
 * 96 lựa chọn là nhiều, nên bày theo lưới cuộn được với biểu tượng đang chọn
 * hiện rõ. Người chơi ở sân sẽ lướt vài giây rồi bấm đại một cái — không cần
 * tìm kiếm hay phân loại, chỉ cần bấm trúng dễ dàng.
 */

import { COLORS, GLYPHS, avatarId, resolveAvatar } from "@/lib/avatars/presets";

export function AvatarPicker({
  name,
  value,
  onChange,
}: {
  name: string;
  value: string | undefined;
  onChange: (id: string) => void;
}) {
  const current = resolveAvatar(value, name);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span
          className="inline-flex h-16 w-16 items-center justify-center rounded-full text-3xl"
          style={{ backgroundColor: current.color }}
          aria-hidden
        >
          {current.glyph}
        </span>
        <div className="text-sm text-mute-700">
          {value ? "Ảnh đang chọn" : "Ảnh tự chọn theo tên — bấm bên dưới để đổi"}
        </div>
      </div>

      <div className="max-h-64 overflow-y-auto rounded-xl border border-mute-300 p-2">
        {GLYPHS.map((glyph, g) => (
          // Lưới 8 cột co giãn thay vì nút cỡ cố định: 8 nút 44px cộng khoảng
          // cách vượt quá bề ngang điện thoại hẹp, và hàng đó sẽ bị cắt mất
          // trong khung chỉ cuộn dọc.
          <div key={glyph} className="mb-1.5 grid grid-cols-8 gap-1.5">
            {COLORS.map((color, c) => {
              const id = avatarId(g, c);
              const selected = id === value;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onChange(id)}
                  aria-label={`Ảnh ${glyph} nền màu ${c + 1}`}
                  aria-pressed={selected}
                  className={`flex aspect-square w-full items-center justify-center rounded-full text-xl transition ${
                    selected ? "ring-4 ring-white" : "ring-1 ring-white/10"
                  }`}
                  style={{ backgroundColor: color }}
                >
                  {glyph}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
