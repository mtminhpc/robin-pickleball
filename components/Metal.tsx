/**
 * Hệ "ánh kim" — khung và chữ cho nhà tài trợ, cúp và giải thưởng.
 *
 * Toàn bộ dải chuyển màu trong tệp này chép nguyên văn từ bộ bàn giao Claude
 * Design v3 (`Robin Pickleball - Nhà tài trợ.dc.html`, các lớp `.f-*` và `.mt-*`).
 * Đừng "chỉnh cho đẹp hơn" từng chỗ một: cái làm nên vẻ kim loại là **thứ tự các
 * chặng sáng–tối**, đổi một chặng là mặt kim loại thành mặt nhựa.
 *
 * Cấu trúc một khung gồm đúng hai lớp, và cả hai đều cần thiết:
 *
 *   • lớp ngoài — dải chuyển màu, chỉ hở ra 2px làm viền;
 *   • lớp trong (`tile`) — **giấy sáng**, không phải ô đen. Logo thật hầu hết là
 *     PNG chữ sẫm nền trắng; đặt lên nền đen thì mất chữ.
 *
 * Đây là lý do tệp này dùng `style` inline thay vì lớp Tailwind: dải nhiều chặng
 * kiểu này Tailwind không sinh ra được. Gom hết vào một chỗ thì vẫn còn đúng một
 * nguồn sự thật, giống vai trò của `tailwind.config.ts` với phần còn lại.
 */

import type { CSSProperties, ReactNode } from "react";
import type { AwardKind, SponsorTier } from "@/lib/domain/types";

export type MetalKey = "dia" | "gold" | "sil" | "bro" | "plain";

/**
 * Dải chuyển màu của viền khung. `plain` không có ánh kim — nó là viền mảnh.
 *
 * Đậm hơn bản thiết kế một bậc, có chủ ý. Bản gốc vẽ khung trên thẻ mẫu nền
 * `#f3f2f2` in trên trang `#e6e4e0`, tức lúc nào cũng có một nền xám bao quanh
 * đỡ lấy các chặng sáng. Trong app, dải nằm thẳng trên nền giấy nên mấy chặng
 * gần trắng tan vào trang và khung mỏng đi trông thấy.
 *
 * Cách chữa là **kéo các chặng tối xuống sâu hơn**, giữ nguyên chặng sáng và
 * giữ nguyên nhịp sáng–tối. Làm tối cả dải thì mất chất kim loại — thứ tạo ra
 * vẻ kim loại chính là khoảng cách giữa chỗ sáng nhất và chỗ tối nhất.
 */
export const METAL_FRAME: Record<Exclude<MetalKey, "plain">, string> = {
  dia: "linear-gradient(140deg,#54687c 0%,#ffffff 18%,#aabecf 38%,#394c60 54%,#f4f8fb 74%,#6d8399 100%)",
  gold: "linear-gradient(140deg,#5f430c 0%,#f3d68f 18%,#fff7dc 38%,#9a7415 54%,#fbeab7 74%,#65480d 100%)",
  sil: "linear-gradient(140deg,#6b6767 0%,#f6f5f5 22%,#b4b0b0 46%,#575454 62%,#eceaea 84%,#787474 100%)",
  bro: "linear-gradient(140deg,#5a3315 0%,#e6b184 20%,#f7dcc2 40%,#8a4f24 56%,#eec9a8 78%,#5f3717 100%)",
};

/**
 * Vạch tóc bao ngoài khung.
 *
 * Một pixel ink rất mờ, đủ để cạnh sáng của khung có chỗ dừng thay vì loang ra
 * nền giấy. Nó nằm ngoài kích thước khung nên không làm logo nhỏ lại.
 */
const FRAME_EDGE = "0 0 0 1px rgb(32 30 29 / 0.22)";

/** Ruột khung: giấy có ánh sáng chéo. */
export const TILE_FILL =
  "linear-gradient(148deg,#ffffff 0%,#f5f4f4 46%,#e7e6e6 100%)";
const TILE_FILL_PLAIN =
  "linear-gradient(148deg,#ffffff 0%,#f5f4f4 55%,#efeeee 100%)";

/** Chữ ánh kim trên nền sáng. */
export const METAL_TEXT: Record<Exclude<MetalKey, "plain">, string> = {
  dia: "linear-gradient(178deg,#33455a 0%,#6d8093 42%,#2b3c4d 56%,#5a6d7f 100%)",
  gold: "linear-gradient(178deg,#7d5c17 0%,#b8912f 42%,#6e5013 56%,#a4801f 100%)",
  sil: "linear-gradient(178deg,#4f4c4c 0%,#898686 42%,#3f3d3d 56%,#767373 100%)",
  bro: "linear-gradient(178deg,#75441f 0%,#ad7040 42%,#66391a 56%,#9a6234 100%)",
};

