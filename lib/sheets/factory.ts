/**
 * Chọn kho dữ liệu theo môi trường.
 *
 * Có đủ biến môi trường Google thì dùng Google Sheet thật; không thì dùng tệp
 * JSON trên máy để chạy thử. Ranh giới này cố ý rất rõ ràng và có báo ra màn
 * hình, vì kiểu hỏng tệ nhất là chạy thật mà tưởng đang lưu, hoá ra ghi vào một
 * tệp tạm rồi mất sạch.
 */

import type { SheetsClient } from "./client";
import { GoogleSheetsClient } from "./google";
import { LocalFileSheetsClient } from "./local";

export type StoreKind = "google" | "local";

const LOCAL_PATH = process.env.LOCAL_SHEET_PATH ?? ".data/sheet.json";
const FORCE_TEST_LOCAL = process.env.ROBIN_LOCAL_TEST_DATA === "1";

let cached: { client: SheetsClient; kind: StoreKind } | null = null;

export function storeKind(): StoreKind {
  return !FORCE_TEST_LOCAL && googleConfig() ? "google" : "local";
}

/**
 * Kho dữ liệu dùng chung cho cả tiến trình.
 *
 * Dùng lại một thực thể để `GoogleSheetsClient` giữ được access token và bản đồ
 * tên tab đã đọc — tạo mới mỗi lần sẽ đốt hạn mức API rất nhanh.
 */
export function getSheetsClient(): SheetsClient {
  if (cached) return cached.client;

  if (FORCE_TEST_LOCAL) {
    assertLocalAllowed();
    console.warn(
      `[robin-pickleball] Chế độ TEST: dùng kho cục bộ "${LOCAL_PATH}", không đụng Google Sheet.`,
    );
    cached = { client: new LocalFileSheetsClient(LOCAL_PATH), kind: "local" };
    return cached.client;
  }

  const google = googleConfig();
  if (google) {
    cached = { client: new GoogleSheetsClient(google), kind: "google" };
    return cached.client;
  }

  assertLocalAllowed();
  console.warn(
    `[robin-pickleball] Chưa có biến môi trường Google, đang dùng kho chạy thử "${LOCAL_PATH}". ` +
      "Dữ liệu chỉ nằm trên máy này.",
  );
  cached = { client: new LocalFileSheetsClient(LOCAL_PATH), kind: "local" };
  return cached.client;
}

/** Chỉ dùng trong kiểm thử: ép dùng một kho khác. */
export function setSheetsClientForTesting(client: SheetsClient | null): void {
  cached = client ? { client, kind: "local" } : null;
}

function googleConfig() {
  const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY;
  const spreadsheetId = process.env.SHEET_ID;
  if (!serviceAccountEmail || !privateKey || !spreadsheetId) return null;
  return { serviceAccountEmail, privateKey, spreadsheetId };
}

/**
 * Chặn kho chạy thử ở môi trường thật.
 *
 * Trên Vercel hệ tệp không giữ lại giữa các lần gọi hàm. Nếu để lọt, ứng dụng sẽ
 * chạy trơn tru, báo "đã lưu", rồi mất sạch dữ liệu ở lần gọi sau — đúng kiểu
 * hỏng mà người dùng sợ nhất. Thà không khởi động được còn hơn.
 */
function assertLocalAllowed(): void {
  const onVercel = process.env.VERCEL === "1";
  const isProduction = process.env.NODE_ENV === "production";
  if (!onVercel && !isProduction) return;

  throw new Error(
    "Thiếu biến môi trường Google Sheet (GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, SHEET_ID). " +
      "Bản chạy thật bắt buộc phải có, vì kho chạy thử ghi vào tệp trên máy và sẽ mất dữ liệu. " +
      "Xem docs/SETUP.md.",
  );
}
