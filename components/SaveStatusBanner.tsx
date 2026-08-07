"use client";

/**
 * Băng trạng thái lưu, dính trên đầu màn hình.
 *
 * Yêu cầu số 7 của người dùng nói thẳng nỗi sợ: "tránh việc tưởng nhầm đã lưu
 * rồi thì không được". Nên ba trạng thái ở đây cố tình khác nhau rất rõ về màu,
 * và quan trọng nhất là **khác nhau về việc có tự biến mất hay không**:
 *
 *   • Đang lưu  — xám, có vòng xoay, tự thay đổi khi xong
 *   • Đã lưu    — xanh, kèm giờ cụ thể, tự ẩn sau 3 giây
 *   • Chưa lưu  — ĐỎ, KHÔNG tự ẩn, có nút thử lại
 *
 * Băng đỏ không tự ẩn là điểm mấu chốt. Một thông báo lỗi tự biến mất sau vài
 * giây thì y hệt như không có, mà đúng lúc đó người dùng đang mải nhìn ra sân.
 */

import { useMutationQueue } from "@/hooks/useMutationQueue";

export function SaveStatusBanner() {
  const queue = useMutationQueue();

  // Lệnh bị từ chối hẳn phải đọc trước mọi thứ khác: gửi lại không cứu được, và
  // người dùng cần biết kết quả họ vừa nhập KHÔNG được ghi.
  if (queue.failures.length > 0) {
    const failure = queue.failures[0]!;
    return (
      <Banner tone="danger">
        <div className="flex-1">
          <div className="font-semibold">Không lưu được</div>
          <div className="text-sm opacity-90">{failure.error}</div>
        </div>
        <button
          type="button"
          onClick={() => queue.dismissFailure(failure.id)}
          className="min-h-tap shrink-0 rounded-lg bg-white/20 px-4 font-semibold"
        >
          Đã hiểu
        </button>
      </Banner>
    );
  }

  if (queue.pending > 0 && (queue.status === "error" || queue.offline)) {
    return (
      <Banner tone="danger">
        <div className="flex-1">
          <div className="font-semibold">
            {queue.pending} thay đổi chưa lưu
          </div>
          <div className="text-sm opacity-90">
            {queue.offline
              ? "Đang mất mạng. Sẽ tự gửi lại khi có sóng — đừng đóng trang."
              : "Không nối được máy chủ. Đang thử lại — đừng đóng trang."}
          </div>
        </div>
        <button
          type="button"
          onClick={queue.retryNow}
          className="min-h-tap shrink-0 rounded-lg bg-white/20 px-4 font-semibold"
        >
          Thử lại
        </button>
      </Banner>
    );
  }

  if (queue.status === "saving") {
    return (
      <Banner tone="neutral">
        <Spinner />
        <span className="font-semibold">
          Đang lưu{queue.pending > 1 ? ` ${queue.pending} thay đổi` : ""}…
        </span>
      </Banner>
    );
  }

  if (queue.status === "saved" && queue.lastSavedAt) {
    return (
      <Banner tone="success">
        <span aria-hidden>✓</span>
        <span className="font-semibold">
          Đã lưu lúc {formatClock(queue.lastSavedAt)}
        </span>
      </Banner>
    );
  }

  return null;
}

function Banner({
  tone,
  children,
}: {
  tone: "neutral" | "success" | "danger";
  children: React.ReactNode;
}) {
  const palette = {
    neutral: "bg-slate-700 text-white",
    success: "bg-court-600 text-white",
    danger: "bg-red-600 text-white",
  }[tone];

  return (
    <div
      // `role=status` để trình đọc màn hình đọc lên mà không cắt ngang thao tác.
      role="status"
      aria-live="polite"
      className={`sticky top-0 z-40 flex items-center gap-3 px-4 py-3 shadow-lg ${palette}`}
    >
      {children}
    </div>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-white/40 border-t-white"
    />
  );
}

function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
