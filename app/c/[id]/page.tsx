"use client";

/**
 * Trang câu lạc bộ: danh bạ, mã mời, và nút tạo buổi đánh.
 *
 * Lý do câu lạc bộ tồn tại nằm gọn ở nút **Tạo buổi đánh** cuối trang: nhóm chơi
 * cố định mười lăm người thì tuần nào chủ sân cũng gõ lại mười lăm cái tên. Ở đây
 * bấm một cái là xong.
 */

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { isClubOwner } from "@/lib/domain/club";
import { rememberClub } from "@/lib/identity/device";
import { useClub, useClubMutation } from "@/hooks/useClub";
import { Avatar } from "@/components/Avatar";
import { AvatarPicker } from "@/components/AvatarPicker";
import { Button, Card, Dialog, Empty, Field, inputClass, Tag } from "@/components/ui";
import { useEffect } from "react";
import { estimateEvent, formatEstimatedDuration } from "@/lib/domain/estimate";
import { scheduledAtFromInputs } from "@/lib/scheduled-at";

export default function ClubPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data, isLoading, error } = useClub(id);
  const mutate = useClubMutation(id);

  const [editing, setEditing] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [creating, setCreating] = useState(false);

  // Nhớ lại để trang chủ bấm một cái là vào được, khỏi nhớ mã.
  useEffect(() => {
    if (data) rememberClub(data.club.id, data.club.name);
  }, [data]);

  if (isLoading) return <Empty>Đang tải…</Empty>;
  if (error) return <Empty>{error.message}</Empty>;
  if (!data) return null;

  const { club, members, me, role } = data;
  const isOwner = role === "owner";

  return (
    <main className="mx-auto min-h-dvh max-w-md space-y-6 px-4 py-8">
      <header className="space-y-1">
        <Link href="/" className="text-sm text-mute-600 hover:text-mute-800">
          ← Trang chủ
        </Link>
        <h1 className="text-2xl font-bold">{club.name}</h1>
        <p className="text-sm text-mute-700">
          {members.length} người trong danh bạ
          {isOwner && " · bạn là người tạo"}
        </p>
      </header>

      {!me && (
        <Card className="space-y-3 border-accent-700 p-4">
          <p className="text-sm text-mute-800">
            Bạn chưa có tên trong danh bạ này.
          </p>
          <Button tone="primary" full onClick={() => router.push(`/c/${club.inviteCode}/join`)}>
            Thêm tên tôi vào
          </Button>
        </Card>
      )}

      <section className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-mute-700">
            Danh bạ
          </h2>
          <button
            className="text-sm text-accent-700 hover:underline"
            onClick={() => setShowInvite(true)}
          >
            Mời thêm người
          </button>
        </div>

        {members.map((m) => (
          <Card key={m.memberId} className="flex items-center gap-3 p-3">
            <Avatar name={m.displayName} avatarId={m.avatarId} userId={m.userId} />
            <span className="min-w-0 flex-1 truncate font-medium">{m.displayName}</span>
            {m.memberId === me?.memberId && <Tag tone="ok">bạn</Tag>}
            {isClubOwner(club, { deviceId: m.deviceId, userId: m.userId }) && (
              <Tag>người tạo</Tag>
            )}
            {(isOwner || m.memberId === me?.memberId) && (
              <button
                className="shrink-0 px-2 text-sm text-mute-700 hover:text-ink"
                onClick={() => setEditing(m.memberId)}
              >
                Sửa
              </button>
            )}
          </Card>
        ))}
      </section>

      <div className="space-y-2">
        <Button tone="primary" full onClick={() => setCreating(true)}>
          Tạo buổi đánh cho câu lạc bộ
        </Button>
        <Link href={`/c/${club.id}/summary`} className="block">
          <Button full>Tổng kết tuần / tháng</Button>
        </Link>
      </div>

      <InviteDialog
        open={showInvite}
        clubId={club.id}
        inviteCode={club.inviteCode}
        canRotate={isOwner}
        rotating={mutate.isPending}
        onRotate={() => mutate.mutate({ body: { rotateInvite: true } })}
        onClose={() => setShowInvite(false)}
      />
      <EditMemberDialog
        member={members.find((m) => m.memberId === editing) ?? null}
        canRemove={isOwner && editing !== me?.memberId}
        pending={mutate.isPending}
        error={mutate.error?.message ?? null}
        onClose={() => {
          setEditing(null);
          mutate.reset();
        }}
        onSave={(body) =>
          mutate.mutate(
            { path: "/members", body },
            { onSuccess: () => setEditing(null) },
          )
        }
      />
      {creating && (
        <CreateFromClubDialog
          clubId={club.id}
          clubName={club.name}
          expectedCount={Math.max(4, members.length)}
          defaultCourts={club.settings.defaultCourts}
          onClose={() => setCreating(false)}
        />
      )}
    </main>
  );
}

