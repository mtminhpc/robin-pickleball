"use client";

/**
 * Trang chủ: tạo buổi đánh mới, hoặc vào buổi đã có.
 *
 * Danh sách "sự kiện gần đây" hiện ngay từ localStorage của chính máy, rồi gộp
 * nền với các thiết bị đăng nhập cùng tài khoản. Nhờ vậy lần mở thứ hai vẫn tức
 * thì, còn đổi điện thoại không làm biến mất các lối tắt cũ.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  loadRecentClubs,
  loadRecentEvents,
  recentEventsForAccount,
  saveAccountRecentEvents,
  type RecentClub,
  type RecentEvent,
  loadProfile,
} from "@/lib/identity/device";
import { clearLocalEventCache } from "@/lib/identity/event-local-cache";
import { Button, Field, inputClass } from "@/components/ui";
import { Avatar } from "@/components/Avatar";
import { DeleteEventDialog } from "@/components/DeleteEventDialog";
import { ACCOUNT_KEY, signInHref, useAccount } from "@/hooks/useAccount";
import { scheduledAtFromInputs } from "@/lib/scheduled-at";
import { estimateEvent, formatEstimatedDuration } from "@/lib/domain/estimate";

const HOME_ACCENT = "#087a55";

export default function HomePage() {
  const [recent, setRecent] = useState<RecentEvent[]>([]);
  const [clubs, setClubs] = useState<RecentClub[]>([]);
  const [recentReady, setRecentReady] = useState(false);
  const [tab, setTab] = useState<"join" | "created" | "create" | "club">("join");
  const account = useAccount();

  useEffect(() => {
    setRecent(loadRecentEvents());
    setClubs(loadRecentClubs());
    setRecentReady(true);
  }, []);

  const recentSync = useQuery<{ events: RecentEvent[] }>({
    queryKey: [
      "recent-events",
      account.data?.user?.userId ?? "anonymous",
      recent.map((event) => event.code).join(","),
    ],
    enabled: recentReady && Boolean(account.data?.user),
    queryFn: async () => {
      const userId = account.data!.user!.userId;
      const response = await fetch("/api/events/recent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ events: recentEventsForAccount(userId) }),
      });
      const body = (await response.json()) as { events?: RecentEvent[]; error?: string };
      if (!response.ok || !body.events) {
        throw new Error(body.error ?? "Không đồng bộ được các buổi gần đây.");
      }
      return { events: body.events };
    },
    staleTime: 60_000,
    retry: 1,
  });

  useEffect(() => {
    const userId = account.data?.user?.userId;
    if (!userId || !recentSync.data) return;
    saveAccountRecentEvents(userId, recentSync.data.events);
    setRecent(recentSync.data.events);
  }, [account.data?.user?.userId, recentSync.data]);

  return (
    <main className="mx-auto min-h-dvh max-w-md overflow-hidden border-x border-line bg-paper pb-16">
      <header className="flex min-h-[4.25rem] items-center justify-between gap-3 border-b-2 border-ink px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className="grid size-9 shrink-0 place-items-center font-display text-xs font-extrabold text-paper"
            style={{ backgroundColor: HOME_ACCENT }}
            aria-hidden="true"
          >
            RP
          </span>
          <div className="min-w-0">
            <p className="truncate font-display text-sm font-extrabold leading-none">
              Robin Pickleball
            </p>
            <p className="eyebrow mt-1 truncate text-mute-600">
              Flexible · Fair · Fast
            </p>
          </div>
        </div>
        <HomeAccount />
      </header>

      <section className="relative overflow-hidden bg-ink px-5 pb-5 pt-6 text-paper">
        <CourtLines />
        <p className="eyebrow relative text-[#63d6aa]">Round robin · Pickleball</p>
        <h1 className="relative mt-3 max-w-[19rem] text-balance text-[2.4rem] font-extrabold uppercase leading-[0.94]">
          Linh hoạt,
          <br />
          công bằng,
          <br />
          nhanh gọn.
        </h1>
        <p className="relative mt-3 max-w-[17rem] text-pretty text-[13px] leading-relaxed text-mute-400">
          Xếp lịch xoay đôi công bằng, nhập điểm tại sân và xem thứ hạng ngay khi
          trận kết thúc.
        </p>
        <div className="relative mt-4 flex flex-wrap gap-x-4 gap-y-2">
          {[
            ["01", "Xếp lịch"],
            ["02", "Nhập điểm"],
            ["03", "Xếp hạng"],
          ].map(([n, label]) => (
            <span key={n} className="eyebrow text-mute-300">
              <b className="mr-1 text-[#26a87c]">{n}</b> {label}
            </span>
          ))}
        </div>
      </section>

      <section className="px-4 pt-5">
        <HomeSectionHead n="01">Bắt đầu</HomeSectionHead>
        <div className="grid grid-cols-4 border border-line bg-surface" role="tablist" aria-label="Cách bắt đầu">
          <TabButton
            id="home-tab-join"
            controls="home-panel-join"
            active={tab === "join"}
            onClick={() => setTab("join")}
          >
            Vào bằng mã
          </TabButton>
          <TabButton
            id="home-tab-created"
            controls="home-panel-created"
            active={tab === "created"}
            onClick={() => setTab("created")}
          >
            Các trận đã tạo
          </TabButton>
          <TabButton
            id="home-tab-create"
            controls="home-panel-create"
            active={tab === "create"}
            onClick={() => setTab("create")}
          >
            Tạo buổi mới
          </TabButton>
          <TabButton
            id="home-tab-club"
            controls="home-panel-club"
            active={tab === "club"}
            onClick={() => setTab("club")}
          >
            Câu lạc bộ
          </TabButton>
        </div>

        {tab === "join" ? (
          <JoinByCode />
        ) : tab === "created" ? (
          <CreatedEvents />
        ) : tab === "create" ? (
          <CreateEvent />
        ) : (
          <ClubEntry />
        )}
      </section>

      {recent.length > 0 && (
        <section className="px-4 pt-5">
          <HomeSectionHead n="02">Gần đây</HomeSectionHead>
          <div className="divide-y divide-line border border-line bg-surface">
            {recent.slice(0, 5).map((e) => (
              <Link
                key={e.code}
                href={`/e/${e.code}`}
                className="flex min-h-tap items-center justify-between gap-3 px-4 hover:bg-mute-300"
              >
                <span className="truncate font-semibold">{e.name}</span>
                <span className="shrink-0 font-mono text-xs font-semibold text-[#087a55]">
                  {e.code} →
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {clubs.length > 0 && (
        <section className="px-4 pt-5">
          <HomeSectionHead n={recent.length > 0 ? "03" : "02"}>
            Câu lạc bộ của bạn
          </HomeSectionHead>
          <div className="divide-y divide-line border border-line bg-surface">
            {clubs.slice(0, 5).map((c) => (
              <Link
                key={c.id}
                href={`/c/${c.id}`}
                className="flex min-h-tap items-center justify-between gap-3 px-4 hover:bg-mute-300"
              >
                <span className="truncate font-semibold">{c.name}</span>
                <span className="shrink-0 text-xs font-semibold text-[#087a55]">
                  Danh bạ →
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <footer className="mx-4 mt-5 flex items-start justify-between gap-3 border-t border-line pt-4 text-[10px] leading-relaxed text-mute-600">
        <p>
          <strong className="flex items-center gap-1 font-display text-ink">
            Phát triển bởi Maico Jack Sun <VietnamFlag />
          </strong>
          Robin Pickleball
        </p>
        <a
          href="mailto:mtminhpc@gmail.com"
          className="text-right font-semibold text-[#087a55] hover:underline"
        >
          Thương mại &amp; quảng cáo
          <br />
          mtminhpc@gmail.com
        </a>
      </footer>
    </main>
  );
}

function HomeAccount() {
  const account = useAccount();
  const user = account.data?.user;
  const setting = (
    <Link
      href="/me"
      aria-label="Mở Setting"
      className="inline-flex min-h-tap shrink-0 items-center gap-1.5 px-2 font-display text-[9px] font-extrabold uppercase hover:bg-ink hover:text-paper"
    >
      <SettingsIcon /> Setting
    </Link>
  );

  if (!account.data?.enabled) return <div className="border border-ink">{setting}</div>;
  if (!user) {
    return (
      <div className="flex min-h-tap items-stretch border border-ink">
        <a
          href={signInHref("/")}
          className="inline-flex items-center px-2 font-display text-[9px] font-extrabold uppercase hover:bg-[#087a55] hover:text-white"
        >
          Đăng nhập Google
        </a>
        <span className="w-px bg-ink" aria-hidden />
        {setting}
      </div>
    );
  }
  return (
    <div className="flex min-h-tap min-w-0 items-stretch border border-ink">
      <Link href="/me" className="flex min-w-0 items-center gap-1.5 px-2 hover:bg-mute-300">
        <Avatar name={user.displayName} avatarId={user.avatarId} userId={user.userId} size="sm" />
        <span className="max-w-20 truncate text-[10px] font-bold">{user.displayName}</span>
      </Link>
      <span className="w-px bg-ink" aria-hidden />
      {setting}
    </div>
  );
}

function TabButton({
  id,
  controls,
  active,
  onClick,
  children,
}: {
  id: string;
  controls: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      id={id}
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls={controls}
      onClick={onClick}
      className={`relative min-h-tap border-r border-line px-1 font-display text-[10px] font-extrabold uppercase last:border-r-0 ${
        active ? "bg-ink text-paper after:absolute after:inset-x-3 after:bottom-0 after:h-[3px] after:bg-[#087a55]" : "text-mute-700 hover:bg-mute-300"
      }`}
    >
      {children}
    </button>
  );
}

function HomeSectionHead({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-2.5">
      <span className="font-display text-[10px] font-extrabold text-[#087a55]">{n}</span>
      <h2 className="eyebrow text-ink">{children}</h2>
      <span className="h-0.5 flex-1 bg-ink" aria-hidden="true" />
    </div>
  );
}

function CourtLines() {
  return (
    <div
      className="absolute -right-14 top-2 h-56 w-40 rotate-[13deg] border border-paper/20"
      aria-hidden="true"
    >
      <span className="absolute inset-x-0 top-1/2 border-t border-paper/20" />
      <span className="absolute bottom-0 left-1/2 top-1/2 border-l border-paper/20" />
    </div>
  );
}

function SettingsIcon() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.1A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.12.38.35.72.66.98.3.26.69.4 1.1.42H21v4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </svg>
  );
}

function VietnamFlag() {
  return (
    <svg className="h-3 w-[18px] shrink-0" viewBox="0 0 30 20" role="img" aria-label="Việt Nam">
      <rect width="30" height="20" fill="#da251d" />
      <polygon points="15,3.4 16.6,8.1 21.6,8.2 17.6,11.2 19,16 15,13.1 11,16 12.4,11.2 8.4,8.2 13.4,8.1" fill="#ffeb00" />
    </svg>
  );
}

function HomePrimaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`inline-flex min-h-tap items-center justify-center bg-[#087a55] px-4 font-display text-[11px] font-extrabold uppercase text-paper hover:bg-[#076b4b] active:bg-[#065c41] disabled:cursor-not-allowed disabled:bg-mute-400 ${props.className ?? ""}`}
    />
  );
}

function JoinByCode() {
  const router = useRouter();
  const [code, setCode] = useState("");

  return (
    <div
      id="home-panel-join"
      role="tabpanel"
      aria-labelledby="home-tab-join"
      className="border border-t-0 border-line bg-surface p-4"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim()) router.push(`/e/${code.trim().toUpperCase()}`);
        }}
      >
        <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
          <label htmlFor="home-event-code" className="font-semibold text-ink">
            Mã buổi đánh
          </label>
          <span className="text-mute-600">4–6 ký tự</span>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
          <input
            id="home-event-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ABC123"
            autoCapitalize="characters"
            autoComplete="off"
            maxLength={6}
            aria-describedby="home-event-code-hint"
            className={`${inputClass} !bg-paper text-center font-mono text-2xl tracking-[0.3em]`}
          />
          <HomePrimaryButton type="submit" disabled={code.trim().length < 4}>
            Vào xem →
          </HomePrimaryButton>
        </div>
        <p id="home-event-code-hint" className="mt-1.5 text-xs text-mute-600">
          Sáu ký tự, người tổ chức sẽ cho bạn.
        </p>
      </form>
    </div>
  );
}

interface OwnedEvent {
  code: string;
  name: string;
  venueAddress: string;
  relation: "owner" | "manager";
  status: "draft" | "running" | "finished";
  scheduledAt: number | null;
  createdAt: number;
  courts: number;
  players: number;
  sponsors: Array<{ id: string; name: string; assetId: string }>;
}

function CreatedEvents() {
  const account = useAccount();
  const userId = account.data?.user?.userId ?? "";
  const query = useQuery<{
    events: OwnedEvent[];
    quota: { used: number; limit: number | null; remaining: number | null };
  }>({
    queryKey: ["owned-events", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const response = await fetch("/api/events");
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Không tải được sự kiện.");
      return body;
    },
  });

  if (!account.data?.user) {
    return (
      <div id="home-panel-created" role="tabpanel" aria-labelledby="home-tab-created" className="border border-t-0 border-line bg-surface p-5">
        <p className="text-sm font-semibold">Đăng nhập để xem các sự kiện do bạn tạo.</p>
        {account.data?.enabled && (
          <a href={signInHref("/")} className="mt-4 inline-flex min-h-tap items-center bg-[#087a55] px-4 font-display text-[10px] font-extrabold uppercase text-white">
            Đăng nhập Google
          </a>
        )}
      </div>
    );
  }

  const events = query.data?.events ?? [];
  const assigned = events.filter((event) => event.relation === "manager");
  const owned = events.filter((event) => event.relation === "owner");
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const endToday = startToday + 86_400_000;
  const groups = [
    { title: "Hôm nay", items: owned.filter((event) => eventTime(event) >= startToday && eventTime(event) < endToday) },
    { title: "Sắp tới", items: owned.filter((event) => eventTime(event) >= endToday) },
    { title: "Đã qua", items: owned.filter((event) => eventTime(event) < startToday) },
  ];

  return (
    <div id="home-panel-created" role="tabpanel" aria-labelledby="home-tab-created" className="space-y-4 border border-t-0 border-line bg-surface p-4">
      {query.data && (
        <div className="border-l-4 border-[#087a55] bg-paper px-3 py-2 text-xs">
          <div className="flex items-center justify-between">
            <strong>Sự kiện đang mở</strong>
            <span className="font-mono font-bold text-[#087a55]">
              {query.data.quota.used}/{query.data.quota.limit ?? "∞"}
            </span>
          </div>
          <p className="mt-1 truncate text-[10px] text-mute-600">
            Theo tài khoản {account.data?.user?.email}
          </p>
        </div>
      )}
      {query.isLoading && <p className="text-sm text-mute-600">Đang tải…</p>}
      {query.error && <p className="text-sm text-accent-700">{(query.error as Error).message}</p>}
      {!query.isLoading && events.length === 0 && <p className="text-sm text-mute-600">Bạn chưa tạo sự kiện nào.</p>}
      {assigned.length > 0 && (
        <section>
          <h3 className="eyebrow mb-2 text-ink">Tôi được phân công</h3>
          <div className="divide-y divide-line border-y border-line">
            {assigned.map((event) => <OwnedEventCard key={event.code} event={event} />)}
          </div>
        </section>
      )}
      {groups.map((group) => group.items.length > 0 && (
        <section key={group.title}>
          <h3 className="eyebrow mb-2 text-ink">{group.title}</h3>
          <div className="divide-y divide-line border-y border-line">
            {group.items.map((event) => <OwnedEventCard key={event.code} event={event} />)}
          </div>
        </section>
      ))}
    </div>
  );
}

function eventTime(event: OwnedEvent): number {
  return event.scheduledAt ?? event.createdAt;
}

function OwnedEventCard({ event }: { event: OwnedEvent }) {
  const first = event.sponsors[0];
  const router = useRouter();
  const client = useQueryClient();
  const account = useAccount();
  const userId = account.data?.user?.userId ?? "";
  const [copying, setCopying] = useState(false);
  const [copyError, setCopyError] = useState("");
  const copyKey = useRef<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  // Buổi đang đánh không xóa được — máy chủ cũng chặn, nhưng hiện nút rồi báo lỗi
  // sau khi người ta đã gõ xong mã là kiểu giao diện hứa hão.
  const canDelete = event.relation === "owner" && event.status !== "running";

  const remove = async () => {
    setDeleting(true);
    setDeleteError("");
    try {
      const response = await fetch(`/api/events/${event.code}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmation: event.code }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Không xóa được sự kiện.");
      await clearLocalEventCache(event.code, userId);
      setConfirmingDelete(false);
      void client.invalidateQueries({ queryKey: ["owned-events", userId] });
      void client.invalidateQueries({ queryKey: ACCOUNT_KEY });
      router.refresh();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Không xóa được sự kiện.");
    } finally {
      setDeleting(false);
    }
  };

  const copy = async () => {
    setCopying(true);
    setCopyError("");
    try {
      const response = await fetch(`/api/events/${event.code}/copy`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idempotencyKey: copyKey.current ??= crypto.randomUUID() }),
      });
      const body = await response.json() as { code?: string; error?: string };
      if (!response.ok || !body.code) throw new Error(body.error ?? "Không sao chép được sự kiện.");
      copyKey.current = null;
      router.push(`/e/${body.code}/players`);
    } catch (error) {
      setCopyError(error instanceof Error ? error.message : "Không sao chép được sự kiện.");
    } finally {
      setCopying(false);
    }
  };
  return (
    <div className="bg-paper">
    <Link href={`/e/${event.code}`} className="grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-3 py-3 hover:bg-mute-300">
      <div className="grid size-12 place-items-center overflow-hidden border border-ink bg-ink text-white">
        {first ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/events/${event.code}/assets/${first.assetId}`} alt={first.name} className="size-full object-contain" />
        ) : (
          <span className="font-display text-[10px] font-extrabold">RP</span>
        )}
      </div>
      <div className="min-w-0">
        <p className="truncate font-display text-sm font-extrabold uppercase">{event.name}</p>
        <p className="mt-1 text-[10px] text-mute-600">
          {new Date(eventTime(event)).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" })} · {event.courts} sân · {event.players} người
        </p>
        {event.venueAddress && <p className="mt-1 truncate text-[9px] text-mute-600">{event.venueAddress}</p>}
        {event.relation === "manager" && <p className="mt-1 text-[9px] font-bold uppercase text-[#087a55]">Phó sự kiện</p>}
        {event.sponsors.length > 1 && <p className="mt-1 text-[9px] font-bold text-[#087a55]">+{event.sponsors.length - 1} logo tài trợ</p>}
      </div>
      <div className="text-right">
        <span className="block font-mono text-[11px] font-bold text-[#087a55]">{event.code}</span>
        <span className="text-[9px] uppercase text-mute-600">{event.status === "draft" ? "Sắp diễn ra" : event.status === "running" ? "Đang đánh" : "Đã xong"}</span>
      </div>
    </Link>
    {(canDelete || (event.status === "finished" && event.relation === "owner")) && (
      <div className="border-t border-line px-3 py-2 text-right">
        <div className="flex items-center justify-end gap-4">
          {canDelete && (
            <button
              type="button"
              disabled={deleting}
              onClick={() => {
                setDeleteError("");
                setConfirmingDelete(true);
              }}
              className="font-display text-[9px] font-extrabold uppercase text-accent-700 disabled:opacity-50"
            >
              Xóa sự kiện
            </button>
          )}
          {event.status === "finished" && event.relation === "owner" && (
            <button
              type="button"
              disabled={copying}
              onClick={copy}
              className="font-display text-[9px] font-extrabold uppercase text-[#087a55] disabled:opacity-50"
            >
              {copying ? "Đang sao chép…" : "Sao chép sự kiện"}
            </button>
          )}
        </div>
        {copyError && <p className="mt-1 text-[10px] text-accent-700">{copyError}</p>}
        {deleteError && !confirmingDelete && <p className="mt-1 text-[10px] text-accent-700">{deleteError}</p>}
      </div>
    )}
    {canDelete && (
      <DeleteEventDialog
        code={event.code}
        name={event.name}
        open={confirmingDelete}
        busy={deleting}
        error={deleteError}
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={remove}
      />
    )}
    </div>
  );
}

function CreateEvent() {
  const router = useRouter();
  const account = useAccount();
  const [name, setName] = useState("");
  const [venueAddress, setVenueAddress] = useState("");
  const [courts, setCourts] = useState(2);
  const [expectedPlayers, setExpectedPlayers] = useState(8);
  const [targetGamesPerPlayer, setTargetGamesPerPlayer] = useState(6);
  const [estimatedMatchMinutes, setEstimatedMatchMinutes] = useState(15);
  const [courtTurnoverMinutes, setCourtTurnoverMinutes] = useState(3);
  const [pointsTo, setPointsTo] = useState(11);
  const [winBy2, setWinBy2] = useState(true);
  const [playerPassword, setPlayerPassword] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const schedule = scheduledAtFromInputs(scheduledDate, scheduledTime);
  const estimate = estimateEvent({
    players: expectedPlayers,
    courts,
    targetGamesPerPlayer,
    matchMinutes: estimatedMatchMinutes,
    turnoverMinutes: courtTurnoverMinutes,
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (schedule.error) {
      setError(schedule.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          venueAddress,
          courts,
          expectedPlayers,
          targetGamesPerPlayer,
          estimatedMatchMinutes,
          courtTurnoverMinutes,
          pointsTo,
          winBy2,
          playerPassword,
          adminPassword,
          scheduledAt: schedule.value,
        }),
      });
      const body = (await res.json()) as { code?: string; error?: string };
      if (!res.ok || !body.code) {
        setError(body.error ?? "Không tạo được buổi đánh.");
        return;
      }
      router.push(`/e/${body.code}/players`);
    } catch {
      setError("Không nối được máy chủ. Kiểm tra mạng rồi thử lại.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      id="home-panel-create"
      role="tabpanel"
      aria-labelledby="home-tab-create"
      className="border border-t-0 border-line bg-surface p-5"
    >
      {!account.data?.user ? (
        <div className="space-y-4">
          <p className="text-sm font-semibold">Chỉ tài khoản Google được tạo sự kiện. Tham gia và nhập điểm vẫn không cần đăng nhập.</p>
          {account.data?.enabled && <a href={signInHref("/")} className="inline-flex min-h-tap items-center bg-[#087a55] px-4 font-display text-[10px] font-extrabold uppercase text-white">Đăng nhập Google</a>}
        </div>
      ) : <form onSubmit={submit} className="space-y-4">
        <Field label="Tên sự kiện">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Tối thứ ba sân Hoa Lư"
            className={`${inputClass} !bg-paper`}
          />
        </Field>

        <Field label="Địa chỉ sân" hint="Tùy chọn, tối đa 200 ký tự.">
          <input
            value={venueAddress}
            onChange={(event) => setVenueAddress(event.target.value)}
            maxLength={200}
            placeholder="123 Nguyễn Du, Quận 1"
            className={`${inputClass} !bg-paper`}
          />
        </Field>

        <div className="grid gap-3">
          <Field label="Giờ bắt đầu" hint="Định dạng 24 giờ: giờ:phút.">
            <input
              type="time"
              lang="vi-VN"
              step={60}
              value={scheduledTime}
              onChange={(event) => setScheduledTime(event.target.value)}
              className={`${inputClass} !bg-paper tabular-nums`}
            />
          </Field>
          <Field label="Ngày diễn ra" hint="Ngày / tháng / năm. Không bắt buộc nếu để trống cả hai ô.">
            <input
              type="date"
              lang="vi-VN"
              value={scheduledDate}
              onChange={(event) => setScheduledDate(event.target.value)}
              className={`${inputClass} !bg-paper tabular-nums`}
            />
          </Field>
          {schedule.error && (
            <p className="text-pretty text-xs font-semibold text-accent-700" role="alert">
              {schedule.error}
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Số người dự kiến">
            <input
              type="number"
              min={4}
              max={200}
              value={expectedPlayers}
              onChange={(event) => setExpectedPlayers(Number(event.target.value))}
              className={`${inputClass} !bg-paper tabular-nums`}
            />
          </Field>
          <Field label="Số sân">
            <input
              type="number"
              min={1}
              max={8}
              value={courts}
              onChange={(e) => setCourts(Number(e.target.value))}
              className={`${inputClass} !bg-paper tabular-nums`}
            />
          </Field>
          <Field label="Trận/người mong muốn">
            <input
              type="number"
              min={1}
              max={50}
              value={targetGamesPerPlayer}
              onChange={(event) => setTargetGamesPerPlayer(Number(event.target.value))}
              className={`${inputClass} !bg-paper tabular-nums`}
            />
          </Field>
          <Field label="Đánh tới">
            <input
              type="number"
              min={5}
              max={50}
              value={pointsTo}
              onChange={(e) => setPointsTo(Number(e.target.value))}
              className={`${inputClass} !bg-paper tabular-nums`}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Phút mỗi trận">
            <input
              type="number"
              min={5}
              max={180}
              value={estimatedMatchMinutes}
              onChange={(event) => setEstimatedMatchMinutes(Number(event.target.value))}
              className={`${inputClass} !bg-paper tabular-nums`}
            />
          </Field>
          <Field label="Phút đổi sân/xếp trận">
            <input
              type="number"
              min={0}
              max={60}
              value={courtTurnoverMinutes}
              onChange={(event) => setCourtTurnoverMinutes(Number(event.target.value))}
              className={`${inputClass} !bg-paper tabular-nums`}
            />
          </Field>
        </div>

        {estimate && (
          <div className="border-l-4 border-[#087a55] bg-paper p-3 text-xs leading-relaxed">
            <p className="font-display text-[11px] font-extrabold uppercase text-[#087a55]">
              Ước tính {estimate.totalMatches} trận · {formatEstimatedDuration(estimate.durationMinutes)}
            </p>
            <p className="mt-1 text-mute-600">
              Khoảng {estimate.minGamesPerPlayer}–{estimate.maxGamesPerPlayer} trận/người, {estimate.usableCourts} sân sử dụng,
              {" "}{estimate.waves} lượt sân; thời gian chờ trung bình khoảng {estimate.averageWaitMinutes} phút.
            </p>
            <p className="mt-1 text-[10px] text-mute-600">
              Dựa trên {estimatedMatchMinutes} phút/trận và {courtTurnoverMinutes} phút đổi sân. Người đến muộn,
              nghỉ hoặc trận kéo dài sẽ làm thay đổi thực tế; ước tính không tác động thuật toán công bằng.
            </p>
          </div>
        )}

        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={winBy2}
            onChange={(e) => setWinBy2(e.target.checked)}
            className="size-5 accent-[#087a55]"
          />
          Phải hơn 2 điểm mới thắng
        </label>

        <Field
          label="Mật khẩu người chơi"
          hint="Để trống thì ai có đường dẫn cũng nhập điểm được."
        >
          <input
            type="password"
            value={playerPassword}
            onChange={(e) => setPlayerPassword(e.target.value)}
            autoComplete="new-password"
            className={`${inputClass} !bg-paper`}
          />
        </Field>

        <Field
          label="Mật khẩu điều hành"
          hint="Quyền dự phòng để phối hợp tại sân; không quản lý Phó, tài trợ, giải thưởng hay kết thúc sớm."
        >
          <input
            type="password"
            value={adminPassword}
            onChange={(e) => setAdminPassword(e.target.value)}
            autoComplete="new-password"
            className={`${inputClass} !bg-paper`}
          />
        </Field>

        {error && <p className="text-sm text-accent-700">{error}</p>}

        <HomePrimaryButton
          className="w-full"
          type="submit"
          disabled={busy || name.trim().length < 2 || adminPassword.length < 4}
        >
          {busy ? "Đang tạo…" : "Tạo buổi đánh"}
        </HomePrimaryButton>
      </form>}
    </div>
  );
}

/**
 * Vào câu lạc bộ bằng mã mời, hoặc lập câu lạc bộ mới.
 *
 * Câu lạc bộ chỉ là cuốn danh bạ những người hay đánh cùng nhau. Giá trị nằm ở
 * chỗ tuần sau khỏi gõ lại mười lăm cái tên.
 */
