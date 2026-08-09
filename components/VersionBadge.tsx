import { buildVersionLabel } from "@/lib/version";

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
      title={`Phiên bản đang chạy: ${label}`}
      className="fixed bottom-[4.5rem] right-2 z-40 border border-ink/20 bg-paper/95 px-2 py-1 font-mono text-[10px] font-semibold tracking-wide text-mute-700 shadow-sm lg:bottom-2"
    >
      {label}
    </div>
  );
}
