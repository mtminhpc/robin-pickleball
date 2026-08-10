/**
 * Lớp truy cập dữ liệu sự kiện.
 *
 * Đây là chỗ ràng buộc "dùng Google Sheet làm cơ sở dữ liệu" được xử lý cho an
 * toàn. Sheet không có giao dịch và cũng không có phép so-sánh-rồi-ghi nguyên tử,
 * nên không thể chống xung đột bằng khoá lạc quan như với cơ sở dữ liệu thật.
 * Giả vờ có sẽ nguy hiểm hơn là không có, vì nó tạo cảm giác an toàn sai.
 *
 * Cách làm ở đây dựa vào một tính chất Sheet thật sự bảo đảm: **nối thêm dòng thì
 * không mất**. Từ đó:
 *
 *   1. Tab nhật ký chỉ-ghi-thêm là nguồn sự thật. Hai người cùng bấm Lưu sẽ tạo
 *      hai dòng khác nhau, không bao giờ đè nhau. Không kết quả nào biến mất.
 *   2. Ô ảnh chụp trạng thái chỉ là bộ nhớ đệm cho nhanh. Nó CÓ THỂ bị ghi đè khi
 *      hai người ghi cùng lúc, và điều đó chấp nhận được: mỗi lần đọc đều so số
 *      dòng nhật ký với số dòng mà ảnh chụp đã đọc qua, lệch thì dựng lại.
 *   3. Xung đột nghiệp vụ thật (hai người cùng nhập một trận) được giải khi phát
 *      lại nhật ký: lệnh thứ hai bị `reduce` từ chối và báo trong `skipped`.
 *
 * Mỗi lệnh tốn đúng một lời gọi đọc và một lời gọi ghi, vì hạn mức của Sheets là
 * 60 request mỗi phút cho cả tài khoản dịch vụ.
 */

import type { CommandEnvelope } from "../domain/commands";
import { apply, emptyState, fold } from "../domain/reduce";
import { withEventDefaults, type EventState } from "../domain/types";
import type { SheetsClient, WriteOp } from "./client";
import { indexToColumn, rowRange } from "./client";
import {
  HEADERS,
  LOG_HEADERS,
  STATE_CELLS,
  STATE_COLUMN_START,
  TABS,
  joinState,
  logTab,
  splitState,
  viewTab,
} from "./schema";
import { renderView } from "./view";

const EVENT_COLUMNS = HEADERS[TABS.events];
const COL = Object.fromEntries(
  EVENT_COLUMNS.map((name, i) => [name, i]),
) as Record<(typeof EVENT_COLUMNS)[number], number>;

export interface EventRecord {
  code: string;
  clubId: string | null;
  name: string;
  status: string;
  ownerUserId: string;
  playerPassHash: string;
  adminPassHash: string;
  seq: number;
  updatedAt: number;
  /** Dòng trong tab events, đánh số từ 0 (dòng 0 là tiêu đề). */
  rowIndex: number;
}

export interface LoadedEvent {
  record: EventRecord;
  state: EventState;
  /** Ảnh chụp lỗi thời hoặc hỏng nên trạng thái vừa được dựng lại từ nhật ký. */
  repaired: boolean;
  /** Lệnh bị bỏ khi phát lại — thường là kết quả thua cuộc trong một xung đột. */
  skipped: Array<{ id: string; error: string }>;
}

export type CommitResult =
  | { ok: true; state: EventState; seq: number }
  | { ok: false; error: string };

export class EventRepo {
  constructor(private readonly sheets: SheetsClient) {}

  /** Tạo sẵn các tab dùng chung. Chạy một lần lúc cài đặt. */
  async bootstrap(): Promise<void> {
    for (const [tab, headers] of Object.entries(HEADERS)) {
      await this.sheets.ensureTab(tab, headers);
    }
  }

