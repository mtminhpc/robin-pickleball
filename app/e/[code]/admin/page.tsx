"use client";

/**
 * Trang quản lý: mã QR, bắt đầu, cấu hình, nhật ký, kết thúc.
 *
 * Nút kết thúc sớm nằm cuối cùng và cần hai bước xác nhận. Nó huỷ toàn bộ trận
 * chưa đánh và khoá sự kiện lại vĩnh viễn, nên đặt nó cạnh các nút thường dùng
 * là mời gọi tai nạn.
 */

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { firstUnplayedRound } from "@/lib/domain/rounds";
import { eventQueryPrefix, useEvent } from "@/hooks/useEventState";
import { useMutationQueue } from "@/hooks/useMutationQueue";
import { signInHref, useAccount } from "@/hooks/useAccount";
import { rememberEvent } from "@/lib/identity/device";
import { PasswordGate } from "@/components/PasswordGate";
import { Button, Card, Dialog, Empty, Field, inputClass } from "@/components/ui";
import { SponsorManager } from "@/components/SponsorManager";
import { estimateEvent, formatEstimatedDuration } from "@/lib/domain/estimate";
import type { EventConfig } from "@/lib/domain/types";
import { CourtManager } from "@/components/CourtManager";
import { RoleManager } from "@/components/RoleManager";

export default function AdminPage() {
  const { code } = useParams<{ code: string }>();
  const { data } = useEvent();
  const queue = useMutationQueue();
  const [ending, setEnding] = useState(false);

  if (!data) return null;
  const { state, capabilities } = data;

  if (!capabilities.canOpenAdmin) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-mute-700">
          Trang này cần quyền Chủ, Phó hoặc mật khẩu điều hành.
        </p>
        <PasswordGate code={code} />
      </div>
    );
  }

  const readyCount = state.players.filter(
    (p) => p.status === "confirmed" || p.status === "active",
  ).length;
  const openMatches = state.matches.filter(
    (match) => match.status === "scheduled" || match.status === "playing",
  ).length;

  return (
    <div className="space-y-5 pb-4">
      {state.status === "draft" && (data.role === "owner" || data.role === "manager" || data.role === "admin") && (
        <Card className="space-y-3 p-5">
          <h2 className="font-semibold">Bắt đầu buổi đánh</h2>
          <p className="text-sm text-mute-700">
            {readyCount} người đã sẵn sàng. Bấm Bắt đầu để chốt danh sách và xếp
            lịch. Sau đó ai vào thêm sẽ phải chờ bạn duyệt.
          </p>
          <Button
            tone="primary"
            full
            disabled={readyCount < 4}
            onClick={() => queue.send({ type: "StartEvent" })}
          >
            {readyCount < 4 ? `Cần ít nhất 4 người (đang có ${readyCount})` : "Bắt đầu"}
          </Button>
        </Card>
      )}

      <QrSection code={code} />

      <OwnershipSection code={code} eventName={state.config.name} />

      {capabilities.canViewIdentityFlags && <RoleManager code={code} />}

      {capabilities.canChangePasswords && <PasswordSection code={code} />}

      {capabilities.canManagePresentation && <SponsorManager code={code} />}

      {capabilities.canManageStructure && <CourtManager code={code} />}

      {state.status === "finished" && capabilities.canCopyEvent && <CopyEventSection code={code} />}

      {capabilities.canManageConfig && <EventConfigSection config={state.config} />}

      <LogSection />

      {state.status === "running" && (capabilities.canFinishNormally || capabilities.canEndEarly) && (
        <Card className="space-y-3 border-line p-5">
          <h2 className={`font-semibold ${openMatches > 0 ? "text-accent-700" : ""}`}>
            {openMatches > 0 ? "Kết thúc sớm" : "Hoàn tất buổi đánh"}
          </h2>
          {openMatches > 0 && capabilities.canEndEarly ? (
            <>
              <p className="text-sm text-mute-700">
                Huỷ toàn bộ trận chưa đánh và chốt bảng xếp hạng. Không mở lại được.
                Hiện còn {openMatches} trận mở từ vòng {firstUnplayedRound(state)}.
              </p>
              <Button tone="danger" full onClick={() => setEnding(true)}>Kết thúc sớm</Button>
            </>
          ) : openMatches === 0 && capabilities.canFinishNormally ? (
            <>
              <p className="text-sm text-mute-700">Không còn trận nào chờ hoặc đang đánh. Bạn có thể chốt kết quả bình thường để mở phần Trao giải.</p>
              <Button tone="primary" full onClick={() => queue.send({ type: "FinishEvent" })}>Hoàn tất &amp; mở trao giải</Button>
            </>
          ) : (
            <p className="text-sm text-mute-700">
              Chỉ Chủ sự kiện được kết thúc sớm khi vẫn còn trận mở.
            </p>
          )}
        </Card>
      )}

      <EndDialog
        open={ending}
        onClose={() => setEnding(false)}
        onConfirm={(reason) => {
          queue.send({ type: "EndEventEarly", reason });
          setEnding(false);
        }}
      />
    </div>
  );
}

