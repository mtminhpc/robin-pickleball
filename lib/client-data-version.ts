import { USER_LOCAL_STORAGE_KEYS } from "@/lib/identity/device";

/**
 * Dấu phiên bản của phần dữ liệu phía trình duyệt.
 *
 * Dùng luôn phiên bản ứng dụng để mỗi lần phát hành đều có một lượt dọn trạng
 * thái tạm. Hồ sơ, lịch sử mở gần đây, cookie và hàng đợi thao tác IndexedDB là
 * dữ liệu người dùng nên cố ý không nằm trong phạm vi xoá.
 */
export const CLIENT_DATA_VERSION_KEY = "rp_app_version";
const APP_KEY_PREFIX = "rp_";
const PRESERVED_KEYS = new Set<string>([
  CLIENT_DATA_VERSION_KEY,
  ...USER_LOCAL_STORAGE_KEYS,
]);

export interface StorageLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ClientDataRefreshResult {
  changed: boolean;
  /** Cần tải lại nếu đây là máy đã từng dùng app, không phải lượt mở đầu tiên. */
  shouldReload: boolean;
  removedKeys: string[];
  previousVersion: string | null;
}

/**
 * Xoá riêng các khoá tạm thuộc ứng dụng khi phiên bản đổi.
 *
 * Không gọi `localStorage.clear()`: làm vậy sẽ xoá cả hồ sơ và lịch sử của người
 * dùng. Chỉ các khoá có tiền tố `rp_` và không thuộc danh sách bảo toàn mới bị
 * dọn, nên dữ liệu lạ của cùng origin cũng không bị đụng tới.
 */
export function refreshLocalDataVersion(
  storage: StorageLike,
  currentVersion: string,
): ClientDataRefreshResult {
  const previousVersion = storage.getItem(CLIENT_DATA_VERSION_KEY);
  if (previousVersion === currentVersion) {
    return {
      changed: false,
      shouldReload: false,
      removedKeys: [],
      previousVersion,
    };
  }

  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(
    (key): key is string => Boolean(key),
  );
  const hadAppData = keys.some((key) => key.startsWith(APP_KEY_PREFIX));
  const removedKeys = keys.filter(
    (key) => key.startsWith(APP_KEY_PREFIX) && !PRESERVED_KEYS.has(key),
  );

  for (const key of removedKeys) storage.removeItem(key);
  storage.setItem(CLIENT_DATA_VERSION_KEY, currentVersion);

  return {
    changed: true,
    shouldReload: previousVersion !== null || hadAppData,
    removedKeys,
    previousVersion,
  };
}
