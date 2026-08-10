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
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAccount } from "@/hooks/useAccount";
import { EventProvider, useEvent, type EventSnapshot } from "@/hooks/useEventState";
import { MutationQueueProvider, useMutationQueue } from "@/hooks/useMutationQueue";
import { SaveStatusBanner } from "@/components/SaveStatusBanner";
import { rememberEvent } from "@/lib/identity/device";
import { SponsorStrip } from "@/components/SponsorStrip";
import { activeCourtsAt } from "@/lib/domain/types";

export function EventShell({
  code,
  initial,
  initialIdentity,
  children,
}: {
  code: string;
  initial: EventSnapshot;
  initialIdentity: string;
  children: ReactNode;
}) {
  return (
    <EventProvider code={code} initial={initial} initialIdentity={initialIdentity}>
      <ShellInner code={code}>{children}</ShellInner>
    </EventProvider>
  );
}

function ShellInner({ code, children }: { code: string; children: ReactNode }) {
  const { data, applyServerState } = useEvent();
  const router = useRouter();

  // Ghi nhớ để trang chủ gợi ý lại ở lần mở sau, khỏi phải nhớ mã sáu ký tự.
  useEffect(() => {
    if (data) rememberEvent(code, data.state.config.name);
  }, [code, data]);

  // Nạp trước mã JavaScript của năm màn hình; EventProvider giữ nguyên state nên
  // chuyển tab chỉ đổi phần nội dung, không gọi lại toàn bộ snapshot.
  useEffect(() => {
    for (const tab of ["", "/standings", "/schedule", "/players", "/admin"]) {
      router.prefetch(`/e/${code}${tab}`);
    }
  }, [code, router]);

  return (
    <MutationQueueProvider
      code={code}
      onApplied={applyServerState}
      baseRevision={data?.state.processed ?? 0}
    >
      <SyncAccount />
      <RoleInvitationAcceptor code={code} />
      <div className="mx-auto flex min-h-dvh w-full max-w-[78.75rem]">
        <SideBar code={code} />
        <div className="flex min-w-0 flex-1 flex-col">
          <SaveStatusBanner />
          <ScheduleChangeBanner code={code} />
          <Band code={code} />
          <SponsorStrip code={code} />
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
  const needsLink = signedIn && me !== null && !data?.myPlayerHasAccount;
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
  const isAdmin = Boolean(data?.capabilities.canOpenAdmin);

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
  const isAdmin = Boolean(data?.capabilities.canOpenAdmin);

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
  const structureRound = Math.max(1, round || state.lastRound + 1);
  const activeCourtCount = activeCourtsAt(state, structureRound).length;
  const title =
    state.status === "draft"
      ? "CHƯA BẮT ĐẦU"
      : state.status === "running"
        ? activeCourtCount === 0
          ? "TẠM DỪNG — CHƯA CÓ SÂN"
          : `VÒNG ${round || structureRound}`
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
            {activeCourtCount} sân đang mở
            {` · ${data.roleLabel.toLowerCase()}`}
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

function RoleInvitationAcceptor({ code }: { code: string }) {
  const { refresh } = useEvent();
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const handled = useRef("");

  useEffect(() => {
    const url = new URL(window.location.href);
    const roleInvite = url.searchParams.get("roleInvite");
    const roleToken = url.searchParams.get("roleToken");
    const ownerInvite = url.searchParams.get("ownerInvite");
    const ownerToken = url.searchParams.get("ownerToken");
    const key = roleInvite && roleToken
      ? `role:${roleInvite}:${roleToken}`
      : ownerInvite && ownerToken
        ? `owner:${ownerInvite}:${ownerToken}`
        : "";
    if (!key || handled.current === key) return;
    handled.current = key;
    const endpoint = roleInvite
      ? `/api/events/${code}/role-invitations/${encodeURIComponent(roleInvite)}/accept`
      : `/api/events/${code}/ownership-transfer/accept`;
    const token = roleToken ?? ownerToken ?? "";
    void fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    }).then(async (response) => {
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Không chấp nhận được lời mời.");
      setError(false);
      setMessage(roleInvite ? "Đã kích hoạt quyền Phó sự kiện." : "Đã nhận quyền Chủ vận hành.");
      for (const name of ["roleInvite", "roleToken", "ownerInvite", "ownerToken"]) {
        url.searchParams.delete(name);
      }
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
      refresh();
    }).catch((reason: unknown) => {
      setError(true);
      setMessage(reason instanceof Error ? reason.message : "Không chấp nhận được lời mời.");
    });
  }, [code, refresh]);

  if (!message) return null;
  return (
    <div className={`border-b-2 border-ink px-4 py-3 text-sm font-bold lg:px-10 ${error ? "bg-accent-100 text-accent-700" : "bg-emerald-100 text-emerald-900"}`}>
      {message}
    </div>
  );
}

function ScheduleChangeBanner({ code }: { code: string }) {
  const { data } = useEvent();
  const revision = data?.state.scheduleChange?.revision ?? 0;
  const [seen, setSeen] = useState(0);

  useEffect(() => {
    const value = Number(localStorage.getItem(`rp_schedule_seen_${code}`) ?? 0);
    setSeen(Number.isFinite(value) ? value : 0);
  }, [code, revision]);

  if (!data?.state.scheduleChange || revision <= seen) return null;
  const dismiss = () => {
    localStorage.setItem(`rp_schedule_seen_${code}`, String(revision));
    setSeen(revision);
  };
  return (
    <div className="flex items-center justify-between gap-3 border-b-2 border-ink bg-accent px-4 py-2 text-xs font-bold text-white lg:px-10">
      <span>Lịch đã cập nhật từ vòng {data.state.scheduleChange.effectiveRound}.</span>
      <button type="button" onClick={dismiss} className="min-h-8 border border-white px-3 font-display text-[9px] font-extrabold uppercase">
        Đã xem
      </button>
    </div>
  );
}

function currentRound(matches: { round: number; status: string }[]): number {
  const open = matches
    .filter((m) => m.status === "scheduled" || m.status === "playing")
    .map((m) => m.round);
  return open.length > 0 ? Math.min(...open) : 0;
}
