/**
 * Danh tính theo thiết bị.
 *
 * Người chơi ở sân không muốn tạo tài khoản. Nhưng ứng dụng vẫn cần biết "cái
 * điện thoại này là ai" để làm được ba việc: tự điền tên lần sau, cho phép chính
 * người vừa nhập điểm tự sửa trong hai phút, và nhận ra người quay lại sau khi
 * tạm rời.
 *
 * Máy chủ cấp một cookie `rp_device` có chữ ký và `httpOnly` (xem
 * `middleware.ts`); tên và ảnh đại diện thì nằm ở `localStorage` vì chúng chỉ
 * phục vụ việc hiển thị. Mã chạy trên trang không cần và không được đọc giấy
 * thông hành này.
 *
 * Phần lịch sử các sự kiện cũ theo thiết bị để sang giai đoạn sau cùng với câu
 * lạc bộ — ở đây chỉ làm đủ để máy nhớ được chủ nhân của nó.
 */

export const DEVICE_COOKIE = "rp_device";
export const PROFILE_KEY = "rp_profile";
export const RECENT_KEY = "rp_recent_events";
export const RECENT_ACCOUNT_KEY = "rp_recent_events_account";
export const CLUBS_KEY = "rp_recent_clubs";
/** Dữ liệu thuộc về người dùng, phải sống qua mọi lần nâng phiên bản. */
export const USER_LOCAL_STORAGE_KEYS = [
  PROFILE_KEY,
  RECENT_KEY,
  RECENT_ACCOUNT_KEY,
  CLUBS_KEY,
] as const;
export const MAX_RECENT = 12;

export interface DeviceProfile {
  name: string;
  avatarId: string;
}

export interface RecentEvent {
  code: string;
  name: string;
  lastOpenedAt: number;
}

export function loadProfile(): DeviceProfile | null {
  return readJson<DeviceProfile>(PROFILE_KEY);
}

export function saveProfile(profile: DeviceProfile): void {
  writeJson(PROFILE_KEY, profile);
}

export function loadRecentEvents(): RecentEvent[] {
  const stored = readJson<unknown>(RECENT_KEY);
  if (!Array.isArray(stored)) return [];
  return normalizeRecentEvents(stored);
}

/**
 * Ghi lại danh sách đã được máy chủ gộp từ các thiết bị của cùng tài khoản.
 *
 * Tên lấy từ snapshot trên Sheet chứ không tin chuỗi do trình duyệt khác gửi
 * lên. Hàm vẫn allowlist hình dạng trước khi chạm localStorage để một giá trị cũ
 * hoặc hỏng không làm trang chủ lỗi mãi ở mọi lần mở sau.
 */
export function saveRecentEvents(events: readonly RecentEvent[]): void {
  writeJson(RECENT_KEY, normalizeRecentEvents(events));
}

/**
 * Chỉ gửi lịch sử cục bộ cho tài khoản đã đồng bộ nó trước đó.
 *
 * Khoá chưa có là dữ liệu legacy và được nhận vào tài khoản đầu tiên — đây là
 * bước cứu lịch sử trên điện thoại hiện tại. Nếu một Gmail khác đăng nhập sau,
 * không tải lịch sử của người trước lên tài khoản mới.
 */
export function recentEventsForAccount(userId: string): RecentEvent[] {
  if (typeof window === "undefined" || !userId) return [];
  try {
    const bound = window.localStorage.getItem(RECENT_ACCOUNT_KEY);
    return !bound || bound === userId ? loadRecentEvents() : [];
  } catch {
    return [];
  }
}

export function saveAccountRecentEvents(
  userId: string,
  events: readonly RecentEvent[],
): void {
  saveRecentEvents(events);
  if (typeof window === "undefined" || !userId) return;
  try {
    window.localStorage.setItem(RECENT_ACCOUNT_KEY, userId);
  } catch {
    // Safari riêng tư có thể chặn localStorage; danh sách trên máy chủ vẫn an toàn.
  }
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
  saveRecentEvents([{ code, name, lastOpenedAt: now }, ...rest]);
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

function normalizeRecentEvents(value: readonly unknown[]): RecentEvent[] {
  const out: RecentEvent[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Partial<RecentEvent>;
    const code = typeof raw.code === "string" ? raw.code.trim().toUpperCase() : "";
    const name = typeof raw.name === "string" ? raw.name.trim().slice(0, 80) : "";
    const lastOpenedAt = Number(raw.lastOpenedAt);
    if (!/^[A-Z0-9]{4,6}$/.test(code) || !name || !Number.isFinite(lastOpenedAt)) continue;
    if (out.some((event) => event.code === code)) continue;
    out.push({ code, name, lastOpenedAt: Math.max(0, Math.floor(lastOpenedAt)) });
    if (out.length === MAX_RECENT) break;
  }
  return out;
}
