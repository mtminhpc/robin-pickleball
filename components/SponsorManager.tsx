"use client";

/**
 * Màn Quản lý nhà tài trợ, dựng theo bản thiết kế 1h.
 *
 * Khối "Thêm nhà tài trợ" nằm thẳng trên trang chứ không nấp trong hộp thoại —
 * thêm logo là việc chủ sự kiện làm liên tiếp nhiều lần trước giờ đánh, mở/đóng
 * hộp thoại từng lần là thêm hai cú bấm cho mỗi nhà tài trợ. Sửa thì vẫn dùng
 * hộp thoại, vì nó bắt đầu từ một dòng cụ thể trong danh sách.
 *
 * Cả hai đường đi qua đúng một `SponsorForm`, nên không có chuyện thêm được mà
 * sửa thì thiếu trường.
 */

import { useState, type ReactNode } from "react";
import type { EventSponsor, SponsorLogoShape, SponsorTier } from "@/lib/domain/types";
import { ImageEditor, type ImageEditorValue } from "@/components/ImageEditor";
import { MetalFrame, MetalText, sponsorMetal } from "@/components/Metal";
import { useEvent } from "@/hooks/useEventState";
import { Button, Dialog, Field, inputClass, SectionHead } from "@/components/ui";

const TIERS: Array<{ value: SponsorTier; label: string }> = [
  { value: "diamond", label: "Kim cương" },
  { value: "gold", label: "Vàng" },
  { value: "silver", label: "Bạc" },
  { value: "partner", label: "Đồng hành" },
  { value: "custom", label: "Tự đặt tên" },
];

/** Cỡ khung trong danh sách quản lý (1h): nhỏ hơn dải, cùng thứ tự giảm dần. */
const LIST_SIZE: Record<SponsorTier, number> = {
  diamond: 44,
  gold: 42,
  silver: 42,
  partner: 40,
  custom: 40,
};

function tierName(sponsor: EventSponsor): string {
  return sponsor.tier === "custom"
    ? sponsor.tierLabel ?? "Tự đặt tên"
    : TIERS.find((item) => item.value === sponsor.tier)?.label ?? "";
}

