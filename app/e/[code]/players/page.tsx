"use client";

/**
 * Danh sách người chơi và hàng chờ duyệt.
 *
 * Hàng chờ là một KHỐI ĐỎ ĐẶC trên cùng, không phải một mục như những mục khác:
 * sau khi buổi đánh bắt đầu, người mới tới đang đứng ngay đó chờ được xếp vào.
 * Chôn nút duyệt xuống dưới đồng nghĩa với bắt họ đứng chờ thêm vài vòng.
 *
 * Mỗi hàng phục vụ hai người khác nhau, và họ thấy hai bộ nút khác nhau:
 *
 *   • **Chủ sự kiện** quản được mọi người — kể cả người không mang điện thoại,
 *     vốn là lý do có nút Sửa và Xoá ở đây. Trước bản này hai lệnh `UpdateProfile`
 *     và `RemovePlayer` đã tồn tại mà **không nút nào gọi tới**.
 *   • **Chính chủ** làm được ba việc về mình: đổi tên/ảnh, xin nghỉ hoặc báo về,
 *     và khai trước mấy giờ phải về. Ba việc đó không cần mật khẩu nào cả —
 *     người biết mình mấy giờ về là chính họ. Xem `isAllowedForActor`.
 */

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import type { Command } from "@/lib/domain/commands";
import type { Player, PlayerStatus } from "@/lib/domain/types";
import { PLAYER_STATUS_SHORT } from "@/lib/domain/labels";
import { firstUnplayedRound } from "@/lib/domain/rounds";
import { useEvent } from "@/hooks/useEventState";
import { useMutationQueue } from "@/hooks/useMutationQueue";
import { Avatar } from "@/components/Avatar";
import { AvatarPicker } from "@/components/AvatarPicker";
import { PhotoPicker } from "@/components/PhotoPicker";
import {
  Button,
  Dialog,
  Empty,
  Field,
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
  const [editing, setEditing] = useState<Player | null>(null);
  const [removing, setRemoving] = useState<Player | null>(null);
  const [declaring, setDeclaring] = useState<Player | null>(null);

  const groups = useMemo(() => {
    const players = data?.state.players ?? [];
    return ORDER.map((status) => ({
      status,
      players: players.filter((p) => p.status === status),
    })).filter((g) => g.players.length > 0);
  }, [data]);

  if (!data) return null;
  const { state } = data;
  const isAdmin = data.capabilities.canManagePlayers;
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
              Dành cho người không mang điện thoại — bạn đặt được cả tên lẫn ảnh
              cho họ, và xoá đi lúc nào cũng được. Ai có máy thì để họ tự quét mã
              QR ở trang Quản lý.
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
                  code={code}
                  player={p}
                  isAdmin={isAdmin}
                  // Máy chủ đã tính sẵn `myPlayerId` có xét cả tài khoản lẫn máy.
                  // Bản trước so `p.deviceId === data.deviceId`, tức chỉ theo máy,
                  // nên người đăng nhập rồi mở buổi trên điện thoại mới bị mất
                  // nhãn "bạn" — đúng tình huống tài khoản sinh ra để chữa.
                  isMe={p.id === data.myPlayerId}
                  onCommand={queue.send}
                  onEdit={() => setEditing(p)}
                  onRemove={() => setRemoving(p)}
                  onDeclare={() => setDeclaring(p)}
                />
              ))}
            </section>
          ))
        )}

        {!isAdmin && (
          <p className="pt-6 text-center text-[11px] text-mute-600">
            Cần quyền Chủ, Phó hoặc mật khẩu điều hành để thêm, duyệt hoặc sửa danh sách. Mã buổi
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

      {/* `key` theo mã người chơi, và chỉ dựng khi thật sự mở: nhờ vậy giá trị
          trong ô nhập luôn là giá trị đang có của đúng người đó. Giữ hộp thoại
          sống mãi rồi đồng bộ lại bằng tay là chỗ dễ để sót một lối đi và hiện
          ra tên người vừa sửa lúc nãy. */}
      {editing && (
        <EditDialog
          key={editing.id}
          player={editing}
          code={code}
          onClose={() => setEditing(null)}
          onCommand={queue.send}
        />
      )}
      {removing && (
        <RemoveDialog
          player={removing}
          onClose={() => setRemoving(null)}
          onCommand={queue.send}
        />
      )}
      {declaring && (
        <AvailabilityDialog
          key={declaring.id}
          player={declaring}
          nextRound={firstUnplayedRound(state)}
          onClose={() => setDeclaring(null)}
          onCommand={queue.send}
        />
      )}
    </div>
  );
}