  /**
   * Đọc một sự kiện bằng một lời gọi.
   *
   * Lấy cả chỉ mục sự kiện lẫn cột đầu của nhật ký trong cùng một lượt. Số dòng
   * nhật ký là thứ cho biết ảnh chụp còn dùng được hay không — nếu chỉ nhìn trong
   * dòng sự kiện thì không bao giờ phát hiện được ảnh chụp bị người khác ghi đè,
   * vì số thứ tự và ảnh chụp nằm cùng một dòng nên luôn khớp nhau.
   */
  async load(code: string): Promise<LoadedEvent | null> {
    const [index, logColumn] = await this.sheets.batchGet([
      `${TABS.events}!A:${indexToColumn(EVENT_COLUMNS.length - 1)}`,
      `${logTab(code)}!A:A`,
    ]);

    const rows = index?.values ?? [];
    const rowIndex = rows.findIndex((row, i) => i > 0 && row[COL.code] === code);
    if (rowIndex === -1) return null;

    const row = rows[rowIndex]!;
    const record = toRecord(row, rowIndex);
    const logRows = countLogRows(logColumn?.values ?? []);

    const snapshot = parseSnapshot(
      joinState(row.slice(STATE_COLUMN_START, STATE_COLUMN_START + STATE_CELLS)),
    );

    if (snapshot && snapshot.processed === logRows) {
      return {
        record: { ...record, seq: snapshot.seq },
        state: snapshot,
        repaired: false,
        skipped: [],
      };
    }

    const rebuilt = await this.rebuildDetailed(code);
    return {
      record: { ...record, seq: rebuilt.state.seq },
      state: rebuilt.state,
      repaired: true,
      skipped: rebuilt.skipped,
    };
  }

  /** Dựng lại trạng thái từ nhật ký. Chậm hơn nhưng luôn đúng. */
  async rebuild(code: string): Promise<EventState> {
    return (await this.rebuildDetailed(code)).state;
  }

  private async rebuildDetailed(code: string) {
    const log = await this.readLog(code);
    return fold(code, log);
  }

  async readLog(code: string): Promise<CommandEnvelope[]> {
    const tab = logTab(code);
    const tabs = await this.sheets.listTabs();
    if (!tabs.includes(tab)) return [];

    const [data] = await this.sheets.batchGet([
      `${tab}!A:${indexToColumn(LOG_HEADERS.length - 1)}`,
    ]);
    const rows = (data?.values ?? []).slice(1);

    const log: CommandEnvelope[] = [];
    for (const row of rows) {
      const parsed = parseLogRow(row);
      // Bỏ qua dòng hỏng chứ không ném lỗi: mất một dòng còn hơn mất cả sự kiện,
      // và `fold` cũng đã báo lại những lệnh nó không áp được.
      if (parsed) log.push(parsed);
    }
    return log;
  }

  /**
   * Áp một lệnh rồi ghi xuống. Trường hợp riêng của `commitMany`.
   */
  async append(
    code: string,
    envelope: CommandEnvelope,
    loaded: LoadedEvent,
  ): Promise<CommitResult> {
    return this.commitMany(code, [envelope], loaded);
  }

  /**
   * Áp một chuỗi lệnh rồi ghi tất cả trong MỘT lời gọi.
   *
   * Hầu hết thao tác của người dùng sinh ra hai lệnh chứ không phải một: nhập
   * điểm xong thì phải xếp thêm vòng mới, duyệt người mới thì phải xếp lại phần
   * chưa đánh. Ghi hai lần sẽ chia đôi hạn mức vốn đã chật, nên chúng đi chung
   * một lô — nhật ký nhận nhiều dòng, ảnh chụp cập nhật một lần ở trạng thái cuối.
   *
   * Lệnh đầu tiên bị từ chối thì dừng và không ghi gì cả: nó là thao tác của
   * người dùng. Lệnh sau bị từ chối thì bỏ qua và vẫn ghi phần trước — chúng là
   * việc dọn dẹp tự động, hỏng thì lần sau xếp lại chứ không được kéo theo mất
   * kết quả người ta vừa nhập.
   */
  async commitMany(
    code: string,
    envelopes: CommandEnvelope[],
    loaded: LoadedEvent,
    options: { allOrNothing?: boolean } = {},
  ): Promise<CommitResult> {
    if (envelopes.length === 0) return { ok: false, error: "Không có lệnh nào." };

    let state = loaded.state;
    const accepted: Array<{ envelope: CommandEnvelope; seq: number }> = [];

    for (const [i, envelope] of envelopes.entries()) {
      const result = apply(state, envelope);
      if (!result.ok) {
        if (i === 0 || options.allOrNothing) return { ok: false, error: result.error };
        break;
      }
      state = result.value;
      // Ghi lại số thứ tự ngay tại đây thay vì tính lùi từ trạng thái cuối: lệnh
      // gửi trùng được nhận nhưng không làm tăng số thứ tự, nên tính lùi sẽ lệch.
      accepted.push({ envelope, seq: state.seq });
    }

    await this.sheets.ensureTab(logTab(code), LOG_HEADERS);
    await this.sheets.ensureTab(viewTab(code), []);

    const record = {
      ...loaded.record,
      seq: state.seq,
      updatedAt: accepted[accepted.length - 1]!.envelope.at,
    };

    await this.sheets.batch([
      {
        kind: "append",
        tab: logTab(code),
        values: accepted.map((a) => logRow(a.seq, a.envelope)),
      },
      {
        kind: "update",
        range: rowRange(TABS.events, loaded.record.rowIndex, EVENT_COLUMNS.length),
        values: [eventRow(record, state)],
      },
      ...this.viewOps(code, state),
    ]);

    return { ok: true, state, seq: state.seq };
  }

