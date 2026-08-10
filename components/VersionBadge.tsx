import { APP_CODENAME, buildVersionLabel } from "@/lib/version";

/**
 * Dấu nhận biết bản đang chạy, hiện trên mọi trang.
 *
 * Trên điện thoại đặt cao hơn thanh điều hướng dưới; trên desktop nằm sát góc
 * dưới. Nhờ kèm commit ngắn, chỉ nhìn ảnh chụp màn hình cũng biết Vercel đã nhận
 * đúng lần push nào, không phải đoán theo thời gian deploy.
 */
export function VersionBadge() {
  const commitSha =
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA;
  const label = buildVersionLabel(commitSha);

  return (
    <div
      data-app-version={label}
      data-app-codename={APP_CODENAME}
      title={`Phiên bản đang chạy: ${label} · ${APP_CODENAME}`}
      className="fixed bottom-[4.5rem] right-2 z-40 border border-ink/20 bg-paper/95 px-2 py-1 font-mono text-[10px] font-semibold tracking-wide text-mute-700 shadow-sm lg:bottom-2"
    >
      {label}
      {/* Tên hiệu nhạt hơn số: nó để nhớ và để gọi tên, còn thứ cần đọc chính xác
          khi đối chiếu deployment vẫn là cặp phiên bản · commit. */}
      <span className="ml-1 font-sans font-bold not-italic text-mute-600">· {APP_CODENAME}</span>
    </div>
  );
}
