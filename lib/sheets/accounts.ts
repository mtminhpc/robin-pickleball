/**
 * Kho tài khoản và sổ thiết bị.
 *
 * Giống `ClubRepo` và cố ý khác `EventRepo`: không có nhật ký lệnh. Một người
 * đăng nhập vài lần một tháng, và hai lần đăng nhập cùng lúc trên hai máy chỉ
 * ghi vào hai dòng thiết bị khác nhau. Không có gì để tranh chấp, nên bộ máy
 * phát lại nhật ký ở đây chỉ tổ nặng nề.
 *
 * Điều bắt buộc phải giữ vẫn là *thêm thì không được mất*, và cái đó có sẵn nhờ
 * nối thêm dòng.
 *
 * Hai tab đọc chung một `batchGet` vì hạn mức Sheets là 60 request mỗi phút cho
 * cả tài khoản dịch vụ — tách làm hai là phí một nửa cho không.
 */

import { randomUUID } from "node:crypto";
import {
  mergeRecentEvents,
  normalizeEmail,
  type Account,
  type AccountPrefs,
  type DeviceLink,
  type UserId,
} from "../domain/account";
import type { SheetsClient } from "./client";
import { indexToColumn, rowRange } from "./client";
import { HEADERS, TABS } from "./schema";

const ACCOUNT_COLUMNS = HEADERS[TABS.accounts];
const DEVICE_COLUMNS = HEADERS[TABS.devices];

const A = Object.fromEntries(ACCOUNT_COLUMNS.map((n, i) => [n, i])) as Record<
  (typeof ACCOUNT_COLUMNS)[number],
  number
>;
const D = Object.fromEntries(DEVICE_COLUMNS.map((n, i) => [n, i])) as Record<
  (typeof DEVICE_COLUMNS)[number],
  number
>;

export class AccountRepo {
  constructor(private readonly sheets: SheetsClient) {}

  async bootstrap(): Promise<void> {
    await this.sheets.ensureTab(TABS.accounts, HEADERS[TABS.accounts]);
    await this.sheets.ensureTab(TABS.devices, HEADERS[TABS.devices]);
  }

  async byId(userId: UserId): Promise<Account | null> {
    if (!userId) return null;
    const [accountRows] = await this.readAll();
    const found = accountRows.find((row, i) => i > 0 && row[A.user_id] === userId);
    return found ? toAccount(found) : null;
  }

  async byEmail(email: string): Promise<Account | null> {
    const wanted = normalizeEmail(email);
    if (!wanted) return null;
    const [accountRows] = await this.readAll();
    const found = accountRows.find(
      (row, i) => i > 0 && normalizeEmail(row[A.email] ?? "") === wanted,
    );
    return found ? toAccount(found) : null;
  }

  /**
   * Nhận ra người quay lại, hoặc lập tài khoản mới cho người lần đầu đăng nhập.
   *
   * Lần sau đăng nhập **không ghi đè tên và ảnh** đang có. Google trả về tên
   * thật của tài khoản, nhưng trong nhóm chơi người ta gọi nhau bằng biệt danh —
   * sửa tên trong danh bạ rồi mà lần đăng nhập sau nó lặng lẽ quay về "Nguyễn
   * Văn A" thì đó là phần mềm cãi lại người dùng.
   */
  async upsertByEmail(input: {
    email: string;
    displayName: string;
    avatarId: string;
    prefs?: AccountPrefs;
    at: number;
  }): Promise<Account> {
    await this.bootstrap();

    const email = normalizeEmail(input.email);
    const [accountRows] = await this.readAll();
    const rowIndex = accountRows.findIndex(
      (row, i) => i > 0 && normalizeEmail(row[A.email] ?? "") === email,
    );

    if (rowIndex !== -1) {
      const existing = toAccount(accountRows[rowIndex]!);
      const updated: Account = {
        ...existing,
        displayName: existing.displayName || input.displayName,
        avatarId: existing.avatarId || input.avatarId,
        prefs: { ...existing.prefs, ...input.prefs },
      };
      await this.sheets.batch([
        {
          kind: "update",
          range: rowRange(TABS.accounts, rowIndex, ACCOUNT_COLUMNS.length),
          values: [accountRow(updated)],
        },
      ]);
      return updated;
    }

    const account: Account = {
      userId: randomUUID(),
      email,
      displayName: input.displayName,
      avatarId: input.avatarId,
      createdAt: input.at,
      prefs: input.prefs ?? {},
    };
    await this.sheets.batch([
      { kind: "append", tab: TABS.accounts, values: [accountRow(account)] },
    ]);
    return account;
  }

