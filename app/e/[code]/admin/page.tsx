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
import { firstUnplayedRound } from "@/lib/domain/rounds";
import { useEvent } from "@/hooks/useEventState";
import { useMutationQueue } from "@/hooks/useMutationQueue";
import { PasswordGate } from "@/components/PasswordGate";
import { Button, Card, Dialog, Empty, Field, inputClass } from "@/components/ui";

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
        <p className="text-sm text-slate-400">
          Trang này cần mật khẩu chủ sự kiện.
        </p>
        <PasswordGate code={code} />
      </div>
    );
  }

  const readyCount = state.players.filter(
    (p) => p.status === "confirmed" || p.status === "active",
  ).length;

  return (
    <div className="space-y-5 pb-4">
      {state.status === "draft" && (
        <Card className="space-y-3 p-5">
          <h2 className="font-semibold">Bắt đầu buổi đánh</h2>
          <p className="text-sm text-slate-400">
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
            className="mt-0.5 h-5 w-5 shrink-0 accent-court-500"
          />
          <span>
            Tính trận dở dang vào bảng xếp hạng
            <span className="block text-xs text-slate-500">
              Trận bị bỏ giữa chừng nhưng có ghi tỷ số.
            </span>
          </span>
        </label>
      </Card>

      <LogSection />

      {state.status === "running" && (
        <Card className="space-y-3 border-red-900/50 p-5">
          <h2 className="font-semibold text-red-300">Kết thúc sớm</h2>
          <p className="text-sm text-slate-400">
            Huỷ toàn bộ trận chưa đánh và chốt bảng xếp hạng. Không mở lại được.
            Hiện còn{" "}
            {state.matches.filter((m) => m.status === "scheduled").length} trận
            chưa đánh từ vòng {firstUnplayedRound(state)}.
          </p>
          <Button tone="danger" full onClick={() => setEnding(true)}>
            Kết thúc buổi đánh
          </Button>
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

function QrSection({ code }: { code: string }) {
  const joinUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/e/${code}/join`
      : `/e/${code}/join`;

  return (
    <Card className="space-y-3 p-5 text-center">
      <h2 className="font-semibold">Mời người chơi</h2>
      <p className="text-sm text-slate-400">
        Chiếu mã này lên để mọi người quét, tự nhập tên và chọn ảnh đại diện.
      </p>
      {/* Ảnh SVG do máy chủ dựng; đường dẫn cố định nên trình duyệt giữ lại được. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/events/${code}/qr`}
        alt={`Mã QR tham gia buổi đánh ${code}`}
        className="mx-auto h-56 w-56 rounded-xl bg-white p-2"
      />
      <p className="break-all font-mono text-xs text-slate-500">{joinUrl}</p>
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
            <li key={i} className="flex gap-2 text-slate-400">
              <span className="shrink-0 font-mono text-xs text-slate-600">
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
        <p className="rounded-xl bg-red-500/15 p-3 text-sm text-red-200">
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
            className="h-5 w-5 accent-red-500"
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
