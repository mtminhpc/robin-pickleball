/**
 * Tài khoản Google, và sợi dây nối tài khoản với những cái điện thoại đã dùng.
 *
 * Giai đoạn trước, danh tính bám theo `deviceId` trong cookie. Đủ dùng ở sân,
 * nhưng đổi điện thoại hay xoá dữ liệu trình duyệt là mất sạch lịch sử — và
 * người dùng chỉ phát hiện ra đúng lúc họ mất. Tài khoản là để chữa chuyện đó.
 *
 * Điều quan trọng nhất về thiết kế ở đây: **tài khoản không thay thế thiết bị,
 * nó gom các thiết bị lại**. Người ra sân vẫn quét mã QR rồi gõ tên như cũ,
 * không ai bị bắt đăng nhập. Ai muốn giữ số liệu xuyên thiết bị thì đăng nhập,
 * và mọi thứ cái máy đó từng làm được gắn về tài khoản.
 *
 * Hệ quả là mỗi người có thể có nhiều `deviceId` cùng trỏ về một `userId`, và
 * đó là trạng thái bình thường chứ không phải lỗi cần dọn.
 */

export type UserId = string;

/**
 * Tiền tố của **tài khoản vãng lai** — người chơi có ảnh thật mà không có Google.
 *
 * Ảnh phải nằm ở bảng `accounts` chứ không nằm trong trạng thái sự kiện: trạng
 * thái đã phải cắt làm bốn ô vì mỗi ô Sheets chỉ chứa 50.000 ký tự, mà mười sáu
 * tấm ảnh là hơn nửa ngân sách đó. Nên người vào bằng mã QR cũng được cấp một
 * dòng tài khoản, chỉ khác là `email` rỗng.
 *
 * Tiền tố có hai việc: nhìn bảng tính là biết ngay dòng nào không phải người
 * đăng nhập, và `isGuestUser` trả lời được câu đó mà không phải đọc Sheet.
 */
export const GUEST_PREFIX = "g-";

export function isGuestUser(userId: UserId): boolean {
  return userId.startsWith(GUEST_PREFIX);
}

export interface Account {
  userId: UserId;
  /** Đã chuẩn hoá chữ thường. **Rỗng với tài khoản vãng lai** — xem `GUEST_PREFIX`. */
  email: string;
  displayName: string;
  avatarId: string;
  createdAt: number;
  prefs: AccountPrefs;
}

export interface AccountPrefs {
  /**
   * Địa chỉ ảnh đại diện bên Google, lấy về lúc đăng nhập.
   *
   * Chỉ là địa chỉ chứ không phải ảnh: đường `/api/avatar/[userId]` chuyển hướng
   * sang đây khi người dùng chưa tự tải ảnh nào. Google đổi ảnh thì lần đăng nhập
   * sau tự cập nhật — đúng điều người ta mong đợi, và không tốn chỗ nào cả.
   */
  picture?: string;
  /**
   * Ảnh người dùng tự tải lên, dạng data URI đã nén còn 128×128.
   *
   * Đè lên `picture` khi có. Giữ riêng hai trường chứ không ghi đè lẫn nhau, vì
   * chúng trả lời hai câu khác nhau: `picture` là "Google nói mặt bạn thế này",
   * `photo` là "bạn nói mặt bạn thế này". Xoá `photo` thì phải quay về được
   * `picture` mà không cần đăng nhập lại.
   *
   * Giới hạn độ dài ở `MAX_PHOTO_CHARS` trong [../avatars/photo.ts](../avatars/photo.ts).
   */
  photo?: string;
}

/** Một cái điện thoại đã nhận là của ai. */
export interface DeviceLink {
  deviceId: string;
  userId: UserId;
  displayName: string;
  avatarId: string;
  lastSeen: number;
  /**
   * Mã các buổi đánh máy này đã mở.
   *
   * Vẫn nằm ở `localStorage` như cũ để trang chủ hiện ra ngay không phải chờ
   * mạng; chép lên đây là để **máy khác của cùng tài khoản đọc được**. Không có
   * bước chép này thì đăng nhập trên điện thoại mới vẫn thấy trang trống trơn,
   * tức là tài khoản không mua được gì.
   */
  recentEvents: string[];
}

/** Giữ bao nhiêu mã buổi cho mỗi thiết bị. Khớp với `MAX_RECENT` phía trình duyệt. */
export const MAX_DEVICE_EVENTS = 60;

/**
 * Chuẩn hoá email trước khi so sánh.
 *
 * Google trả về đúng một dạng, nhưng dữ liệu đã nằm trong Sheet thì người ta sửa
 * tay được — và một chữ hoa lạc vào là lần đăng nhập sau mọc ra một tài khoản
 * thứ hai, mang theo một nửa lịch sử.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Gộp danh sách mã buổi cũ với mã mới gửi lên, mới nhất đứng trước.
 *
 * Không xoá mã cũ chỉ vì lần này trình duyệt không gửi lên: người dùng có thể
 * vừa xoá dữ liệu trình duyệt, và nếu ta tin danh sách rỗng đó thì việc đăng
 * nhập lại chính là lúc lịch sử biến mất.
 */
export function mergeRecentEvents(
  existing: readonly string[],
  incoming: readonly string[],
  max = MAX_DEVICE_EVENTS,
): string[] {
  const out: string[] = [];
  for (const code of [...incoming, ...existing]) {
    const trimmed = code.trim();
    if (trimmed !== "" && !out.includes(trimmed)) out.push(trimmed);
  }
  return out.slice(0, max);
}

/**
 * Tên hiển thị lấy từ Google.
 *
 * Google có thể trả về tên rỗng (tài khoản chỉ có email). Lấy phần trước `@`
 * còn hơn hiện một khoảng trắng trong danh bạ câu lạc bộ.
 */
export function displayNameFrom(name: string, email: string): string {
  const trimmed = name.trim();
  if (trimmed !== "") return trimmed.slice(0, 40);
  return (email.split("@")[0] ?? "Người chơi").slice(0, 40);
}