export function SponsorManager({ code }: { code: string }) {
  const { data, applyServerState } = useEvent();
  const [editing, setEditing] = useState<EventSponsor | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Đổi khoá là cách buộc form thêm quên sạch trạng thái cũ sau mỗi lần lưu —
  // rẻ hơn và ít sai hơn là đi reset từng `useState` một.
  const [addKey, setAddKey] = useState(0);
  if (!data?.ownerByAccount) return null;
  const { sponsors, sponsorLogoShape } = data.state.presentation;

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
      if (!response.ok) throw new Error(parsed.error ?? "Không lưu được thay đổi.");
      applyServerState(parsed.state);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không lưu được thay đổi.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const move = (index: number, direction: -1 | 1) => {
    const next = [...sponsors];
    const other = index + direction;
    if (!next[index] || !next[other]) return;
    [next[index], next[other]] = [next[other]!, next[index]!];
    void act({ action: "reorderSponsors", ids: next.map((item) => item.id) });
  };

  return (
    <section aria-label="Nhà tài trợ">
      <SectionHead n="01" className="pt-0">Hình dạng logo</SectionHead>
      <div className="grid grid-cols-3 border border-t-0 border-line bg-surface">
        {(["square", "round", "transparent"] as SponsorLogoShape[]).map((shape) => (
          <button
            key={shape}
            type="button"
            disabled={busy}
            onClick={() => void act({ action: "setShape", shape })}
            aria-pressed={sponsorLogoShape === shape}
            className={`min-h-12 border-r border-line px-2 font-display text-[10px] font-extrabold uppercase tracking-[0.08em] last:border-r-0 ${
              sponsorLogoShape === shape ? "bg-ink text-paper" : "text-mute-700 hover:bg-mute-300"
            }`}
          >
            {shape === "square" ? "Vuông" : shape === "round" ? "Tròn" : "Nền trong"}
          </button>
        ))}
      </div>

      <SectionHead n="02" aside={`${sponsors.length} logo`}>Danh sách</SectionHead>
      {sponsors.length === 0 ? (
        <p className="border-b border-line py-5 text-center text-xs text-mute-600">Chưa có nhà tài trợ.</p>
      ) : (
        sponsors.map((sponsor, index) => (
          <div key={sponsor.id} className="flex items-center gap-3 border-b border-line py-3">
            <MetalFrame
              metal={sponsorMetal(sponsor.tier)}
              size={LIST_SIZE[sponsor.tier]}
              round={sponsorLogoShape === "round"}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/events/${code}/assets/${sponsor.assetId}`} alt="" className="size-full object-contain" />
            </MetalFrame>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{sponsor.name}</p>
              <MetalText metal={sponsorMetal(sponsor.tier)} className="mt-0.5 block text-[10px] leading-none">
                {tierName(sponsor)}
              </MetalText>
            </div>
            {/*
              Bản thiết kế chỉ vẽ một nút "⋯". Giữ bốn nút rời là lệch có chủ ý:
              gộp chúng vào một trình đơn là thêm một tầng tương tác mà bản thiết
              kế không mô tả, còn thứ tự hạng thì phải sửa được ngay tại dòng.
            */}
            <div className="flex flex-none">
              <IconButton label={`Đưa ${sponsor.name} lên`} disabled={index === 0 || busy || sponsors[index - 1]?.tier !== sponsor.tier} onClick={() => move(index, -1)}>↑</IconButton>
              <IconButton label={`Đưa ${sponsor.name} xuống`} disabled={index === sponsors.length - 1 || busy || sponsors[index + 1]?.tier !== sponsor.tier} onClick={() => move(index, 1)}>↓</IconButton>
              <IconButton label={`Sửa ${sponsor.name}`} onClick={() => setEditing(sponsor)}>Sửa</IconButton>
              <IconButton label={`Xoá ${sponsor.name}`} tone="danger" onClick={() => void act({ action: "removeSponsor", id: sponsor.id })}>Xoá</IconButton>
            </div>
          </div>
        ))
      )}

      {error && <p className="mt-3 bg-accent p-3 text-sm text-paper">{error}</p>}

      <div className="mt-5 border border-line bg-surface p-4">
        <p className="eyebrow mb-3">Thêm nhà tài trợ</p>
        <SponsorForm
          key={addKey}
          sponsor={null}
          shape={sponsorLogoShape}
          busy={busy}
          submitLabel="Thêm vào buổi đánh"
          onSubmit={async (input) => {
            const ok = await act({ action: "upsertSponsor", ...input });
            if (ok) setAddKey((value) => value + 1);
          }}
        />
      </div>

      <Dialog open={editing !== null} onClose={() => setEditing(null)} title="Sửa nhà tài trợ">
        <h2 className="mb-4 text-lg uppercase">Sửa nhà tài trợ</h2>
        {editing && (
          <SponsorForm
            key={editing.id}
            sponsor={editing}
            shape={sponsorLogoShape}
            busy={busy}
            submitLabel="Lưu"
            onCancel={() => setEditing(null)}
            onSubmit={async (input) => {
              const ok = await act({ action: "upsertSponsor", ...input });
              if (ok) setEditing(null);
            }}
          />
        )}
      </Dialog>
    </section>
  );
}

function IconButton({
  label,
  children,
  onClick,
  disabled = false,
  tone = "neutral",
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: "neutral" | "danger";
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`-ml-px grid size-11 place-items-center border border-line font-display text-[10px] font-extrabold uppercase transition disabled:opacity-25 ${
        tone === "danger" ? "text-accent-700 hover:bg-accent-100" : "hover:bg-ink/[0.07]"
      }`}
    >
      {children}
    </button>
  );
}

function SponsorForm({
  sponsor,
  shape,
  busy,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  sponsor: EventSponsor | null;
  shape: SponsorLogoShape;
  busy: boolean;
  submitLabel: string;
  onSubmit: (input: object) => Promise<void>;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(sponsor?.name ?? "");
  const [tier, setTier] = useState<SponsorTier>(sponsor?.tier ?? "partner");
  const [tierLabel, setTierLabel] = useState(sponsor?.tierLabel ?? "");
  const [edited, setEdited] = useState<ImageEditorValue | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit({ id: sponsor?.id, name, tier, tierLabel, ...edited });
      }}
    >
      <ImageEditor
        label={sponsor ? "Logo mới (không bắt buộc)" : "Logo nhà tài trợ"}
        variant="tile"
        tileLabel={sponsor ? "Đổi logo" : "Tải logo"}
        defaultFit="contain"
        shape={shape}
        required={!sponsor}
        onChange={(value, reason) => {
          setEdited(value);
          setImageError(reason ?? null);
        }}
        aside={
          <>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={inputClass}
              placeholder="Tên thương hiệu"
              aria-label="Tên nhà tài trợ"
              required
              minLength={2}
            />
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {TIERS.map((item) => (
                <TierChip key={item.value} item={item} active={tier === item.value} onClick={() => setTier(item.value)} />
              ))}
            </div>
          </>
        }
      />

      {tier === "custom" && (
        <Field label="Tên hạng tự đặt">
          <input value={tierLabel} onChange={(event) => setTierLabel(event.target.value)} className={inputClass} required minLength={2} placeholder="Tài trợ áo đấu" />
        </Field>
      )}

      {imageError && <p className="text-sm text-accent-700">{imageError}</p>}

      <div className="flex gap-2">
        {onCancel && <Button type="button" tone="ghost" full onClick={onCancel}>Huỷ</Button>}
        <Button type="submit" tone="primary" full disabled={busy || Boolean(imageError) || (!sponsor && !edited)}>
          {busy ? "Đang lưu…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}

/**
 * Chip chọn hạng.
 *
 * Ba hạng đầu hiện đúng chất liệu của chúng — chọn hạng mà thấy ngay ánh kim sẽ
 * ra sao thì không phải lưu rồi mới biết. Hạng đang chọn đảo sang khối ink đặc.
 */
function TierChip({
  item,
  active,
  onClick,
}: {
  item: { value: SponsorTier; label: string };
  active: boolean;
  onClick: () => void;
}) {
  const metal = sponsorMetal(item.value);
  const text = "font-display text-[10px] font-extrabold uppercase tracking-[0.06em]";

  if (active) {
    return (
      <button type="button" onClick={onClick} aria-pressed className={`min-h-9 bg-ink px-2.5 text-paper ${text}`}>
        {item.label}
      </button>
    );
  }
  if (metal === "plain") {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={false}
        className={`min-h-9 border px-2.5 text-mute-700 hover:bg-ink/[0.07] ${item.value === "custom" ? "border-dashed border-line" : "border-line"} ${text}`}
      >
        {item.value === "custom" ? `+ ${item.label}` : item.label}
      </button>
    );
  }
  return (
    <button type="button" onClick={onClick} aria-pressed={false} className="min-h-9">
      <MetalFrame metal={metal} className="h-full">
        <MetalText metal={metal} className="px-2.5 py-2 text-[10px] leading-none">
          {item.label}
        </MetalText>
      </MetalFrame>
    </button>
  );
}