  /** Sửa tên hoặc ảnh của chính mình. */
  async updateAccount(
    userId: UserId,
    patch: Partial<Pick<Account, "displayName" | "avatarId">>,
  ): Promise<Account | null> {
    const [accountRows] = await this.readAll();
    const rowIndex = accountRows.findIndex(
      (row, i) => i > 0 && row[A.user_id] === userId,
    );
    if (rowIndex === -1) return null;

    const updated: Account = { ...toAccount(accountRows[rowIndex]!), ...patch };
    if (patch.displayName !== undefined) {
      updated.displayName = patch.displayName.trim();
    }
    await this.sheets.batch([
      {
        kind: "update",
        range: rowRange(TABS.accounts, rowIndex, ACCOUNT_COLUMNS.length),
        values: [accountRow(updated)],
      },
    ]);
    return updated;
  }

  /**
   * Sửa vài khoá trong `prefs` mà không đụng những khoá còn lại.
   *
   * Gộp chứ không đè cả cụm: `picture` do lần đăng nhập Google ghi, `photo` do
   * người dùng bấm tải lên — hai đường khác nhau, hai lúc khác nhau. Ghi đè cả
   * `prefs` thì việc tải ảnh sẽ lặng lẽ xoá mất địa chỉ ảnh Google, và người dùng
   * bấm "xoá ảnh" sau đó sẽ không quay về đâu được.
   *
   * Đặt một khoá bằng `undefined` là xoá khoá đó.
   */
  async updatePrefs(
    userId: UserId,
    patch: Partial<AccountPrefs>,
  ): Promise<Account | null> {
    if (!userId) return null;

    const [accountRows] = await this.readAll();
    const rowIndex = accountRows.findIndex(
      (row, i) => i > 0 && row[A.user_id] === userId,
    );
    if (rowIndex === -1) return null;

    const existing = toAccount(accountRows[rowIndex]!);
    const prefs: AccountPrefs = { ...existing.prefs, ...patch };
    for (const key of Object.keys(patch) as (keyof AccountPrefs)[]) {
      if (patch[key] === undefined) delete prefs[key];
    }

    const updated: Account = { ...existing, prefs };
    await this.sheets.batch([
      {
        kind: "update",
        range: rowRange(TABS.accounts, rowIndex, ACCOUNT_COLUMNS.length),
        values: [accountRow(updated)],
      },
    ]);
    return updated;
  }

  async deviceLink(deviceId: string): Promise<DeviceLink | null> {
    if (!deviceId) return null;
    const [, deviceRows] = await this.readAll();
    const found = deviceRows.find((row, i) => i > 0 && row[D.device_id] === deviceId);
    return found ? toDeviceLink(found) : null;
  }

  /** Mọi thiết bị đã nhận là của một tài khoản. */
  async devicesOf(userId: UserId): Promise<DeviceLink[]> {
    if (!userId) return [];
    const [, deviceRows] = await this.readAll();
    return deviceRows
      .filter((row, i) => i > 0 && row[D.user_id] === userId)
      .map(toDeviceLink);
  }

