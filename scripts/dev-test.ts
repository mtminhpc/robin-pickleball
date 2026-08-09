/** Khởi động app bằng kho TEST cục bộ kể cả khi máy có cấu hình Google Sheet. */

import { spawn } from "node:child_process";
import { seedTestData, TEST_DATA_PATH } from "./seed-test-data";

await seedTestData();

const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev"], {
  cwd: process.cwd(),
  stdio: "inherit",
  env: {
    ...process.env,
    ROBIN_LOCAL_TEST_DATA: "1",
    LOCAL_SHEET_PATH: TEST_DATA_PATH,
  },
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
