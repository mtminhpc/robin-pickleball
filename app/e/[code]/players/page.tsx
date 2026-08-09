"use client";

/**
 * Danh sách người chơi và hàng chờ duyệt.
 *
 * Hàng chờ là một KHỐI ĐỎ ĐẶC trên cùng, không phải một mục như những mục khác:
 * sau khi buổi đánh bắt đầu, người mới tới đang đứng ngay đó chờ được xếp vào.
 * Chôn nút duyệt xuống dưới đồng nghĩa với bắt họ đứng chờ thêm vài vòng.
 */

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import type { Player, PlayerStatus } from "@/lib/domain/types";
import { PLAYER_STATUS_SHORT } from "@/lib/domain/labels";
import { useEvent } from "@/hooks/useEventState";
import { useMutationQueue } from "@/hooks/useMutationQueue";
import { Avatar } from "@/components/Avatar";
import {
  Button,
  Empty,
  InkNote,
  Marker,
  SectionHead,
  inputClass,
} from "@/components/ui";

/** Thứ tự hiển thị: ai cần chú ý nhất lên trước. */
const ORDER: PlayerStatus[] = [
  "pendingApproval",
  "active",
  "confirmed",
  "invited",
  "paused",
  "left",
  "declined",
  "rejected",
];

export default function PlayersPage() {
  const { code } = useParams<{ code: string }>();
  const { data } = useEvent();
  const queue = useMutationQueue();
  const [newName, setNewName] = useState("");

  const groups = useMemo(() => {
    const players = data?.state.players ?? [];
    return ORDER.map((status) => ({
      status,
      players: players.filter((p) => p.status === status),
    })).filter((g) => g.players.length > 0);
  }, [data]);

  if (!data) return null;
  const { state, role } = data;
  const isAdmin = role === "admin";
  const waiting = state.players.filter((p) => p.status === "pendingApproval");

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)] lg:items-start lg:gap-12">
      <div>
        {isAdmin && waiting.length > 0 && (
          <div className="mt-6 bg-accent p-4 text-paper">
            <p className="eyebrow mb-3 font-normal">
              {waiting.length} người xin vào
            </p>
            {waiting.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-2.5 py-1">
                <span className="min-w-[7.5rem] flex-1 font-display text-xl font-extrabold tracking-[-0.02em]">
                  {p.name}
                </span>
                <Button
                  className="min-h-11 flex-none border-paper text-paper hover:bg-paper/20"
                  onClick={() => queue.send({ type: "RejectJoin", playerId: p.id })}
                >
                  Từ chối
                </Button>
                <Button
                  className="min-h-11 flex-none border-paper bg-paper text-accent hover:bg-paper/90"
                  onClick={() => queue.send({ type: "ApproveJoin", playerId: p.id })}
                >
                  Duyệt
                </Button>
              </div>
            ))}
          </div>
        )}

        {isAdmin && (
          <>
            <SectionHead n="01">Thêm người</SectionHead>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const name = newName.trim();
                if (!name) return;
                queue.send({
                  type: "AddPlayer",
                  player: {
                    id: `p-${crypto.randomUUID().slice(0, 8)}`,
                    name,
                    avatarId: "",
                  },
                  // Chủ sân gõ tên ai đó ngay tại sân nghĩa là người đó đang có
                  // mặt. Bắt bấm thêm một nút "đã đến" nữa cho từng người là thừa.
                  asActive: true,
                });
                setNewName("");
              }}
              className="mb-1.5 mt-3.5 flex gap-2"
            >
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Thêm nhanh bằng tên"
                className={inputClass}
              />
              <Button tone="primary" type="submit" disabled={!newName.trim()}>
                Thêm
              </Button>
            </form>
            <p className="text-[11px] text-mute-600">
              Hoặc để mọi người tự quét mã QR ở trang Quản lý — họ tự chọn tên và
              ảnh.
            </p>
          </>
        )}

        {groups.length === 0 ? (
          <div className="pt-6">
            <Empty>Chưa có ai. Chia sẻ mã QR để mọi người tự vào.</Empty>
          </div>
        ) : (
          groups.map((group) => (
            <section key={group.status}>
              <SectionHead aside={String(group.players.length)}>
                {PLAYER_STATUS_SHORT[group.status]}
              </SectionHead>
              {group.players.map((p) => (
                <PlayerRow
                  key={p.id}
                  player={p}
                  isAdmin={isAdmin}
                  isMe={p.deviceId === data.deviceId}
                  onCommand={queue.send}
                />
              ))}
            </section>
          ))
        )}

        {!isAdmin && (
          <p className="pt-6 text-center text-[11px] text-mute-600">
            Cần mật khẩu chủ sự kiện để thêm, duyệt hoặc sửa danh sách. Mã buổi
            đánh: <span className="font-semibold">{code}</span>
          </p>
        )}
      </div>

      <div className="pt-6">
        <InkNote title="Suất kỳ vọng, không phải số trận">
          Người tới vòng thứ chín không nợ tám trận, họ chỉ chưa có mặt. Cột Lệch
          của họ bằng 0 từ lúc đặt chân tới sân.
        </InkNote>
      </div>
    </div>
  );
}

function PlayerRow({
  player,
  isAdmin,
  isMe,
  onCommand,
}: {
  player: Player;
  isAdmin: boolean;
  isMe: boolean;
  onCommand: ReturnType<typeof useMutationQueue>["send"];
}) {
  const dimmed = player.status === "left" || player.status === "declined";

  return (
    <div className="flex items-center gap-3 border-b border-line py-2.5">
      <Avatar
        name={player.name}
        avatarId={player.avatarId}
        userId={player.userId}
        dimmed={dimmed}
        size="sm"
      />
      <span
        className={`min-w-0 flex-1 truncate text-[15px] font-semibold ${
          dimmed ? "opacity-55" : ""
        }`}
      >
        {player.name}
      </span>
      {isMe && <Marker tone="accent">bạn</Marker>}

      {isAdmin && (
        <div className="flex flex-none gap-1.5">
          {player.status === "active" && (
            <>
              <Button
                className="min-h-10 border-line px-3"
                onClick={() => onCommand({ type: "PausePlayer", playerId: player.id })}
              >
                Nghỉ
              </Button>
              <Button
                className="min-h-10 border-line px-3"
                onClick={() => onCommand({ type: "PlayerLeft", playerId: player.id })}
              >
                Về rồi
              </Button>
            </>
          )}
          {(player.status === "invited" || player.status === "confirmed") && (
            <Button
              className="min-h-10 px-3"
              onClick={() => onCommand({ type: "MarkArrived", playerId: player.id })}
            >
              Đã đến
            </Button>
          )}
          {(player.status === "paused" || player.status === "left") && (
            <Button
              className="min-h-10 px-3"
              onClick={() =>
                onCommand(
                  player.status === "paused"
                    ? { type: "ResumePlayer", playerId: player.id }
                    : { type: "MarkArrived", playerId: player.id },
                )
              }
            >
              Quay lại
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
