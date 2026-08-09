"use client";

/**
 * Vỏ ngoài của mọi màn hình trong một sự kiện.
 *
 * Hai hình dạng, cùng một cây thẻ:
 *
 *   • **Điện thoại** — thanh điều hướng dính dưới đáy. Nằm dưới chứ không trên:
 *     điện thoại ngày nay dài, ngón cái với không tới mép trên khi cầm một tay.
 *   • **Máy tính (≥1024px)** — thanh bên tối cố định bên trái. Cùng năm mục,
 *     cùng thứ tự, nên đổi máy không phải học lại.
 *
 * Băng tiêu đề tối với số vòng cỡ lớn là thứ đầu tiên đập vào mắt. Người đang
 * đứng ở sân chỉ cần biết đúng một điều: giờ là vòng mấy.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { useAccount } from "@/hooks/useAccount";
import { EventProvider, useEvent, type EventSnapshot } from "@/hooks/useEventState";
import { MutationQueueProvider, useMutationQueue } from "@/hooks/useMutationQueue";
import { SaveStatusBanner } from "@/components/SaveStatusBanner";
import { rememberEvent } from "@/lib/identity/device";

export function EventShell({
  code,
  initial,
  children,
}: {
  code: string;
  initial: EventSnapshot;
  children: ReactNode;
}) {
  return (
    <EventProvider code={code} initial={initial}>
      <ShellInner code={code}>{children}</ShellInner>
    </EventProvider>
  );
}

function ShellInner({ code, children }: { code: string; children: ReactNode }) {
  const { data, applyServerState } = useEvent();

  // Ghi nhớ để trang chủ gợi ý lại ở lần mở sau, khỏi phải nhớ mã sáu ký tự.
  useEffect(() => {
    if (data) rememberEvent(code, data.state.config.name);
  }, [code, data]);

  return (
    <MutationQueueProvider code={code} onApplied={applyServerState}>
      <SyncAccount />
      <div className="mx-auto flex min-h-dvh w-full max-w-[78.75rem]">
        <SideBar code={code} />
        <div className="flex min-w-0 flex-1 flex-col">
          <SaveStatusBanner />
          <Band code={code} />
          {/* Thanh dưới nằm TRONG dòng chảy chứ không `fixed`, nên không cần
              chừa khoảng đệm dưới cho nó như bản trước. */}
          <main className="flex-1 px-4 pb-10 lg:px-10 lg:pb-12">{children}</main>
          <TabBar code={code} />
        </div>
      </div>
    </MutationQueueProvider>
  );
}

/**
 * Gộp danh tính của cái máy vào tài khoản, ngay lúc mở một buổi cũ.
 *
 * Đây là chỗ chữa cảnh "một máy hai danh tính": chơi vài buổi bằng máy — ô tên
 * chỉ mang `deviceId` — rồi hôm sau đăng nhập Google. Không có bước này thì tài
 * khoản mới không biết gì về những ô tên cũ, và người dùng có hai bản thân trong
 * cùng một ứng dụng.
 *
 * Chỉ chạy khi máy chủ đã nhận ra `myPlayerId` mà ô tên đó **chưa có tài khoản**.
 * Nhận ra được nghĩa là `findMyPlayer` đã khớp theo `deviceId`, tức chính máy này
 * — nên lá chắn chống chiếm tên trong `reduce` không bao giờ cản đường hợp lệ.
 *
 * Không tự gắn được cho người đăng nhập trên **điện thoại hoàn toàn mới**: ở đó
 * `myPlayerId` là `null` và không có căn cứ nào để đoán ô tên nào là của họ. Họ
 * vào trang Tham gia bấm "Đây là tôi", đúng như trước.
 */
function SyncAccount() {
  const { data } = useEvent();
  const account = useAccount();
  const queue = useMutationQueue();
  const sent = useRef<string | null>(null);

  const signedIn = Boolean(account.data?.user);
  const me = data?.state.players.find((p) => p.id === data.myPlayerId) ?? null;
  const needsLink = signedIn && me !== null && !me.userId;
  const playerId = me?.id ?? null;

  useEffect(() => {
    if (!needsLink || !playerId) return;
    // Một lần cho mỗi ô tên trong mỗi lượt tải. Máy chủ tự điền `userId` từ
    // cookie đã ký, nên lệnh này không mang theo gì để làm sai.
    if (sent.current === playerId) return;
    sent.current = playerId;
    queue.send({ type: "LinkAccount", playerId });
  }, [needsLink, playerId, queue]);

  return null;
}

const TABS: ReadonlyArray<{ href: string; label: string; adminOnly?: boolean }> = [
  { href: "", label: "Đang đánh" },
  { href: "/standings", label: "Xếp hạng" },
  { href: "/schedule", label: "Lịch" },
  { href: "/players", label: "Người chơi" },
  { href: "/admin", label: "Quản lý", adminOnly: true },
];

/** Mục nào đang mở. Tab gốc phải so khớp chính xác, nếu không nó luôn "đang mở". */
function useActive(code: string) {
  const pathname = usePathname();
  const base = `/e/${code}`;
  return (href: string) =>
    href === "" ? pathname === base : pathname === `${base}${href}`;
}

