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
import { get, set } from "idb-keyval";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { EventCapabilities, Role } from "@/lib/domain/commands";
import type { EventState } from "@/lib/domain/types";
import { useAccount } from "@/hooks/useAccount";

export interface EventSnapshot {
  state: EventState;
  role: Role;
  capabilities: EventCapabilities;
  roleLabel: string;
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
  /** Chỉ cờ của chính người xem; không đưa userId của bất kỳ người chơi nào ra public state. */
  myPlayerHasAccount: boolean;
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
const IDLE_POLL_MS = 10_000;
const etags = new Map<string, string>();

interface EventContextValue {
  data: EventSnapshot | undefined;
  isLoading: boolean;
  error: Error | null;
  /** Ghi đè trạng thái ngay khi máy chủ trả về sau một lệnh, không đợi lần hỏi sau. */
  applyServerState: (state: EventState) => void;
  refresh: () => void;
  /** Lần gần nhất nhận thay đổi từ thiết bị/tab khác. */
  externalSyncAt: number | null;
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

export function eventQueryKey(code: string, userId: string) {
  return ["event", code, userId || "anonymous"] as const;
}

export function eventQueryPrefix(code: string) {
  return ["event", code] as const;
}

export function EventProvider({
  code,
  initial,
  initialIdentity,
  children,
}: {
  code: string;
  /** Dữ liệu máy chủ dựng sẵn, để màn hình có nội dung ngay từ lượt tải đầu. */
  initial?: EventSnapshot;
  /** Tài khoản mà snapshot SSR đã được xét quyền; không suy đoán từ hook đang tải. */
  initialIdentity: string;
  children: ReactNode;
}) {
  const client = useQueryClient();
  const account = useAccount();
  // Trong lúc `/api/auth/session` còn đang tải, danh tính SSR là căn cứ đúng
  // nhất. Nếu mặc định ngay thành anonymous, snapshot Chủ có thể lọt vào cache
  // React Query của khách rồi lóe lại khi đăng xuất trên cùng tab.
  const userId = account.data === undefined
    ? (initialIdentity || "anonymous")
    : (account.data.user?.userId ?? "anonymous");
  const key = useMemo(() => eventQueryKey(code, userId), [code, userId]);
  const storageKey = `rp_event_snapshot_v6_${code}_${userId}`;
  const [externalSyncAt, setExternalSyncAt] = useState<number | null>(null);
  const initialRef = useRef(initial);
  const initialIdentityRef = useRef(initialIdentity || "anonymous");

  const query = useQuery({
    queryKey: key,
    queryFn: async (): Promise<EventSnapshot> => {
      const known = etags.get(storageKey);
      let res: Response;
      try {
        res = await fetch(`/api/events/${code}/state`, {
          cache: "no-store",
          headers: known ? { "If-None-Match": known } : undefined,
        });
      } catch (error) {
        const persisted = await get<EventSnapshot>(storageKey);
        if (persisted) return persisted;
        throw error;
      }
      if (res.status === 304) {
        const cached = client.getQueryData<EventSnapshot>(key);
        if (cached) return cached;
        const persisted = await get<EventSnapshot>(storageKey);
        if (persisted) {
          // Bản bền đã hạ quyền về viewer. Dùng nó để hiện ngay, nhưng buộc lần
          // poll kế tiếp lấy 200 đầy đủ thay vì kẹt mãi trong chuỗi 304.
          etags.delete(storageKey);
          return persisted;
        }
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Không tải được dữ liệu sự kiện.");
      }
      const snapshot = (await res.json()) as EventSnapshot;
      const etag = res.headers.get("etag");
      if (etag) etags.set(storageKey, etag);
      return snapshot;
    },
    // SSR snapshot chỉ thuộc đúng tài khoản/cookie lúc hydrate. Đăng xuất hoặc
    // đổi Gmail phải mở query trắng rồi hỏi lại, không được mượn quyền của key cũ.
    initialData: userId === initialIdentityRef.current ? initialRef.current : undefined,
    refetchInterval: (current) => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return false;
      }
      return current.state.data?.state.status === "running" ? ACTIVE_POLL_MS : IDLE_POLL_MS;
    },
    refetchIntervalInBackground: false,
    // Giữ dữ liệu cũ trên màn hình khi đang tải lại. Nháy trắng giữa hai lần hỏi
    // sẽ khiến người ta tưởng mất kết nối.
    placeholderData: (previous) => previous,
    retry: 3,
  });

  const applyServerState = useCallback(
    (state: EventState) => {
      client.setQueryData<EventSnapshot>(key, (prev) =>
        prev ? { ...prev, state } : prev,
      );
      if (typeof BroadcastChannel !== "undefined") {
        const channel = new BroadcastChannel(`rp_event_${code}_${userId}`);
        const snapshot = client.getQueryData<EventSnapshot>(key);
        if (snapshot) channel.postMessage(snapshot);
        channel.close();
      }
    },
    [client, code, key, userId],
  );

  const refresh = useCallback(() => {
    void client.invalidateQueries({ queryKey: key });
  }, [client, key]);

  // Local-first khi tải lại hoặc mất mạng: vẽ public snapshot từ IndexedDB trước,
  // lời đáp máy chủ (nếu có) sẽ thay thế nó và khôi phục đúng quyền phiên hiện tại.
  useEffect(() => {
    let cancelled = false;
    void get<EventSnapshot>(storageKey).then((persisted) => {
      if (cancelled || !persisted || client.getQueryData<EventSnapshot>(key)) return;
      client.setQueryData(key, persisted);
    });
    return () => {
      cancelled = true;
    };
  }, [client, key, storageKey]);

  useEffect(() => {
    if (query.data) void set(storageKey, publicCacheSnapshot(query.data));
  }, [query.data, storageKey]);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(`rp_event_${code}_${userId}`);
    channel.onmessage = (event: MessageEvent<EventSnapshot>) => {
      const incoming = event.data;
      if (!incoming?.state) return;
      client.setQueryData<EventSnapshot>(key, (current) => {
        if (!current || incoming.state.processed > current.state.processed) {
          setExternalSyncAt(Date.now());
          return incoming;
        }
        return current;
      });
    };
    return () => channel.close();
  }, [client, code, key, userId]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  useEffect(() => {
    if (!externalSyncAt) return;
    const timer = setTimeout(() => setExternalSyncAt(null), 3_000);
    return () => clearTimeout(timer);
  }, [externalSyncAt]);

  return (
    <EventContext.Provider
      value={{
        data: query.data,
        isLoading: query.isLoading,
        error: (query.error as Error | null) ?? null,
        applyServerState,
        refresh,
        externalSyncAt,
      }}
    >
      {children}
    </EventContext.Provider>
  );
}

/** Cache thiết bị chỉ giữ dữ liệu xem; quyền luôn phải lấy lại từ cookie/máy chủ. */
function publicCacheSnapshot(snapshot: EventSnapshot): EventSnapshot {
  return {
    ...snapshot,
    role: "viewer",
    capabilities: {
      canOpenAdmin: false,
      canManagePlayers: false,
      canManageSchedule: false,
      canEditAnyScore: false,
      canFinishNormally: false,
      canEndEarly: false,
      canManageConfig: false,
      canManageStaff: false,
      canManagePresentation: false,
      canChangePasswords: false,
      canCopyEvent: false,
    },
    roleLabel: "Khách xem",
    actorRef: "",
    myPlayerId: null,
    myPlayerHasAccount: false,
    ownerByAccount: false,
  };
}