  /**
   * Gắn cái máy đang dùng vào một tài khoản.
   *
   * Một thiết bị chỉ thuộc về một tài khoản tại một thời điểm: điện thoại dùng
   * chung mà hai người lần lượt đăng nhập thì người sau nhận máy, đúng như họ
   * mong đợi. Danh sách buổi cũ vẫn được gộp lại chứ không xoá — nó là lịch sử
   * của cái máy, và những buổi đó cả hai người đều có mặt.
   *
   * Điều đó chỉ đúng cho **người sau tự đăng nhập đè lên**. Chủ máy chủ động bấm
   * gỡ là một tín hiệu khác hẳn, và `unlinkDevice` xoá danh sách đi — xem docblock
   * ở đó.
   */
  async linkDevice(input: {
    deviceId: string;
    userId: UserId;
    displayName: string;
    avatarId: string;
    recentEvents?: readonly string[];
    at: number;
  }): Promise<DeviceLink> {
    await this.bootstrap();

    const [, deviceRows] = await this.readAll();
    const rowIndex = deviceRows.findIndex(
      (row, i) => i > 0 && row[D.device_id] === input.deviceId,
    );

    const previous = rowIndex === -1 ? null : toDeviceLink(deviceRows[rowIndex]!);
    const link: DeviceLink = {
      deviceId: input.deviceId,
      userId: input.userId,
      displayName: input.displayName || (previous?.displayName ?? ""),
      avatarId: input.avatarId || (previous?.avatarId ?? ""),
      lastSeen: input.at,
      recentEvents: mergeRecentEvents(
        previous?.recentEvents ?? [],
        input.recentEvents ?? [],
      ),
    };

    await this.sheets.batch([
      rowIndex === -1
        ? { kind: "append", tab: TABS.devices, values: [deviceRow(link)] }
        : {
            kind: "update",
            range: rowRange(TABS.devices, rowIndex, DEVICE_COLUMNS.length),
            values: [deviceRow(link)],
          },
    ]);
    return link;
  }

  /**
   * Bỏ một cái máy ra khỏi tài khoản.
   *
   * Chỉ gỡ được máy của **chính mình**: `userId` phải khớp, không thì trả `false`
   * và không ghi gì. Không có bước này thì ai đoán được `deviceId` của người khác
   * là gỡ được máy của họ.
   *
   * Xoá luôn danh sách buổi của cái máy đó, khác hẳn `linkDevice` vốn gộp lại.
   * Hai tình huống khác nhau: điện thoại dùng chung thì cả hai người đều có mặt
   * ở những buổi ấy nên giữ là đúng; còn chủ máy chủ động bấm gỡ là đang nói *"đừng
   * gộp số liệu từ máy này nữa"*, mà để danh sách lại thì `linkDevice` sẽ merge nó
   * sang tài khoản người đăng nhập kế tiếp — tức là việc gỡ không mua được gì.
   *
   * Giữ lại dòng chứ không xoá, giống `ClubRepo.removeMember`: `SheetsClient` chỉ
   * có `update` và `append`, và xoá dòng thật thì mọi `rowIndex` phía dưới đều
   * xê dịch.
   *
   * **Việc này không cắt được cái điện thoại**, chỉ cắt việc gộp số liệu. Cookie
   * thiết bị vẫn nằm trong máy đó, và `ClubRepo.forDevice` vẫn nhận nó là thành
   * viên câu lạc bộ theo `device_id`. Muốn cắt thật thì phải đổi cookie thiết bị,
   * mà chỉ chính cái máy đó làm được.
   */
  async unlinkDevice(userId: UserId, deviceId: string): Promise<boolean> {
    if (!userId || !deviceId) return false;

    const [, deviceRows] = await this.readAll();
    const rowIndex = deviceRows.findIndex(
      (row, i) => i > 0 && row[D.device_id] === deviceId,
    );
    if (rowIndex === -1) return false;

    const existing = toDeviceLink(deviceRows[rowIndex]!);
    if (existing.userId !== userId) return false;

    await this.sheets.batch([
      {
        kind: "update",
        range: rowRange(TABS.devices, rowIndex, DEVICE_COLUMNS.length),
        values: [deviceRow({ ...existing, userId: "", recentEvents: [] })],
      },
    ]);
    return true;
  }

