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
import {
  loadRecentClubs,
  loadRecentEvents,
  type RecentClub,
  type RecentEvent,
  loadProfile,
} from "@/lib/identity/device";
import { Button, Card, Field, inputClass } from "@/components/ui";

export default function HomePage() {
  const [recent, setRecent] = useState<RecentEvent[]>([]);
  const [clubs, setClubs] = useState<RecentClub[]>([]);
  const [tab, setTab] = useState<"join" | "create" | "club">("join");

  useEffect(() => {
    setRecent(loadRecentEvents());
    setClubs(loadRecentClubs());
  }, []);

  return (
    <main className="mx-auto min-h-dvh max-w-md space-y-6 px-4 py-8">
      <header className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">Robin Pickleball</h1>
          <p className="text-sm text-slate-400">
            Xếp lịch xoay đôi công bằng, tính điểm theo hiệu số.
          </p>
        </div>
        <Link
          href="/me"
          className="shrink-0 rounded-xl bg-slate-900 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
        >
          Của tôi
        </Link>
      </header>

      {recent.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Gần đây
          </h2>
          {recent.slice(0, 5).map((e) => (
            <Link key={e.code} href={`/e/${e.code}`} className="block">
              <Card className="flex items-center justify-between p-4">
                <span className="truncate font-medium">{e.name}</span>
                <span className="ml-3 shrink-0 font-mono text-xs tracking-wider text-slate-500">
                  {e.code}
                </span>
              </Card>
            </Link>
          ))}
        </section>
      )}

      {clubs.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Câu lạc bộ của bạn
          </h2>
          {clubs.slice(0, 5).map((c) => (
            <Link key={c.id} href={`/c/${c.id}`} className="block">
              <Card className="flex items-center justify-between p-4">
                <span className="truncate font-medium">{c.name}</span>
                <span className="ml-3 shrink-0 text-xs text-slate-500">danh bạ →</span>
              </Card>
            </Link>
          ))}
        </section>
      )}

      <div className="flex gap-2 rounded-xl bg-slate-900 p-1">
        <TabButton active={tab === "join"} onClick={() => setTab("join")}>
          Vào bằng mã
        </TabButton>
        <TabButton active={tab === "create"} onClick={() => setTab("create")}>
          Tạo buổi mới
        </TabButton>
        <TabButton active={tab === "club"} onClick={() => setTab("club")}>
          Câu lạc bộ
        </TabButton>
      </div>

      {tab === "join" ? <JoinByCode /> : tab === "create" ? <CreateEvent /> : <ClubEntry />}
    </main>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-tap flex-1 rounded-lg text-sm font-semibold ${
        active ? "bg-slate-800 text-slate-100" : "text-slate-400"
      }`}
    >
      {children}
    </button>
  );
}

function JoinByCode() {
  const router = useRouter();
  const [code, setCode] = useState("");

  return (
    <Card className="p-5">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim()) router.push(`/e/${code.trim().toUpperCase()}`);
        }}
        className="space-y-4"
      >
        <Field label="Mã buổi đánh" hint="Sáu ký tự, người tổ chức sẽ cho bạn.">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ABC123"
            autoCapitalize="characters"
            autoComplete="off"
            maxLength={6}
            className={`${inputClass} text-center font-mono text-2xl tracking-[0.3em]`}
          />
        </Field>
        <Button tone="primary" full type="submit" disabled={code.trim().length < 4}>
          Vào xem
        </Button>
      </form>
    </Card>
  );
}

function CreateEvent() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [courts, setCourts] = useState(2);
  const [pointsTo, setPointsTo] = useState(11);
  const [winBy2, setWinBy2] = useState(true);
  const [playerPassword, setPlayerPassword] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
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
    <Card className="p-5">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Tên buổi đánh">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Tối thứ ba sân Hoa Lư"
            className={inputClass}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Số sân">
            <input
              type="number"
              min={1}
              max={8}
              value={courts}
              onChange={(e) => setCourts(Number(e.target.value))}
              className={inputClass}
            />
          </Field>
          <Field label="Đánh tới">
            <input
              type="number"
              min={5}
              max={50}
              value={pointsTo}
              onChange={(e) => setPointsTo(Number(e.target.value))}
              className={inputClass}
            />
          </Field>
        </div>

        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={winBy2}
            onChange={(e) => setWinBy2(e.target.checked)}
            className="h-5 w-5 accent-court-500"
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
            className={inputClass}
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
            className={inputClass}
          />
        </Field>

        {error && <p className="text-sm text-red-300">{error}</p>}

        <Button
          tone="primary"
          full
          type="submit"
          disabled={busy || name.trim().length < 2 || adminPassword.length < 4}
        >
          {busy ? "Đang tạo…" : "Tạo buổi đánh"}
        </Button>
      </form>
    </Card>
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
    <div className="space-y-4">
      <Card className="p-5">
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
              className={`${inputClass} text-center font-mono text-2xl tracking-[0.3em]`}
            />
          </Field>
          <Button full type="submit" disabled={code.trim().length < 4}>
            Vào câu lạc bộ
          </Button>
        </form>
      </Card>

      <Card className="p-5">
        <form onSubmit={create} className="space-y-4">
          <Field label="Lập câu lạc bộ mới" hint="Danh bạ dùng lại cho mọi buổi đánh sau.">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Pickleball tối thứ ba"
              maxLength={60}
              className={inputClass}
            />
          </Field>
          <Field label="Tên của bạn">
            <input
              value={myName}
              onChange={(e) => setMyName(e.target.value)}
              placeholder="Nguyễn Văn Nam"
              maxLength={40}
              className={inputClass}
            />
          </Field>

          {error && (
            <p className="rounded-xl bg-red-500/15 p-3 text-sm text-red-200">{error}</p>
          )}

          <Button
            tone="primary"
            full
            type="submit"
            disabled={busy || name.trim().length < 2 || myName.trim().length < 1}
          >
            {busy ? "Đang tạo…" : "Lập câu lạc bộ"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
