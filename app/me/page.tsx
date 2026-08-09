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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { loadProfile, loadRecentEvents, saveProfile } from "@/lib/identity/device";
import { ACCOUNT_KEY, useAccount } from "@/hooks/useAccount";
import { AccountBar } from "@/components/AccountBar";
import { PhotoPicker } from "@/components/PhotoPicker";
import { Button, Card, Empty, inputClass } from "@/components/ui";
import { AppAdminEventLimits } from "@/components/AppAdminEventLimits";

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
  account: {
    email: string;
    displayName: string;
    devices: number;
    deviceList: DeviceRow[];
  } | null;
}

interface DeviceRow {
  deviceId: string;
  displayName: string;
  lastSeen: number;
  /** Chính cái máy đang mở trang này. */
  current: boolean;
}

export default function MePage() {
  const [payload, setPayload] = useState<{ codes: string[]; name: string } | null>(null);
  const [showDevices, setShowDevices] = useState(false);
  const queryClient = useQueryClient();
  const user = useAccount().data?.user ?? null;

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
        <Link href="/" className="text-sm text-mute-600 hover:text-mute-800">
          ← Trang chủ
        </Link>
        <div className="flex items-center gap-3 pt-1">
          <PhotoPicker
            name={user?.displayName || profile?.name || "Máy này"}
            avatarId={user?.avatarId ?? profile?.avatarId}
            photoSrc={
              user ? `/api/avatar/${encodeURIComponent(user.userId)}` : undefined
            }
            endpoint="/api/me/avatar"
            canEdit={user !== null}
            hasPhoto={user?.hasPhoto ?? false}
            onChanged={() => queryClient.invalidateQueries({ queryKey: ACCOUNT_KEY })}
          />
          <div className="min-w-0">
            <NameLine
              name={data?.account?.displayName || profile?.name || "Máy này"}
              avatarId={user?.avatarId ?? profile?.avatarId ?? ""}
              canEdit={user !== null}
            />
            {data?.account && data.account.devices > 1 ? (
              <button
                className="text-sm text-mute-700 underline decoration-mute-400 underline-offset-4 hover:text-mute-900"
                onClick={() => setShowDevices((v) => !v)}
              >
                Gộp số liệu từ {data.account.devices} máy
                <span className="ml-1 text-xs">{showDevices ? "▲" : "▼"}</span>
              </button>
            ) : (
              <p className="text-sm text-mute-700">
                {data?.account
                  ? "Số liệu theo tài khoản"
                  : "Số liệu lưu trên máy, không cần tài khoản"}
              </p>
            )}
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
              <h2 className="text-sm font-semibold uppercase tracking-wide text-mute-700">
                Theo tháng
              </h2>
              {data.periods.map((p) => (
                <Card key={p.periodKey} className="flex items-center justify-between p-4">
                  <div>
                    <p className="font-medium">{p.label}</p>
                    <p className="text-xs text-mute-600">
                      {p.events} buổi · {p.games} trận
                      {p.rank > 0 && ` · hạng ${p.rank}/${p.of}`}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 font-semibold tabular-nums ${
                      p.avgDiff > 0 ? "text-accent-700" : "text-mute-800"
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
            <h2 className="text-sm font-semibold uppercase tracking-wide text-mute-700">
              Từng buổi
            </h2>
            {data.events.map((e) => (
              <Link key={e.code} href={`/e/${e.code}/standings`} className="block">
                <Card className="flex items-center justify-between p-4">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{e.name}</p>
                    <p className="text-xs text-mute-600">
                      {new Date(e.at).toLocaleDateString("vi-VN")} · {e.games} trận ·{" "}
                      {e.wins}T {e.losses}B
                    </p>
                  </div>
                  <span
                    className={`ml-3 shrink-0 font-semibold tabular-nums ${
                      e.avgDiff > 0 ? "text-accent-700" : "text-mute-800"
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

      {showDevices && data?.account && <DeviceList devices={data.account.deviceList} />}

      {user?.isAppAdmin && <AppAdminEventLimits />}

      <AccountBar next="/me" />

      <p className="pb-4 text-xs text-mute-500">
        {data?.account
          ? "Số liệu này bám theo tài khoản của bạn. Đăng nhập trên điện thoại mới là thấy lại đủ."
          : "Số liệu này bám theo máy bạn đang dùng. Xoá dữ liệu trình duyệt hoặc đổi điện thoại là mất."}
      </p>
    </main>
  );
}

/**
 * Tên hiển thị, và nút sửa nó.
 *
 * Chỉ hiện nút khi đã đăng nhập: chưa có tài khoản thì cái tên đang hiện nằm
 * trong `localStorage` của máy này, người dùng đổi nó ở màn hình Tham gia.
 *
 * Lưu xong thì ghi cả vào `localStorage`. Không có bước đó thì lần quét mã QR
 * sau vẫn tự điền cái tên cũ, và người dùng phải sửa lần thứ hai cho một việc
 * họ tưởng đã làm xong.
 */
function NameLine({
  name,
  avatarId,
  canEdit,
}: {
  name: string;
  avatarId: string;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async (displayName: string) => {
      const res = await fetch("/api/me/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName }),
      });
      const body = (await res.json()) as { displayName?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Không đổi được tên.");
      return body.displayName ?? displayName;
    },
    onSuccess: (saved) => {
      // Máy mới có thể chưa có `rp_profile`; lấy ảnh đang hiện từ tài khoản làm
      // dự phòng để đổi tên không vô tình ghi một avatar rỗng vào localStorage.
      saveProfile({ name: saved, avatarId });
      queryClient.invalidateQueries({ queryKey: ACCOUNT_KEY });
      queryClient.invalidateQueries({ queryKey: ["me"] });
      setEditing(false);
      setError(null);
    },
    onError: (e: Error) => setError(e.message),
  });

  if (!editing) {
    return (
      <div className="flex min-w-0 items-center gap-2">
        <h1 className="truncate text-2xl font-bold">{name}</h1>
        {canEdit && (
          <button
            type="button"
            aria-label="Đổi tên hiển thị"
            onClick={() => {
              setDraft(name);
              setEditing(true);
            }}
            className="min-h-9 flex-none px-1 text-sm text-mute-600 underline underline-offset-4 hover:text-mute-900"
          >
            Sửa
          </button>
        )}
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = draft.trim();
        if (trimmed === "" || save.isPending) return;
        save.mutate(trimmed);
      }}
      className="space-y-1"
    >
      <div className="flex gap-2">
        <input
          autoFocus
          value={draft}
          maxLength={40}
          onChange={(e) => setDraft(e.target.value)}
          className={inputClass}
        />
        <Button tone="primary" type="submit" disabled={!draft.trim() || save.isPending}>
          {save.isPending ? "…" : "Lưu"}
        </Button>
      </div>
      <button
        type="button"
        onClick={() => {
          setEditing(false);
          setError(null);
        }}
        className="min-h-9 text-xs text-mute-600 underline underline-offset-4"
      >
        Thôi
      </button>
      {error && <p className="bg-accent p-2 text-xs text-paper">{error}</p>}
    </form>
  );
}

/**
 * Những máy đang được gộp vào tài khoản, và nút bỏ bớt.
 *
 * Chữ ở đây phải nói đúng phạm vi việc mình làm, vì rất dễ đọc nhầm thành "khoá
 * cái điện thoại đã mất". Nó **không làm được thế**: cookie thiết bị nằm trong
 * chính cái máy đó, và danh bạ câu lạc bộ vẫn nhận nó theo mã máy. Thứ duy nhất
 * bị cắt là việc gộp số liệu — nên nút cũng chỉ hứa đúng chừng ấy.
 *
 * Máy đang cầm không gỡ được: gỡ nó chỉ tạo ra trạng thái vừa đang đăng nhập vừa
 * không thuộc tài khoản nào, rồi lần đăng nhập sau nó tự gắn lại. Đăng xuất mới
 * là việc người dùng đang định làm.
 */
function DeviceList({ devices }: { devices: DeviceRow[] }) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const remove = useMutation({
    mutationFn: async (deviceId: string) => {
      const res = await fetch("/api/auth/devices", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceId }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Không gỡ được máy này.");
    },
    onSuccess: () => {
      // Số liệu thu hẹp lại, và AccountBar vẽ số máy từ phiên đăng nhập — không
      // tính lại cả hai thì người vừa bấm nhìn thấy con số của trạng thái cũ.
      queryClient.invalidateQueries({ queryKey: ["me"] });
      queryClient.invalidateQueries({ queryKey: ACCOUNT_KEY });
      setConfirming(null);
    },
  });

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-mute-700">
        Máy đang gộp
      </h2>

      {devices.map((d) => (
        <Card key={d.deviceId} className="p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-medium">
                {d.displayName || "Máy không tên"}
                <span className="ml-2 font-mono text-xs text-mute-500">
                  ·{d.deviceId.slice(-4)}
                </span>
              </p>
              <p className="text-xs text-mute-600">
                {d.current ? "Máy này" : `Đồng bộ lần cuối ${whenLabel(d.lastSeen)}`}
              </p>
            </div>

            {d.current ? (
              <span className="shrink-0 text-xs text-mute-500">Dùng Đăng xuất</span>
            ) : (
              confirming !== d.deviceId && (
                <button
                  className="shrink-0 text-sm text-mute-700 hover:text-ink"
                  onClick={() => {
                    remove.reset();
                    setConfirming(d.deviceId);
                  }}
                >
                  Bỏ gộp
                </button>
              )
            )}
          </div>

          {confirming === d.deviceId && (
            <div className="mt-3 space-y-3 rounded-xl bg-accent-100 p-3">
              <p className="text-sm text-accent-800">
                Số liệu từ máy này thôi được cộng vào trang của bạn, và danh sách
                buổi của nó không còn theo tài khoản sang máy khác nữa.
                <strong className="block pt-1 font-semibold">
                  Việc này không khoá được cái điện thoại đó.
                </strong>
                Ai đang cầm nó vẫn mở được các buổi đã lưu sẵn trong máy, và vẫn
                là thành viên câu lạc bộ như trước.
              </p>
              {remove.error && (
                <p className="text-sm text-rose-300">{(remove.error as Error).message}</p>
              )}
              <div className="flex gap-2">
                <Button className="flex-1" onClick={() => setConfirming(null)}>
                  Thôi
                </Button>
                <Button
                  tone="danger"
                  className="flex-1"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(d.deviceId)}
                >
                  {remove.isPending ? "Đang gỡ…" : "Bỏ gộp"}
                </Button>
              </div>
            </div>
          )}
        </Card>
      ))}
    </section>
  );
}

/** "hôm nay" / "3 ngày trước" — ngày tháng đầy đủ cho mốc đã xa. */
function whenLabel(at: number): string {
  if (!at) return "chưa rõ";
  const days = Math.floor((Date.now() - at) / 86_400_000);
  if (days <= 0) return "hôm nay";
  if (days === 1) return "hôm qua";
  if (days < 30) return `${days} ngày trước`;
  return new Date(at).toLocaleDateString("vi-VN");
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
      <p className="text-xs text-mute-600">{label}</p>
      <p
        className={`text-2xl font-bold tabular-nums ${
          highlight ? "text-accent-700" : "text-ink"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
