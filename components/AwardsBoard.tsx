"use client";

/**
 * Bảng vàng, dựng theo bản thiết kế 2a và thang giải 2c.
 *
 * Giải dùng **đúng thang ánh kim của nhà tài trợ**, chỉ đổi tông: vàng → bạc →
 * đồng → viền mảnh. Đó là lý do `Metal.tsx` phục vụ cả hai chỗ; hai hệ kim loại
 * song song trong một ứng dụng thì kiểu gì cũng trôi khỏi nhau.
 *
 * Cúp lớn dần theo bậc nhưng chỉ chênh vài pixel. Bậc đọc được nhờ **thứ tự và
 * chất liệu**, không phải nhờ một cái cúp to áp đảo phần còn lại.
 *
 * Đồng giải gộp vào cùng một khung kèm nhãn "Đồng giải"; bậc dưới không bị đẩy
 * xuống, vì hai người cùng giải ba vẫn chỉ là một giải ba.
 */

import { useState } from "react";
import type { AwardKind, EventAward, EventState, TrophyMode } from "@/lib/domain/types";
import type { StandingRow } from "@/lib/domain/standings";
import { ImageEditor, type ImageEditorValue } from "@/components/ImageEditor";
import { Avatar } from "@/components/Avatar";
import { MetalFrame, MetalText, METAL_STROKE, TrophyIcon, awardMetal } from "@/components/Metal";
import { useEvent } from "@/hooks/useEventState";
import { Button, Dialog, Field, inputClass } from "@/components/ui";

const KIND_LABEL: Record<AwardKind, string> = {
  champion: "Vô địch",
  runnerUp: "Á quân",
  third: "Giải ba",
  encouragement: "Khuyến khích",
  custom: "Giải tự đặt",
};

/** Cỡ khung cúp, nhãn giải và tên người nhận theo bậc — thang của 2c. */
const SCALE: Record<AwardKind, { frame: number; icon: number; label: number; name: number }> = {
  champion: { frame: 62, icon: 30, label: 12, name: 18 },
  runnerUp: { frame: 52, icon: 25, label: 11, name: 16 },
  third: { frame: 46, icon: 22, label: 11, name: 15 },
  encouragement: { frame: 42, icon: 20, label: 11, name: 15 },
  custom: { frame: 42, icon: 20, label: 11, name: 15 },
};