function EventConfigSection({ config }: { config: EventConfig }) {
  const queue = useMutationQueue();
  const [name, setName] = useState(config.name);
  const [venueAddress, setVenueAddress] = useState(config.venueAddress);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPatch = useRef<Partial<EventConfig>>({});
  const sendRef = useRef(queue.send);
  sendRef.current = queue.send;
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    if (Object.keys(pendingPatch.current).length > 0) {
      sendRef.current({ type: "UpdateConfig", patch: pendingPatch.current });
      pendingPatch.current = {};
    }
  }, []);
  const debounce = (patch: Partial<EventConfig>) => {
    pendingPatch.current = { ...pendingPatch.current, ...patch };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      queue.send({ type: "UpdateConfig", patch: pendingPatch.current });
      pendingPatch.current = {};
    }, 750);
  };
  const numberField = (
    key: "courts" | "expectedPlayers" | "targetGamesPerPlayer" | "estimatedMatchMinutes" | "courtTurnoverMinutes",
    label: string,
    min: number,
    max: number,
  ) => (
    <Field label={label}>
      <input type="number" min={min} max={max} defaultValue={config[key]} onBlur={(event) => {
        const value = Math.round(Number(event.target.value));
        if (Number.isFinite(value) && value >= min && value <= max && value !== config[key]) {
          queue.send({ type: "UpdateConfig", patch: { [key]: value } });
        }
      }} className={inputClass} />
    </Field>
  );
  const estimate = estimateEvent({
    players: config.expectedPlayers,
    courts: config.courts,
    targetGamesPerPlayer: config.targetGamesPerPlayer,
    matchMinutes: config.estimatedMatchMinutes,
    turnoverMinutes: config.courtTurnoverMinutes,
  });
  return (
    <Card className="space-y-4 p-5">
      <h2 className="font-semibold">Thông tin & cấu hình</h2>
      <Field label="Tên sự kiện"><input value={name} maxLength={80} onChange={(event) => { const value = event.target.value; setName(value); if (value.trim().length >= 2) debounce({ name: value.trim() }); }} className={inputClass} /></Field>
      <Field label="Địa chỉ sân"><input value={venueAddress} maxLength={200} onChange={(event) => { const value = event.target.value; setVenueAddress(value); debounce({ venueAddress: value.trim() }); }} className={inputClass} /></Field>
      <div className="grid grid-cols-2 gap-3">
        {numberField("expectedPlayers", "Số người dự kiến", 4, 200)}
        {numberField("targetGamesPerPlayer", "Trận/người", 1, 50)}
        {numberField("estimatedMatchMinutes", "Phút/trận", 5, 180)}
        {numberField("courtTurnoverMinutes", "Phút đổi sân", 0, 60)}
      </div>
      {estimate && <p className="border-l-4 border-accent bg-surface p-3 text-xs">Ước tính {estimate.totalMatches} trận · {formatEstimatedDuration(estimate.durationMinutes)} · chờ trung bình {estimate.averageWaitMinutes} phút.</p>}
      <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={config.countPartialMatches} onChange={(event) => queue.send({ type: "UpdateConfig", patch: { countPartialMatches: event.target.checked } })} className="mt-0.5 size-5 shrink-0 accent-accent" /><span>Tính trận dở dang vào bảng xếp hạng<span className="block text-xs text-mute-600">Trận bị bỏ giữa chừng nhưng có ghi tỷ số.</span></span></label>
    </Card>
  );
}

