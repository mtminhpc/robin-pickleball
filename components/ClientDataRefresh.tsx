"use client";

import { useEffect } from "react";
import { del, keys } from "idb-keyval";
import { APP_VERSION } from "@/lib/version";
import { refreshLocalDataVersion } from "@/lib/client-data-version";

/**
 * Dọn trạng thái tạm đúng một lần khi phiên bản ứng dụng đổi.
 *
 * Những thứ được giữ:
 * - hồ sơ, sự kiện/CLB gần đây trong localStorage;
 * - cookie thiết bị và phiên đăng nhập;
 * - hàng đợi thao tác chưa gửi trong IndexedDB.
 *
 * Những thứ được làm mới: khoá `rp_` tạm từ phiên bản cũ, public snapshot trong
 * IndexedDB, sessionStorage và Cache Storage. Sau đó máy đã từng dùng app tải lại một lần để mọi component
 * đều khởi động từ mã và cache của phiên bản mới.
 */
export function ClientDataRefresh() {
  useEffect(() => {
    let result: ReturnType<typeof refreshLocalDataVersion>;
    try {
      result = refreshLocalDataVersion(window.localStorage, APP_VERSION);
    } catch {
      // Safari ở chế độ riêng tư có thể chặn storage. Không được biến việc dọn
      // cache thành lý do khiến ứng dụng không mở được.
      return;
    }

    if (!result.changed) return;

    try {
      window.sessionStorage.clear();
    } catch {
      // Như trên: dọn được phần nào thì dọn, không chặn lượt mở trang.
    }

    void Promise.all([clearBrowserCaches(), clearTemporaryIndexedDb()]).finally(() => {
      if (result.shouldReload) window.location.reload();
    });
  }, []);

  return null;
}

async function clearTemporaryIndexedDb(): Promise<void> {
  try {
    const all = await keys();
    await Promise.all(
      all
        .filter((key): key is string => typeof key === "string" && key.startsWith("rp_event_snapshot_"))
        .map((key) => del(key)),
    );
  } catch {
    // Không xoá `rp_queue_`: đó là lệnh người dùng chưa gửi, không phải cache.
  }
}

async function clearBrowserCaches(): Promise<void> {
  if (!("caches" in window)) return;
  try {
    const names = await window.caches.keys();
    await Promise.all(names.map((name) => window.caches.delete(name)));
  } catch {
    // Cache Storage không phải lúc nào cũng khả dụng (nhất là chế độ riêng tư).
  }
}
