/**
 * Soát biến môi trường trước khi triển khai.
 *
 *   npm run check-env
 *
 * Lý do tồn tại: hỏng cấu hình khi triển khai thật thì thông báo lỗi rơi vào
 * nhật ký của Vercel, giữa hàng trăm dòng, bằng tiếng Anh, và thường chỉ nói
 * "undefined". Chạy lệnh này trước thì mọi thứ sai được nói ra ở đây, bằng tiếng
 * Việt, kèm cách sửa.
 *
 * Cố ý **không in ra giá trị của biến nào**, chỉ nói có/không và đúng dạng hay
 * không. Chép khoá riêng ra màn hình là cách làm lộ nó nhanh nhất — nó sẽ nằm
 * lại trong lịch sử cửa sổ lệnh, trong ảnh chụp màn hình gửi cho người khác.
 */

import { readFileSync } from "node:fs";

/** Nạp `.env.local` thủ công — script này chạy ngoài Next nên không có sẵn. */
function loadEnv(): boolean {
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
    return true;
  } catch {
    return false;
  }
}

type Level = "ok" | "warn" | "err";

interface Check {
  level: Level;
  label: string;
  detail: string;
}

const MARK: Record<Level, string> = { ok: "  OK  ", warn: " LƯU Ý", err: " THIẾU" };

