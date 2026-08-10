"use client";

/**
 * Dải nhà tài trợ, ngay dưới băng tiêu đề của sự kiện.
 *
 * Dựng theo bản bàn giao Claude Design v3, ba biến thể ứng đúng ba giá trị của
 * `sponsorLogoShape`:
 *
 *   • `square`      → dải A (1d): ô vuông ánh kim trên băng giấy;
 *   • `round`       → dải B (1e): cùng thứ đó nhưng bo tròn;
 *   • `transparent` → dải C (1f): logo nền trong trên băng tối, hạng đọc bằng
 *                      vạch ánh kim phía trên chứ không bằng khung.
 *
 * Hai điều dễ làm sai, đều đã từng sai ở bản trước:
 *
 *   • **Ruột khung là giấy sáng, không phải ô đen.** Logo thật hầu hết là chữ sẫm
 *     nền trắng; nền đen nuốt mất chữ.
 *   • **Dải cuộn ngang chứ không cắt bớt.** Bản trước ẩn logo theo breakpoint, tức
 *     nhà tài trợ trả tiền rồi mà điện thoại hẹp thì không ai thấy. Cuộn thì ai
 *     cũng tới được, và nút "Tất cả (n)" là đường tắt.
 *
 * Cỡ logo giảm dần theo hạng, nhưng chỉ vài pixel: thứ tự trong dải mới là thứ
 * nói lên hạng, cỡ chỉ nhấn thêm.
 */

import { useState } from "react";
import { useEvent } from "@/hooks/useEventState";
import { MetalFrame, MetalText, sponsorMetal } from "@/components/Metal";
import { Dialog } from "@/components/ui";
import type { EventSponsor, SponsorLogoShape, SponsorTier } from "@/lib/domain/types";

const TIER_LABEL: Record<SponsorTier, string> = {
  diamond: "Kim cương",
  gold: "Vàng",
  silver: "Bạc",
  partner: "Đồng hành",
  custom: "Tài trợ",
};

/** Cỡ khung trong dải, tính bằng pixel đúng như bản thiết kế 1d. */
const STRIP_SIZE: Record<SponsorTier, number> = {
  diamond: 46,
  gold: 43,
  silver: 40,
  partner: 40,
  custom: 40,
};

/** Vạch hạng của dải C: chỉ có nó nói lên hạng khi logo là PNG nền trong. */
const BAR: Record<SponsorTier, { width: number; height: number; background: string }> = {
  diamond: { width: 22, height: 3, background: "linear-gradient(90deg,#ffffff,#8fa1b3)" },
  gold: { width: 18, height: 2, background: "linear-gradient(90deg,#fff3cf,#a9832a)" },
  silver: { width: 16, height: 2, background: "linear-gradient(90deg,#f2f1f1,#8f8b8b)" },
  partner: { width: 14, height: 2, background: "#7d7979" },
  custom: { width: 14, height: 2, background: "#7d7979" },
};

function tierLabel(sponsor: EventSponsor): string {
  return sponsor.tier === "custom" ? sponsor.tierLabel ?? TIER_LABEL.custom : TIER_LABEL[sponsor.tier];
}

function logoSrc(code: string, sponsor: EventSponsor): string {
  return `/api/events/${code}/assets/${sponsor.assetId}`;
}

export function SponsorStrip({ code }: { code: string }) {
  const { data } = useEvent();
  const [open, setOpen] = useState(false);
  const sponsors = data?.state.presentation.sponsors ?? [];
  const shape = data?.state.presentation.sponsorLogoShape ?? "square";
  if (sponsors.length === 0) return null;

  const dark = shape === "transparent";

  return (
    <>
      <section
        aria-label="Nhà tài trợ"
        className={dark ? "border-b-2 border-accent bg-ink" : "border-b-2 border-ink bg-paper"}
      >
        <div className="flex items-center justify-between gap-3 pl-4 pr-2 pt-0.5 lg:pl-10 lg:pr-6">
          {/* Cùng một xám cho cả hai nền: #7d7979 đủ tương phản trên giấy lẫn trên ink. */}
          <p className="font-display text-[9px] font-extrabold uppercase tracking-[0.16em] text-mute-600">
            Nhà tài trợ
          </p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className={`min-h-9 flex-none px-2 font-display text-[9px] font-extrabold uppercase tracking-[0.08em] transition ${
              dark ? "text-paper hover:text-accent-400" : "text-accent hover:text-accent-700"
            }`}
          >
            Tất cả ({sponsors.length}) →
          </button>
        </div>

        {dark ? (
          <div className="scroll-x flex items-end pb-3 pl-4 lg:pl-10">
            {sponsors.map((sponsor, index) => (
              <span
                key={sponsor.id}
                className={`flex-none ${index === 0 ? "pr-3" : "border-l border-white/20 px-3"}`}
              >
                <span aria-hidden className="mb-1.5 block" style={BAR[sponsor.tier]} />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={logoSrc(code, sponsor)}
                  alt={`${sponsor.name} · ${tierLabel(sponsor)}`}
                  className="h-6 max-w-24 object-contain object-left"
                />
              </span>
            ))}
          </div>
        ) : (
          <div className="scroll-x flex items-end gap-[9px] px-4 pb-[9px] lg:px-10">
            {sponsors.map((sponsor) => (
              <span key={sponsor.id} className="flex-none text-center">
                <MetalFrame
                  metal={sponsorMetal(sponsor.tier)}
                  size={STRIP_SIZE[sponsor.tier]}
                  round={shape === "round"}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={logoSrc(code, sponsor)} alt={sponsor.name} className="size-full object-contain" />
                </MetalFrame>
                <MetalText metal={sponsorMetal(sponsor.tier)} className="mt-[3px] block text-[9px] leading-none">
                  {tierLabel(sponsor)}
                </MetalText>
              </span>
            ))}
          </div>
        )}
      </section>

      <AllSponsors code={code} sponsors={sponsors} shape={shape} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/**
 * Danh sách đầy đủ.
 *
 * Bản thiết kế không vẽ màn này — nó nằm ở mục "thử tiếp" — nên dựng bằng đúng
 * ngữ pháp của hệ: khung ánh kim, nhãn hạng ánh kim, kẻ mảnh giữa các dòng.
 */
function AllSponsors({
  code,
  sponsors,
  shape,
  open,
  onClose,
}: {
  code: string;
  sponsors: EventSponsor[];
  shape: SponsorLogoShape;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title="Nhà tài trợ">
      <header className="flex items-center justify-between border-b-2 border-ink pb-3">
        <h2 className="text-lg uppercase">Nhà tài trợ</h2>
        <button
          type="button"
          aria-label="Đóng danh sách nhà tài trợ"
          onClick={onClose}
          className="grid size-11 place-items-center border border-line text-xl"
        >
          ×
        </button>
      </header>
      <div className="max-h-[60dvh] overflow-y-auto">
        {sponsors.map((sponsor) => (
          <div key={sponsor.id} className="flex items-center gap-3 border-b border-line py-3">
            <MetalFrame
              metal={sponsorMetal(sponsor.tier)}
              size={48}
              round={shape === "round"}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logoSrc(code, sponsor)} alt="" className="size-full object-contain" />
            </MetalFrame>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{sponsor.name}</span>
              <MetalText metal={sponsorMetal(sponsor.tier)} className="mt-0.5 block text-[10px] leading-none">
                {tierLabel(sponsor)}
              </MetalText>
            </span>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
