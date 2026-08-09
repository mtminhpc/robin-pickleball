"use client";

/**
 * Hàng đợi gửi lệnh, và trạng thái lưu hiển thị cho người dùng.
 *
 * Đây là câu trả lời cho mục 7: "có hiển thị trạng thái đang lưu / đã lưu để
 * tránh việc tưởng nhầm đã lưu rồi thì không được."
 *
 * Hai nguyên tắc chi phối toàn bộ tệp này:
 *
 *   1. **Chỉ báo "đã lưu" sau khi máy chủ xác nhận Google Sheet đã ghi xong.**
 *      Không bao giờ báo lạc quan. Trong lúc chờ, tỷ số hiện mờ kèm chấm nhấp
 *      nháy — trông khác hẳn điểm đã lưu, để không ai nhìn nhầm.
 *   2. **Chưa lưu được thì phải khó bỏ qua.** Banner đỏ dính trên đầu màn hình,
 *      không tự ẩn, và chặn cả việc đóng tab. Sân pickleball hay mất sóng, và
 *      mất một trận điểm vì không ai để ý là kiểu hỏng người dùng sợ nhất.
 *
 * Lệnh nằm trong IndexedDB nên đóng tab hay tắt máy giữa chừng vẫn còn, gửi lại
 * được ở lần mở sau.
 */

import { del, get, set } from "idb-keyval";
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
import type { Command } from "@/lib/domain/commands";
import type { EventState } from "@/lib/domain/types";

export type SaveStatus = "idle" | "processing" | "saving" | "saved" | "error" | "conflict";

export interface QueuedCommand {
  id: string;
  code: string;
  command: Command;
  createdAt: number;
  attempts: number;
  /** Revision công khai tại thời điểm người dùng bấm, dùng để phát hiện thao tác chen ngang. */
  baseRevision: number;
}

export interface FailedCommand {
  id: string;
  command: Command;
  error: string;
}

export interface MutationQueue {
  status: SaveStatus;
  /** Số lệnh chưa được máy chủ xác nhận. */
  pending: number;
  lastSavedAt: number | null;
  /** Lệnh bị máy chủ từ chối vì lý do nghiệp vụ, cần người dùng đọc. */
  failures: FailedCommand[];
  /** Đang mất mạng theo trình duyệt. */
  offline: boolean;
  send: (command: Command) => void;
  retryNow: () => void;
  dismissFailure: (id: string) => void;
  /** Các lệnh đang chờ, để giao diện vẽ giá trị tạm ở dạng mờ. */
  queued: QueuedCommand[];
}

const QueueContext = createContext<MutationQueue | null>(null);

export function useMutationQueue(): MutationQueue {
  const ctx = useContext(QueueContext);
  if (!ctx) throw new Error("useMutationQueue phải nằm trong <MutationQueueProvider>");
  return ctx;
}

/** Khoảng chờ giữa các lần gửi lại. Lần cuối lặp lại mãi. */
const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 20_000];

function storageKey(code: string): string {
  return `rp_queue_${code}`;
}

/**
 * Khoá gộp: hai lệnh cùng khoá thì lệnh sau thay thế lệnh trước trong hàng đợi.
 *
 * Chỉ áp dụng cho tỷ số. Khi mất mạng, người dùng nhập 11-5 rồi nhận ra sai và
 * nhập lại 11-7 — nếu xếp cả hai vào hàng thì cái đầu được ghi nhận, cái sau bị
 * máy chủ từ chối vì trận đã khoá, và ý định mới nhất của họ biến mất kèm một
 * thông báo lỗi khó hiểu. Gộp lại thì đúng ý: họ đang tự sửa mình trước khi có
 * gì kịp gửi đi.
 *
 * Các lệnh khác không gộp: thêm hai người chơi là hai việc khác nhau.
 */
function supersedeKey(command: Command): string | null {
  if (command.type === "SubmitResult" || command.type === "EditResult") {
    return `score:${command.matchId}`;
  }
  return null;
}

