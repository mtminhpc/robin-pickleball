"use client";

/**
 * Ảnh đại diện, hai tầng.
 *
 * Có `userId` thì thử tải ảnh thật ở `/api/avatar/<userId>` — ảnh người đó tự
 * tải lên, hoặc ảnh tài khoản Google của họ. Không có, hoặc tải hỏng, thì rơi về
 * biểu tượng suy từ tên như trước giờ.
 *
 * **Rơi về được là điều kiện bắt buộc, không phải tính năng thêm.** Phần lớn
 * người ra sân không đăng nhập bao giờ, nên trường hợp "không có ảnh" mới là
 * trường hợp thường gặp. Ngoài ra địa chỉ ảnh Google có hạn dùng: một buổi đánh
 * mở suốt buổi tối mà ảnh hết hạn giữa chừng thì phải thành biểu tượng, không
 * được thành ô vỡ.
 */

import { useEffect, useState } from "react";
import { resolveAvatar } from "@/lib/avatars/presets";

const SIZES = {
  /** Hàng lịch: bốn người trên một hàng ở màn hình điện thoại, phải thật gọn. */
  xs: "h-5 w-5 text-[10px]",
  sm: "h-7 w-7 text-sm",
  md: "h-10 w-10 text-lg",
  lg: "h-16 w-16 text-3xl",
} as const;

export function Avatar({
  name,
  avatarId,
  userId,
  src,
  size = "md",
  dimmed = false,
}: {
  name: string;
  avatarId?: string;
  /** Tài khoản của người này, nếu họ đã đăng nhập. Dùng để tìm ảnh thật. */
  userId?: string;
  /** Ghi đè thẳng địa chỉ ảnh. Dùng khi xem trước ảnh vừa chọn, chưa gửi đi. */
  src?: string;
  size?: keyof typeof SIZES;
  /** Người đã về hoặc đang nghỉ tạm: vẫn thấy được nhưng lùi ra sau. */
  dimmed?: boolean;
}) {
  const avatar = resolveAvatar(avatarId, name);
  const photo = src ?? (userId ? `/api/avatar/${encodeURIComponent(userId)}` : null);

  const [state, setState] = useState<"cho" | "xong" | "hong">("cho");
  // Đổi người là phải thử lại từ đầu. Thiếu dòng này thì một ô ảnh hỏng sẽ dính
  // cờ hỏng vĩnh viễn, và React dùng lại chính ô đó cho người khác khi danh sách
  // đổi thứ tự — hoá ra người có ảnh lại mất ảnh.
  useEffect(() => setState("cho"), [photo]);

  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full ${SIZES[size]} ${
        dimmed ? "opacity-45 grayscale" : ""
      }`}
      style={{ backgroundColor: avatar.color }}
      // Ảnh chỉ là trang trí, tên luôn hiện ngay bên cạnh nên không cần đọc lên.
      aria-hidden
      title={name}
    >
      {/*
        Biểu tượng luôn được vẽ, và ảnh nằm đè lên nó chứ không thay thế nó.

        Bản trước đổi qua lại giữa hai thứ, và nó hỏng ở đúng khoảng thời gian
        không ai nghĩ tới: từ lúc bắt đầu tải cho tới lúc `onError` kêu lên. Với
        một địa chỉ ảnh trỏ vào máy chủ không phản hồi, khoảng đó dài hàng chục
        giây — suốt từng ấy thời gian người dùng nhìn thấy một vòng tròn màu
        rỗng không. Xếp chồng thì không còn khoảng trống nào cả: biểu tượng hiện
        ngay, ảnh chỉ lộ ra khi nó thật sự tải xong.
      */}
      <span className="leading-none">{avatar.glyph}</span>
      {photo && state !== "hong" && (
        // Thẻ `img` thường, cố ý không dùng `next/image`: dự án không có
        // `next.config`, và `/_next/image` kéo theo `sharp` — đúng thứ đã tránh.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photo}
          alt=""
          loading="lazy"
          decoding="async"
          onLoad={() => setState("xong")}
          onError={() => setState("hong")}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity ${
            state === "xong" ? "opacity-100" : "opacity-0"
          }`}
        />
      )}
    </span>
  );
}
