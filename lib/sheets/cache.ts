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
import type { Account, DeviceLink } from "../domain/account";
import type { EventState } from "../domain/types";
import { getSheetsClient } from "./factory";
import { AccountRepo } from "./accounts";
import { ClubRepo, type LoadedClub } from "./clubs";
import { EventRepo, type EventRecord } from "./repo";
import { AppEventLimitRepo } from "./app-event-limits";
import { EventAssetRepo, type EventAsset } from "./event-assets";
import { EventCreationReservationRepo } from "./event-reservations";
import { EventOwnerClaimRepo } from "./event-owner-claims";
import { EventStaffRepo, type EventStaffMember } from "./event-staff";
import { EventAuthRepo } from "./event-auth";
import { EventCopyRepo } from "./event-copies";
import { AccountAssetRepo, type AccountAsset } from "./account-assets";

/** Bao lâu thì chấp nhận dữ liệu cũ. Ghi thì xoá đệm ngay nên không ai phải chờ. */
const TTL_SECONDS = 5;
/** Danh bạ câu lạc bộ đổi rất thưa nên giữ lâu hơn nhiều. */
const CLUB_TTL_SECONDS = 60;

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

/** Xếp hàng thao tác quota theo tài khoản trong cùng một instance server. */
export function withAccountLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  return withEventLock(`account:${userId}`, fn);
}

export function getAppEventLimitRepo(): AppEventLimitRepo {
  return new AppEventLimitRepo(getSheetsClient());
}

export function getEventAssetRepo(): EventAssetRepo {
  return new EventAssetRepo(getSheetsClient());
}

/** Asset ID không bị ghi đè; bản chỉnh sửa luôn có ID mới nên có thể đệm lâu. */
export async function readEventAsset(code: string, assetId: string): Promise<EventAsset | null> {
  const read = unstable_cache(
    async (eventCode: string, id: string) => getEventAssetRepo().get(eventCode, id),
    ["event-asset"],
    { revalidate: 60 * 60 },
  );
  return read(code.toUpperCase(), assetId);
}

export function getEventCreationReservationRepo(): EventCreationReservationRepo {
  return new EventCreationReservationRepo(getSheetsClient());
}

export function getEventOwnerClaimRepo(): EventOwnerClaimRepo {
  return new EventOwnerClaimRepo(getSheetsClient());
}

export function getAccountAssetRepo(): AccountAssetRepo {
  return new AccountAssetRepo(getSheetsClient());
}

export async function readAccountAsset(userId: string, assetId: string): Promise<AccountAsset | null> {
  const read = unstable_cache(
    async (id: string, asset: string) => getAccountAssetRepo().get(id, asset),
    ["account-asset"],
    { revalidate: 60 * 60 },
  );
  return read(userId, assetId);
}

export function getEventCopyRepo(): EventCopyRepo {
  return new EventCopyRepo(getSheetsClient());
}

export function eventStaffTag(code: string): string {
  return `event-staff:${code}`;
}

export function getEventStaffRepo(): EventStaffRepo {
  return new EventStaffRepo(getSheetsClient());
}

export async function readEventStaff(code: string): Promise<EventStaffMember[]> {
  const read = unstable_cache(
    async (eventCode: string) => getEventStaffRepo().list(eventCode),
    ["event-staff"],
    { tags: [eventStaffTag(code)], revalidate: 30 },
  );
  return read(code.toUpperCase());
}

export function invalidateEventStaff(code: string): void {
  revalidateTag(eventStaffTag(code));
}

export function eventAuthTag(code: string): string {
  return `event-auth:${code}`;
}

export function getEventAuthRepo(): EventAuthRepo {
  return new EventAuthRepo(getSheetsClient());
}

export async function readEventAuthVersion(code: string): Promise<number> {
  const read = unstable_cache(
    async (eventCode: string) => getEventAuthRepo().version(eventCode),
    ["event-auth"],
    { tags: [eventAuthTag(code)], revalidate: 30 },
  );
  return read(code.toUpperCase());
}

export function invalidateEventAuth(code: string): void {
  revalidateTag(eventAuthTag(code));
}

// ---------------------------------------------------------------------------
// Câu lạc bộ
// ---------------------------------------------------------------------------