/**
 * Mã QR và mã mời, kèm nút đổi mã cho chủ câu lạc bộ.
 *
 * Mã mời không hết hạn và dùng được vô số lần — chiếu lên tường sân cho hai mươi
 * người cùng quét thì buộc phải như vậy. Cái giá là nó sống mãi: ai chụp màn
 * hình gửi lung tung, hay người đã rời nhóm, đều còn đường quay lại. Nút đổi mã
 * là cách khoá cửa lại, và có hỏi lại một câu vì mã cũ chết ngay lập tức — kể cả
 * tờ giấy đang dán ở sân.
 */
function InviteDialog({
  open,
  clubId,
  inviteCode,
  canRotate,
  rotating,
  onRotate,
  onClose,
}: {
  open: boolean;
  clubId: string;
  inviteCode: string;
  canRotate: boolean;
  rotating: boolean;
  onRotate: () => void;
  onClose: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  if (!open) return null;

  return (
    <Dialog open onClose={onClose} title="Mời vào câu lạc bộ">
      <div className="space-y-4">
        <p className="text-sm text-mute-700">
          Cho mọi người quét mã, hoặc đọc mã mời cho họ gõ vào.
        </p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          // `inviteCode` trong đường dẫn không phải để máy chủ đọc mà để trình
          // duyệt biết đây là ảnh khác sau khi đổi mã — thiếu nó thì ảnh cũ nằm
          // lại trong bộ đệm và người ta quét phải mã vừa bị khai tử.
          src={`/api/clubs/${encodeURIComponent(clubId)}/qr?v=${inviteCode}`}
          alt="Mã QR mời vào câu lạc bộ"
          className="mx-auto w-56 rounded-xl bg-white p-3"
        />
        <p className="text-center font-mono text-2xl tracking-[0.3em]">{inviteCode}</p>

        {canRotate && !confirming && (
          <button
            className="w-full text-sm text-mute-700 hover:text-ink"
            onClick={() => setConfirming(true)}
          >
            Đổi mã mời
          </button>
        )}

        {confirming && (
          <div className="space-y-3 rounded-xl bg-accent-100 p-3">
            <p className="text-sm text-accent-800">
              Mã <span className="font-mono">{inviteCode}</span> sẽ hết dùng được
              ngay, kể cả mã QR đã in ra dán ở sân. Danh bạ giữ nguyên — đổi mã
              chỉ chặn người mới vào, không đuổi ai đang ở trong.
            </p>
            <div className="flex gap-2">
              <Button className="flex-1" onClick={() => setConfirming(false)}>
                Thôi
              </Button>
              <Button
                tone="danger"
                className="flex-1"
                disabled={rotating}
                onClick={() => {
                  onRotate();
                  setConfirming(false);
                }}
              >
                {rotating ? "Đang đổi…" : "Đổi mã"}
              </Button>
            </div>
          </div>
        )}

        <Button full onClick={onClose}>
          Xong
        </Button>
      </div>
    </Dialog>
  );
}

function EditMemberDialog({
  member,
  canRemove,
  pending,
  error,
  onClose,
  onSave,
}: {
  member: { memberId: string; displayName: string; avatarId: string } | null;
  canRemove: boolean;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (body: Record<string, unknown>) => void;
}) {
  const [name, setName] = useState("");
  const [avatarId, setAvatarId] = useState<string | undefined>();

  useEffect(() => {
    if (member) {
      setName(member.displayName);
      setAvatarId(member.avatarId);
    }
  }, [member]);

  if (!member) return null;

  return (
    <Dialog open onClose={onClose} title="Sửa thông tin">
      <div className="space-y-4">
        <Field label="Tên">
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
          />
        </Field>
        <AvatarPicker name={name} value={avatarId} onChange={setAvatarId} />

        {error && (
          <p className="rounded-xl bg-accent-100 p-3 text-sm text-paper">{error}</p>
        )}

        <div className="flex gap-2">
          <Button tone="ghost" full onClick={onClose} disabled={pending}>
            Quay lại
          </Button>
          <Button
            tone="primary"
            full
            disabled={pending || name.trim() === ""}
            onClick={() =>
              onSave({ memberId: member.memberId, displayName: name, avatarId })
            }
          >
            {pending ? "Đang lưu…" : "Lưu"}
          </Button>
        </div>

        {canRemove && (
          <Button
            tone="danger"
            full
            disabled={pending}
            onClick={() => onSave({ memberId: member.memberId, remove: true })}
          >
            Gỡ khỏi danh bạ
          </Button>
        )}
      </div>
    </Dialog>
  );
}

/**
 * Tạo buổi đánh với cả danh bạ điền sẵn.
 *
 * Mọi người vào ở trạng thái "đã mời" chứ không phải "đang chơi": hôm nay ai đi
 * ai không thì phải hỏi, không được đoán. Xem `/e/[mã]/players` để điểm danh.
 */
function CreateFromClubDialog({
  clubId,
  clubName,
  expectedCount,
  defaultCourts,
  onClose,
}: {
  clubId: string;
  clubName: string;
  expectedCount: number;
  defaultCourts: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const today = useMemo(
    () => new Date().toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" }),
    [],
  );
  const [name, setName] = useState(`${clubName} ${today}`);
  const [venueAddress, setVenueAddress] = useState("");
  const [expectedPlayers, setExpectedPlayers] = useState(expectedCount);
  const [courts, setCourts] = useState(defaultCourts);
  const [targetGamesPerPlayer, setTargetGamesPerPlayer] = useState(6);
  const [estimatedMatchMinutes, setEstimatedMatchMinutes] = useState(15);
  const [courtTurnoverMinutes, setCourtTurnoverMinutes] = useState(3);
  const [scheduledTime, setScheduledTime] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [playerPassword, setPlayerPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const schedule = scheduledAtFromInputs(scheduledDate, scheduledTime);
  const estimate = estimateEvent({ players: expectedPlayers, courts, targetGamesPerPlayer, matchMinutes: estimatedMatchMinutes, turnoverMinutes: courtTurnoverMinutes });

  async function submit() {
    if (schedule.error) { setError(schedule.error); return; }
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, venueAddress, clubId, courts, expectedPlayers, targetGamesPerPlayer, estimatedMatchMinutes, courtTurnoverMinutes, scheduledAt: schedule.value, adminPassword, playerPassword }),
      });
      const body = (await res.json()) as { code?: string; error?: string };
      if (!res.ok || !body.code) throw new Error(body.error ?? "Không tạo được buổi đánh.");
      router.push(`/e/${body.code}/players`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tạo được buổi đánh.");
      setPending(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title="Tạo buổi đánh">
      <div className="space-y-4">
        <p className="text-sm text-mute-700">
          Cả danh bạ sẽ được thêm sẵn vào buổi này ở trạng thái <strong>đã mời</strong>.
          Ai xác nhận đi thì điểm danh ở trang Người chơi, không cần gõ lại tên ai.
        </p>
        <Field label="Tên sự kiện">
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Địa chỉ sân"><input className={inputClass} value={venueAddress} maxLength={200} onChange={(event) => setVenueAddress(event.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Giờ bắt đầu"><input type="time" step={60} className={inputClass} value={scheduledTime} onChange={(event) => setScheduledTime(event.target.value)} /></Field>
          <Field label="Ngày diễn ra"><input type="date" className={inputClass} value={scheduledDate} onChange={(event) => setScheduledDate(event.target.value)} /></Field>
          <Field label="Số người dự kiến"><input type="number" min={4} max={200} className={inputClass} value={expectedPlayers} onChange={(event) => setExpectedPlayers(Number(event.target.value))} /></Field>
          <Field label="Số sân"><input type="number" min={1} max={8} className={inputClass} value={courts} onChange={(event) => setCourts(Number(event.target.value))} /></Field>
          <Field label="Trận/người"><input type="number" min={1} max={50} className={inputClass} value={targetGamesPerPlayer} onChange={(event) => setTargetGamesPerPlayer(Number(event.target.value))} /></Field>
          <Field label="Phút/trận"><input type="number" min={5} max={180} className={inputClass} value={estimatedMatchMinutes} onChange={(event) => setEstimatedMatchMinutes(Number(event.target.value))} /></Field>
          <Field label="Phút đổi sân"><input type="number" min={0} max={60} className={inputClass} value={courtTurnoverMinutes} onChange={(event) => setCourtTurnoverMinutes(Number(event.target.value))} /></Field>
        </div>
        {schedule.error && <p className="text-xs text-accent-700">{schedule.error}</p>}
        {estimate && (
          <div className="border-l-4 border-accent bg-surface p-3 text-xs leading-relaxed">
            <p className="font-semibold">Ước tính {estimate.totalMatches} trận · {formatEstimatedDuration(estimate.durationMinutes)}</p>
            <p className="mt-1 text-mute-600">
              Khoảng {estimate.minGamesPerPlayer}–{estimate.maxGamesPerPlayer} trận/người, {estimate.usableCourts} sân sử dụng,
              {" "}{estimate.waves} lượt sân; chờ trung bình khoảng {estimate.averageWaitMinutes} phút.
            </p>
            <p className="mt-1 text-[10px] text-mute-600">
              Dựa trên {estimatedMatchMinutes} phút/trận và {courtTurnoverMinutes} phút đổi sân. Người đến muộn,
              nghỉ hoặc trận kéo dài sẽ làm thay đổi thực tế; ước tính không tác động thuật toán công bằng.
            </p>
          </div>
        )}
        <Field label="Mật khẩu điều hành" hint="Quyền dự phòng để phối hợp tại sân; không quản lý Phó, tài trợ hoặc kết thúc sớm.">
          <input
            className={inputClass}
            type="password"
            value={adminPassword}
            onChange={(e) => setAdminPassword(e.target.value)}
          />
        </Field>
        <Field
          label="Mật khẩu người chơi"
          hint="Để trống thì ai có đường dẫn cũng nhập được điểm."
        >
          <input
            className={inputClass}
            type="password"
            value={playerPassword}
            onChange={(e) => setPlayerPassword(e.target.value)}
          />
        </Field>

        {error && (
          <p className="rounded-xl bg-accent-100 p-3 text-sm text-paper">{error}</p>
        )}

        <div className="flex gap-2">
          <Button tone="ghost" full onClick={onClose} disabled={pending}>
            Quay lại
          </Button>
          <Button
            tone="primary"
            full
            disabled={pending || adminPassword.length < 4 || name.trim().length < 2}
            onClick={submit}
          >
            {pending ? "Đang tạo…" : "Tạo"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
