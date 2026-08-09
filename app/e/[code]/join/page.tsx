"use client";

/**
 * Tự tham gia — đích của mã QR dán ở sân.
 *
 * Ba đường vào, xếp theo thứ tự người chơi hay gặp nhất:
 *
 *   1. Tên mình đã có sẵn trong danh sách (chủ sân gõ trước) → bấm "Đây là tôi"
 *      để nhận, rồi đổi ảnh nếu muốn.
 *   2. Chưa có tên → gõ tên, chọn ảnh, tham gia.
 *   3. Đã tham gia rồi, quay lại → nhận ra ngay và cho vào thẳng. Từ cùng máy
 *      thì nhận ra qua máy; đã đăng nhập thì nhận ra trên máy nào cũng được.
 *
 * Câu hỏi "ai trong danh sách này là tôi" do **máy chủ** trả lời chứ không phải
 * trang này tự dò: cookie tài khoản là `httpOnly` nên trình duyệt không đọc
 * được, và người vừa đổi điện thoại thì cũng chẳng có mã máy nào để dò.
 *
 * Trước giờ bắt đầu thì vào thẳng. Sau khi chủ sân bấm Bắt đầu thì mọi người vào
 * thêm đều rơi vào hàng chờ duyệt — đúng như đã chốt ở mục 20.
 */

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type { PlayerSeed } from "@/lib/domain/commands";
import { loadProfile, readDeviceId, saveProfile } from "@/lib/identity/device";
import { useEvent } from "@/hooks/useEventState";
import { useMutationQueue } from "@/hooks/useMutationQueue";
import { Avatar } from "@/components/Avatar";
import { AvatarPicker } from "@/components/AvatarPicker";
import { PLAYER_STATUS_LABEL } from "@/lib/domain/labels";
import { Button, Card, Field, inputClass } from "@/components/ui";

export default function JoinPage() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const { data } = useEvent();
  const queue = useMutationQueue();

  const [name, setName] = useState("");
  const [avatarId, setAvatarId] = useState<string | undefined>();
  const [claiming, setClaiming] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  // Máy này đã dùng lần trước thì tự điền lại, khỏi gõ tên mỗi buổi.
  useEffect(() => {
    const profile = loadProfile();
    if (profile) {
      setName(profile.name);
      setAvatarId(profile.avatarId);
    }
  }, []);

  const deviceId = data?.deviceId || readDeviceId() || "";

  const mine = useMemo(
    () => data?.state.players.find((p) => p.id === data.myPlayerId),
    [data],
  );

  // Những người chủ sân đã gõ sẵn mà chưa máy nào nhận — có thể là mình.
  const unclaimed = useMemo(
    () =>
      (data?.state.players ?? []).filter(
        (p) =>
          !p.deviceId &&
          p.id !== data?.myPlayerId &&
          p.status !== "left" &&
          p.status !== "rejected" &&
          p.status !== "declined",
      ),
    [data],
  );

  if (!data) return null;
  const { state } = data;
  const afterStart = state.status !== "draft";

  if (mine) {
    return (
      <Card className="space-y-4 p-5 text-center">
        <div className="flex justify-center">
          <Avatar name={mine.name} avatarId={mine.avatarId} size="lg" />
        </div>
        <div>
          <p className="text-lg font-semibold">{mine.name}</p>
          <p className="text-sm text-mute-700">{PLAYER_STATUS_LABEL[mine.status]}</p>
        </div>
        <Button tone="primary" full onClick={() => router.push(`/e/${code}`)}>
          Vào xem trận
        </Button>
      </Card>
    );
  }

  if (sent) {
    return (
      <Card className="space-y-3 p-5 text-center">
        <p className="text-lg font-semibold">
          {afterStart ? "Đã gửi yêu cầu tham gia" : "Đã ghi tên bạn"}
        </p>
        <p className="text-sm text-mute-700">
          {afterStart
            ? "Buổi đánh đã bắt đầu nên chủ sân cần duyệt. Bạn sẽ được xếp vào vòng gần nhất sau khi được duyệt."
            : "Chủ sân bấm Bắt đầu là hệ thống xếp lịch cho cả nhóm."}
        </p>
        <Button tone="primary" full onClick={() => router.push(`/e/${code}`)}>
          Xem trận đang đánh
        </Button>
      </Card>
    );
  }

  const submit = (claimId?: string) => {
    const trimmed = name.trim();
    if (trimmed.length < 1) return;

    saveProfile({ name: trimmed, avatarId: avatarId ?? "" });

    if (claimId) {
      // Một lệnh, không phải hai: `ClaimPlayer` vừa đổi tên/ảnh vừa gắn máy này
      // vào ô tên. Máy chủ tự điền mã máy và mã tài khoản, trang này không gửi
      // lên — và cũng không được phép gửi.
      queue.send({
        type: "ClaimPlayer",
        playerId: claimId,
        name: trimmed,
        avatarId: avatarId ?? "",
      });
    } else {
      const seed: PlayerSeed = {
        id: `p-${crypto.randomUUID().slice(0, 8)}`,
        name: trimmed,
        avatarId: avatarId ?? "",
        deviceId,
      };
      queue.send({ type: "RequestJoin", player: seed });
    }
    setSent(true);
  };

  return (
    <div className="space-y-4">
      {afterStart && (
        <p className="rounded-xl bg-accent-100 p-3 text-sm text-accent-800">
          Buổi đánh đã bắt đầu. Chủ sân sẽ cần duyệt trước khi bạn được xếp lịch.
        </p>
      )}

      {unclaimed.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-mute-700">
            Tên bạn đã có sẵn?
          </h2>
          <div className="flex flex-wrap gap-2">
            {unclaimed.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setClaiming(p.id);
                  setName(p.name);
                }}
                className={`flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-sm ${
                  claiming === p.id ? "bg-accent text-white" : "bg-surface"
                }`}
              >
                <Avatar name={p.name} avatarId={p.avatarId} size="sm" />
                {p.name}
              </button>
            ))}
          </div>
          {claiming && (
            <p className="text-xs text-mute-600">
              Đang nhận tên này. Bấm lần nữa vào tên khác nếu chọn nhầm.
            </p>
          )}
        </section>
      )}

      <Card className="space-y-4 p-5">
        <Field label="Tên của bạn" hint="Tên gọi ở sân là được, không cần tên đầy đủ.">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nam"
            className={inputClass}
          />
        </Field>

        <div>
          <span className="mb-2 block text-sm font-medium text-mute-800">
            Ảnh đại diện
          </span>
          <AvatarPicker name={name} value={avatarId} onChange={setAvatarId} />
        </div>

        <Button
          tone="primary"
          full
          disabled={name.trim().length < 1}
          onClick={() => submit(claiming ?? undefined)}
        >
          {claiming ? "Đây là tôi" : afterStart ? "Xin tham gia" : "Tham gia"}
        </Button>
      </Card>
    </div>
  );
}