export function clubTag(clubId: string): string {
  return `club:${clubId}`;
}

export function getClubRepo(): ClubRepo {
  return new ClubRepo(getSheetsClient());
}

/**
 * Đọc câu lạc bộ qua bộ nhớ đệm.
 *
 * Thời hạn dài hơn sự kiện rất nhiều (60 giây so với 5): danh bạ mỗi tháng đổi
 * vài lần, còn tỷ số thì đổi từng phút. Đọc lại danh bạ mỗi 5 giây cho hai mươi
 * người là đốt hạn mức vào thứ gần như không bao giờ thay đổi.
 */
export async function readClub(clubId: string): Promise<LoadedClub | null> {
  const load = unstable_cache(
    async (id: string) => getClubRepo().load(id),
    ["club"],
    { tags: [clubTag(clubId)], revalidate: CLUB_TTL_SECONDS },
  );
  return load(clubId);
}

export function invalidateClub(clubId: string): void {
  revalidateTag(clubTag(clubId));
}

export function clubEventsTag(clubId: string): string {
  return `club-events:${clubId}`;
}

/**
 * Mọi buổi đánh của một câu lạc bộ, qua bộ nhớ đệm. Dùng cho trang tổng kết.
 *
 * `listByClub` là lời gọi đọc đắt nhất trong ứng dụng: mỗi dòng sự kiện mang
 * theo ảnh chụp trạng thái tới 180 nghìn ký tự, và nó đọc cả bảng. Trước đây
 * trang tổng kết gọi thẳng `getRepo()`, tức là đi vòng qua toàn bộ lớp đệm —
 * hai mươi người cùng mở là hai mươi lần đọc.
 *
 * Giữ 60 giây, cùng lý lẽ với `CLUB_TTL_SECONDS`: tổng kết nói về những buổi đã
 * xong, chậm một phút không ai nhận ra. **Cố ý không xoá đệm sau mỗi lần nhập
 * tỷ số** — bắn hỏng đệm mỗi khi có người ghi điểm thì nó chẳng đệm được gì, mà
 * số liệu buổi đang đánh vốn đã được đánh dấu là còn chạy tiếp.
 */
export async function readClubEvents(
  clubId: string,
): Promise<Array<{ record: EventRecord; state: EventState }>> {
  const load = unstable_cache(
    async (id: string) => getRepo().listByClub(id),
    ["club-events"],
    { tags: [clubEventsTag(clubId)], revalidate: CLUB_TTL_SECONDS },
  );
  return load(clubId);
}

/** Gọi khi câu lạc bộ có thêm buổi mới, để nó hiện ra ngay chứ không đợi một phút. */
export function invalidateClubEvents(clubId: string): void {
  revalidateTag(clubEventsTag(clubId));
}

// ---------------------------------------------------------------------------
// Tài khoản
// ---------------------------------------------------------------------------

/** Bảng tài khoản gần như không đổi, nên giữ lâu như danh bạ câu lạc bộ. */
const ACCOUNT_TTL_SECONDS = 60;

export function accountTag(userId: string): string {
  return `account:${userId}`;
}

export function getAccountRepo(): AccountRepo {
  return new AccountRepo(getSheetsClient());
}

/**
 * Đọc tài khoản kèm danh sách thiết bị của nó, qua bộ nhớ đệm.
 *
 * Gộp hai thứ vào một hàm vì mọi chỗ cần cái này đều cần cả cái kia: biết người
 * dùng là ai thì câu hỏi tiếp theo luôn là "những máy nào là của họ". Tách ra
 * chỉ tổ thành hai lần đọc Sheet cho cùng một câu trả lời.
 */
export async function readAccount(
  userId: string,
): Promise<{ account: Account; devices: DeviceLink[] } | null> {
  if (!userId) return null;
  const load = unstable_cache(
    async (id: string) => {
      const repo = getAccountRepo();
      const account = await repo.byId(id);
      if (!account) return null;
      return { account, devices: await repo.devicesOf(id) };
    },
    ["account"],
    { tags: [accountTag(userId)], revalidate: ACCOUNT_TTL_SECONDS },
  );
  return load(userId);
}

export function invalidateAccount(userId: string): void {
  revalidateTag(accountTag(userId));
}
