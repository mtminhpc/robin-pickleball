"use client";

import { useState } from "react";
import type { AwardKind, EventAward, EventState, TrophyMode } from "@/lib/domain/types";
import { ImageEditor, type ImageEditorValue } from "@/components/ImageEditor";
import { useEvent } from "@/hooks/useEventState";
import { Button, Dialog, Field, inputClass } from "@/components/ui";

const KIND_LABEL: Record<AwardKind, string> = {
  champion: "Vô địch",
  runnerUp: "Á quân",
  third: "Giải ba",
  encouragement: "Khuyến khích",
  custom: "Giải tự đặt",
};

export function AwardsBoard({ code }: { code: string }) {
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
    <section className="border-2 border-ink bg-[#151313] text-white">
      <header className="flex items-center justify-between border-b border-white/20 px-4 py-3">
        <div><p className="font-display text-[9px] font-extrabold uppercase tracking-[0.2em] text-[#f2c45c]">Hall of fame</p><h2 className="mt-1 text-xl uppercase">Bảng vàng</h2></div>
        {data.ownerByAccount && <Button className="border-white text-white hover:bg-white/10" onClick={() => setEditing("new")}>Trao giải</Button>}
      </header>
      {awards.length === 0 ? (
        <p className="p-5 text-sm text-mute-400">Sự kiện đã kết thúc. Chủ sự kiện có thể trao giải thủ công.</p>
      ) : (
        <div className="grid gap-px bg-white/15 sm:grid-cols-2">
          {awards.map((award) => {
            const names = award.recipientIds.map((id) => data.state.players.find((player) => player.id === id)?.name).filter(Boolean);
            return (
              <article key={award.id} className="relative flex min-h-32 items-center gap-4 bg-[#151313] p-4">
                <Trophy code={code} award={award} />
                <div className="min-w-0"><p className="font-display text-[9px] font-extrabold uppercase tracking-[0.16em] text-[#f2c45c]">{award.label}</p><p className="mt-2 text-lg font-extrabold leading-tight">{names.join(" · ")}</p>{names.length > 1 && <span className="mt-2 inline-block border border-[#f2c45c] px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider text-[#f2c45c]">Đồng giải</span>}</div>
                {data.ownerByAccount && <div className="absolute right-2 top-2 flex"><button type="button" aria-label={`Sửa ${award.label}`} onClick={() => setEditing(award)} className="size-9 text-xs underline">Sửa</button><button type="button" aria-label={`Xoá ${award.label}`} onClick={() => void act({ action: "removeAward", id: award.id })} className="size-9 text-xs text-accent-400 underline">Xoá</button></div>}
              </article>
            );
          })}
        </div>
      )}
      {error && <p className="bg-accent p-3 text-sm text-white">{error}</p>}
      <AwardDialog key={editing === "new" ? "new" : editing?.id ?? "closed"} open={editing !== null} award={editing === "new" ? null : editing} state={data.state} busy={busy} onClose={() => setEditing(null)} onSave={async (input) => { const ok = await act({ action: "upsertAward", ...input }); if (ok) setEditing(null); }} />
    </section>
  );
}

function Trophy({ code, award }: { code: string; award: EventAward }) {
  const framed = award.trophyMode === "framed";
  return <div className={`grid size-16 shrink-0 place-items-center ${framed ? "border-2 border-[#f2c45c] bg-black" : ""}`}>{award.trophyAssetId ? <img src={`/api/events/${code}/assets/${award.trophyAssetId}`} alt="Cúp" className="size-full object-contain" /> : <span aria-hidden className="text-4xl">🏆</span>}</div>;
}

function AwardDialog({ open, award, state, busy, onClose, onSave }: { open: boolean; award: EventAward | null; state: EventState; busy: boolean; onClose: () => void; onSave: (body: object) => Promise<void> }) {
  const [kind, setKind] = useState<AwardKind>(award?.kind ?? "champion");
  const [label, setLabel] = useState(award?.label ?? "Vô địch");
  const [recipientIds, setRecipientIds] = useState<string[]>(award?.recipientIds ?? []);
  const [trophyMode, setTrophyMode] = useState<TrophyMode>(award?.trophyMode ?? "framed");
  const [edited, setEdited] = useState<ImageEditorValue | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const chooseKind = (next: AwardKind) => { setKind(next); setLabel(KIND_LABEL[next]); };
  return (
    <Dialog open={open} onClose={onClose} title={award ? "Sửa giải" : "Trao giải"}>
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void onSave({ id: award?.id, kind, label, recipientIds, trophyMode, ...edited, removeImage }); }}>
        <h2 className="text-lg uppercase">{award ? "Sửa giải" : "Trao giải"}</h2>
        <Field label="Bậc giải"><select value={kind} onChange={(event) => chooseKind(event.target.value as AwardKind)} className={inputClass}><option value="champion">Vô địch / Giải nhất</option><option value="runnerUp">Á quân / Giải nhì</option><option value="third">Giải ba</option><option value="encouragement">Khuyến khích</option><option value="custom">Giải tự đặt</option></select></Field>
        {kind === "champion" && <Field label="Tên hiển thị"><select value={label} onChange={(event) => setLabel(event.target.value)} className={inputClass}><option>Vô địch</option><option>Giải nhất</option></select></Field>}
        {kind === "runnerUp" && <Field label="Tên hiển thị"><select value={label} onChange={(event) => setLabel(event.target.value)} className={inputClass}><option>Á quân</option><option>Giải nhì</option></select></Field>}
        {kind === "custom" && <Field label="Tên giải"><input value={label} onChange={(event) => setLabel(event.target.value)} minLength={2} required className={inputClass} /></Field>}
        <fieldset><legend className="mb-2 text-xs text-mute-700">Người nhận (chọn nhiều để đồng giải)</legend><div className="max-h-44 divide-y divide-line overflow-auto border border-line">{state.players.map((player) => <label key={player.id} className="flex min-h-11 items-center gap-3 px-3 text-sm"><input type="checkbox" checked={recipientIds.includes(player.id)} onChange={(event) => setRecipientIds((current) => event.target.checked ? [...current, player.id] : current.filter((id) => id !== player.id))} className="size-5 accent-accent" />{player.name}</label>)}</div></fieldset>
        <Field label="Kiểu cúp"><select value={trophyMode} onChange={(event) => setTrophyMode(event.target.value as TrophyMode)} className={inputClass}><option value="framed">Trong khung</option><option value="transparent">Nền trong</option></select></Field>
        <ImageEditor label="Ảnh cúp tùy chọn" defaultFit="contain" shape={trophyMode === "transparent" ? "transparent" : "square"} onChange={(value, reason) => { setEdited(value); setImageError(reason ?? null); if (value) setRemoveImage(false); }} />
        {award?.trophyAssetId && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={removeImage} onChange={(event) => { setRemoveImage(event.target.checked); if (event.target.checked) setEdited(null); }} />Bỏ ảnh cúp tùy chỉnh</label>}
        {imageError && <p className="text-sm text-accent-700">{imageError}</p>}
        <div className="flex gap-2"><Button type="button" tone="ghost" full onClick={onClose}>Huỷ</Button><Button type="submit" tone="primary" full disabled={busy || recipientIds.length === 0 || Boolean(imageError)}>{busy ? "Đang lưu…" : "Lưu giải"}</Button></div>
      </form>
    </Dialog>
  );
}