function CopyEventSection({ code }: { code: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const copyKey = useRef<string | null>(null);
  const copy = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/events/${code}/copy`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idempotencyKey: copyKey.current ??= crypto.randomUUID() }),
      });
      const body = await response.json() as { code?: string; error?: string };
      if (!response.ok || !body.code) throw new Error(body.error ?? "Không sao chép được sự kiện.");
      copyKey.current = null;
      router.push(`/e/${body.code}/players`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không sao chép được sự kiện.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="space-y-3 p-5">
      <h2 className="font-semibold">Sao chép sự kiện</h2>
      <p className="text-sm text-mute-700">
        Giữ cấu hình, địa chỉ, danh sách mời và nhà tài trợ. Không sao chép lịch, điểm, giải thưởng,
        ngày giờ hoặc mật khẩu. Bản sao mới tính vào hạn mức sự kiện.
      </p>
      <Button full disabled={busy} onClick={copy}>{busy ? "Đang sao chép…" : "Tạo bản sao"}</Button>
      {error && <p className="text-xs text-accent-700">{error}</p>}
    </Card>
  );
}

interface StaffMemberView {
  staffId: string;
  email: string;
  displayName: string;
  status: "pending" | "active";
  createdAt: number;
}

function EventStaffSection({ code }: { code: string }) {
  const account = useAccount();
  const client = useQueryClient();
  const [email, setEmail] = useState("");
  const staff = useQuery<{ max: number; members: StaffMemberView[] }>({
    queryKey: ["event-staff", code],
    queryFn: async () => {
      const response = await fetch(`/api/events/${code}/staff`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Không tải được đội điều hành.");
      return body;
    },
    staleTime: 30_000,
  });
  const change = useMutation({
    mutationFn: async (input: { email?: string; removeId?: string }) => {
      const response = await fetch(
        input.removeId
          ? `/api/events/${code}/staff/${input.removeId}`
          : `/api/events/${code}/staff`,
        input.removeId
          ? { method: "DELETE" }
          : {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ email: input.email }),
            },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Không cập nhật được đội điều hành.");
      return body;
    },
    onSuccess: () => {
      setEmail("");
      void client.invalidateQueries({ queryKey: ["event-staff", code] });
      void client.invalidateQueries({ queryKey: eventQueryPrefix(code) });
    },
  });

  const members = staff.data?.members ?? [];
  return (
    <Card className="space-y-4 p-5">
      <div>
        <p className="eyebrow text-accent">Đội điều hành</p>
        <h2 className="mt-1 font-semibold">Chủ chính và Phó sự kiện</h2>
        <p className="mt-1 text-xs leading-relaxed text-mute-600">
          Tối đa {staff.data?.max ?? 5} Phó. Phó được vận hành trận và kết thúc bình thường,
          nhưng không đổi mật khẩu, tài trợ, giải thưởng hoặc kết thúc sớm.
        </p>
      </div>

      <div className="border border-line bg-surface p-3 text-sm">
        <strong>Chủ sự kiện</strong>
        <p className="mt-1 truncate text-xs text-mute-600">
          {account.data?.user?.displayName} · {account.data?.user?.email}
        </p>
      </div>

      <form
        className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          if (email.trim()) change.mutate({ email: email.trim() });
        }}
      >
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="email.pho@gmail.com"
          className={inputClass}
          maxLength={254}
          required
        />
        <Button type="submit" disabled={change.isPending || members.length >= (staff.data?.max ?? 5)}>
          Mời Phó
        </Button>
      </form>

      {staff.isLoading && <p className="text-sm text-mute-600">Đang tải đội điều hành…</p>}
      {staff.error && <p className="text-sm text-accent-700">{(staff.error as Error).message}</p>}
      {change.error && <p className="text-sm text-accent-700">{(change.error as Error).message}</p>}
      {members.length > 0 && (
        <div className="divide-y divide-line border-y border-line">
          {members.map((member) => (
            <div key={member.staffId} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  {member.displayName || member.email}
                </p>
                <p className="truncate text-xs text-mute-600">
                  {member.email} · {member.status === "active" ? "Đang hoạt động" : "Chờ đăng nhập"}
                </p>
              </div>
              <Button
                tone="neutral"
                className="min-h-10 px-3"
                disabled={change.isPending}
                onClick={() => change.mutate({ removeId: member.staffId })}
              >
                Thu hồi
              </Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function OwnershipSection({
  code,
  eventName,
}: {
  code: string;
  eventName: string;
}) {
  const { data, refresh } = useEvent();
  const account = useAccount();
  const queryClient = useQueryClient();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const user = account.data?.user ?? null;

  if (!data?.ownerClaimable || data.ownerByAccount) return null;

  if (!user) {
    return (
      <Card className="space-y-3 border-accent-600 p-5">
        <h2 className="text-balance font-semibold">Buổi cũ chưa gắn tài khoản</h2>
        <p className="text-pretty text-sm text-mute-700">
          Đăng nhập Google rồi nhập lại mật khẩu điều hành cũ để buổi này xuất hiện trong
          “Các trận đã tạo” trên mọi thiết bị.
        </p>
        {account.data?.enabled && (
          <a
            href={signInHref(`/e/${code}/admin`)}
            className="inline-flex min-h-tap items-center border border-ink px-4 font-display text-[10px] font-extrabold uppercase"
          >
            Đăng nhập Google
          </a>
        )}
      </Card>
    );
  }

  const claim = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/events/${code}/ownership`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ adminPassword: password }),
      });
      const body = (await response.json()) as { claimed?: boolean; error?: string };
      if (!response.ok || !body.claimed) {
        setError(body.error ?? "Không gắn được buổi này với tài khoản.");
        return;
      }

      rememberEvent(code, eventName);
      setDone(true);
      setPassword("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["owned-events", user.userId] }),
        queryClient.invalidateQueries({ queryKey: ["recent-events", user.userId] }),
        queryClient.invalidateQueries({ queryKey: eventQueryPrefix(code) }),
      ]);
      refresh();
    } catch {
      setError("Không nối được máy chủ. Kiểm tra mạng rồi thử lại.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-4 border-accent-600 p-5">
      <div>
        <h2 className="text-balance font-semibold">Gắn buổi cũ với tài khoản</h2>
        <p className="mt-1 text-pretty text-sm text-mute-700">
          Sau khi xác minh, buổi này sẽ thuộc {user.email} và hiện
          trên các thiết bị đăng nhập cùng Gmail.
        </p>
      </div>
      {done ? (
        <p className="text-sm font-semibold text-accent-700" role="status">
          Đã gắn với tài khoản. Danh sách đang được làm mới.
        </p>
      ) : (
        <form onSubmit={claim} className="space-y-3">
          <Field label="Nhập lại mật khẩu điều hành cũ">
            <input
              type="password"
              autoComplete="current-password"
              maxLength={200}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={inputClass}
            />
          </Field>
          {error && (
            <p className="text-pretty text-sm font-semibold text-accent-700" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" tone="primary" full disabled={busy || !password}>
            {busy ? "Đang xác minh…" : "Gắn với tài khoản"}
          </Button>
        </form>
      )}
    </Card>
  );
}

function QrSection({ code }: { code: string }) {
  const joinUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/e/${code}/join`
      : `/e/${code}/join`;

  return (
    <Card className="space-y-3 p-5 text-center">
      <h2 className="font-semibold">Mời người chơi</h2>
      <p className="text-sm text-mute-700">
        Chiếu mã này lên để mọi người quét, tự nhập tên và chọn ảnh đại diện.
      </p>
      {/* Ảnh SVG do máy chủ dựng; đường dẫn cố định nên trình duyệt giữ lại được. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/events/${code}/qr`}
        alt={`Mã QR tham gia buổi đánh ${code}`}
        className="mx-auto h-56 w-56 rounded-xl bg-white p-2"
      />
      <p className="break-all font-mono text-xs text-mute-600">{joinUrl}</p>
      <Button
        full
        onClick={() => {
          void navigator.clipboard?.writeText(joinUrl);
        }}
      >
        Sao chép đường dẫn
      </Button>
    </Card>
  );
}

