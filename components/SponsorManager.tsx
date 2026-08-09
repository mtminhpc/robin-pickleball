"use client";

import { useState } from "react";
import type { EventSponsor, SponsorLogoShape, SponsorTier } from "@/lib/domain/types";
import { ImageEditor, type ImageEditorValue } from "@/components/ImageEditor";
import { useEvent } from "@/hooks/useEventState";
import { Button, Card, Dialog, Field, inputClass } from "@/components/ui";

const TIERS: Array<{ value: SponsorTier; label: string }> = [
  { value: "diamond", label: "Kim cương" },
  { value: "gold", label: "Vàng" },
  { value: "silver", label: "Bạc" },
  { value: "partner", label: "Đồng hành" },
  { value: "custom", label: "Hạng tự đặt" },
];

export function SponsorManager({ code }: { code: string }) {
  const { data, applyServerState } = useEvent();
  const [editing, setEditing] = useState<EventSponsor | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    <Card className="space-y-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Nhà tài trợ</h2>
          <p className="mt-1 text-xs text-mute-600">Kim cương, Vàng, Bạc và Đồng hành tối đa 2 logo mỗi hạng. Hạng tự đặt không giới hạn.</p>
        </div>
        <Button className="shrink-0" onClick={() => setEditing("new")}>Thêm</Button>
      </div>
      <div className="grid grid-cols-3 border border-line" aria-label="Hình dạng logo">
        {(["square", "round", "transparent"] as SponsorLogoShape[]).map((shape) => (
          <button key={shape} type="button" disabled={busy} onClick={() => void act({ action: "setShape", shape })} className={`min-h-tap border-r border-line px-2 text-[10px] font-bold uppercase last:border-r-0 ${sponsorLogoShape === shape ? "bg-ink text-white" : ""}`}>
            {shape === "square" ? "Vuông" : shape === "round" ? "Tròn" : "Nền trong"}
          </button>
        ))}
      </div>
      {sponsors.length === 0 ? <p className="border border-dashed border-line p-4 text-center text-xs text-mute-600">Chưa có nhà tài trợ.</p> : (
        <div className="divide-y divide-line border-y border-line">
          {sponsors.map((sponsor, index) => (
            <div key={sponsor.id} className="grid grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-3 py-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/events/${code}/assets/${sponsor.assetId}`} alt="" className="size-11 border border-line bg-ink object-contain" />
              <div className="min-w-0"><p className="truncate text-sm font-semibold">{sponsor.name}</p><p className="text-[10px] uppercase text-mute-600">{sponsor.tier === "custom" ? sponsor.tierLabel : TIERS.find((tier) => tier.value === sponsor.tier)?.label}</p></div>
              <div className="flex">
                <button type="button" aria-label="Đưa lên" onClick={() => move(index, -1)} disabled={index === 0 || busy || sponsors[index - 1]?.tier !== sponsor.tier} className="size-10 disabled:opacity-25">↑</button>
                <button type="button" aria-label="Đưa xuống" onClick={() => move(index, 1)} disabled={index === sponsors.length - 1 || busy || sponsors[index + 1]?.tier !== sponsor.tier} className="size-10 disabled:opacity-25">↓</button>
                <button type="button" onClick={() => setEditing(sponsor)} className="min-h-10 px-2 text-xs font-bold underline">Sửa</button>
                <button type="button" onClick={() => void act({ action: "removeSponsor", id: sponsor.id })} className="min-h-10 px-2 text-xs text-accent-700 underline">Xoá</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {error && <p className="bg-accent p-3 text-sm text-white">{error}</p>}
      <SponsorDialog key={editing === "new" ? "new" : editing?.id ?? "closed"} shape={sponsorLogoShape} open={editing !== null} sponsor={editing === "new" ? null : editing} busy={busy} onClose={() => setEditing(null)} onSave={async (input) => { const ok = await act({ action: "upsertSponsor", ...input }); if (ok) setEditing(null); }} />
    </Card>
  );
}

function SponsorDialog({ open, sponsor, shape, busy, onClose, onSave }: { open: boolean; sponsor: EventSponsor | null; shape: SponsorLogoShape; busy: boolean; onClose: () => void; onSave: (input: object) => Promise<void> }) {
  const [name, setName] = useState(sponsor?.name ?? "");
  const [tier, setTier] = useState<SponsorTier>(sponsor?.tier ?? "partner");
  const [tierLabel, setTierLabel] = useState(sponsor?.tierLabel ?? "");
  const [edited, setEdited] = useState<ImageEditorValue | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  return (
    <Dialog open={open} onClose={onClose} title={sponsor ? "Sửa nhà tài trợ" : "Thêm nhà tài trợ"}>
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void onSave({ id: sponsor?.id, name, tier, tierLabel, ...edited }); }}>
        <h2 className="text-lg uppercase">{sponsor ? "Sửa nhà tài trợ" : "Thêm nhà tài trợ"}</h2>
        <Field label="Tên nhà tài trợ"><input value={name} onChange={(event) => setName(event.target.value)} className={inputClass} required minLength={2} /></Field>
        <Field label="Hạng"><select defaultValue={sponsor?.tier ?? "partner"} onChange={(event) => setTier(event.target.value as SponsorTier)} className={inputClass}>{TIERS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
        {tier === "custom" && <Field label="Tên hạng tự đặt"><input value={tierLabel} onChange={(event) => setTierLabel(event.target.value)} className={inputClass} required minLength={2} /></Field>}
        <ImageEditor label={sponsor ? "Logo mới (không bắt buộc)" : "Logo nhà tài trợ"} defaultFit="contain" shape={shape} required={!sponsor} onChange={(value, reason) => { setEdited(value); setImageError(reason ?? null); }} />
        {imageError && <p className="text-sm text-accent-700">{imageError}</p>}
        <div className="flex gap-2"><Button type="button" tone="ghost" full onClick={onClose}>Huỷ</Button><Button type="submit" tone="primary" full disabled={busy || Boolean(imageError) || (!sponsor && !edited)}>{busy ? "Đang lưu…" : "Lưu"}</Button></div>
      </form>
    </Dialog>
  );
}