  /** Bản in dễ đọc trong Google Sheet. Ghi kèm cùng lô nên không tốn thêm lời gọi. */
  private viewOps(code: string, state: EventState): WriteOp[] {
    const rendered = renderView(state);
    return [
      {
        kind: "update",
        range: `${viewTab(code)}!A1:${indexToColumn(rendered.width - 1)}${rendered.rows.length}`,
        values: rendered.rows,
        typed: true,
      },
    ];
  }

  /**
   * Đọc, áp lệnh, rồi ghi. Đây là lối vào mà các route nên dùng.
   *
   * Thử lại khi lệnh bị từ chối vì trạng thái đã cũ: người khác vừa ghi xen vào,
   * đọc lại rồi kiểm tra lệnh trên trạng thái mới có thể sẽ hợp lệ. Còn nếu lệnh
   * vẫn bị từ chối trên trạng thái mới nhất thì đó là từ chối thật (ví dụ trận đã
   * có người nhập điểm rồi) và người dùng cần biết.
   */
  async commit(
    code: string,
    envelope: CommandEnvelope,
    retries = 2,
  ): Promise<CommitResult> {
    let lastError = "Không tìm thấy sự kiện.";
    for (let attempt = 0; attempt <= retries; attempt++) {
      const loaded = await this.load(code);
      if (!loaded) return { ok: false, error: lastError };

      const out = await this.append(code, envelope, loaded);
      if (out.ok) return out;
      lastError = out.error;
    }
    return { ok: false, error: lastError };
  }

  /** Tạo sự kiện mới: một dòng trong tab events và một tab nhật ký riêng. */
  /**
   * Mọi buổi đánh của một câu lạc bộ, kèm trạng thái đọc từ ảnh chụp.
   *
   * Dùng **một** lời gọi đọc cho cả danh sách, kể cả khi câu lạc bộ có ba mươi
   * buổi. Đọc lại nhật ký từng buổi sẽ đúng hơn một chút nhưng tốn ba mươi lời
   * gọi — quá hạn mức Sheets ngay lập tức, và tổng kết tháng không đáng giá bằng
   * việc ứng dụng còn chạy được.
   *
   * Đổi lại, số liệu của buổi ĐANG đánh có thể chậm vài lệnh so với thực tế. Với
   * buổi đã kết thúc thì ảnh chụp là chính xác, và tổng kết chủ yếu nói về những
   * buổi đã xong. Giao diện đánh dấu buổi chưa kết thúc để người đọc biết.
   */
  async listByClub(clubId: string): Promise<
    Array<{ record: EventRecord; state: EventState }>
  > {
    const [index] = await this.sheets.batchGet([
      `${TABS.events}!A:${indexToColumn(EVENT_COLUMNS.length - 1)}`,
    ]);
    const rows = index?.values ?? [];

    const out: Array<{ record: EventRecord; state: EventState }> = [];
    rows.forEach((row, i) => {
      if (i === 0 || row[COL.club_id] !== clubId) return;
      const state = parseSnapshot(
        joinState(row.slice(STATE_COLUMN_START, STATE_COLUMN_START + STATE_CELLS)),
      );
      // Ảnh chụp hỏng thì bỏ buổi đó ra khỏi tổng kết chứ không làm hỏng cả
      // trang. Mở thẳng buổi đó vẫn dựng lại được từ nhật ký.
      if (state) out.push({ record: toRecord(row, i), state });
    });
    return out;
  }

