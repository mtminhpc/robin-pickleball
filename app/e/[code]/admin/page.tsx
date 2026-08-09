"use client";

/**
 * Trang quản lý: mã QR, bắt đầu, cấu hình, nhật ký, kết thúc.
 *
 * Nút kết thúc sớm nằm cuối cùng và cần hai bước xác nhận. Nó huỷ toàn bộ trận
 * chưa đánh và khoá sự kiện lại vĩnh viễn, nên đặt nó cạnh các nút thường dùng
 * là mời gọi tai nạn.
 */

import { useState } from "react";
import { useParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { firstUnplayedRound } from "@/lib/domain/rounds";
import { eventQueryKey, useEvent } from "@/hooks/useEventState";
import { useMutationQueue } from "@/hooks/useMutationQueue";
import { signInHref, useAccount } from "@/hooks/useAccount";
import { rememberEvent } from "@/lib/identity/device";
import { PasswordGate } from "@/components/PasswordGate";
import { Button, Card, Dialog, Empty, Field, inputClass } from "@/components/ui";
import { SponsorManager } from "@/components/SponsorManager";

export default function AdminPage() {
  const { code } = useParams<{ code: string }>();
  const { data } = useEvent();
  const queue = useMutationQueue();
  const [ending, setEnding] = useState(false);

  if (!data) return null;
  const { state, role } = data;

  if (role !== "admin") {
    return (
      <div className="space-y-4">
        <p className="text-sm text-mute-700">
          Trang này cần mật khẩu chủ sự kiện.
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
      {state.status === "draft" && (
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

      {data.ownerByAccount && <PasswordSection code={code} />}

      <SponsorManager code={code} />

      <Card className="space-y-4 p-5">
        <h2 className="font-semibold">Cấu hình</h2>
        <Field
          label="Số sân"
          hint="Đổi giữa chừng thì phần lịch chưa đánh sẽ được xếp lại."
        >
          <input
            type="number"
            min={1}
            max={8}
            defaultValue={state.config.courts}
            onBlur={(e) => {
              const courts = Number(e.target.value);
              if (courts >= 1 && courts <= 8 && courts !== state.config.courts) {
                queue.send({ type: "UpdateConfig", patch: { courts } });
              }
            }}
            className={inputClass}
          />
        </Field>

        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={state.config.countPartialMatches}
            onChange={(e) =>
              queue.send({
                type: "UpdateConfig",
                patch: { countPartialMatches: e.target.checked },
              })
            }
            className="mt-0.5 h-5 w-5 shrink-0 accent-accent"
          />
          <span>
            Tính trận dở dang vào bảng xếp hạng
            <span className="block text-xs text-mute-600">
              Trận bị bỏ giữa chừng nhưng có ghi tỷ số.
            </span>
          </span>
        </label>
      </Card>

      <LogSection />

      {state.status === "running" && (
        <Card className="space-y-3 border-line p-5">
          <h2 className={`font-semibold ${openMatches > 0 ? "text-accent-700" : ""}`}>
            {openMatches > 0 ? "Kết thúc sớm" : "Hoàn tất buổi đánh"}
          </h2>
          {openMatches > 0 ? (
            <>
              <p className="text-sm text-mute-700">
                Huỷ toàn bộ trận chưa đánh và chốt bảng xếp hạng. Không mở lại được.
                Hiện còn {openMatches} trận mở từ vòng {firstUnplayedRound(state)}.
              </p>
              <Button tone="danger" full onClick={() => setEnding(true)}>Kết thúc sớm</Button>
            </>
          ) : (
            <>
              <p className="text-sm text-mute-700">Không còn trận nào chờ hoặc đang đánh. Bạn có thể chốt kết quả bình thường để mở phần Trao giải.</p>
              <Button tone="primary" full onClick={() => queue.send({ type: "FinishEvent" })}>Hoàn tất &amp; mở trao giải</Button>
            </>
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
          Đăng nhập Google rồi nhập lại mật khẩu chủ để buổi này xuất hiện trong
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
        queryClient.invalidateQueries({ queryKey: eventQueryKey(code) }),
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
          <Field label="Nhập lại mật khẩu chủ sự kiện">
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
        <Field label="Mật khẩu chủ sự kiện mới" hint="Để trống nếu không đổi.">
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
