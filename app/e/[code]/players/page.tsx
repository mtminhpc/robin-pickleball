"use client";

/**
 * Danh sách người chơi và hàng chờ duyệt.
 *
 * Hàng chờ nằm trên cùng và có màu nổi: sau khi buổi đánh bắt đầu, người mới tới
 * đang đứng ngay đó chờ được xếp vào. Chôn nút duyệt xuống dưới đồng nghĩa với
 * bắt họ đứng chờ thêm vài vòng.
 */

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import type { Player, PlayerStatus } from "@/lib/domain/types";
import { PLAYER_STATUS_SHORT } from "@/lib/domain/labels";
import { useEvent } from "@/hooks/useEventState";
import { useMutationQueue } from "@/hooks/useMutationQueue";
import { Avatar } from "@/components/Avatar";
import { Button, Card, Empty, Tag, inputClass } from "@/components/ui";

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
    <div className="space-y-5">
      {isAdmin && waiting.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-300">
            🔔 {waiting.length} người xin vào
          </h2>
          {waiting.map((p) => (
            <Card key={p.id} className="flex items-center gap-3 border-amber-500/40 p-3">
              <Avatar name={p.name} avatarId={p.avatarId} />
              <span className="flex-1 truncate font-medium">{p.name}</span>
              <Button
                tone="ghost"
                onClick={() => queue.send({ type: "RejectJoin", playerId: p.id })}
              >
                Từ chối
              </Button>
              <Button
                tone="primary"
                onClick={() => queue.send({ type: "ApproveJoin", playerId: p.id })}
              >
                Duyệt
              </Button>
            </Card>
          ))}
        </section>
      )}

      {isAdmin && (
        <Card className="space-y-3 p-4">
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
                // Chủ sân gõ tên ai đó ngay tại sân nghĩa là người đó đang có mặt.
                // Bắt bấm thêm một nút "đã đến" nữa cho từng người là thừa.
                asActive: true,
              });
              setNewName("");
            }}
            className="flex gap-2"
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
          <p className="text-xs text-slate-500">
            Hoặc để mọi người tự quét mã QR ở trang Quản lý — họ tự chọn tên và ảnh.
          </p>
        </Card>
      )}

      {groups.length === 0 ? (
        <Empty>Chưa có ai. Chia sẻ mã QR để mọi người tự vào.</Empty>
      ) : (
        groups.map((group) => (
          <section key={group.status} className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
              {PLAYER_STATUS_SHORT[group.status]} · {group.players.length}
            </h2>
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
        <p className="pb-4 text-center text-xs text-slate-500">
          Cần mật khẩu chủ sự kiện để thêm, duyệt hoặc sửa danh sách. Mã buổi đánh:{" "}
          <span className="font-mono">{code}</span>
        </p>
      )}
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
    <Card className="flex items-center gap-3 p-3">
      <Avatar name={player.name} avatarId={player.avatarId} dimmed={dimmed} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`truncate font-medium ${dimmed ? "text-slate-500" : ""}`}>
            {player.name}
          </span>
          {isMe && <Tag tone="ok">bạn</Tag>}
        </div>
      </div>

      {isAdmin && (
        <div className="flex shrink-0 gap-1.5">
          {player.status === "active" && (
            <>
              <Button
                tone="ghost"
                className="px-3 text-sm"
                onClick={() => onCommand({ type: "PausePlayer", playerId: player.id })}
              >
                Nghỉ
              </Button>
              <Button
                tone="ghost"
                className="px-3 text-sm"
                onClick={() => onCommand({ type: "PlayerLeft", playerId: player.id })}
              >
                Về rồi
              </Button>
            </>
          )}
          {(player.status === "invited" || player.status === "confirmed") && (
            <Button
              tone="primary"
              className="px-3 text-sm"
              onClick={() => onCommand({ type: "MarkArrived", playerId: player.id })}
            >
              Đã đến
            </Button>
          )}
          {(player.status === "paused" || player.status === "left") && (
            <Button
              tone="primary"
              className="px-3 text-sm"
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
    </Card>
  );
}