function main(): void {
  const hasFile = loadEnv();
  const checks: Check[] = [];
  /** Dòng cần dán vào Google Cloud, in ở cuối cho dễ chép. */
  let redirectHint = "";

  // -- Kho dữ liệu: bắt buộc khi chạy thật -----------------------------------
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY;
  const sheet = process.env.SHEET_ID;
  const hasStore = !!(email && key && sheet);

  if (!hasStore) {
    checks.push({
      level: "err",
      label: "Google Sheet",
      detail:
        "Thiếu " +
        [
          !email && "GOOGLE_SERVICE_ACCOUNT_EMAIL",
          !key && "GOOGLE_PRIVATE_KEY",
          !sheet && "SHEET_ID",
        ]
          .filter(Boolean)
          .join(", ") +
        ". Chạy thử trên máy thì không sao, nhưng bản thật BẮT BUỘC phải có — " +
        "thiếu là ứng dụng từ chối khởi động, cố ý, để khỏi âm thầm mất dữ liệu.",
    });
  } else {
    checks.push({ level: "ok", label: "Google Sheet", detail: "đủ ba biến" });

    if (!email!.includes("gserviceaccount.com")) {
      checks.push({
        level: "warn",
        label: "GOOGLE_SERVICE_ACCOUNT_EMAIL",
        detail:
          "không có dạng ...@....iam.gserviceaccount.com. Đây phải là email của " +
          "service account, không phải email cá nhân của bạn.",
      });
    }
    if (!key!.includes("BEGIN PRIVATE KEY")) {
      checks.push({
        level: "err",
        label: "GOOGLE_PRIVATE_KEY",
        detail:
          "không chứa 'BEGIN PRIVATE KEY'. Chép nguyên văn giá trị private_key " +
          "trong tệp JSON tải về, giữ cả các ký tự \\n, bọc trong nháy kép.",
      });
    }
    if (/^https?:|\/d\//.test(sheet!)) {
      checks.push({
        level: "err",
        label: "SHEET_ID",
        detail:
          "đang là cả đường dẫn. Chỉ lấy đoạn giữa /d/ và /edit, ví dụ " +
          "1a2B3cD4eF5gH6iJ7kL8mN9oP0qR.",
      });
    }
  }

  // -- Khoá ký cookie: bắt buộc khi chạy thật --------------------------------
  const secret = process.env.APP_SECRET;
  if (!secret) {
    checks.push({
      level: "err",
      label: "APP_SECRET",
      detail:
        "chưa đặt. Ai đoán được nó thì tự cấp cho mình quyền chủ sự kiện của mọi " +
        "buổi đánh. Sinh một chuỗi mới bằng: npm run new-secret",
    });
  } else if (secret.length < 16) {
    checks.push({
      level: "err",
      label: "APP_SECRET",
      detail: `mới ${secret.length} ký tự, cần ít nhất 16. Sinh lại: npm run new-secret`,
    });
  } else if (secret.length < 32) {
    checks.push({
      level: "warn",
      label: "APP_SECRET",
      detail: `${secret.length} ký tự — chạy được, nhưng 43 ký tự ngẫu nhiên thì yên tâm hơn.`,
    });
  } else {
    checks.push({ level: "ok", label: "APP_SECRET", detail: `${secret.length} ký tự` });
  }

  // -- Đăng nhập Google: tuỳ chọn -------------------------------------------
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

  if (!clientId && !clientSecret) {
    checks.push({
      level: "warn",
      label: "Đăng nhập Google",
      detail:
        "chưa bật (tuỳ chọn). Nút đăng nhập sẽ không hiện ra, mọi thứ khác chạy " +
        "y nguyên. Muốn bật: xem docs/SETUP.md.",
    });
  } else if (!clientId || !clientSecret) {
    checks.push({
      level: "err",
      label: "Đăng nhập Google",
      detail: `chỉ có một nửa — thiếu ${clientId ? "GOOGLE_OAUTH_CLIENT_SECRET" : "GOOGLE_OAUTH_CLIENT_ID"}. Phải có cả hai.`,
    });
  } else {
    checks.push({ level: "ok", label: "Đăng nhập Google", detail: "đủ hai biến" });

    if (!clientId.endsWith(".apps.googleusercontent.com")) {
      checks.push({
        level: "warn",
        label: "GOOGLE_OAUTH_CLIENT_ID",
        detail: "thường kết thúc bằng .apps.googleusercontent.com — kiểm lại xem có chép nhầm không.",
      });
    }

    const appUrl = process.env.APP_URL;
    if (!appUrl) {
      checks.push({
        level: "warn",
        label: "APP_URL",
        detail:
          "chưa đặt. Chạy trên máy thì không sao. Trên Vercel thì NÊN đặt, vì đằng " +
          "sau proxy ứng dụng sẽ tự suy ra địa chỉ nội bộ và Google từ chối với lỗi " +
          "redirect_uri_mismatch.",
      });
    } else {
      checks.push({ level: "ok", label: "APP_URL", detail: appUrl });
      if (appUrl.endsWith("/")) {
        checks.push({
          level: "err",
          label: "APP_URL",
          detail: "có dấu / ở cuối. Bỏ đi, nếu không redirect_uri sẽ có hai dấu gạch.",
        });
      }
      if (!/^https?:\/\//.test(appUrl)) {
        checks.push({
          level: "err",
          label: "APP_URL",
          detail: "phải bắt đầu bằng https:// (hoặc http:// khi chạy trên máy).",
        });
      }
      redirectHint = `${appUrl.replace(/\/+$/, "")}/api/auth/google/callback`;
    }
  }

  // -- In kết quả ------------------------------------------------------------
  if (!hasFile) {
    console.log(
      "Không thấy tệp .env.local — đang soát biến của môi trường hiện tại.\n",
    );
  }

  for (const c of checks) {
    console.log(`${MARK[c.level]}  ${c.label}: ${c.detail}`);
  }

  if (redirectHint) {
    console.log(
      "\nRedirect URI phải khai đúng dòng này trên Google Cloud, từng ký tự một:\n" +
        `  ${redirectHint}`,
    );
  }

  const errors = checks.filter((c) => c.level === "err").length;
  console.log(
    errors === 0
      ? "\nKhông có lỗi chặn. Bước tiếp: npm run bootstrap-sheet rồi npm run dev.\n"
      : `\n${errors} chỗ phải sửa trước khi triển khai. Xem docs/SETUP.md.\n`,
  );
  if (errors > 0) process.exitCode = 1;
}

main();
