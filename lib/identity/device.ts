/**
 * Danh tính theo thiết bị.
 *
 * Người chơi ở sân không muốn tạo tài khoản. Nhưng ứng dụng vẫn cần biết "cái
 * điện thoại này là ai" để làm được ba việc: tự điền tên lần sau, cho phép chính
 * người vừa nhập điểm tự sửa trong hai phút, và nhận ra người quay lại sau khi
 * tạm rời.
 *
 * Máy chủ cấp một cookie `rp_device` (xem `middleware.ts`); tên và ảnh đại diện
 * thì nằm ở `localStorage` vì chúng chỉ phục vụ việc hiển thị.
 *
 * Phần lịch sử các sự kiện cũ theo thiết bị để sang giai đoạn sau cùng với câu
 * lạc bộ — ở đây chỉ làm đủ để máy nhớ được chủ nhân của nó.
 */

export const DEVICE_COOKIE = "rp_device";
export const PROFILE_KEY = "rp_profile";
export const RECENT_KEY = "rp_recent_events";
export const CLUBS_KEY = "rp_recent_clubs";
/** Dữ liệu thuộc về người dùng, phải sống qua mọi lần nâng phiên bản. */
export const USER_LOCAL_STORAGE_KEYS = [PROFILE_KEY, RECENT_KEY, CLUBS_KEY] as const;
const MAX_RECENT = 12;

export interface DeviceProfile {
  name: string;
  avatarId: string;
}

export interface RecentEvent {
  code: string;
  name: string;
  lastOpenedAt: number;
}

/** Đọc cookie thiết bị ở phía trình duyệt. Máy chủ đọc thẳng từ request. */
export function readDeviceId(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp(`(?:^|;\\s*)${DEVICE_COOKIE}=([^;]+)`),
  );
  return match?.[1] ?? null;
}

export function loadProfile(): DeviceProfile | null {
  return readJson<DeviceProfile>(PROFILE_KEY);
}

export function saveProfile(profile: DeviceProfile): void {
  writeJson(PROFILE_KEY, profile);
}

export function loadRecentEvents(): RecentEvent[] {
  return readJson<RecentEvent[]>(RECENT_KEY) ?? [];
}

/**
 * Ghi nhớ một sự kiện vừa mở, mới nhất lên đầu.
 *
 * Đây là thứ khiến trang chủ hữu ích ở lần mở thứ hai: người chơi không phải nhớ
 * mã sáu ký tự, chỉ cần bấm vào tên buổi đánh hôm trước.
 */
export function rememberEvent(code: string, name: string): void {
  const now = Date.now();
  const rest = loadRecentEvents().filter((e) => e.code !== code);
  writeJson(RECENT_KEY, [{ code, name, lastOpenedAt: now }, ...rest].slice(0, MAX_RECENT));
}

export interface RecentClub {
  id: string;
  name: string;
  lastOpenedAt: number;
}

export function loadRecentClubs(): RecentClub[] {
  return readJson<RecentClub[]>(CLUBS_KEY) ?? [];
}

/**
 * Ghi nhớ câu lạc bộ vừa mở.
 *
 * Máy chủ cũng biết được điều này qua cookie thiết bị, nhưng đọc từ đây thì trang
 * chủ hiện ra ngay không phải chờ mạng — và vẫn đúng trong đại đa số trường hợp.
 */
export function rememberClub(id: string, name: string): void {
  const rest = loadRecentClubs().filter((c) => c.id !== id);
  writeJson(CLUBS_KEY, [{ id, name, lastOpenedAt: Date.now() }, ...rest].slice(0, MAX_RECENT));
}

export function forgetEvent(code: string): void {
  writeJson(
    RECENT_KEY,
    loadRecentEvents().filter((e) => e.code !== code),
  );
}

// ---------------------------------------------------------------------------

function readJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    // Chế độ riêng tư của Safari chặn localStorage. Không nhớ được thì thôi,
    // không phải lý do để cả trang hỏng.
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // như trên
  }
}
