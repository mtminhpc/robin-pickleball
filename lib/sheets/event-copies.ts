import { randomUUID } from "node:crypto";
import type { SheetsClient } from "./client";
import { indexToColumn } from "./client";
import { HEADERS, TABS } from "./schema";

const COLUMNS = HEADERS[TABS.eventCopies];
const C = Object.fromEntries(COLUMNS.map((name, index) => [name, index])) as Record<
  (typeof COLUMNS)[number],
  number
>;

export type EventCopyStatus = "reserved" | "complete" | "failed";
export interface EventCopyClaim {
  code: string;
  token: string;
  status: EventCopyStatus;
  createdAt: number;
}

/** Idempotency append-only; một bản ghi `failed` mở epoch mới để cùng key có thể retry. */
export class EventCopyRepo {
  constructor(private readonly sheets: SheetsClient) {}

  async find(ownerUserId: string, sourceCode: string, key: string): Promise<EventCopyClaim | null> {
    return claimFromRows(await this.rows(), ownerUserId, sourceCode, key);
  }

  async reserve(input: {
    ownerUserId: string;
    sourceCode: string;
    idempotencyKey: string;
    newCode: string;
    at: number;
  }): Promise<EventCopyClaim & { winner: boolean }> {
    await this.sheets.ensureTab(TABS.eventCopies, COLUMNS);
    // Một lần tạo có thể đã ghi được dòng event/asset trước khi request bị ngắt.
    // Retry cùng key phải tiếp tục đúng mã cũ để không để lại một draft mồ côi
    // vừa chiếm quota vừa không xuất hiện như bản sao hoàn chỉnh.
    const prior = await this.find(input.ownerUserId, input.sourceCode, input.idempotencyKey);
    const code = prior?.status === "failed" && prior.code
      ? prior.code
      : input.newCode.toUpperCase();
    const token = randomUUID();
    await this.append(input, token, code, "reserved", input.at);
    const claim = claimFromRows(
      await this.rows(),
      input.ownerUserId,
      input.sourceCode,
      input.idempotencyKey,
    );
    return {
      code: claim?.code ?? code,
      token: claim?.token ?? token,
      status: claim?.status ?? "reserved",
      createdAt: claim?.createdAt ?? input.at,
      winner: claim?.token === token,
    };
  }

  async complete(input: CopyTransition): Promise<void> {
    await this.append(input, input.token, input.code, "complete", input.at);
  }

  async fail(input: CopyTransition): Promise<void> {
    const current = await this.find(input.ownerUserId, input.sourceCode, input.idempotencyKey);
    if (!current || current.token !== input.token || current.status === "complete") return;
    await this.append(input, input.token, input.code, "failed", input.at);
  }

  private async append(
    input: { ownerUserId: string; sourceCode: string; idempotencyKey: string },
    token: string,
    code: string,
    status: EventCopyStatus,
    at: number,
  ): Promise<void> {
    await this.sheets.batch([{
      kind: "append",
      tab: TABS.eventCopies,
      values: [[
        input.ownerUserId,
        input.sourceCode.toUpperCase(),
        input.idempotencyKey,
        token,
        code.toUpperCase(),
        String(at),
        status,
      ]],
    }]);
  }

  private async rows(): Promise<string[][]> {
    await this.sheets.ensureTab(TABS.eventCopies, COLUMNS);
    const [range] = await this.sheets.batchGet([
      `${TABS.eventCopies}!A:${indexToColumn(COLUMNS.length - 1)}`,
    ]);
    return range?.values ?? [];
  }
}

interface CopyTransition {
  ownerUserId: string;
  sourceCode: string;
  idempotencyKey: string;
  token: string;
  code: string;
  at: number;
}

function claimFromRows(
  rows: string[][],
  ownerUserId: string,
  sourceCode: string,
  key: string,
): EventCopyClaim | null {
  const matching = rows.filter(
    (row, index) =>
      index > 0 &&
      row[C.owner_user_id] === ownerUserId &&
      row[C.source_code] === sourceCode.toUpperCase() &&
      row[C.idempotency_key] === key,
  );
  let lastFailure = -1;
  for (let index = 0; index < matching.length; index++) {
    if (matching[index]?.[C.status] === "failed") lastFailure = index;
  }
  const epoch = matching.slice(lastFailure + 1);
  const reservation = epoch.find((row) => (row[C.status] || "reserved") === "reserved");
  if (!reservation) {
    const failed = matching[lastFailure];
    return failed ? fromRow(failed, "failed") : null;
  }
  const token = reservation[C.token] ?? "";
  const latest = [...epoch].reverse().find((row) => row[C.token] === token) ?? reservation;
  return fromRow(latest, latest[C.status] === "complete" ? "complete" : "reserved");
}

function fromRow(row: string[], status: EventCopyStatus): EventCopyClaim {
  return {
    code: (row[C.new_code] ?? "").toUpperCase(),
    token: row[C.token] ?? "",
    status,
    createdAt: Number(row[C.created_at] ?? 0),
  };
}