/**
 * Nhật ký.
 *
 * Hiện mục 20 dòng gần nhất, mới nhất lên đầu. Đây là chỗ trả lời "ai sửa cái
 * này" khi có tranh cãi — và biết rằng nó tồn tại thường đủ để không có tranh cãi.
 */
function LogSection() {
  const { data } = useEvent();
  if (!data) return null;

  const entries = [...data.state.matches]
    .flatMap((m) =>
      m.edits.map((e) => ({
        at: e.at,
        text: `${e.by.label || "ai đó"} · vòng ${m.round} sân ${m.court} · ${
          e.from
            ? `${e.from.scoreA}-${e.from.scoreB} → ${e.to?.scoreA}-${e.to?.scoreB}`
            : (e.note ?? "thay đổi")
        }`,
      })),
    )
    .sort((a, b) => b.at - a.at)
    .slice(0, 20);

  return (
    <Card className="space-y-2 p-5">
      <h2 className="font-semibold">Nhật ký thay đổi</h2>
      {entries.length === 0 ? (
        <Empty>Chưa có thay đổi nào.</Empty>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {entries.map((e, i) => (
            <li key={i} className="flex gap-2 text-mute-700">
              <span className="shrink-0 font-mono text-xs text-mute-500">
                {new Date(e.at).toLocaleTimeString("vi-VN", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
              <span>{e.text}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function EndDialog({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("Hết giờ sân");
  const [confirmed, setConfirmed] = useState(false);

  return (
    <Dialog
      open={open}
      onClose={() => {
        setConfirmed(false);
        onClose();
      }}
      title="Kết thúc buổi đánh"
    >
      <div className="space-y-4">
        <p className="rounded-xl bg-accent-100 p-3 text-sm text-paper">
          Mọi trận chưa đánh sẽ bị huỷ và bảng xếp hạng được chốt. Không mở lại được.
        </p>

        <Field label="Lý do">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={inputClass}
          />
        </Field>

        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="h-5 w-5 accent-accent"
          />
          Tôi hiểu và muốn kết thúc buổi đánh
        </label>

        <div className="flex gap-2">
          <Button tone="ghost" full onClick={onClose}>
            Quay lại
          </Button>
          <Button
            tone="danger"
            full
            disabled={!confirmed || !reason.trim()}
            onClick={() => onConfirm(reason.trim())}
          >
            Kết thúc
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * Đặt lại mật khẩu, chỉ hiện với chủ-theo-tài-khoản.
 *
 * Cố ý **không hỏi mật khẩu cũ**. Đây chính là màn hình dành cho người đã quên
 * nó — bắt gõ lại thứ họ vừa quên thì cả khối này vô nghĩa. Quyền ở đây đến từ
 * tài khoản Google đã tạo ra buổi đánh, và máy chủ kiểm lại điều đó chứ không
 * tin vào việc trang này có được vẽ ra hay không.
 */
function PasswordSection({ code }: { code: string }) {
  const [adminPassword, setAdminPassword] = useState("");
  const [playerPassword, setPlayerPassword] = useState("");
  const [touchedPlayer, setTouchedPlayer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      const body: Record<string, string> = {};
      if (adminPassword) body.adminPassword = adminPassword;
      // Gửi cả chuỗi rỗng nếu người dùng có chạm vào ô đó: rỗng nghĩa là bỏ mật
      // khẩu người chơi, khác hẳn với không đụng tới.
      if (touchedPlayer) body.playerPassword = playerPassword;

      const res = await fetch(`/api/events/${code}/password`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const parsed = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(parsed.error ?? "Không đổi được mật khẩu.");

      setAdminPassword("");
      setPlayerPassword("");
      setTouchedPlayer(false);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không đổi được mật khẩu.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="font-semibold">Mật khẩu</h2>
        <p className="mt-1 text-sm text-mute-700">
          Bạn là chủ buổi này nhờ tài khoản Google, nên đổi được mật khẩu mà không
          cần nhớ mật khẩu cũ.
        </p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <Field label="Mật khẩu điều hành mới" hint="Để trống nếu không đổi; đổi mật khẩu sẽ vô hiệu mọi phiên dùng mật khẩu cũ.">
          <input
            type="password"
            value={adminPassword}
            onChange={(e) => setAdminPassword(e.target.value)}
            autoComplete="new-password"
            className={inputClass}
          />
        </Field>

        <Field
          label="Mật khẩu người chơi mới"
          hint="Để trống và bấm Lưu là bỏ hẳn — ai có đường dẫn cũng nhập điểm được."
        >
          <input
            type="password"
            value={playerPassword}
            onChange={(e) => {
              setPlayerPassword(e.target.value);
              setTouchedPlayer(true);
            }}
            autoComplete="new-password"
            className={inputClass}
          />
        </Field>

        {error && <p className="bg-accent p-3 text-sm text-paper">{error}</p>}
        {done && (
          <p className="border border-ink p-3 text-sm">
            Đã đổi. Mật khẩu cũ không dùng được nữa — ai đang mở buổi này bằng mật
            khẩu cũ vẫn giữ quyền tới khi họ thoát.
          </p>
        )}

        <Button
          tone="primary"
          full
          type="submit"
          disabled={busy || (adminPassword.length < 4 && !touchedPlayer)}
        >
          {busy ? "Đang lưu…" : "Lưu mật khẩu"}
        </Button>
      </form>
    </Card>
  );
}