export function MutationQueueProvider({
  code,
  onApplied,
  baseRevision,
  children,
}: {
  code: string;
  /** Trạng thái mới nhất máy chủ trả về, để cập nhật màn hình ngay. */
  onApplied: (state: EventState) => void;
  baseRevision: number;
  children: ReactNode;
}) {
  const [queued, setQueued] = useState<QueuedCommand[]>([]);
  const [failures, setFailures] = useState<FailedCommand[]>([]);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [offline, setOffline] = useState(false);
  const [restored, setRestored] = useState(false);

  const sending = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onAppliedRef = useRef(onApplied);
  onAppliedRef.current = onApplied;

  // -- lưu bền hàng đợi ----------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    void get<QueuedCommand[]>(storageKey(code)).then((saved) => {
      if (cancelled) return;
      if (saved?.length) setQueued(saved);
      setRestored(true);
    });
    return () => {
      cancelled = true;
    };
  }, [code]);

  useEffect(() => {
    if (!restored) return;
    if (queued.length === 0) void del(storageKey(code));
    else void set(storageKey(code), queued);
  }, [queued, code, restored]);

  // -- theo dõi mạng -------------------------------------------------------

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  // Có mạng trở lại thì gửi ngay, không đợi hết khoảng chờ.
  useEffect(() => {
    if (!offline && queued.length > 0) scheduleFlush(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offline]);

  // -- cảnh báo khi đóng tab -----------------------------------------------

  useEffect(() => {
    if (queued.length === 0) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [queued.length]);

  // -- vòng gửi ------------------------------------------------------------

  const scheduleFlush = useCallback((delay: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void flush();
    }, delay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flush = useCallback(async () => {
    if (sending.current) return;

    const next = queuedRef.current[0];
    if (!next) {
      setStatus((s) => (s === "saving" ? "saved" : s));
      return;
    }

    // Số lệnh sẽ còn lại sau khi xử lý xong cái này. Phải tính trước vì `setQueued`
    // chỉ có hiệu lực ở lần vẽ sau, còn ở đây thì cần biết ngay là có gửi tiếp không.
    const remaining = queuedRef.current.length - 1;
    sending.current = true;
    setStatus("saving");

    try {
      const res = await fetch(`/api/events/${next.code}/mutate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          commandId: next.id,
          baseRevision: next.baseRevision ?? 0,
          command: next.command,
        }),
      });

      if (res.ok) {
        const body = (await res.json()) as { state: EventState };
        onAppliedRef.current(body.state);
        setQueued((q) => q.filter((x) => x.id !== next.id));
        setLastSavedAt(Date.now());
        sending.current = false;
        if (remaining > 0) scheduleFlush(0);
        else setStatus("saved");
        return;
      }

      // 5xx và 429 là lỗi tạm thời — giữ lại trong hàng đợi và thử tiếp.
      if (res.status >= 500 || res.status === 429) {
        throw new Error(`máy chủ trả về ${res.status}`);
      }

      // 4xx nghĩa là máy chủ đã đọc lệnh và từ chối vì lý do nghiệp vụ: trận đã
      // có người nhập, hết quyền sửa, thiếu mật khẩu. Gửi lại cũng vô ích, mà
      // giữ trong hàng đợi thì banner đỏ kẹt mãi. Bỏ ra và đưa cho người dùng đọc.
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setQueued((q) => q.filter((x) => x.id !== next.id));
      setFailures((f) => [
        ...f,
        {
          id: next.id,
          command: next.command,
          error: body.error ?? "Máy chủ từ chối lệnh.",
        },
      ]);
      sending.current = false;
      if (remaining > 0) scheduleFlush(0);
      else setStatus(res.status === 409 ? "conflict" : "idle");
      return;
    } catch {
      // Mất mạng hoặc máy chủ trục trặc. Giữ nguyên lệnh và thử lại sau.
      setQueued((q) =>
        q.map((x) => (x.id === next.id ? { ...x, attempts: x.attempts + 1 } : x)),
      );
      setStatus("error");
      sending.current = false;
      scheduleFlush(BACKOFF_MS[Math.min(next.attempts, BACKOFF_MS.length - 1)]!);
    }
  }, [scheduleFlush]);

  // Bản tham chiếu để `flush` đọc được hàng đợi mới nhất mà không phải tạo lại.
  const queuedRef = useRef<QueuedCommand[]>([]);
  queuedRef.current = queued;

  useEffect(() => {
    if (restored && queued.length > 0 && !sending.current) scheduleFlush(0);
  }, [restored, queued.length, scheduleFlush]);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  // Băng xanh "đã lưu" tự tắt sau 3 giây; băng đỏ thì không bao giờ tự tắt.
  useEffect(() => {
    if (status !== "saved") return;
    const t = setTimeout(() => setStatus("idle"), 3_000);
    return () => clearTimeout(t);
  }, [status]);

  const send = useCallback(
    (command: Command) => {
      const make = (): QueuedCommand => ({
        id: crypto.randomUUID(),
        code,
        command,
        createdAt: Date.now(),
        attempts: 0,
        baseRevision,
      });

      setQueued((q) => {
        const key = supersedeKey(command);
        if (key) {
          const idx = q.findIndex(
            (x, i) =>
              // Bỏ qua lệnh đang trên đường gửi: máy chủ có thể đã nhận nó rồi.
              !(i === 0 && sending.current) && supersedeKey(x.command) === key,
          );
          if (idx !== -1) {
            const copy = [...q];
            // Mã lệnh mới hoàn toàn. Giữ mã cũ sẽ khiến máy chủ coi đây là bản
            // gửi lại và bỏ qua nội dung mới.
            copy[idx] = make();
            return copy;
          }
        }
        return [...q, make()];
      });
      setStatus("processing");
    },
    [baseRevision, code],
  );

  const retryNow = useCallback(() => {
    setQueued((q) => q.map((x) => ({ ...x, attempts: 0 })));
    scheduleFlush(0);
  }, [scheduleFlush]);

  const dismissFailure = useCallback((id: string) => {
    setFailures((f) => f.filter((x) => x.id !== id));
  }, []);

  const value = useMemo<MutationQueue>(
    () => ({
      status,
      pending: queued.length,
      lastSavedAt,
      failures,
      offline,
      send,
      retryNow,
      dismissFailure,
      queued,
    }),
    [status, queued, lastSavedAt, failures, offline, send, retryNow, dismissFailure],
  );

  return <QueueContext.Provider value={value}>{children}</QueueContext.Provider>;
}
