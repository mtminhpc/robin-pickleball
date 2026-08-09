/**
 * Bố cục Google Sheet.
 *
 * Sheet vừa là kho dữ liệu vừa là thứ người dùng mở ra xem, nên bố cục phải đọc
 * được bằng mắt: mỗi tab một mục đích rõ ràng, tên cột viết thường có gạch dưới,
 * dòng đầu là tiêu đề.
 *
 * Mỗi sự kiện có tab nhật ký riêng thay vì chung một tab khổng lồ. Đọc một sự
 * kiện khi đó chỉ cần lấy đúng một dải ô, không phải tải nhật ký của mọi sự kiện
 * rồi lọc — điều này quyết định vì hạn mức của Sheets API rất chặt.
 */

export const TABS = {
  clubs: "clubs",
  clubMembers: "club_members",
  events: "events",
  accounts: "accounts",
  devices: "devices",
  eventAssets: "event_assets",
  appEventLimits: "app_event_limits",
  appEventReservations: "app_event_reservations",
  eventOwnerClaims: "event_owner_claims",
  eventStaff: "event_staff",
  eventAuth: "event_auth",
  accountAssets: "account_assets",
  eventCopies: "event_copies",
} as const;

/** Tab nhật ký của một sự kiện: nguồn sự thật, chỉ ghi thêm không sửa. */
export function logTab(code: string): string {
  return `log__${code}`;
}

/** Tab hiển thị của một sự kiện: bản in cho người đọc, ghi đè sau mỗi lần lưu. */
export function viewTab(code: string): string {
  return `view__${code}`;
}

/** Ảnh tối đa 512 KB phải tách ô vì một ô Google Sheet chỉ chứa 50.000 ký tự. */
export const ASSET_CELL_LIMIT = 45_000;
export const ASSET_CHUNK_HEADERS = [
  "data_1", "data_2", "data_3", "data_4",
  "data_5", "data_6", "data_7", "data_8",
  "data_9", "data_10", "data_11", "data_12",
  "data_13", "data_14", "data_15", "data_16",
] as const;

export const HEADERS = {
  [TABS.clubs]: [
    "club_id",
    "name",
    // Thiết bị của người tạo ở giai đoạn này, tài khoản Google ở giai đoạn sau.
    // Đặt tên chung để lúc có tài khoản không phải đổi bố cục Sheet.
    "owner_ref",
    "invite_code",
    "created_at",
    "settings_json",
  ],
  [TABS.clubMembers]: [
    "club_id",
    "member_id",
    "display_name",
    "avatar_id",
    "user_id",
    "device_id",
    "joined_at",
    "status",
  ],
  [TABS.events]: [
    "code",
    "club_id",
    "name",
    "starts_at",
    "status",
    "owner_user_id",
    "player_pass_hash",
    "admin_pass_hash",
    "seq",
    "updated_at",
    // Ảnh chụp trạng thái, cắt thành nhiều ô vì mỗi ô Sheets chỉ chứa 50k ký tự.
    "state_1",
    "state_2",
    "state_3",
    "state_4",
  ],
  [TABS.accounts]: [
    "user_id",
    "email",
    "display_name",
    "avatar_id",
    "created_at",
    "prefs_json",
  ],
  [TABS.devices]: [
    "device_id",
    "user_id",
    "display_name",
    "avatar_id",
    "last_seen",
    "recent_events_json",
  ],
  [TABS.eventAssets]: [
    "event_code",
    "asset_id",
    "kind",
    "mime",
    "data_uri",
    "active",
    "created_by",
    "created_at",
    "updated_at",
    "metadata_json",
    ...ASSET_CHUNK_HEADERS,
  ],
  [TABS.appEventLimits]: [
    "email",
    "limit",
    "granted_by",
    "updated_at",
    "active",
  ],
  [TABS.appEventReservations]: [
    "user_id",
    "token",
    "status",
    "created_at",
    "updated_at",
  ],
  [TABS.eventOwnerClaims]: [
    "event_code",
    "user_id",
    "token",
    "created_at",
  ],
  [TABS.eventStaff]: [
    "event_code",
    "staff_id",
    "email",
    "user_id",
    "display_name",
    "status",
    "granted_by",
    "created_at",
    "revoked_at",
  ],
  [TABS.eventAuth]: [
    "event_code",
    "admin_pass_version",
    "updated_at",
  ],
  [TABS.accountAssets]: [
    "user_id",
    "asset_id",
    "kind",
    "mime",
    "data_uri",
    "metadata_json",
    "active",
    "created_at",
    "updated_at",
    ...ASSET_CHUNK_HEADERS,
  ],
  [TABS.eventCopies]: [
    "owner_user_id",
    "source_code",
    "idempotency_key",
    "token",
    "new_code",
    "created_at",
    "status",
  ],
} as const;

