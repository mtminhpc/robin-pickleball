/**
 * Bộ nhớ cục bộ của **một** sự kiện: khoá IndexedDB và cách dọn chúng.
 *
 * Hình dạng khoá được đặt ở đây thay vì nằm rải trong từng hook, vì có lúc phải
 * dọn chúng từ nơi khác hẳn: nút xóa sự kiện nằm ở trang chủ, ngoài mọi
 * `EventProvider`. Hai bản chép tay của cùng một chuỗi khoá sẽ lệch nhau đúng vào
 * lần đổi phiên bản tiếp theo, và hậu quả là ảnh chụp của một buổi đã xóa còn nằm
 * lại trên máy.
 *
 * Phạm vi dọn cố ý hẹp: đúng một mã sự kiện. Không đụng cookie, không đụng
 * `rp_recent_events_account`, không đụng bộ đệm của buổi khác.
 */

import { del } from "idb-keyval";
import { forgetEvent } from "./device";

/** Đệm snapshot đã lược quyền của một sự kiện, tách theo tài khoản đang xem. */
export function eventSnapshotStorageKey(code: string, userId: string): string {
  return `rp_event_snapshot_v6_${code}_${userId}`;
}

/** Hàng đợi lệnh chờ gửi khi mất mạng. */
export function eventQueueStorageKey(code: string): string {
  return `rp_queue_${code}`;
}

/**
 * Dọn dấu vết cục bộ của một sự kiện vừa bị xóa trên máy chủ.
 *
 * Xoá cả bản `anonymous` vì cùng một máy có thể đã mở buổi đó trước khi đăng nhập,
 * và bản đó vẫn sẽ được vẽ ra ở lần mở sau nếu bỏ sót.
 */
export async function clearLocalEventCache(
  code: string,
  userId: string | null | undefined,
): Promise<void> {
  forgetEvent(code);
  if (typeof window === "undefined") return;
  const keys = [
    eventQueueStorageKey(code),
    eventSnapshotStorageKey(code, "anonymous"),
    ...(userId ? [eventSnapshotStorageKey(code, userId)] : []),
  ];
  // Trình duyệt riêng tư có thể chặn IndexedDB. Không dọn được thì thôi — máy chủ
  // đã trả 410 cho mã này rồi, bản cũ trên máy không thể sống lại thành dữ liệu thật.
  await Promise.all(keys.map((key) => del(key).catch(() => undefined)));
}