function SideBar({ code }: { code: string }) {
  const { data } = useEvent();
  const isActive = useActive(code);
  const isAdmin = data?.role === "admin";

  return (
    <aside className="hidden w-[14.5rem] flex-none flex-col bg-ink text-mute-200 lg:flex">
      {/* Logo là đường về trang chủ. Đó là chỗ mọi người bấm theo phản xạ trên
          web, nên gắn liên kết vào đây rẻ hơn hẳn so với thêm một mục thứ sáu
          vào thanh điều hướng. */}
      <Link
        href="/"
        className="block border-b border-white/15 px-5 pb-6 pt-7 transition hover:bg-white/5"
      >
        <div className="mb-3.5 h-1.5 w-6 bg-accent" />
        <p className="font-display text-lg font-extrabold leading-none tracking-[-0.02em] text-white">
          ROBIN
          <br />
          PICKLEBALL
        </p>
        <p className="eyebrow mt-2.5 font-normal text-mute-500">
          Americano · Round robin
        </p>
      </Link>

      <nav className="flex flex-col py-3.5">
        {TABS.filter((t) => !t.adminOnly || isAdmin).map((tab) => {
          const active = isActive(tab.href);
          return (
            <Link
              key={tab.href}
              href={`/e/${code}${tab.href}`}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-3.5 px-5 py-3 font-display text-xs font-extrabold uppercase leading-none tracking-[0.1em] transition ${
                active ? "text-white" : "text-mute-500 hover:text-mute-300"
              }`}
            >
              <span
                aria-hidden
                className={`h-0.5 w-3.5 flex-none ${active ? "bg-accent" : "bg-mute-700"}`}
              />
              {tab.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto border-t border-white/15 p-5">
        <p className="eyebrow font-normal text-mute-600">Mã buổi đánh</p>
        <p className="mt-1.5 font-display text-2xl font-extrabold tracking-[0.16em] text-white">
          {code}
        </p>
      </div>
    </aside>
  );
}

function TabBar({ code }: { code: string }) {
  const { data } = useEvent();
  const isActive = useActive(code);
  const isAdmin = data?.role === "admin";

  return (
    <nav className="sticky bottom-0 z-30 flex bg-ink lg:hidden">
      {TABS.filter((t) => !t.adminOnly || isAdmin).map((tab) => {
        const active = isActive(tab.href);
        return (
          <Link
            key={tab.href}
            href={`/e/${code}${tab.href}`}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-[3.875rem] flex-1 flex-col items-center justify-center gap-2 font-display text-[9px] font-extrabold uppercase leading-none tracking-[0.1em] ${
              active ? "text-white" : "text-mute-500"
            }`}
          >
            <span
              aria-hidden
              className={`h-0.5 w-5 ${active ? "bg-accent" : "bg-mute-700"}`}
            />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Băng tối trên đỉnh: tên buổi, vòng đang đánh cỡ lớn, và mã. */
function Band({ code }: { code: string }) {
  const { data } = useEvent();
  if (!data) return null;

  const { state, role } = data;
  const round = currentRound(state.matches);
  const title =
    state.status === "draft"
      ? "CHƯA BẮT ĐẦU"
      : state.status === "running"
        ? `VÒNG ${round}`
        : state.endedEarly
          ? "KẾT THÚC SỚM"
          : "ĐÃ XONG";

  return (
    <header className="bg-ink px-4 pb-4 pt-5 text-white lg:px-10 lg:pb-6 lg:pt-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {/* Chỉ dưới `lg`, vì từ `lg` trở lên logo thanh bên đã là đường về nhà
              rồi — hai lối ra cạnh nhau chỉ làm người ta phải chọn. */}
          <Link
            href="/"
            className="eyebrow -ml-1 mb-2 inline-flex min-h-9 items-center gap-1.5 px-1 font-normal text-mute-500 transition hover:text-white lg:hidden"
          >
            <span aria-hidden>←</span> Trang chủ
          </Link>
          <p className="truncate text-[10px] uppercase tracking-[0.2em] text-mute-500">
            {state.config.name}
          </p>
          <p className="mt-2 font-display text-display lg:text-[2.875rem]">{title}</p>
          <p className="mt-2 text-[11px] text-mute-400">
            {state.config.courts} sân
            {role === "admin" && " · bạn là chủ sự kiện"}
            {role === "viewer" && " · chế độ xem"}
          </p>
        </div>
        <div className="flex-none text-right lg:hidden">
          <p className="eyebrow font-normal text-mute-500">Mã</p>
          <p className="mt-1 font-display text-[17px] font-extrabold tracking-[0.18em]">
            {code}
          </p>
        </div>
      </div>
    </header>
  );
}

function currentRound(matches: { round: number; status: string }[]): number {
  const open = matches
    .filter((m) => m.status === "scheduled" || m.status === "playing")
    .map((m) => m.round);
  return open.length > 0 ? Math.min(...open) : 0;
}
