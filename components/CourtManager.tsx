"use client";

import { useMemo, useState } from "react";
import { firstOpenRound } from "@/lib/domain/rounds";
import { courtLabelAt, spanContains, type EventCourt, type RoundSpan } from "@/lib/domain/types";
import type { StructureIntent } from "@/lib/domain/structure";
import { useEvent } from "@/hooks/useEventState";
import { useStructureChange, type StructurePreviewResponse } from "@/hooks/useStructureChange";
import { StructurePreviewDialog } from "@/components/StructurePreviewDialog";
import { Button, Card, Field, Tag, inputClass } from "@/components/ui";

export function CourtManager({ code }: { code: string }) {
  const event = useEvent();
  const structure = useStructureChange(code);
  const [name, setName] = useState("");
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState<string>("");
  const [dialog, setDialog] = useState<{ title: string; preview: StructurePreviewResponse | null } | null>(null);
  const state = event.data?.state;
  const open = state ? firstOpenRound(state) : 1;
  const maxRound = Math.max(open + 20, state?.lastRound ?? 0);
  const roundOptions = useMemo(() => Array.from({ length: maxRound }, (_, index) => index + 1), [maxRound]);

  if (!state || !event.data?.capabilities.canManageStructure) return null;

  const run = async (title: string, intent: StructureIntent) => {
    setDialog({ title, preview: null });
    try {
      const preview = await structure.preview(intent);
      setDialog({ title, preview });
    } catch {
      setDialog(null);
    }
  };
  const confirm = async (token: string) => {
    try {
      await structure.confirm(token);
      setDialog(null);
    } catch {
      // Lỗi đã hiện dưới khối quản lý; giữ dialog để người dùng đọc diff cũ.
    }
  };

  const addCourt = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const courtId = crypto.randomUUID();
    void run("Thêm sân và xếp lại lịch", {
      type: "add-court",
      courtId,
      labelId: crypto.randomUUID(),
      name: trimmed,
      availability: [{ from, to: to === "" ? null : Number(to) }],
      requestedFromRound: from,
    });
  };

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="font-semibold">Sân &amp; ca hoạt động</h2>
        <p className="mt-1 text-xs text-mute-600">Tên sân bám theo trận lịch sử; thay đổi công suất luôn có bước xem trước lịch.</p>
      </div>

      <div className="space-y-3">
        {state.courts.map((court, index) => (
          <CourtRow
            key={court.id}
            court={court}
            index={index}
            total={state.courts.length}
            open={open}
            roundOptions={roundOptions}
            busy={structure.busy}
            onOnline={structure.sendOnline}
            onPreview={run}
          />
        ))}
      </div>

      <div className="border-t border-line pt-4">
        <p className="font-display text-[10px] font-extrabold uppercase">Thêm sân</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Field label="Tên sân">
            <input value={name} maxLength={40} onChange={(event) => setName(event.target.value)} placeholder="Ví dụ: Sân số 7" className={inputClass} />
          </Field>
          <RoundSelect label="Từ vòng" value={from} options={roundOptions.filter((round) => round >= open)} onChange={setFrom} />
          <Field label="Đến vòng">
            <select value={to} onChange={(event) => setTo(event.target.value)} className={inputClass}>
              <option value="">Đến cuối</option>
              {roundOptions.filter((round) => round >= from).map((round) => <option key={round} value={round}>{round}</option>)}
            </select>
          </Field>
        </div>
        <Button className="mt-3" tone="primary" disabled={!name.trim() || structure.busy} onClick={addCourt}>Xem trước thêm sân</Button>
      </div>

      {structure.error && <p className="text-xs font-semibold text-accent-700">{structure.error}</p>}
      <StructurePreviewDialog
        open={dialog !== null}
        title={dialog?.title ?? "Xem trước lịch"}
        preview={dialog?.preview ?? null}
        busy={structure.busy}
        onClose={() => setDialog(null)}
        onConfirm={confirm}
      />
    </Card>
  );
}