function ClubEntry() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [myName, setMyName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const profile = loadProfile();
    if (profile) setMyName(profile.name);
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/clubs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, ownerName: myName }),
      });
      const body = (await res.json()) as { club?: { id: string }; error?: string };
      if (!res.ok || !body.club) throw new Error(body.error ?? "Không tạo được câu lạc bộ.");
      router.push(`/c/${body.club.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tạo được câu lạc bộ.");
      setBusy(false);
    }
  };

  return (
    <div
      id="home-panel-club"
      role="tabpanel"
      aria-labelledby="home-tab-club"
      className="space-y-4 border border-t-0 border-line bg-surface p-5"
    >
      <div className="border-b border-line pb-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim()) router.push(`/c/${code.trim().toUpperCase()}/join`);
          }}
          className="space-y-4"
        >
          <Field label="Mã mời câu lạc bộ" hint="Sáu ký tự, hoặc quét mã QR của nhóm.">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ABC123"
              autoCapitalize="characters"
              autoComplete="off"
              maxLength={6}
              className={`${inputClass} !bg-paper text-center font-mono text-2xl tracking-[0.3em]`}
            />
          </Field>
          <Button full type="submit" disabled={code.trim().length < 4}>
            Vào câu lạc bộ
          </Button>
        </form>
      </div>

      <div>
        <form onSubmit={create} className="space-y-4">
          <Field label="Lập câu lạc bộ mới" hint="Danh bạ dùng lại cho mọi buổi đánh sau.">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Pickleball tối thứ ba"
              maxLength={60}
              className={`${inputClass} !bg-paper`}
            />
          </Field>
          <Field label="Tên của bạn">
            <input
              value={myName}
              onChange={(e) => setMyName(e.target.value)}
              placeholder="Nguyễn Văn Nam"
              maxLength={40}
              className={`${inputClass} !bg-paper`}
            />
          </Field>

          {error && (
            <p className="bg-accent-100 p-3 text-sm text-accent-700">{error}</p>
          )}

          <HomePrimaryButton
            className="w-full"
            type="submit"
            disabled={busy || name.trim().length < 2 || myName.trim().length < 1}
          >
            {busy ? "Đang tạo…" : "Lập câu lạc bộ"}
          </HomePrimaryButton>
        </form>
      </div>
    </div>
  );
}