  /**
   * Chỉ MÃ của các buổi thuộc một nhóm câu lạc bộ, không kèm trạng thái.
   *
   * Đọc đúng hai cột đầu thay vì cả dòng, và khác biệt không nhỏ: mỗi dòng sự
   * kiện mang theo ảnh chụp trạng thái tới 180 nghìn ký tự. Trang "Của tôi" chỉ
   * cần biết *có những buổi nào* rồi mới lọc, nên kéo cả ảnh chụp về để vứt đi
   * là tốn băng thông cho không.
   *
   * Đây là cách người vừa đăng nhập trên điện thoại mới tìm lại được các buổi
   * đã đánh: danh sách mã nằm ở `localStorage` của cái máy cũ, nhưng câu lạc bộ
   * thì máy chủ biết.
   */
  async codesByClubs(clubIds: readonly string[]): Promise<string[]> {
    if (clubIds.length === 0) return [];
    const wanted = new Set(clubIds);

    const [index] = await this.sheets.batchGet([
      `${TABS.events}!A:${indexToColumn(COL.club_id)}`,
    ]);
    return (index?.values ?? [])
      .filter((row, i) => i > 0 && wanted.has(row[COL.club_id] ?? ""))
      .map((row) => row[COL.code] ?? "")
      .filter((code) => code !== "");
  }

  /**
   * Nhiều buổi đánh cùng lúc theo mã, trong một lời gọi đọc.
   *
   * Dùng cho trang `/me`: máy nhớ mã các buổi đã mở, còn số liệu thì lấy từ đây.
   * Mã không tồn tại thì lặng lẽ bỏ qua — người dùng có thể còn giữ mã của một
   * buổi đã bị xoá, và đó không phải lý do để cả trang báo lỗi.
   */
  async listByCodes(
    codes: readonly string[],
  ): Promise<Array<{ record: EventRecord; state: EventState }>> {
    if (codes.length === 0) return [];
    const wanted = new Set(codes.map((c) => c.toUpperCase()));

    const [index] = await this.sheets.batchGet([
      `${TABS.events}!A:${indexToColumn(EVENT_COLUMNS.length - 1)}`,
    ]);
    const rows = index?.values ?? [];

    const out: Array<{ record: EventRecord; state: EventState }> = [];
    rows.forEach((row, i) => {
      if (i === 0 || !wanted.has((row[COL.code] ?? "").toUpperCase())) return;
      const state = parseSnapshot(
        joinState(row.slice(STATE_COLUMN_START, STATE_COLUMN_START + STATE_CELLS)),
      );
      if (state) out.push({ record: toRecord(row, i), state });
    });
    return out;
  }

  /** Các sự kiện do đúng tài khoản tạo, phục vụ tab "Các trận đã tạo" và quota. */
  async listByOwner(
    ownerUserId: string,
  ): Promise<Array<{ record: EventRecord; state: EventState }>> {
    if (!ownerUserId) return [];
    const [index] = await this.sheets.batchGet([
      `${TABS.events}!A:${indexToColumn(EVENT_COLUMNS.length - 1)}`,
    ]);
    const out: Array<{ record: EventRecord; state: EventState }> = [];
    (index?.values ?? []).forEach((row, i) => {
      if (i === 0 || row[COL.owner_user_id] !== ownerUserId) return;
      const state = parseSnapshot(
        joinState(row.slice(STATE_COLUMN_START, STATE_COLUMN_START + STATE_CELLS)),
      );
      if (state) out.push({ record: toRecord(row, i), state });
    });
    return out;
  }