export function AwardsBoard({
  code,
  n = "01",
  standings = [],
}: {
  code: string;
  /** Số thứ tự mục, để trang Xếp hạng đánh số liền mạch. */
  n?: string;
  /** Dòng xếp hạng đã tính sẵn ở trang cha — chỉ để lấy hiệu số và số trận. */
  standings?: StandingRow[];
}) {
  const { data, applyServerState } = useEvent();
  const [editing, setEditing] = useState<EventAward | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!data || (data.state.status !== "finished" && data.state.presentation.awards.length === 0)) return null;
  const awards = data.state.presentation.awards;

  const act = async (body: object) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/events/${code}/presentation`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const parsed = await response.json();
      if (!response.ok) throw new Error(parsed.error ?? "Không lưu được giải.");
      applyServerState(parsed.state);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không lưu được giải.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Bảng vàng">
      <div className="flex items-center gap-3 border-b-2 border-ink pb-2 pt-6">
        <span className="font-display text-[11px] font-extrabold leading-none text-accent">{n}</span>
        <h2 className="eyebrow m-0">Bảng vàng</h2>
        {data.ownerByAccount && (
          <Button className="ml-auto min-h-9 px-3 text-[10px]" onClick={() => setEditing("new")}>
            Trao giải
          </Button>
        )}
      </div>

      {awards.length === 0 ? (
        <p className="border-b-2 border-ink py-5 text-sm text-mute-700">
          Buổi đã kết thúc. Chủ sự kiện có thể trao giải cho từng người.
        </p>
      ) : (
        awards.map((award, index) => (
          <AwardRow
            key={award.id}
            code={code}
            award={award}
            standings={standings}
            state={data.state}
            last={index === awards.length - 1}
            canEdit={Boolean(data.ownerByAccount)}
            onEdit={() => setEditing(award)}
            onRemove={() => void act({ action: "removeAward", id: award.id })}
          />
        ))
      )}

      {error && <p className="mt-3 bg-accent p-3 text-sm text-paper">{error}</p>}

      <AwardDialog
        key={editing === "new" ? "new" : editing?.id ?? "closed"}
        open={editing !== null}
        award={editing === "new" ? null : editing}
        state={data.state}
        standings={standings}
        busy={busy}
        onClose={() => setEditing(null)}
        onSave={async (input) => {
          const ok = await act({ action: "upsertAward", ...input });
          if (ok) setEditing(null);
        }}
      />
    </section>
  );
}

function AwardRow({
  code,
  award,
  state,
  standings,
  last,
  canEdit,
  onEdit,
  onRemove,
}: {
  code: string;
  award: EventAward;
  state: EventState;
  standings: StandingRow[];
  last: boolean;
  canEdit: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const metal = awardMetal(award.kind);
  const scale = SCALE[award.kind];
  const shared = award.recipientIds.length > 1;
  const winners = award.recipientIds
    .map((id) => ({
      id,
      player: state.players.find((player) => player.id === id),
      row: standings.find((item) => item.playerId === id),
    }))
    .filter((item) => item.player);

  return (
    <div className={`flex items-start gap-3.5 py-4 ${last ? "border-b-2 border-ink" : "border-b border-line"}`}>
      <Trophy code={code} award={award} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <MetalText metal={metal} className="leading-none" style={{ fontSize: scale.label }}>
            {award.label}
          </MetalText>
          {shared && (
            <span className="border border-line px-1.5 py-px font-display text-[9px] font-extrabold uppercase tracking-[0.08em] text-mute-700">
              Đồng giải
            </span>
          )}
        </div>
        {winners.map(({ id, player, row }) => (
          <div key={id} className="mt-1.5 flex items-center gap-2">
            <Avatar name={player!.name} avatarId={player!.avatarId} size="sm" />
            <span
              className="truncate font-display font-extrabold tracking-[-0.02em]"
              style={{ fontSize: shared ? SCALE.third.name : scale.name }}
            >
              {player!.name}
            </span>
            {row && <span className="flex-none text-[11px] text-mute-700">{signed(row.diff)}</span>}
          </div>
        ))}
        {!shared && winners[0]?.row && (
          <p className="mt-1 text-[11px] text-mute-700">
            Hiệu số {signed(winners[0].row.diff)} · {winners[0].row.games} trận
          </p>
        )}
      </div>
      {canEdit && (
        <div className="flex flex-none">
          <button type="button" aria-label={`Sửa ${award.label}`} onClick={onEdit} className="-ml-px grid size-11 place-items-center border border-line font-display text-[10px] font-extrabold uppercase hover:bg-ink/[0.07]">Sửa</button>
          <button type="button" aria-label={`Xoá ${award.label}`} onClick={onRemove} className="-ml-px grid size-11 place-items-center border border-line font-display text-[10px] font-extrabold uppercase text-accent-700 hover:bg-accent-100">Xoá</button>
        </div>
      )}
    </div>
  );
}

/** Cúp: ảnh chủ sự kiện tải lên nếu có, không thì cúp mặc định của app. */
function Trophy({ code, award }: { code: string; award: EventAward }) {
  const metal = awardMetal(award.kind);
  const scale = SCALE[award.kind];
  const inner = award.trophyAssetId ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`/api/events/${code}/assets/${award.trophyAssetId}`} alt="" className="size-full object-contain" />
  ) : (
    <TrophyIcon size={scale.icon} stroke={METAL_STROKE[metal]} />
  );

  if (award.trophyMode === "transparent") {
    return (
      <span className="grid flex-none place-items-center" style={{ width: scale.frame, height: scale.frame }}>
        {inner}
      </span>
    );
  }
  return <MetalFrame metal={metal} size={scale.frame}>{inner}</MetalFrame>;
}

function AwardDialog({
  open,
  award,
  state,
  standings,
  busy,
  onClose,
  onSave,
}: {
  open: boolean;
  award: EventAward | null;
  state: EventState;
  standings: StandingRow[];
  busy: boolean;
  onClose: () => void;
  onSave: (body: object) => Promise<void>;
}) {
  const [kind, setKind] = useState<AwardKind>(award?.kind ?? "champion");
  const [label, setLabel] = useState(award?.label ?? "Vô địch");
  const [recipientIds, setRecipientIds] = useState<string[]>(award?.recipientIds ?? []);
  const [trophyMode, setTrophyMode] = useState<TrophyMode>(award?.trophyMode ?? "framed");
  const [edited, setEdited] = useState<ImageEditorValue | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const chooseKind = (next: AwardKind) => {
    setKind(next);
    setLabel(KIND_LABEL[next]);
  };
  // Tên gọi thay thế của hai bậc đầu — bản thiết kế cho chủ sự kiện chọn một
  // trong hai chứ không cho gõ tự do, để Bảng vàng không lẫn lộn cách gọi.
  const altName = kind === "champion" ? "Giải nhất" : kind === "runnerUp" ? "Giải nhì" : null;

  return (
    <Dialog open={open} onClose={onClose} title={award ? "Sửa giải" : "Trao giải"}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void onSave({ id: award?.id, kind, label, recipientIds, trophyMode, ...edited, removeImage });
        }}
      >
        <div>
          <h2 className="text-lg uppercase">{award ? "Sửa giải" : "Trao giải"}</h2>
          <p className="mt-1.5 text-xs text-mute-700">
            Giải trao xong hiện ở đầu bảng xếp hạng và không tự đổi theo tỷ số nữa.
          </p>
        </div>

        <fieldset>
          <legend className="eyebrow mb-2 text-mute-600">Giải</legend>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(KIND_LABEL) as AwardKind[]).map((value) => (
              <KindChip key={value} kind={value} active={kind === value} onClick={() => chooseKind(value)} />
            ))}
          </div>
        </fieldset>

        {altName && (
          <fieldset>
            <legend className="eyebrow mb-2 text-mute-600">Tên gọi</legend>
            <div className="grid grid-cols-2 border border-line bg-surface">
              {[KIND_LABEL[kind], altName].map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={label === option}
                  onClick={() => setLabel(option)}
                  className={`min-h-11 border-r border-line font-display text-[10px] font-extrabold uppercase tracking-[0.08em] last:border-r-0 ${
                    label === option ? "bg-ink text-paper" : "text-mute-700"
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </fieldset>
        )}

        {kind === "custom" && (
          <Field label="Tên giải">
            <input value={label} onChange={(event) => setLabel(event.target.value)} minLength={2} required className={inputClass} placeholder="Tay vợt phong cách" />
          </Field>
        )}

        <fieldset>
          <legend className="eyebrow mb-2 text-mute-600">Trao cho — chọn nhiều người nếu đồng giải</legend>
          <div className="max-h-56 divide-y divide-line overflow-auto border border-line">
            {state.players.map((player) => {
              const row = standings.find((item) => item.playerId === player.id);
              return (
                <label key={player.id} className="flex min-h-12 items-center gap-2.5 px-3 text-sm">
                  <input
                    type="checkbox"
                    checked={recipientIds.includes(player.id)}
                    onChange={(event) =>
                      setRecipientIds((current) =>
                        event.target.checked ? [...current, player.id] : current.filter((id) => id !== player.id),
                      )
                    }
                    className="size-[18px] accent-accent"
                  />
                  <Avatar name={player.name} avatarId={player.avatarId} size="sm" />
                  <span className="flex-1 truncate font-semibold">{player.name}</span>
                  {row && <span className="flex-none text-xs text-mute-700">{signed(row.diff)}</span>}
                </label>
              );
            })}
          </div>
        </fieldset>

        <fieldset>
          <legend className="eyebrow mb-2 text-mute-600">Cúp</legend>
          <div className="grid grid-cols-2 border border-line bg-surface">
            {(["framed", "transparent"] as TrophyMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={trophyMode === mode}
                onClick={() => setTrophyMode(mode)}
                className={`min-h-11 border-r border-line font-display text-[10px] font-extrabold uppercase tracking-[0.08em] last:border-r-0 ${
                  trophyMode === mode ? "bg-ink text-paper" : "text-mute-700"
                }`}
              >
                {mode === "framed" ? "Trong khung" : "Nền trong"}
              </button>
            ))}
          </div>
          <div className="mt-3">
            <ImageEditor
              label="Ảnh cúp tùy chọn"
              variant="tile"
              tileLabel="Tải cúp"
              defaultFit="contain"
              shape={trophyMode === "transparent" ? "transparent" : "square"}
              onChange={(value, reason) => {
                setEdited(value);
                setImageError(reason ?? null);
                if (value) setRemoveImage(false);
              }}
              aside={
                <p className="text-xs leading-relaxed text-mute-700">
                  Để trống thì dùng cúp mặc định của app, đặt trong khung ánh kim đúng bậc giải.
                </p>
              }
            />
          </div>
        </fieldset>

        {award?.trophyAssetId && (
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={removeImage}
              onChange={(event) => {
                setRemoveImage(event.target.checked);
                if (event.target.checked) setEdited(null);
              }}
            />
            Bỏ ảnh cúp tùy chỉnh
          </label>
        )}
        {imageError && <p className="text-sm text-accent-700">{imageError}</p>}

        <div className="flex gap-2">
          <Button type="submit" tone="primary" full disabled={busy || recipientIds.length === 0 || Boolean(imageError)}>
            {busy ? "Đang lưu…" : award ? "Lưu giải" : "Trao giải"}
          </Button>
          <Button type="button" tone="neutral" onClick={onClose}>Huỷ</Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Chip chọn bậc giải — ba bậc đầu hiện đúng chất liệu ánh kim của chúng. */
function KindChip({ kind, active, onClick }: { kind: AwardKind; active: boolean; onClick: () => void }) {
  const metal = awardMetal(kind);
  const text = "font-display text-[10px] font-extrabold uppercase tracking-[0.08em]";
  if (active) {
    return (
      <button type="button" onClick={onClick} aria-pressed className={`min-h-9 bg-ink px-2.5 text-paper ${text}`}>
        {KIND_LABEL[kind]}
      </button>
    );
  }
  if (metal === "plain") {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={false}
        className={`min-h-9 border px-2.5 text-mute-700 hover:bg-ink/[0.07] ${kind === "custom" ? "border-dashed border-line" : "border-line"} ${text}`}
      >
        {kind === "custom" ? "+ Giải khác" : KIND_LABEL[kind]}
      </button>
    );
  }
  return (
    <button type="button" onClick={onClick} aria-pressed={false} className="min-h-9">
      <MetalFrame metal={metal} className="h-full">
        <MetalText metal={metal} className="px-2.5 py-2 text-[10px] leading-none">
          {KIND_LABEL[kind]}
        </MetalText>
      </MetalFrame>
    </button>
  );
}

function signed(x: number): string {
  return x > 0 ? `+${x}` : String(x);
}
