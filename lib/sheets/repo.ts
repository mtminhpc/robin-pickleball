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
import type { EventState } from "../domain/types";
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
} from "./schema";

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
   * Áp một lệnh rồi ghi xuống: một lời gọi ghi duy nhất, gồm nối thêm nhật ký và
   * cập nhật ảnh chụp.
   *
   * Lệnh được kiểm tra trên `loaded.state` trước khi ghi, nên lệnh sai bị chặn tại
   * đây chứ không lọt vào nhật ký. Nếu trong lúc đó có người khác vừa ghi xen vào
   * thì lệnh này vẫn được nối thêm an toàn, và lần phát lại tiếp theo sẽ quyết
   * định ai thắng — không kết quả nào biến mất.
   */
  async append(
    code: string,
    envelope: CommandEnvelope,
    loaded: LoadedEvent,
  ): Promise<CommitResult> {
    const result = apply(loaded.state, envelope);
    if (!result.ok) return { ok: false, error: result.error };
    const next = result.value;

    await this.sheets.ensureTab(logTab(code), LOG_HEADERS);

    const record = { ...loaded.record, seq: next.seq, updatedAt: envelope.at };
    const ops: WriteOp[] = [
      { kind: "append", tab: logTab(code), values: [logRow(next.seq, envelope)] },
      {
        kind: "update",
        range: rowRange(TABS.events, loaded.record.rowIndex, EVENT_COLUMNS.length),
        values: [eventRow(record, next)],
      },
    ];

    await this.sheets.batch(ops);
    return { ok: true, state: next, seq: next.seq };
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
  async create(
    record: Omit<EventRecord, "rowIndex" | "seq" | "updatedAt">,
    createdAt: number,
  ): Promise<EventRecord> {
    await this.bootstrap();
    await this.sheets.ensureTab(logTab(record.code), LOG_HEADERS);

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
  return [
    String(seq),
    new Date(envelope.at).toISOString(),
    envelope.actor.kind,
    envelope.actor.label,
    envelope.actor.ref ?? "",
    envelope.id,
    envelope.command.type,
    JSON.stringify(envelope.command),
  ];
}

function parseLogRow(row: string[]): CommandEnvelope | null {
  const [, ts, kind, label, ref, id, , payload] = row;
  if (!id || !payload) return null;
  try {
    return {
      id,
      at: ts ? Date.parse(ts) : 0,
      actor: {
        kind: (kind as CommandEnvelope["actor"]["kind"]) || "system",
        label: label ?? "",
        ref: ref || undefined,
      },
      command: JSON.parse(payload),
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
    return parsed;
  } catch {
    return null;
  }
}