  async create(
    record: Omit<EventRecord, "rowIndex" | "seq" | "updatedAt">,
    createdAt: number,
  ): Promise<EventRecord> {
    await this.bootstrap();
    await this.sheets.ensureTab(logTab(record.code), LOG_HEADERS);
    await this.sheets.ensureTab(viewTab(record.code), []);

    const state = emptyState(record.code);
    const full: EventRecord = { ...record, seq: 0, updatedAt: createdAt, rowIndex: -1 };

    await this.sheets.batch([
      { kind: "append", tab: TABS.events, values: [eventRow(full, state)] },
    ]);

    const [index] = await this.sheets.batchGet([`${TABS.events}!A:A`]);
    const rows = index?.values ?? [];
    const rowIndex = rows.findIndex((row, i) => i > 0 && row[0] === record.code);
    return { ...full, rowIndex };
  }

  /**
   * Đổi mật khẩu của một buổi đánh.
   *
   * **Chỉ ghi đúng những ô mật khẩu**, không ghi lại cả dòng. Một dòng sự kiện
   * chứa cả ảnh chụp trạng thái tới bốn ô; ghi đè cả dòng nghĩa là lấy trạng thái
   * mình đang cầm đè lên trạng thái trên Sheet — mà giữa lúc đó có người vừa nhập
   * xong một tỷ số thì tỷ số ấy biến mất. Đổi mật khẩu không có lý do gì đụng tới
   * kết quả trận đấu.
   *
   * Mỗi ô một lệnh ghi riêng, cố ý không gộp thành một dải: gộp được là nhờ hai
   * cột đang nằm cạnh nhau, và cái đó chỉ đúng cho tới lần đầu tiên ai đó chèn
   * thêm một cột vào giữa `HEADERS`. Lúc ấy nó sẽ ghi nhầm sang cột khác mà không
   * báo lỗi gì.
   *
   * Tìm lại dòng theo mã thay vì tin vào `rowIndex` đang cầm: chỉ tốn một lời gọi
   * đọc đúng một cột, mà đổi mật khẩu thì cả buổi mới xảy ra một lần.
   */
  async updatePasswords(
    code: string,
    patch: { playerPassHash?: string; adminPassHash?: string },
  ): Promise<boolean> {
    const [index] = await this.sheets.batchGet([`${TABS.events}!A:A`]);
    const rows = index?.values ?? [];
    const rowIndex = rows.findIndex((row, i) => i > 0 && row[0] === code);
    if (rowIndex === -1) return false;

    const row = rowIndex + 1;
    const writes = [
      { column: COL.player_pass_hash, value: patch.playerPassHash },
      { column: COL.admin_pass_hash, value: patch.adminPassHash },
    ]
      .filter((w) => w.value !== undefined)
      .map((w) => {
        const letter = indexToColumn(w.column);
        return {
          kind: "update" as const,
          range: `${TABS.events}!${letter}${row}:${letter}${row}`,
          values: [[w.value!]],
        };
      });

    if (writes.length === 0) return true;
    await this.sheets.batch(writes);
    return true;
  }

  /**
   * Gắn một buổi cũ vào tài khoản bằng cách chỉ ghi đúng ô `owner_user_id`.
   *
   * Không ghi lại cả dòng: dòng ấy còn chứa ảnh chụp trạng thái, và một bản chụp
   * cũ có thể xoá tỷ số người khác vừa nhập. Phân xử hai tài khoản tranh nhau nằm
   * ở `EventOwnerClaimRepo`; phép kiểm ở đây là lớp phòng thủ cuối cùng.
   */
  async claimOwner(
    code: string,
    userId: string,
  ): Promise<"claimed" | "already-owned" | "owned-by-other" | "not-found"> {
    if (!code || !userId) return "not-found";

    const ownerColumn = indexToColumn(COL.owner_user_id);
    const [index] = await this.sheets.batchGet([
      `${TABS.events}!A:${ownerColumn}`,
    ]);
    const rows = index?.values ?? [];
    const rowIndex = rows.findIndex(
      (row, i) => i > 0 && (row[COL.code] ?? "").toUpperCase() === code.toUpperCase(),
    );
    if (rowIndex === -1) return "not-found";

    const current = rows[rowIndex]?.[COL.owner_user_id] ?? "";
    if (current === userId) return "already-owned";
    if (current !== "") return "owned-by-other";

    const rowNumber = rowIndex + 1;
    await this.sheets.batch([
      {
        kind: "update",
        range: `${TABS.events}!${ownerColumn}${rowNumber}:${ownerColumn}${rowNumber}`,
        values: [[userId]],
      },
    ]);
    return "claimed";
  }
}

