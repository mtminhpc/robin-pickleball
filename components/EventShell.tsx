"use client";

/**
 * Vỏ ngoài của mọi màn hình trong một sự kiện: banner trạng thái lưu, tiêu đề,
 * và thanh điều hướng dưới đáy.
 *
 * Thanh điều hướng nằm dưới đáy chứ không trên đỉnh: điện thoại ngày nay dài,
 * ngón cái với không tới mép trên khi cầm một tay.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { EventProvider, useEvent, type EventSnapshot } from "@/hooks/useEventState";
import { MutationQueueProvider } from "@/hooks/useMutationQueue";
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
      <div className="mx-auto flex min-h-dvh max-w-2xl flex-col">
        <SaveStatusBanner />
        <Header code={code} />
        <main className="flex-1 space-y-4 px-4 pb-28 pt-2">{children}</main>
        <NavBar code={code} />
      </div>
    </MutationQueueProvider>
  );
}

function Header({ code }: { code: string }) {
  const { data } = useEvent();
  if (!data) return null;

  const { state, role } = data;
  const status =
    state.status === "draft"
      ? "Chưa bắt đầu"
      : state.status === "running"
        ? `Vòng ${currentRound(state.matches)}`
        : state.endedEarly
          ? "Đã kết thúc sớm"
          : "Đã xong";

  return (
    <header className="px-4 pt-4">
      <h1 className="truncate text-xl font-bold">{state.config.name}</h1>
      <p className="text-sm text-slate-400">
        {status} · {state.config.courts} sân · mã{" "}
        <span className="font-mono tracking-wider text-slate-300">{code}</span>
        {role === "admin" && " · bạn là chủ sự kiện"}
        {role === "viewer" && " · chế độ xem"}
      </p>
    </header>
  );
}

const TABS = [
  { href: "", label: "Đang đánh", icon: "🏓" },
  { href: "/standings", label: "Xếp hạng", icon: "🏆" },
  { href: "/schedule", label: "Lịch", icon: "📋" },
  { href: "/players", label: "Người chơi", icon: "👥" },
  { href: "/admin", label: "Quản lý", icon: "⚙️" },
] as const;

function NavBar({ code }: { code: string }) {
  const pathname = usePathname();
  const base = `/e/${code}`;

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-800 bg-slate-950/95 backdrop-blur">
      <div className="mx-auto flex max-w-2xl">
        {TABS.map((tab) => {
          const href = `${base}${tab.href}`;
          const active = tab.href === "" ? pathname === base : pathname === href;
          return (
            <Link
              key={tab.href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] ${
                active ? "text-court-100" : "text-slate-500"
              }`}
            >
              <span aria-hidden className="text-lg leading-none">
                {tab.icon}
              </span>
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function currentRound(matches: { round: number; status: string }[]): number {
  const open = matches
    .filter((m) => m.status === "scheduled" || m.status === "playing")
    .map((m) => m.round);
  return open.length > 0 ? Math.min(...open) : 0;
}
