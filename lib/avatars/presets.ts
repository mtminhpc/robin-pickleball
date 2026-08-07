/**
 * Bộ ảnh đại diện.
 *
 * Tổ hợp 12 biểu tượng với 8 màu nền cho 96 lựa chọn, mã dạng `"e03-c05"`.
 *
 * Cố ý không dùng tệp ảnh vẽ tay: bộ tổ hợp cho nhiều lựa chọn hơn với vài chục
 * dòng mã, không phải lưu tệp ở đâu cả, không tốn lượt tải, và Google Sheet chỉ
 * cần giữ một chuỗi bảy ký tự. Với nhóm 20 người thì 96 lựa chọn là thừa để ai
 * cũng có ảnh riêng.
 *
 * Ai không chọn gì thì nhận một ảnh suy ra từ tên — luôn ra cùng kết quả cho
 * cùng một tên, nên "Nam" ở buổi này và buổi sau trông giống nhau.
 */

export const GLYPHS = [
  "🏓", "🎾", "🔥", "⚡", "🌊", "🍀",
  "🌟", "🦅", "🐯", "🦈", "🐝", "🌺",
] as const;

/** Màu nền, chọn để chữ trắng trên đó luôn đọc được. */
export const COLORS = [
  "#0e7490", // xanh mòng két
  "#15803d", // xanh lá
  "#b45309", // hổ phách
  "#b91c1c", // đỏ
  "#7e22ce", // tím
  "#1d4ed8", // xanh dương
  "#be185d", // hồng
  "#3f6212", // ô liu
] as const;

export interface Avatar {
  id: string;
  glyph: string;
  color: string;
}

export function avatarId(glyphIndex: number, colorIndex: number): string {
  return `e${pad(glyphIndex)}-c${pad(colorIndex)}`;
}

/**
 * Giải mã một mã ảnh đại diện.
 *
 * Mã lạ hay mã rỗng đều rơi về ảnh suy từ tên chứ không báo lỗi: dữ liệu cũ hoặc
 * ai đó sửa tay trong Google Sheet không đáng để làm hỏng cả màn hình.
 */
export function resolveAvatar(id: string | undefined, name: string): Avatar {
  const match = /^e(\d{2})-c(\d{2})$/.exec(id ?? "");
  if (match) {
    const glyph = GLYPHS[Number(match[1]) % GLYPHS.length]!;
    const color = COLORS[Number(match[2]) % COLORS.length]!;
    return { id: id!, glyph, color };
  }
  return derivedAvatar(name);
}

/** Ảnh suy từ tên. Cùng một tên luôn cho cùng một ảnh. */
export function derivedAvatar(name: string): Avatar {
  const hash = hashString(name.trim().toLowerCase() || "?");
  const glyphIndex = hash % GLYPHS.length;
  const colorIndex = Math.floor(hash / GLYPHS.length) % COLORS.length;
  return {
    id: avatarId(glyphIndex, colorIndex),
    glyph: GLYPHS[glyphIndex]!,
    color: COLORS[colorIndex]!,
  };
}

/** Toàn bộ 96 lựa chọn, xếp theo biểu tượng rồi tới màu. */
export function allAvatars(): Avatar[] {
  const out: Avatar[] = [];
  GLYPHS.forEach((glyph, g) => {
    COLORS.forEach((color, c) => {
      out.push({ id: avatarId(g, c), glyph, color });
    });
  });
  return out;
}

/**
 * Chữ cái đầu để hiện chồng lên ảnh ở các danh sách dày.
 * Lấy chữ cuối của tên, vì người Việt gọi nhau bằng tên chứ không bằng họ.
 */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const last = parts[parts.length - 1];
  return (last ?? "?").slice(0, 1).toUpperCase();
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function hashString(text: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
