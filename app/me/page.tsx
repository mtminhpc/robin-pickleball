"use client";

/**
 * Trang của tôi — chạy được cả khi không có tài khoản.
 *
 * Mục 13 trong yêu cầu: giữ lại mọi thứ kể cả khi người chơi không tạo tài khoản,
 * miễn là họ vẫn dùng đúng cái điện thoại đó. Danh sách buổi đã mở nằm trong
 * `localStorage` của chính máy, số liệu thì máy chủ tính rồi trả về.
 *
 * Đăng nhập rồi thì máy chủ gộp thêm các buổi từ những máy khác của cùng tài
 * khoản. Dòng chữ cuối trang **đổi theo trạng thái đó**, vì nó là lời hứa về
 * việc dữ liệu có mất hay không — hứa sai ở đây thì người dùng chỉ phát hiện ra
 * đúng lúc họ đã mất.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { loadProfile, loadRecentEvents } from "@/lib/identity/device";
import { AccountBar } from "@/components/AccountBar";
import { Avatar } from "@/components/Avatar";
import { Card, Empty } from "@/components/ui";

interface MeResponse {
  events: Array<{
    code: string;
    name: string;
    at: number;
    status: string;
    myName: string;
    games: number;
    wins: number;
    losses: number;
    diff: number;
    avgDiff: number;
  }>;
  totals: {
    events: number;
    games: number;
    wins: number;
    losses: number;
    diff: number;
    avgDiff: number;
  };
  periods: Array<{
    periodKey: string;
    label: string;
    events: number;
    games: number;
    avgDiff: number;
    rank: number;
    of: number;
  }>;
  /** `null` khi chưa đăng nhập — số liệu khi đó chỉ của riêng máy này. */
  account: { email: string; displayName: string; devices: number } | null;
}

export default function MePage() {
  const [payload, setPayload] = useState<{ codes: string[]; name: string } | null>(null);

  useEffect(() => {
    setPayload({
      codes: loadRecentEvents().map((e) => e.code),
      name: loadProfile()?.name ?? "",
    });
  }, []);

  const profile = typeof window === "undefined" ? null : loadProfile();

  const { data, isLoading, error } = useQuery<MeResponse>({
    queryKey: ["me", payload?.codes.join(","), payload?.name],
    enabled: payload !== null,
    queryFn: async () => {
      const res = await fetch("/api/me", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json()) as MeResponse & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Không tải được số liệu.");
      return body;
    },
    retry: false,
  });

  return (
    <main className="mx-auto min-h-dvh max-w-md space-y-6 px-4 py-8">
      <header className="space-y-1">
        <Link href="/" className="text-sm text-slate-500 hover:text-slate-300">
          ← Trang chủ
        </Link>
        <div className="flex items-center gap-3 pt-1">
          {profile && <Avatar name={profile.name} avatarId={profile.avatarId} size="lg" />}
          <div>
            <h1 className="text-2xl font-bold">
              {data?.account?.displayName || profile?.name || "Máy này"}
            </h1>
            <p className="text-sm text-slate-400">
              {data?.account
                ? data.account.devices > 1
                  ? `Gộp số liệu từ ${data.account.devices} máy`
                  : "Số liệu theo tài khoản"
                : "Số liệu lưu trên máy, không cần tài khoản"}
            </p>
          </div>
        </div>
      </header>

      {(isLoading || payload === null) && <Empty>Đang tính…</Empty>}
      {error && <Empty>{(error as Error).message}</Empty>}

      {data && data.totals.events === 0 && (
        <Empty>
          Chưa có buổi đánh nào trên máy này. Vào một buổi rồi quay lại đây là thấy
          số liệu.
        </Empty>
      )}

      {data && data.totals.events > 0 && (
        <>
          <Card className="grid grid-cols-2 gap-4 p-5">
            <Stat label="Buổi đã đánh" value={data.totals.events} />
            <Stat label="Tổng số trận" value={data.totals.games} />
            <Stat label="Thắng – Thua" value={`${data.totals.wins} – ${data.totals.losses}`} />
            <Stat
              label="Hiệu số TB/trận"
              value={`${data.totals.avgDiff > 0 ? "+" : ""}${data.totals.avgDiff}`}
              highlight={data.totals.avgDiff > 0}
            />
          </Card>

          {data.periods.length > 1 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
                Theo tháng
              </h2>
              {data.periods.map((p) => (
                <Card key={p.periodKey} className="flex items-center justify-between p-4">
                  <div>
                    <p className="font-medium">{p.label}</p>
                    <p className="text-xs text-slate-500">
                      {p.events} buổi · {p.games} trận
                      {p.rank > 0 && ` · hạng ${p.rank}/${p.of}`}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 font-semibold tabular-nums ${
                      p.avgDiff > 0 ? "text-court-100" : "text-slate-300"
                    }`}
                  >
                    {p.avgDiff > 0 ? "+" : ""}
                    {p.avgDiff}
                  </span>
                </Card>
              ))}
            </section>
          )}

          <section className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
              Từng buổi
            </h2>
            {data.events.map((e) => (
              <Link key={e.code} href={`/e/${e.code}/standings`} className="block">
                <Card className="flex items-center justify-between p-4">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{e.name}</p>
                    <p className="text-xs text-slate-500">
                      {new Date(e.at).toLocaleDateString("vi-VN")} · {e.games} trận ·{" "}
                      {e.wins}T {e.losses}B
                    </p>
                  </div>
                  <span
                    className={`ml-3 shrink-0 font-semibold tabular-nums ${
                      e.avgDiff > 0 ? "text-court-100" : "text-slate-300"
                    }`}
                  >
                    {e.avgDiff > 0 ? "+" : ""}
                    {e.avgDiff}
                  </span>
                </Card>
              </Link>
            ))}
          </section>
        </>
      )}

      <AccountBar next="/me" />

      <p className="pb-4 text-xs text-slate-600">
        {data?.account
          ? "Số liệu này bám theo tài khoản của bạn. Đăng nhập trên điện thoại mới là thấy lại đủ."
          : "Số liệu này bám theo máy bạn đang dùng. Xoá dữ liệu trình duyệt hoặc đổi điện thoại là mất."}
      </p>
    </main>
  );
}

function Stat({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string | number;
  highlight?: boolean;
}) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p
        className={`text-2xl font-bold tabular-nums ${
          highlight ? "text-court-100" : "text-slate-100"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