function PlayerRow({
  code,
  player,
  isAdmin,
  isMe,
  onCommand,
  onEdit,
  onRemove,
  onDeclare,
}: {
  code: string;
  player: Player;
  isAdmin: boolean;
  isMe: boolean;
  onCommand: (command: Command) => void;
  onEdit: () => void;
  onRemove: () => void;
  onDeclare: () => void;
}) {
  const dimmed = player.status === "left" || player.status === "declined";
  const active = player.status === "active";

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line py-2.5">
      <Avatar
        name={player.name}
        avatarId={player.avatarId}
        src={`/api/events/${code}/players/${player.id}/avatar`}
        dimmed={dimmed}
        size="sm"
      />
      <span
        className={`min-w-0 flex-1 truncate text-[15px] font-semibold ${
          dimmed ? "opacity-55" : ""
        }`}
      >
        {player.name}
        {player.available && (
          <span className="ml-2 whitespace-nowrap text-[11px] font-normal text-mute-600">
            {describeSpan(player.available)}
          </span>
        )}
      </span>
      {isMe && <Marker tone="accent">bạn</Marker>}

      {isAdmin && (
        <div className="flex flex-none gap-1.5">
          {active && (
            <>
              <Button
                className="min-h-10 border-line px-3"
                onClick={() => onCommand({ type: "PausePlayer", playerId: player.id })}
              >
                {/* "Nghỉ tạm", không phải "Nghỉ": bảng xếp hạng có sẵn một cột
                    tên "Nghỉ" đếm số vòng phải ngồi ngoài, mà hai thứ đó gần như
                    ngược nhau — cột đếm những vòng bạn VẪN ĐANG CHƠI, còn nút
                    này thì rút bạn khỏi cuộc. Chữ này khớp luôn với tiêu đề nhóm
                    ngay phía trên (`PLAYER_STATUS_SHORT.paused`). */}
                Nghỉ tạm
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

      {/* Hàng thứ hai: những việc ít dùng hơn, dạng chữ gạch chân thay vì nút, để
          hàng chính không bị đẩy tràn trên điện thoại. */}
      {(isAdmin || isMe) && (
        <div className="flex w-full flex-wrap gap-x-4 gap-y-1 pl-10">
          <MiniAction onClick={onEdit}>Sửa tên, ảnh</MiniAction>
          {(isAdmin || isMe) && active && (
            <MiniAction onClick={onDeclare}>
              {player.available ? "Sửa giờ đến/về" : "Khai giờ đến/về"}
            </MiniAction>
          )}
          {isMe && !isAdmin && active && (
            <>
              <MiniAction
                onClick={() => onCommand({ type: "PausePlayer", playerId: player.id })}
              >
                Tôi nghỉ một lúc
              </MiniAction>
              <MiniAction
                onClick={() => onCommand({ type: "PlayerLeft", playerId: player.id })}
              >
                Tôi về đây
              </MiniAction>
            </>
          )}
          {isMe &&
            !isAdmin &&
            (player.status === "paused" || player.status === "left") && (
              <MiniAction
                onClick={() =>
                  onCommand({ type: "ResumePlayer", playerId: player.id })
                }
              >
                Tôi quay lại
              </MiniAction>
            )}
          {isAdmin && <MiniAction onClick={onRemove}>Xoá khỏi buổi</MiniAction>}
        </div>
      )}
    </div>
  );
}

function MiniAction({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-8 text-[11px] text-mute-600 underline underline-offset-4 hover:text-ink"
    >
      {children}
    </button>
  );
}

/**
 * Sửa tên và ảnh của một ô tên.
 *
 * Ảnh thật đi qua `/api/events/[code]/players/[id]/photo` chứ không qua
 * `/api/me/avatar`: ô tên này có thể thuộc về một người không có tài khoản Google
 * nào cả — người không mang điện thoại, do chủ sân gõ tên hộ.
 */
function EditDialog({
  player,
  code,
  onClose,
  onCommand,
}: {
  player: Player;
  code: string;
  onClose: () => void;
  onCommand: (command: Command) => void;
}) {
  const [name, setName] = useState(player.name);
  const [avatarId, setAvatarId] = useState<string | undefined>(
    player.avatarId || undefined,
  );

  const save = () => {
    const trimmed = name.trim();
    if (trimmed === "") return;
    onCommand({
      type: "UpdateProfile",
      playerId: player.id,
      name: trimmed,
      avatarId: avatarId ?? player.avatarId,
    });
    onClose();
  };

  return (
    <Dialog open onClose={onClose} title={`Sửa ${player.name}`}>
      {/* `Dialog` chỉ đặt `aria-label`, không vẽ tiêu đề — mọi hộp trong dự án
          tự viết dòng đầu của mình. Thiếu nó thì người dùng mở hộp ra mà không
          biết mình đang sửa cho ai. */}
      <p className="eyebrow font-normal text-mute-600">Sửa {player.name}</p>
      <div className="mt-3.5 space-y-4">
        <div>
          <span className="mb-2 block text-sm font-medium text-mute-800">
            Ảnh thật
          </span>
          <PhotoPicker
            name={player.name}
            avatarId={player.avatarId}
            photoSrc={`/api/events/${code}/players/${player.id}/avatar`}
            endpoint={`/api/events/${code}/players/${player.id}/photo`}
            canEdit
            hasPhoto
          />
        </div>

        <Field label="Tên" hint="Tên gọi ở sân là được, không cần tên đầy đủ.">
          <input
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
        </Field>

        <div>
          <span className="mb-2 block text-sm font-medium text-mute-800">
            Ảnh biểu tượng
          </span>
          <AvatarPicker name={name} value={avatarId} onChange={setAvatarId} />
        </div>

        <div className="flex gap-2.5">
          <Button className="min-h-[3.25rem] flex-1" onClick={onClose}>
            Thôi
          </Button>
          <Button
            tone="primary"
            className="min-h-[3.25rem] flex-1"
            disabled={!name.trim()}
            onClick={save}
          >
            Lưu
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * Xoá hẳn một ô tên.
 *
 * `RemovePlayer` tự từ chối người đã đánh trận nào ([reduce.ts](../../../../lib/domain/reduce.ts)),
 * nên hộp này nói trước điều đó thay vì để người dùng bấm rồi mới nhận một câu
 * từ chối ở băng lỗi.
 */
function RemoveDialog({
  player,
  onClose,
  onCommand,
}: {
  player: Player;
  onClose: () => void;
  onCommand: (command: Command) => void;
}) {
  return (
    <Dialog open onClose={onClose} title={`Xoá ${player.name}?`}>
      <p className="eyebrow font-normal text-mute-600">Xoá {player.name}?</p>
      <p className="mt-3.5 bg-surface p-3 text-sm">
        Xoá hẳn khỏi buổi đánh, kể cả khỏi những vòng đã xếp sẵn phía trước.
      </p>
      <p className="mt-3 text-[11px] leading-relaxed text-mute-700">
        Chỉ dùng khi thêm nhầm. Người <strong>đã đánh trận nào rồi</strong> thì
        không xoá được — dùng nút <em>Về rồi</em> để giữ lại kết quả của họ trong
        bảng xếp hạng.
      </p>
      <div className="mt-4.5 flex gap-2.5">
        <Button className="min-h-[3.25rem] flex-1" onClick={onClose}>
          Thôi
        </Button>
        <Button
          tone="primary"
          className="min-h-[3.25rem] flex-1"
          onClick={() => {
            onCommand({ type: "RemovePlayer", playerId: player.id });
            onClose();
          }}
        >
          Xoá
        </Button>
      </div>
    </Dialog>
  );
}

/**
 * Khai trước có mặt được từ vòng nào đến vòng nào.
 *
 * Lệnh `DeclareAvailability` đã chạy và đã được kiểm thử từ giai đoạn trước,
 * nhưng **chưa màn hình nào gọi tới** — đây là chỗ đó.
 *
 * Khác hẳn "Về rồi": lệnh này nói về **tương lai** và người khai vẫn đang chơi.
 * Bộ xếp lịch nhận nó làm ràng buộc cứng nên sẽ không nhét ai vào vòng họ đã báo
 * là mình vắng, thay vì tới lúc đó cả sân đứng chờ một người đã về.
 */
function AvailabilityDialog({
  player,
  nextRound,
  onClose,
  onCommand,
}: {
  player: Player;
  nextRound: number;
  onClose: () => void;
  onCommand: (command: Command) => void;
}) {
  const [from, setFrom] = useState(
    player.available ? String(player.available.from) : "",
  );
  const [to, setTo] = useState(
    player.available?.to != null ? String(player.available.to) : "",
  );

  const parse = (v: string): number | null => {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  return (
    <Dialog open onClose={onClose} title={`${player.name} có mặt những vòng nào?`}>
      <p className="eyebrow font-normal text-mute-600">
        {player.name} có mặt những vòng nào?
      </p>
      <p className="mt-3.5 bg-surface p-3 text-sm">
        Vòng đang tới là <strong>vòng {nextRound}</strong>. Bỏ trống nghĩa là
        không giới hạn ở đầu đó.
      </p>

      <div className="mt-3.5 flex gap-2">
        <Field label="Từ vòng">
          <input
            inputMode="numeric"
            value={from}
            placeholder="1"
            onChange={(e) => setFrom(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Đến hết vòng">
          <input
            inputMode="numeric"
            value={to}
            placeholder="tới cuối buổi"
            onChange={(e) => setTo(e.target.value)}
            className={inputClass}
          />
        </Field>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-mute-700">
        Đây là <strong>dự định</strong>, không phải rời cuộc. Bạn vẫn nằm trong
        danh sách và vẫn giữ mọi kết quả đã đánh; hệ thống chỉ tránh xếp trận cho
        bạn ngoài khoảng này. Về sớm thật thì bấm <em>Về rồi</em>.
      </p>

      <div className="mt-4.5 flex gap-2.5">
        {player.available && (
          <Button
            className="min-h-[3.25rem] flex-1"
            onClick={() => {
              onCommand({
                type: "DeclareAvailability",
                playerId: player.id,
                fromRound: null,
                toRound: null,
              });
              onClose();
            }}
          >
            Xoá lời khai
          </Button>
        )}
        <Button className="min-h-[3.25rem] flex-1" onClick={onClose}>
          Thôi
        </Button>
        <Button
          tone="primary"
          className="min-h-[3.25rem] flex-1"
          disabled={from.trim() === "" && to.trim() === ""}
          onClick={() => {
            onCommand({
              type: "DeclareAvailability",
              playerId: player.id,
              fromRound: parse(from),
              toRound: parse(to),
            });
            onClose();
          }}
        >
          Lưu
        </Button>
      </div>
    </Dialog>
  );
}

function describeSpan(span: { from: number; to: number | null }): string {
  if (span.to === null) return `từ vòng ${span.from}`;
  if (span.from <= 1) return `tới vòng ${span.to}`;
  return `vòng ${span.from}–${span.to}`;
}
