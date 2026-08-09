"use client";

/**
 * Băng trạng thái lưu, dính trên đầu màn hình.
 *
 * Yêu cầu số 7 của người dùng nói thẳng nỗi sợ: "tránh việc tưởng nhầm đã lưu
 * rồi thì không được". Nên ba trạng thái ở đây cố tình khác nhau rất rõ về màu,
 * và quan trọng nhất là **khác nhau về việc có tự biến mất hay không**:
 *
 *   • Đang lưu  — xám đậm, có vòng xoay, tự thay đổi khi xong
 *   • Đã lưu    — xám nhạt, kèm giờ cụ thể, tự ẩn sau vài giây
 *   • Chưa lưu  — ĐỎ, KHÔNG tự ẩn, có nút thử lại
 *
 * Băng đỏ không tự ẩn là điểm mấu chốt. Một thông báo lỗi tự biến mất sau vài
 * giây thì y hệt như không có, mà đúng lúc đó người dùng đang mải nhìn ra sân.
 *
 * Băng mỏng, chữ hoa nhỏ: nó nằm trên mọi màn hình suốt buổi, nên phải nói đủ
 * mà không chiếm chỗ của thứ người ta đang cần nhìn.
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
        <span className="flex-1 normal-case tracking-normal">
          <strong className="uppercase tracking-[0.1em]">Không lưu được</strong>{" "}
          — {failure.error}
        </span>
        <BannerButton onClick={() => queue.dismissFailure(failure.id)}>
          Đã hiểu
        </BannerButton>
      </Banner>
    );
  }

  if (queue.pending > 0 && (queue.status === "error" || queue.offline)) {
    return (
      <Banner tone="danger">
        <span className="flex-1 normal-case tracking-normal">
          <strong className="uppercase tracking-[0.1em]">
            {queue.pending} thay đổi chưa lưu
          </strong>{" "}
          —{" "}
          {queue.offline
            ? "đang mất mạng, sẽ tự gửi lại khi có sóng. Đừng đóng trang."
            : "không nối được máy chủ, đang thử lại. Đừng đóng trang."}
        </span>
        <BannerButton onClick={queue.retryNow}>Thử lại</BannerButton>
      </Banner>
    );
  }

  if (queue.status === "saving") {
    return (
      <Banner tone="working">
        <Spinner />
        Đang lưu{queue.pending > 1 ? ` ${queue.pending} thay đổi` : ""}
      </Banner>
    );
  }

  if (queue.status === "saved" && queue.lastSavedAt) {
    return (
      <Banner tone="done">Đã lưu {formatClock(queue.lastSavedAt)}</Banner>
    );
  }

  return null;
}

function Banner({
  tone,
  children,
}: {
  tone: "working" | "done" | "danger";
  children: React.ReactNode;
}) {
  const palette = {
    working: "bg-mute-800 text-white",
    done: "bg-mute-300 text-ink",
    danger: "bg-accent text-paper font-semibold",
  }[tone];

  return (
    <div
      // `role=status` để trình đọc màn hình đọc lên mà không cắt ngang thao tác.
      role="status"
      aria-live="polite"
      className={`sticky top-0 z-40 flex items-center gap-3 px-4 py-2.5 text-[11px] uppercase tracking-[0.1em] ${palette}`}
    >
      {children}
    </div>
  );
}

function BannerButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 bg-paper px-3 py-1.5 font-display text-[10px] font-extrabold uppercase tracking-[0.1em] text-accent"
    >
      {children}
    </button>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="h-2.5 w-2.5 shrink-0 animate-spin rounded-full border-2 border-mute-600 border-t-white"
    />
  );
}

function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
