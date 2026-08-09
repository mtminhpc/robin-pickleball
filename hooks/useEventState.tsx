"use client";

/**
 * Đọc và theo dõi trạng thái một sự kiện.
 *
 * Hỏi lại máy chủ mỗi vài giây để mọi điện thoại quanh sân thấy cùng một thứ.
 * Điều này an toàn với hạn mức vì máy chủ có bộ nhớ đệm 5 giây dùng chung —
 * xem `lib/sheets/cache.ts`.
 *
 * Tab đang ẩn thì giãn ra rất thưa: điện thoại nằm trong túi không cần biết tỷ
 * số, mà mỗi lần hỏi vẫn tốn pin và có thể tốn hạn mức.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, type ReactNode } from "react";
import type { Role } from "@/lib/domain/commands";
import type { EventState } from "@/lib/domain/types";

export interface EventSnapshot {
  state: EventState;
  role: Role;
  /** Mã giả để giao diện đối chiếu quyền tự sửa, không phải mã thiết bị thật. */
  actorRef: "self" | "";
  /** Người nào đã có danh tính nhận, nhưng không công khai danh tính đó. */
  claimedPlayerIds: string[];
  /**
   * Người chơi nào là người đang xem, do máy chủ trả lời.
   *
   * Trình duyệt không tự dò được: cookie tài khoản là `httpOnly` nên chỉ máy chủ
   * đọc nổi, và người vừa đổi điện thoại thì không có mã máy nào để dò cả.
   */
  myPlayerId: string | null;
  requiresPlayerPassword: boolean;
  /**
   * Bạn là chủ buổi đánh nhờ tài khoản, không phải nhờ gõ mật khẩu.
   *
   * Chỉ có cờ đúng/sai chứ không có mã tài khoản của chủ. Giao diện cần biết
   * *bạn có phải chủ không*, chứ không cần biết *chủ là ai* — mà mọi người xem
   * buổi đánh đều nhận được cùng một câu trả lời này.
   */
  ownerByAccount: boolean;
  /** Buổi cũ chưa có tài khoản chủ và có thể nhận lại bằng mật khẩu chủ. */
  ownerClaimable: boolean;
  repaired: boolean;
}

const ACTIVE_POLL_MS = 3_000;
const HIDDEN_POLL_MS = 30_000;

interface EventContextValue {
  data: EventSnapshot | undefined;
  isLoading: boolean;
  error: Error | null;
  /** Ghi đè trạng thái ngay khi máy chủ trả về sau một lệnh, không đợi lần hỏi sau. */
  applyServerState: (state: EventState) => void;
  refresh: () => void;
}

const EventContext = createContext<EventContextValue | null>(null);

export function useEvent(): EventContextValue {
  const ctx = useContext(EventContext);
  if (!ctx) throw new Error("useEvent phải nằm trong <EventProvider>");
  return ctx;
}

/** Lối tắt cho phần lớn màn hình chỉ cần trạng thái đã tải xong. */
export function useEventState(): EventSnapshot | undefined {
  return useEvent().data;
}

export function eventQueryKey(code: string) {
  return ["event", code] as const;
}

export function EventProvider({
  code,
  initial,
  children,
}: {
  code: string;
  /** Dữ liệu máy chủ dựng sẵn, để màn hình có nội dung ngay từ lượt tải đầu. */
  initial?: EventSnapshot;
  children: ReactNode;
}) {
  const client = useQueryClient();

  const query = useQuery({
    queryKey: eventQueryKey(code),
    queryFn: async (): Promise<EventSnapshot> => {
      const res = await fetch(`/api/events/${code}/state`, { cache: "no-store" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Không tải được dữ liệu sự kiện.");
      }
      return (await res.json()) as EventSnapshot;
    },
    initialData: initial,
    refetchInterval: () =>
      typeof document !== "undefined" && document.visibilityState === "hidden"
        ? HIDDEN_POLL_MS
        : ACTIVE_POLL_MS,
    refetchIntervalInBackground: false,
    // Giữ dữ liệu cũ trên màn hình khi đang tải lại. Nháy trắng giữa hai lần hỏi
    // sẽ khiến người ta tưởng mất kết nối.
    placeholderData: (previous) => previous,
    retry: 3,
  });

  const applyServerState = useCallback(
    (state: EventState) => {
      client.setQueryData<EventSnapshot>(eventQueryKey(code), (prev) =>
        prev ? { ...prev, state } : prev,
      );
    },
    [client, code],
  );

  const refresh = useCallback(() => {
    void client.invalidateQueries({ queryKey: eventQueryKey(code) });
  }, [client, code]);

  return (
    <EventContext.Provider
      value={{
        data: query.data,
        isLoading: query.isLoading,
        error: (query.error as Error | null) ?? null,
        applyServerState,
        refresh,
      }}
    >
      {children}
    </EventContext.Provider>
  );
}