/*
 * Đã có một tab `rollups` ở đây để đệm tổng kết tuần/tháng, cột
 * `scope, period_type, period_key, computed_at, source_seq, data_json`.
 * Nó chưa bao giờ được đọc hay ghi, và nay đã bỏ hẳn. Ghi lại lý do để lần sau
 * không ai dựng lại đúng thứ vừa gỡ đi:
 *
 * - Sheets không lọc được ở phía máy chủ. Lấy các dòng của một câu lạc bộ nghĩa
 *   là đọc cả tab, tức là mọi kỳ của mọi câu lạc bộ — sau một năm với năm câu
 *   lạc bộ là vài megabyte để trả lời một câu hỏi. Đúng thứ định tránh.
 * - Khi đệm còn mới thì tốn 1 lời gọi, y như không đệm. Khi đệm cũ thì tốn 3
 *   (đọc dấu vân tay, đọc đủ trạng thái, ghi lại) — mà mỗi lần nhập tỷ số là
 *   `seq` đổi, nên suốt buổi đang đánh lần nào cũng cũ. Đắt gấp ba đúng lúc gần
 *   chạm hạn mức nhất.
 * - Ghi bằng `rowIndex` đọc được từ trước, trên một tab dùng chung, không có
 *   khoá cũng không có CAS. Hai máy chủ tính tổng kết cho hai câu lạc bộ cùng
 *   lúc thì lời ghi này đè lên dòng của lời ghi kia, im lặng.
 *
 * Thay bằng `readClubEvents` trong `cache.ts`: bọc `listByClub` vào
 * `unstable_cache` 60 giây, đúng khuôn `readClub` đã có.
 */

export const LOG_HEADERS = [
  "seq",
  "ts",
  "actor_kind",
  "actor_label",
  "actor_ref",
  "command_id",
  "type",
  "payload_json",
] as const;

/** Số ô dành cho ảnh chụp trạng thái, và sức chứa mỗi ô. */
export const STATE_CELLS = 4;
export const STATE_CELL_LIMIT = 45_000;

/** Vị trí cột `state_1` trong tab events (đánh số từ 0). */
export const STATE_COLUMN_START = HEADERS[TABS.events].indexOf("state_1");

/**
 * Cắt chuỗi JSON thành đúng `STATE_CELLS` ô.
 *
 * Ném lỗi khi vượt sức chứa thay vì cắt cụt âm thầm: mất một phần trạng thái sẽ
 * hỏng theo kiểu rất khó truy, còn nhật ký thì vẫn nguyên nên dựng lại được.
 */
export function splitState(json: string): string[] {
  const parts: string[] = [];
  for (let i = 0; i < STATE_CELLS; i++) {
    parts.push(json.slice(i * STATE_CELL_LIMIT, (i + 1) * STATE_CELL_LIMIT));
  }
  if (json.length > STATE_CELLS * STATE_CELL_LIMIT) {
    throw new Error(
      `Ảnh chụp trạng thái ${json.length} ký tự, vượt sức chứa ${STATE_CELLS * STATE_CELL_LIMIT}. ` +
        "Cần nén bớt hoặc tăng STATE_CELLS.",
    );
  }
  return parts;
}

export function joinState(cells: readonly (string | undefined)[]): string {
  return cells.slice(0, STATE_CELLS).map((c) => c ?? "").join("");
}

export function splitAssetData(dataUri: string): string[] {
  const parts = ASSET_CHUNK_HEADERS.map((_, index) =>
    dataUri.slice(index * ASSET_CELL_LIMIT, (index + 1) * ASSET_CELL_LIMIT),
  );
  if (dataUri.length > ASSET_CHUNK_HEADERS.length * ASSET_CELL_LIMIT) {
    throw new Error("Ảnh vượt sức chứa 512 KB của kho asset.");
  }
  return parts;
}

export function joinAssetData(row: readonly (string | undefined)[]): string {
  return ASSET_CHUNK_HEADERS.map((header) => row[HEADERS[TABS.eventAssets].indexOf(header)] ?? "").join("");
}
