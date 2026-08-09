"use client";

/**
 * Trang chủ: tạo buổi đánh mới, hoặc vào buổi đã có.
 *
 * Danh sách "sự kiện gần đây" lấy từ localStorage của chính máy. Đó là thứ khiến
 * lần mở thứ hai trở đi thành một cú bấm: không ai nhớ nổi mã sáu ký tự của buổi
 * tuần trước, nhưng ai cũng nhận ra tên buổi đánh.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  loadRecentClubs,
  loadRecentEvents,
  type RecentClub,
  type RecentEvent,
  loadProfile,
} from "@/lib/identity/device";
import { Button, Field, inputClass } from "@/components/ui";
import { Avatar } from "@/components/Avatar";
import { signInHref, useAccount } from "@/hooks/useAccount";

const HOME_ACCENT = "#087a55";

export default function HomePage() {
  const [recent, setRecent] = useState<RecentEvent[]>([]);
  const [clubs, setClubs] = useState<RecentClub[]>([]);
  const [tab, setTab] = useState<"join" | "created" | "create" | "club">("join");

  useEffect(() => {
    setRecent(loadRecentEvents());
    setClubs(loadRecentClubs());
  }, []);

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
  status: "draft" | "running" | "finished";
  scheduledAt: number | null;
  createdAt: number;
  courts: number;
  players: number;
  sponsors: Array<{ id: string; name: string; assetId: string }>;
}

function CreatedEvents() {
  const account = useAccount();
  const query = useQuery<{
    events: OwnedEvent[];
    quota: { used: number; limit: number | null; remaining: number | null };
  }>({
    queryKey: ["owned-events"],
    enabled: Boolean(account.data?.user),
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
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const endToday = startToday + 86_400_000;
  const groups = [
    { title: "Hôm nay", items: events.filter((event) => eventTime(event) >= startToday && eventTime(event) < endToday) },
    { title: "Sắp tới", items: events.filter((event) => eventTime(event) >= endToday) },
    { title: "Đã qua", items: events.filter((event) => eventTime(event) < startToday) },
  ];

  return (
    <div id="home-panel-created" role="tabpanel" aria-labelledby="home-tab-created" className="space-y-4 border border-t-0 border-line bg-surface p-4">
      {query.data && (
        <div className="flex items-center justify-between border-l-4 border-[#087a55] bg-paper px-3 py-2 text-xs">
          <strong>Sự kiện đang mở</strong>
          <span className="font-mono font-bold text-[#087a55]">
            {query.data.quota.used}/{query.data.quota.limit ?? "∞"}
          </span>
        </div>
      )}
      {query.isLoading && <p className="text-sm text-mute-600">Đang tải…</p>}
      {query.error && <p className="text-sm text-accent-700">{(query.error as Error).message}</p>}
      {!query.isLoading && events.length === 0 && <p className="text-sm text-mute-600">Bạn chưa tạo sự kiện nào.</p>}
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
  return (
    <Link href={`/e/${event.code}`} className="grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-3 bg-paper py-3 hover:bg-mute-300">
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
        {event.sponsors.length > 1 && <p className="mt-1 text-[9px] font-bold text-[#087a55]">+{event.sponsors.length - 1} logo tài trợ</p>}
      </div>
      <div className="text-right">
        <span className="block font-mono text-[11px] font-bold text-[#087a55]">{event.code}</span>
        <span className="text-[9px] uppercase text-mute-600">{event.status === "draft" ? "Sắp diễn ra" : event.status === "running" ? "Đang đánh" : "Đã xong"}</span>
      </div>
    </Link>
  );
}

function CreateEvent() {
  const router = useRouter();
  const account = useAccount();
  const [name, setName] = useState("");
  const [courts, setCourts] = useState(2);
  const [pointsTo, setPointsTo] = useState(11);
  const [winBy2, setWinBy2] = useState(true);
  const [playerPassword, setPlayerPassword] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          courts,
          pointsTo,
          winBy2,
          playerPassword,
          adminPassword,
          scheduledAt: scheduledAt ? new Date(scheduledAt).getTime() : null,
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
        <Field label="Tên buổi đánh">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Tối thứ ba sân Hoa Lư"
            className={`${inputClass} !bg-paper`}
          />
        </Field>

        <Field label="Ngày giờ dự kiến" hint="Không bắt buộc.">
          <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className={`${inputClass} !bg-paper`} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
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
          label="Mật khẩu chủ sự kiện"
          hint="Dùng để xếp lịch, duyệt người, mở khoá kết quả. Đừng chia sẻ rộng."
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