/** Cùng chữ đó nhưng trên băng tối — phải sáng hơn hẳn mới đọc được. */
export const METAL_TEXT_DARK: Record<Exclude<MetalKey, "plain">, string> = {
  dia: "linear-gradient(178deg,#ffffff 0%,#c9d6e2 45%,#8fa1b3 60%,#eef4f9 100%)",
  gold: "linear-gradient(178deg,#fff3cf 0%,#e2bd63 45%,#a9832a 60%,#f0d089 100%)",
  sil: "linear-gradient(178deg,#f2f1f1 0%,#c4c1c1 45%,#8f8b8b 60%,#dedcdc 100%)",
  bro: "linear-gradient(178deg,#e0aa78 0%,#c08a55 45%,#8a5227 60%,#d9a273 100%)",
};

/** Màu nét cúp mặc định, lấy theo chặng tối nhất của từng thang. */
export const METAL_STROKE: Record<MetalKey, string> = {
  dia: "#6c7c8c",
  gold: "#8a6620",
  sil: "#605d5d",
  bro: "#8a5227",
  plain: "#7d7979",
};

/**
 * Ba hạng đầu mang ánh kim; Đồng hành và hạng tự đặt dùng chung khung viền mảnh.
 * Đó là quy tắc của bản thiết kế (1g), không phải chuyện thiếu màu cho hai hạng kia.
 */
export function sponsorMetal(tier: SponsorTier): MetalKey {
  return tier === "diamond" ? "dia" : tier === "gold" ? "gold" : tier === "silver" ? "sil" : "plain";
}

/** Giải thưởng dùng lại đúng thang đó, chỉ đổi tông: vàng → bạc → đồng → viền mảnh (2c). */
export function awardMetal(kind: AwardKind): MetalKey {
  return kind === "champion" ? "gold" : kind === "runnerUp" ? "sil" : kind === "third" ? "bro" : "plain";
}

/**
 * Khung ánh kim.
 *
 * `size` tính bằng pixel vì bản thiết kế nói bằng pixel và các bậc chỉ chênh nhau
 * vài pixel (46/43/40). Ép chúng vào thang `rem` của Tailwind thì thứ tự hạng —
 * thứ duy nhất phân biệt các bậc — bị làm tròn mất.
 */
export function MetalFrame({
  metal,
  size,
  round = false,
  ring,
  className = "",
  children,
}: {
  metal: MetalKey;
  /** Bỏ trống thì khung ôm sát nội dung — dùng cho chip chữ, không phải ô logo. */
  size?: number;
  round?: boolean;
  /**
   * Bề dày viền. Mặc định 3px cho ô logo cỡ thật; khung nhỏ hơn 30px tự lùi về
   * 2px, nếu không cái viền ăn hết chỗ của thứ nó đóng khung.
   */
  ring?: number;
  className?: string;
  children?: ReactNode;
}) {
  const plain = metal === "plain";
  const shape = round ? "9999px" : "0";
  const width = ring ?? (size !== undefined && size < 30 ? 2 : 3);
  return (
    <span
      className={`grid flex-none place-items-center ${className}`}
      style={{
        ...(size === undefined ? {} : { width: size, height: size }),
        // Đồng hành và hạng tự đặt mỏng hơn đúng một pixel: chúng vẫn phải nhìn
        // rõ trên nền giấy, nhưng "viền mảnh, không ánh kim" là cách bản thiết
        // kế phân biệt chúng với ba hạng trên. Bằng nhau là mất thứ bậc.
        padding: plain ? Math.max(1, width - 1) : width,
        borderRadius: shape,
        boxShadow: FRAME_EDGE,
        background: plain ? "rgb(32 30 29 / 0.62)" : METAL_FRAME[metal],
      }}
    >
      <span
        className="grid size-full place-items-center overflow-hidden font-extrabold"
        style={{
          background: plain ? TILE_FILL_PLAIN : TILE_FILL,
          borderRadius: shape,
          letterSpacing: "-0.01em",
        }}
      >
        {children}
      </span>
    </span>
  );
}

/**
 * Nhãn hạng bằng chữ ánh kim.
 *
 * Hạng `plain` cố ý trả về chữ xám thường: bản thiết kế chỉ cho ánh kim ba hạng
 * đầu, và nếu hạng nào cũng lấp lánh thì không hạng nào lấp lánh.
 */
export function MetalText({
  metal,
  dark = false,
  className = "",
  style,
  children,
}: {
  metal: MetalKey;
  dark?: boolean;
  className?: string;
  /** Chỉ dùng cho cỡ chữ theo bậc — bản thiết kế nói bằng pixel lẻ (12/11/9). */
  style?: CSSProperties;
  children: ReactNode;
}) {
  const base = "font-display font-extrabold uppercase tracking-[0.1em]";
  if (metal === "plain") {
    return (
      <span className={`${base} ${dark ? "text-mute-400" : "text-mute-600"} ${className}`} style={style}>
        {children}
      </span>
    );
  }
  return (
    <span
      className={`bg-clip-text text-transparent ${base} ${className}`}
      style={{ ...style, backgroundImage: (dark ? METAL_TEXT_DARK : METAL_TEXT)[metal] }}
    >
      {children}
    </span>
  );
}

/** Cúp mặc định (Lucide `trophy`), chép nguyên từ bản thiết kế. */
export function TrophyIcon({
  size,
  stroke,
  strokeWidth = 1.6,
}: {
  size: number;
  stroke: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      style={{ width: size, height: size }}
      fill="none"
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </svg>
  );
}