  /**
   * Chép danh sách buổi của một thiết bị lên Sheet để máy khác đọc được.
   *
   * Trả `false` và **không ghi gì** khi danh sách không đổi. Trang "Của tôi" mở
   * ra là gọi tới đây, mà ghi một lần cho mỗi lần mở là đốt hạn mức vào việc lưu
   * lại đúng thứ đã có sẵn.
   */
  async rememberEvents(
    deviceId: string,
    codes: readonly string[],
    at: number,
  ): Promise<boolean> {
    if (!deviceId || codes.length === 0) return false;

    const [, deviceRows] = await this.readAll();
    const rowIndex = deviceRows.findIndex(
      (row, i) => i > 0 && row[D.device_id] === deviceId,
    );
    // Máy chưa đăng nhập bao giờ thì không có dòng nào, và cũng không cần có:
    // danh sách đó đang nằm trong localStorage và chưa thuộc về tài khoản nào.
    if (rowIndex === -1) return false;

    const existing = toDeviceLink(deviceRows[rowIndex]!);

    // Máy đã bị gỡ khỏi tài khoản đang ở đúng trạng thái vừa nói: có một dòng,
    // nhưng dòng đó không thuộc về ai. Thiếu chỗ này thì việc gỡ vô tác dụng —
    // cookie tài khoản sống 30 ngày và không có danh sách thu hồi, nên cái máy
    // vừa bị gỡ chỉ cần mở trang "Của tôi" một lần là ghi lại đúng danh sách ta
    // vừa xoá.
    if (existing.userId === "") return false;

    const merged = mergeRecentEvents(existing.recentEvents, codes);
    if (
      merged.length === existing.recentEvents.length &&
      merged.every((code, i) => code === existing.recentEvents[i])
    ) {
      return false;
    }

    await this.sheets.batch([
      {
        kind: "update",
        range: rowRange(TABS.devices, rowIndex, DEVICE_COLUMNS.length),
        values: [deviceRow({ ...existing, recentEvents: merged, lastSeen: at })],
      },
    ]);
    return true;
  }

  // -- nội bộ ---------------------------------------------------------------

  private async readAll(): Promise<[string[][], string[][]]> {
    const [accounts, devices] = await this.sheets.batchGet([
      `${TABS.accounts}!A:${indexToColumn(ACCOUNT_COLUMNS.length - 1)}`,
      `${TABS.devices}!A:${indexToColumn(DEVICE_COLUMNS.length - 1)}`,
    ]);
    return [accounts?.values ?? [], devices?.values ?? []];
  }
}

// ---------------------------------------------------------------------------

function toAccount(row: string[]): Account {
  return {
    userId: row[A.user_id] ?? "",
    email: normalizeEmail(row[A.email] ?? ""),
    displayName: row[A.display_name] ?? "",
    avatarId: row[A.avatar_id] ?? "",
    createdAt: Number(row[A.created_at] ?? 0),
    prefs: parseJson<AccountPrefs>(row[A.prefs_json], {}),
  };
}

function accountRow(account: Account): string[] {
  const row = new Array<string>(ACCOUNT_COLUMNS.length).fill("");
  row[A.user_id] = account.userId;
  row[A.email] = account.email;
  row[A.display_name] = account.displayName;
  row[A.avatar_id] = account.avatarId;
  row[A.created_at] = String(account.createdAt);
  row[A.prefs_json] = JSON.stringify(account.prefs);
  return row;
}

function toDeviceLink(row: string[]): DeviceLink {
  return {
    deviceId: row[D.device_id] ?? "",
    userId: row[D.user_id] ?? "",
    displayName: row[D.display_name] ?? "",
    avatarId: row[D.avatar_id] ?? "",
    lastSeen: Number(row[D.last_seen] ?? 0),
    recentEvents: parseJson<string[]>(row[D.recent_events_json], []),
  };
}

function deviceRow(link: DeviceLink): string[] {
  const row = new Array<string>(DEVICE_COLUMNS.length).fill("");
  row[D.device_id] = link.deviceId;
  row[D.user_id] = link.userId;
  row[D.display_name] = link.displayName;
  row[D.avatar_id] = link.avatarId;
  row[D.last_seen] = String(link.lastSeen);
  row[D.recent_events_json] = JSON.stringify(link.recentEvents);
  return row;
}

/** Ô JSON hỏng thì lấy mặc định chứ không làm hỏng cả lần đăng nhập. */
function parseJson<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