// ---------------------------------------------------------------------------

/**
 * Số dòng dữ liệu trong nhật ký (không tính dòng tiêu đề).
 *
 * Cố ý đếm dòng chứ không đọc số thứ tự ghi trong ô: khi hai người ghi đồng thời
 * từ cùng một trạng thái cũ, cả hai cùng ghi ra số thứ tự giống nhau. Chỉ có số
 * dòng thực tế mới phản ánh đúng là đã có hai lệnh.
 */
function countLogRows(column: string[][]): number {
  let count = 0;
  for (let i = 1; i < column.length; i++) {
    if ((column[i]?.[0] ?? "") !== "") count += 1;
  }
  return count;
}

function toRecord(row: string[], rowIndex: number): EventRecord {
  return {
    code: row[COL.code] ?? "",
    clubId: row[COL.club_id] || null,
    name: row[COL.name] ?? "",
    status: row[COL.status] ?? "draft",
    ownerUserId: row[COL.owner_user_id] ?? "",
    playerPassHash: row[COL.player_pass_hash] ?? "",
    adminPassHash: row[COL.admin_pass_hash] ?? "",
    seq: Number(row[COL.seq] ?? 0),
    updatedAt: Number(row[COL.updated_at] ?? 0),
    rowIndex,
  };
}

function eventRow(record: EventRecord, state: EventState): string[] {
  const row = new Array<string>(EVENT_COLUMNS.length).fill("");
  row[COL.code] = record.code;
  row[COL.club_id] = record.clubId ?? "";
  row[COL.name] = record.name;
  row[COL.starts_at] = String(state.startedAt ?? "");
  row[COL.status] = state.status;
  row[COL.owner_user_id] = record.ownerUserId;
  row[COL.player_pass_hash] = record.playerPassHash;
  row[COL.admin_pass_hash] = record.adminPassHash;
  row[COL.seq] = String(record.seq);
  row[COL.updated_at] = String(record.updatedAt);

  const parts = splitState(JSON.stringify(state));
  parts.forEach((part, i) => {
    row[STATE_COLUMN_START + i] = part;
  });
  return row;
}

function logRow(seq: number, envelope: CommandEnvelope): string[] {
  const payload = envelope.precondition
    ? {
        __envelope: 1,
        command: envelope.command,
        precondition: envelope.precondition,
      }
    : envelope.command;
  return [
    String(seq),
    new Date(envelope.at).toISOString(),
    envelope.actor.kind,
    envelope.actor.label,
    envelope.actor.ref ?? "",
    envelope.id,
    envelope.command.type,
    JSON.stringify(payload),
  ];
}

function parseLogRow(row: string[]): CommandEnvelope | null {
  const [, ts, kind, label, ref, id, , payload] = row;
  if (!id || !payload) return null;
  try {
    const parsed = JSON.parse(payload) as
      | CommandEnvelope["command"]
      | {
          __envelope: 1;
          command: CommandEnvelope["command"];
          precondition: CommandEnvelope["precondition"];
        };
    const wrapped =
      typeof parsed === "object" && parsed !== null && "__envelope" in parsed;
    return {
      id,
      at: ts ? Date.parse(ts) : 0,
      actor: {
        kind: (kind as CommandEnvelope["actor"]["kind"]) || "system",
        label: label ?? "",
        ref: ref || undefined,
      },
      command: wrapped ? parsed.command : parsed,
      ...(wrapped && parsed.precondition ? { precondition: parsed.precondition } : {}),
    };
  } catch {
    return null;
  }
}

function parseSnapshot(json: string): EventState | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as EventState;
    // Kiểm sơ bộ cho chắc: chuỗi bị cắt cụt vẫn có thể tình cờ hợp lệ JSON.
    if (!Array.isArray(parsed.players) || !Array.isArray(parsed.matches)) return null;
    return withEventDefaults(parsed);
  } catch {
    return null;
  }
}