function CourtRow({
  court,
  index,
  total,
  open,
  roundOptions,
  busy,
  onOnline,
  onPreview,
}: {
  court: EventCourt;
  index: number;
  total: number;
  open: number;
  roundOptions: number[];
  busy: boolean;
  onOnline: ReturnType<typeof useStructureChange>["sendOnline"];
  onPreview: (title: string, intent: StructureIntent) => Promise<void>;
}) {
  const event = useEvent();
  const state = event.data!.state;
  const label = courtLabelAt(court, open);
  const [courtName, setCourtName] = useState(label.name);
  const [from, setFrom] = useState(open);
  const [to, setTo] = useState<string>("");
  const active = !court.archived && court.availability.some((span) => spanContains(span, open));
  const playing = state.matches.some((match) => match.courtId === court.id && match.status === "playing");

  const reorder = (offset: -1 | 1) => {
    const ids = state.courts.map((item) => item.id);
    const target = index + offset;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    void onOnline({ type: "ReorderCourts", courtIds: ids, effectiveRound: open });
  };
  const addSpan = () => void onPreview(`Mở ${courtName}`, {
    type: "set-court-availability",
    courtId: court.id,
    availability: [...court.availability, { from, to: to === "" ? null : Number(to) }],
    requestedFromRound: from,
  });
  const close = () => void onPreview(playing ? "Đóng sân sau trận này" : "Đóng sân", {
    type: "set-court-availability",
    courtId: court.id,
    availability: removeFrom(court.availability, open),
    requestedFromRound: open,
  });

  return (
    <div className="border border-line p-3">
      <div className="flex flex-wrap items-center gap-2">
        <input value={courtName} maxLength={40} onChange={(event) => setCourtName(event.target.value)} className={`${inputClass} min-w-[10rem] flex-1`} />
        <Tag tone={court.archived ? "neutral" : active ? "ok" : "warn"}>
          {court.archived ? "Lưu trữ" : active ? "Đang mở" : playing ? "Đóng sau trận này" : "Đang đóng"}
        </Tag>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button disabled={busy || courtName.trim() === label.name} onClick={() => void onOnline({
          type: "RenameCourt",
          courtId: court.id,
          labelId: crypto.randomUUID(),
          name: courtName,
          effectiveRound: open,
        })}>Lưu tên</Button>
        <Button disabled={busy || index === 0} onClick={() => reorder(-1)}>↑</Button>
        <Button disabled={busy || index === total - 1} onClick={() => reorder(1)}>↓</Button>
        <Button disabled={busy || !active} onClick={close}>{playing ? "Đóng sau trận này" : "Đóng sân"}</Button>
        <Button tone={court.archived ? "neutral" : "danger"} disabled={busy} onClick={() => void onPreview(
          court.archived ? "Khôi phục sân" : "Lưu trữ sân",
          { type: "archive-court", courtId: court.id, archived: !court.archived, requestedFromRound: open },
        )}>{court.archived ? "Khôi phục" : "Lưu trữ"}</Button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {court.availability.map((span, spanIndex) => (
          <span key={`${span.from}-${span.to}-${spanIndex}`} className="inline-flex items-center border border-line bg-paper px-2 py-1 text-xs">
            V{span.from}–{span.to ?? "cuối"}
            <button
              type="button"
              disabled={span.from < open}
              onClick={() => void onPreview("Xoá ca sân", {
                type: "set-court-availability",
                courtId: court.id,
                availability: court.availability.filter((_, item) => item !== spanIndex),
                requestedFromRound: open,
              })}
              className="ml-2 font-bold text-accent-700 disabled:text-mute-400"
              aria-label={`Xoá ca từ vòng ${span.from}`}
            >×</button>
          </span>
        ))}
      </div>

      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-bold text-accent-700">Thêm khoảng hoạt động</summary>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <RoundSelect label="Từ vòng" value={from} options={roundOptions.filter((round) => round >= open)} onChange={setFrom} />
          <Field label="Đến vòng">
            <select value={to} onChange={(event) => setTo(event.target.value)} className={inputClass}>
              <option value="">Đến cuối</option>
              {roundOptions.filter((round) => round >= from).map((round) => <option key={round} value={round}>{round}</option>)}
            </select>
          </Field>
          <Button className="self-end" disabled={busy} onClick={addSpan}>Xem trước</Button>
        </div>
      </details>
    </div>
  );
}

function RoundSelect({ label, value, options, onChange }: { label: string; value: number; options: number[]; onChange: (value: number) => void }) {
  return (
    <Field label={label}>
      <select value={value} onChange={(event) => onChange(Number(event.target.value))} className={inputClass}>
        {options.map((round) => <option key={round} value={round}>Vòng {round}</option>)}
      </select>
    </Field>
  );
}

function removeFrom(spans: RoundSpan[], fromRound: number): RoundSpan[] {
  return spans.flatMap((span) => {
    if (span.to !== null && span.to < fromRound) return [span];
    if (span.from >= fromRound) return [];
    return [{ from: span.from, to: fromRound - 1 }];
  });
}
