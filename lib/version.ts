import packageJson from "@/package.json";

/** Phiên bản phát hành, lấy trực tiếp từ package.json để không có hai nơi lệch nhau. */
export const APP_VERSION = `v${packageJson.version}`;

/**
 * Tên hiệu của bản phát hành.
 *
 * Con số nói thứ tự, cái tên nói *bản này làm gì*. Khi báo lỗi qua điện thoại thì
 * "bản Trao quyền" dễ nói và dễ nhớ hơn "không chấm chín chấm không".
 *
 * Đổi tên mỗi khi đổi số nhỏ (minor); bản vá thì giữ nguyên tên của bản gốc.
 */
export const APP_CODENAME = "Trao quyền";

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

/**
 * Nhãn kèm tên hiệu.
 *
 * Tên đứng **sau** cặp `vX.Y.Z · <commit>` chứ không chen vào giữa: quy trình
 * kiểm phát hành trong `AGENTS.md` dò đúng cặp đó trong HTML, và một cái tên
 * chèn vào giữa sẽ làm bước kiểm ấy trượt mà không ai để ý.
 */
export function buildVersionLabelWithCodename(commitSha?: string | null): string {
  return `${buildVersionLabel(commitSha)} · ${APP_CODENAME}`;
}
