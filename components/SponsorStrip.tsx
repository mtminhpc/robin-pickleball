"use client";

import { useState } from "react";
import { useEvent } from "@/hooks/useEventState";
import type { EventSponsor, SponsorTier } from "@/lib/domain/types";

const TIER_LABEL: Record<SponsorTier, string> = {
  diamond: "Kim cương",
  gold: "Vàng",
  silver: "Bạc",
  partner: "Đồng hành",
  custom: "Tài trợ",
};

const METAL: Record<SponsorTier, string> = {
  diamond: "linear-gradient(135deg,#b9ffff,#fff 35%,#76bfd0 58%,#f8ffff 80%,#8bd9e7)",
  gold: "linear-gradient(135deg,#7d5310,#fff2a5 32%,#c99316 55%,#fff5b5 78%,#8c5e0c)",
  silver: "linear-gradient(135deg,#5e6266,#f6f8f9 32%,#9da4aa 55%,#fff 78%,#727980)",
  partner: "linear-gradient(135deg,#7e3f19,#f2bd83 34%,#a85d2d 56%,#ffd2a5 78%,#753714)",
  custom: "linear-gradient(135deg,#087a55,#8ee8c6 38%,#0c5f48 60%,#b7ffe5 82%,#07543d)",
};

export function SponsorStrip({ code }: { code: string }) {
  const { data } = useEvent();
  const [open, setOpen] = useState(false);
  const sponsors = data?.state.presentation.sponsors ?? [];
  const shape = data?.state.presentation.sponsorLogoShape ?? "square";
  if (sponsors.length === 0) return null;

  const visible = sponsors.slice(0, 6);
  return (
    <>
      <section aria-label="Nhà tài trợ" className="border-b border-white/10 bg-[#151313] px-4 py-3 text-white lg:px-10">
        <div className="mx-auto flex max-w-5xl items-center gap-3 overflow-hidden">
          <p className="hidden shrink-0 font-display text-[8px] font-extrabold uppercase tracking-[0.18em] text-mute-500 sm:block">Đồng hành</p>
          <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
            {visible.map((sponsor, index) => (
              <div key={sponsor.id} className={index < 3 ? "block" : index === 3 ? "hidden sm:block" : "hidden lg:block"}>
                <SponsorLogo code={code} sponsor={sponsor} shape={shape} compact />
              </div>
            ))}
          </div>
          {sponsors.length > 3 && (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className={`min-h-10 shrink-0 border-l border-white/20 pl-3 font-display text-[9px] font-extrabold uppercase tracking-wide text-white hover:text-accent-400 ${sponsors.length <= 4 ? "sm:hidden" : sponsors.length <= 6 ? "lg:hidden" : ""}`}
            >
              Tất cả ({sponsors.length})
            </button>
          )}
        </div>
      </section>
      {open && (
        <div role="presentation" className="fixed inset-0 z-50 grid place-items-end bg-black/70 p-0 sm:place-items-center sm:p-5" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}>
          <section role="dialog" aria-modal="true" aria-labelledby="sponsor-dialog-title" className="max-h-[86dvh] w-full max-w-md overflow-auto border-2 border-ink bg-paper p-5 text-ink shadow-xl">
            <header className="flex items-center justify-between border-b-2 border-ink pb-3">
              <h2 id="sponsor-dialog-title" className="font-display text-lg font-extrabold uppercase">Nhà tài trợ</h2>
              <button type="button" aria-label="Đóng danh sách nhà tài trợ" onClick={() => setOpen(false)} className="grid size-11 place-items-center border border-ink text-xl">×</button>
            </header>
            <div className="grid grid-cols-2 gap-4 py-5">
              {sponsors.map((sponsor) => <SponsorLogo key={sponsor.id} code={code} sponsor={sponsor} shape={shape} />)}
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function SponsorLogo({ code, sponsor, shape, compact = false }: { code: string; sponsor: EventSponsor; shape: "square" | "round" | "transparent"; compact?: boolean }) {
  const label = sponsor.tier === "custom" ? sponsor.tierLabel ?? TIER_LABEL.custom : TIER_LABEL[sponsor.tier];
  const src = `/api/events/${code}/assets/${sponsor.assetId}`;
  if (shape === "transparent") {
    return (
      <div className={`${compact ? "min-w-[5rem]" : "min-w-0"} text-center`}>
        <div className={`${compact ? "h-8" : "h-16"} flex items-center justify-center`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={sponsor.name} className="max-h-full max-w-full object-contain" />
        </div>
        <div className="mx-auto mt-1 h-0.5 w-10" style={{ background: METAL[sponsor.tier] }} />
        {!compact && <p className="mt-1 font-display text-[8px] font-extrabold uppercase tracking-wider text-mute-600">{label}</p>}
      </div>
    );
  }
  const round = shape === "round";
  return (
    <div className={`${compact ? "w-12" : "w-full"} text-center`}>
      <div className={`mx-auto ${compact ? "size-10 p-[2px]" : "size-24 p-[3px]"} ${round ? "rounded-full" : ""}`} style={{ background: METAL[sponsor.tier] }}>
        <div className={`grid size-full place-items-center overflow-hidden bg-[#111] ${round ? "rounded-full" : ""}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={sponsor.name} className="size-full object-contain" />
        </div>
      </div>
      {(!compact || !round) && (
        <p className={`font-display font-extrabold uppercase tracking-wider ${compact ? "mt-1 truncate text-[6px] text-mute-500" : "mt-2 text-[8px] text-mute-600"}`}>
          {label}
        </p>
      )}
    </div>
  );
}
