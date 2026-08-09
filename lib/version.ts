import packageJson from "@/package.json";

/** Phiên bản phát hành, lấy trực tiếp từ package.json để không có hai nơi lệch nhau. */
export const APP_VERSION = `v${packageJson.version}`;

/**
 * Nhãn đủ ngắn để nhìn trên điện thoại nhưng vẫn chỉ đúng bản build nào đang chạy.
 *
 * Vercel cấp `VERCEL_GIT_COMMIT_SHA` cho deployment nối Git. Ở máy local không
 * có biến đó, chữ `local` là tín hiệu rõ ràng rằng đây chưa phải bản trên mạng.
 */
export function buildVersionLabel(commitSha?: string | null): string {
  const revision = commitSha?.trim().slice(0, 7);
  return `${APP_VERSION} · ${revision || "local"}`;
}
