/**
 * Bộ nhớ đệm đường đọc và khoá tuần tự đường ghi.
 *
 * Không phải tối ưu mà là điều kiện để ứng dụng chạy được. Hạn mức Sheets là 60
 * request mỗi phút cho cả tài khoản dịch vụ. Hai mươi người cùng mở app và hỏi
 * lại mỗi 3 giây là 400 request mỗi phút — vượt gấp bảy lần. Bộ nhớ đệm của
 * Next dùng chung giữa các hàm serverless kéo xuống còn tối đa 12 lần đọc mỗi
 * phút cho mỗi sự kiện, bất kể có bao nhiêu người đang xem.
 */

import { revalidateTag, unstable_cache } from "next/cache";
import type { EventState } from "../domain/types";
import { getSheetsClient } from "./factory";
import { EventRepo, type EventRecord } from "./repo";

/** Bao lâu thì chấp nhận dữ liệu cũ. Ghi thì xoá đệm ngay nên không ai phải chờ. */
const TTL_SECONDS = 5;

export interface CachedEvent {
  record: EventRecord;
  state: EventState;
  repaired: boolean;
}

export function eventTag(code: string): string {
  return `event:${code}`;
}

export function getRepo(): EventRepo {
  return new EventRepo(getSheetsClient());
}

/**
 * Đọc trạng thái sự kiện qua bộ nhớ đệm.
 *
 * `unstable_cache` được chia sẻ giữa các thực thể hàm trong cùng một vùng, nên
 * hai mươi điện thoại cùng hỏi chỉ tốn một lần đọc Google Sheet.
 */
export async function readEvent(code: string): Promise<CachedEvent | null> {
  const load = unstable_cache(
    async (eventCode: string) => {
      const loaded = await getRepo().load(eventCode);
      if (!loaded) return null;
      return {
        record: loaded.record,
        state: loaded.state,
        repaired: loaded.repaired,
      } satisfies CachedEvent;
    },
    ["event-state"],
    { tags: [eventTag(code)], revalidate: TTL_SECONDS },
  );
  return load(code);
}

/** Xoá đệm sau khi ghi, để người vừa bấm thấy kết quả ngay chứ không đợi 5 giây. */
export function invalidateEvent(code: string): void {
  revalidateTag(eventTag(code));
}

// ---------------------------------------------------------------------------
// Khoá tuần tự cho đường ghi
// ---------------------------------------------------------------------------

const inFlight = new Map<string, Promise<unknown>>();

/**
 * Xếp hàng các lệnh ghi của cùng một sự kiện.
 *
 * Chỉ có tác dụng trong phạm vi một thực thể hàm. Hai hàm serverless khác nhau
 * vẫn ghi song song được — chỗ đó đã có nhật ký chỉ-ghi-thêm lo, và lần đọc sau
 * sẽ phát hiện ảnh chụp bị ghi đè rồi dựng lại. Khoá này chỉ để bớt đi trường
 * hợp phải dựng lại, không phải để bảo đảm tính đúng đắn.
 */
export async function withEventLock<T>(
  code: string,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = inFlight.get(code) ?? Promise.resolve();
  const result = previous.then(fn, fn);
  // Nuốt lỗi ở bản dùng để xếp hàng, nếu không một lệnh hỏng sẽ kéo theo mọi lệnh
  // đứng sau. Lỗi vẫn nổi lên ở `result` cho người gọi.
  const queued = result.then(
    () => undefined,
    () => undefined,
  );
  inFlight.set(code, queued);

  try {
    return await result;
  } finally {
    // Chỉ dọn khi mình là lệnh cuối, để không xoá mất hàng đợi của lệnh đến sau.
    if (inFlight.get(code) === queued) inFlight.delete(code);
  }
}
