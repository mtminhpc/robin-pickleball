/**
 * Tạo sẵn các tab và dòng tiêu đề trong Google Sheet.
 *
 *   pnpm bootstrap-sheet
 *
 * Chạy một lần sau khi đã điền biến môi trường. Ứng dụng cũng tự tạo tab khi
 * cần, nhưng chạy trước ở đây có hai cái lợi: bạn biết ngay là cấu hình đúng hay
 * sai thay vì phát hiện lúc đang ở sân, và thông báo lỗi ở đây nói rõ phải sửa gì.
 */

import { readFileSync } from "node:fs";
import { getSheetsClient, storeKind } from "../lib/sheets/factory";
import { EventRepo } from "../lib/sheets/repo";
import { HEADERS } from "../lib/sheets/schema";

/** Nạp `.env.local` thủ công — script này chạy ngoài Next nên không có sẵn. */
function loadEnv(): void {
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // Không có .env.local là bình thường khi biến đã đặt sẵn ở môi trường.
  }
}

async function main(): Promise<void> {
  loadEnv();

  const kind = storeKind();
  if (kind === "local") {
    console.error(
      "Chưa có biến môi trường Google.\n" +
        "Cần GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY và SHEET_ID trong .env.local.\n" +
        "Xem docs/SETUP.md để biết cách lấy.\n\n" +
        "Nếu bạn chỉ muốn chạy thử trên máy thì không cần script này: `pnpm dev` là chạy được ngay.",
    );
    process.exit(1);
  }

  const client = getSheetsClient();
  console.log("Đang nối tới Google Sheet…");

  const before = await client.listTabs();
  console.log(`Bảng tính hiện có ${before.length} tab.`);

  await new EventRepo(client).bootstrap();

  const after = await client.listTabs();
  const created = after.filter((t) => !before.includes(t));

  if (created.length > 0) console.log("Đã tạo:", created.join(", "));
  else console.log("Các tab đã có sẵn, không phải tạo thêm.");

  console.log("\nCác tab dùng chung:");
  for (const [tab, headers] of Object.entries(HEADERS)) {
    console.log(`  ${tab.padEnd(14)} ${headers.length} cột`);
  }
  console.log(
    "\nMỗi buổi đánh sẽ tự sinh thêm hai tab riêng: log__<mã> (nhật ký) và view__<mã> (bản in).",
  );
  console.log("\nXong. Chạy `pnpm dev` hoặc triển khai lên Vercel.");
}

main().catch((error: unknown) => {
  console.error("\nKhông chạy được:", error instanceof Error ? error.message : error);
  console.error(
    "\nHay gặp nhất:\n" +
      "  • Chưa chia sẻ bảng tính cho email service account (cần quyền Editor)\n" +
      "  • SHEET_ID lấy sai — nó là đoạn giữa /d/ và /edit trong đường dẫn\n" +
      "  • GOOGLE_PRIVATE_KEY mất phần xuống dòng: để nguyên cả chuỗi trong dấu nháy kép\n" +
      "  • Chưa bật Google Sheets API trong project trên Google Cloud",
  );
  process.exit(1);
});
