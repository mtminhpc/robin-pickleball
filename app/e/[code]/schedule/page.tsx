"use client";

/**
 * Toàn bộ lịch và luồng đưa đúng một trận tương lai lên sân vừa trống.
 *
 * Mỗi vòng là một khối, mỗi trận là một hàng gọn: sân, đội A, tỷ số, đội B. Cả
 * buổi nhìn hết trong một màn hình thay vì phải cuộn qua hàng chục thẻ. Bấm vào
 * hàng là mở đúng hộp nhập tỷ số như ở màn hình chính.
 *
 * Khi sân xong sớm, hộp `PromoteMatch` chỉ liệt kê trận tương lai vượt toàn bộ
 * kiểm tra công bằng. Cặp đấu giữ nguyên và trận được gắn `courtWave` bổ sung;
 * không có nút dời cả vòng hoặc cưỡng ép một ứng viên bị chặn.
 */

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import type { Command } from "@/lib/domain/commands";
import { firstUnplayedRound } from "@/lib/domain/rounds";
import { activeCourtsAt, courtLabelAt, type EventState, type Match, type PlayerId } from "@/lib/domain/types";
import type { StructureIntent } from "@/lib/domain/structure";
import { suggestedPromotions, validateMove, validatePromoteMatch } from "@/lib/scheduler/validate";
import { useEvent } from "@/hooks/useEventState";
import { useMutationQueue } from "@/hooks/useMutationQueue";
import { Avatar } from "@/components/Avatar";
import { pendingScoreFor } from "@/components/MatchCard";
import { ScoreEntryDialog } from "@/components/ScoreEntryDialog";
import { Button, Dialog, Empty, SectionHead } from "@/components/ui";
import { useStructureChange, type StructurePreviewResponse } from "@/hooks/useStructureChange";
import { StructurePreviewDialog } from "@/components/StructurePreviewDialog";
import { RoundRobinManager } from "@/components/RoundRobinManager";

export default function SchedulePage() {
  const { code } = useParams<{ code: string }>();
  const { data } = useEvent();
  const queue = useMutationQueue();
  const structure = useStructureChange(code);

  const [scoring, setScoring] = useState<Match | null>(null);
  const [promotingCourt, setPromotingCourt] = useState<number | null>(null);
  const [moving, setMoving] = useState<Match | null>(null);
  const [transferring, setTransferring] = useState<Match | null>(null);
  const [quickCourt, setQuickCourt] = useState(false);
  const [structureDialog, setStructureDialog] = useState<{ title: string; preview: StructurePreviewResponse | null } | null>(null);

  const rounds = useMemo(() => {
    if (!data) return [];
    const byRound = new Map<number, Match[]>();
    for (const m of data.state.matches) {
      const list = byRound.get(m.round) ?? [];
      list.push(m);
      byRound.set(m.round, list);
    }
    return [...byRound.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([round, matches]) => ({
        round,
        matches: matches.sort((a, b) => (a.courtWave ?? 1) - (b.courtWave ?? 1) || a.court - b.court),
      }));
  }, [data]);

  if (!data) return null;
  const { state, role, capabilities } = data;
  const isAdmin = capabilities.canManageSchedule;
  // Mốc "đã đánh chưa", không phải mốc "thuật toán còn xếp lại được": vòng vừa
  // bị ghim vẫn chưa đánh, dán nhãn "đã xong" cho nó là nói sai với người dùng.
  const open = firstUnplayedRound(state);
  const activeCourts = activeCourtsAt(state, open);
  const freeCourts = activeCourts.map((court) => court.order).filter(
    (court) => !state.matches.some(
      (match) =>
        match.court === court &&
        (match.status === "playing" ||
          (match.round === open && match.status === "scheduled")),
    ),
  );
  const previewIntent = async (title: string, intent: StructureIntent) => {
    setStructureDialog({ title, preview: null });
    try {
      const preview = await structure.preview(intent);
      setStructureDialog({ title, preview });
    } catch {
      setStructureDialog(null);
    }
  };
  const confirmStructure = async (token: string) => {
    try {
      await structure.confirm(token);
      setStructureDialog(null);
      setTransferring(null);
      setQuickCourt(false);
    } catch {
      // Giữ preview để người dùng thấy kế hoạch nào vừa bị stale/chặn.
    }
  };

  if (rounds.length === 0) {
    return (
      <div className="space-y-4 pt-6">
        <RoundRobinManager compact />
        <Empty>Chưa có lịch. Bắt đầu buổi đánh để hệ thống xếp.</Empty>
        {capabilities.canManageStructure && state.status === "running" && (
          <Button tone="primary" full onClick={() => setQuickCourt(true)}>Thêm sân để tiếp tục</Button>
        )}
        <QuickCourtDialog open={quickCourt} fromRound={open} onClose={() => setQuickCourt(false)} onIntent={(intent) => void previewIntent("Thêm sân và xếp lại lịch", intent)} />
        <StructurePreviewDialog open={structureDialog !== null} title={structureDialog?.title ?? "Xem trước lịch"} preview={structureDialog?.preview ?? null} busy={structure.busy} onClose={() => setStructureDialog(null)} onConfirm={confirmStructure} />
      </div>
    );
  }

  return (
    <>
      <div className="mb-5 pt-5"><RoundRobinManager compact /></div>
      {capabilities.canManageStructure && state.status === "running" && (
        <section className="mb-5 flex flex-wrap items-center justify-between gap-3 border-l-4 border-accent bg-surface p-4">
          <div><p className="font-display text-xs font-extrabold uppercase">Điều phối sân nhanh</p><p className="mt-1 text-xs text-mute-700">Thêm sân, đóng sân hoặc chuyển nguyên trạng một trận.</p></div>
          <Button tone="primary" onClick={() => setQuickCourt(true)}>+ Thêm sân</Button>
        </section>
      )}
      {isAdmin && state.status === "running" && freeCourts.length > 0 && (
        <section className="mb-5 border-l-4 border-accent bg-surface p-4">
          <p className="font-display text-xs font-extrabold uppercase">Sân vừa trống</p>
          <p className="mt-1 text-xs text-mute-700">Đưa một trận tương lai hợp lệ lên lượt bổ sung của vòng {open}; không dời cả vòng.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {freeCourts.map((court) => (
              <Button key={court} onClick={() => setPromotingCourt(court)}>Đưa trận lên sân {court}</Button>
            ))}
          </div>
        </section>
      )}
      <div className="grid lg:grid-cols-2 lg:gap-x-10">
        {rounds.map(({ round, matches }) => {
          return (
            <section key={round} className="mb-2">
              <SectionHead
                n={String(round).padStart(2, "0")}
                aside={
                  round < open ? "đã xong" : round === open ? "đang tới" : "chưa đánh"
                }
              >
                Vòng
              </SectionHead>

              {matches.map((m) => (
                <div key={m.id}>
                  <ScheduleRow
                    code={code}
                    match={m}
                    state={state}
                    pending={pendingScoreFor(m.id, queue.queued)}
                    onOpen={role !== "viewer" ? setScoring : undefined}
                  />
                  {isAdmin && m.status === "scheduled" && m.round > open && (
                    <button
                      type="button"
                      onClick={() => setMoving(m)}
                      className="mb-2 min-h-9 text-[10px] font-bold uppercase tracking-wide text-mute-600 underline underline-offset-4"
                    >
                      Đổi vị trí với một trận tương lai
                    </button>
                  )}
                  {capabilities.canManageStructure && (m.status === "scheduled" || m.status === "playing") && (
                    <button
                      type="button"
                      onClick={() => setTransferring(m)}
                      className="mb-2 ml-4 min-h-9 text-[10px] font-bold uppercase tracking-wide text-accent-700 underline underline-offset-4"
                    >
                      Chuyển sân
                    </button>
                  )}
                </div>
              ))}

            </section>
          );
        })}
      </div>

      <ScoreEntryDialog
        match={scoring}
        state={state}
        open={scoring !== null}
        pendingScore={
          scoring ? pendingScoreFor(scoring.id, queue.queued) : undefined
        }
        onClose={() => setScoring(null)}
        onSubmit={(c: Command) => queue.send(c)}
      />
      <PromotionDialog
        court={promotingCourt}
        round={open}
        onClose={() => setPromotingCourt(null)}
        onConfirm={(command) => {
          queue.send(command);
          setPromotingCourt(null);
        }}
      />
      <FutureSwapDialog
        key={moving?.id ?? "closed"}
        moving={moving}
        openRound={open}
        onClose={() => setMoving(null)}
        onConfirm={(command) => {
          queue.send(command);
          setMoving(null);
        }}
      />
      <QuickCourtDialog open={quickCourt} fromRound={open} onClose={() => setQuickCourt(false)} onIntent={(intent) => void previewIntent("Thêm sân và xếp lại lịch", intent)} />
      <TransferCourtDialog match={transferring} fromRound={open} onClose={() => setTransferring(null)} onIntent={(intent) => void previewIntent("Chuyển sân và giữ nguyên trận", intent)} />
      <StructurePreviewDialog open={structureDialog !== null} title={structureDialog?.title ?? "Xem trước lịch"} preview={structureDialog?.preview ?? null} busy={structure.busy} onClose={() => setStructureDialog(null)} onConfirm={confirmStructure} />
      {structure.error && <p className="fixed bottom-20 left-4 right-4 z-50 bg-accent p-3 text-xs font-bold text-white lg:left-auto lg:w-96">{structure.error}</p>}
    </>
  );
}

function FutureSwapDialog({
  moving,
  openRound,
  onClose,
  onConfirm,
}: {
  moving: Match | null;
  openRound: number;
  onClose: () => void;
  onConfirm: (command: Command) => void;
}) {
  const { data } = useEvent();
  const [targetId, setTargetId] = useState("");
  const targets = useMemo(
    () => data && moving
      ? data.state.matches.filter(
          (match) =>
            match.id !== moving.id &&
            match.status === "scheduled" &&
            match.round > openRound,
        )
      : [],
    [data, moving, openRound],
  );
  const target = targets.find((match) => match.id === targetId) ?? null;
  const validation = useMemo(
    () => data && moving && target
      ? validateMove(data.state, moving.id, target.round, target.court, Date.now())
      : null,
    [data, moving, target],
  );
  if (!data || !moving) return null;

  return (
    <Dialog open onClose={onClose} title="Đổi vị trí hai trận">
      <p className="bg-surface p-3 text-sm">
        Chỉ hai trận cụ thể đổi chỗ; cặp đấu giữ nguyên và không dời cả vòng.
      </p>
      <p className="mt-3 text-xs text-mute-600">
        Đang dời: vòng {moving.round} · sân {moving.court}
      </p>
      <div className="mt-2 max-h-52 divide-y divide-line overflow-auto border border-line">
        {targets.length === 0 ? (
          <p className="p-4 text-sm text-mute-600">Không còn vị trí tương lai hợp lệ để đổi.</p>
        ) : targets.map((match) => {
          const names = [...match.teamA, ...match.teamB].map(
            (id) => data.state.players.find((player) => player.id === id)?.name ?? id,
          );
          return (
            <label key={match.id} className="flex min-h-14 items-center gap-3 px-3 text-sm">
              <input type="radio" name="future-swap" checked={targetId === match.id} onChange={() => setTargetId(match.id)} className="size-5 accent-accent" />
              <span><b>Vòng {match.round} · sân {match.court}</b><span className="block text-xs text-mute-600">{names.join(" · ")}</span></span>
            </label>
          );
        })}
      </div>
      {validation && (
        <div className="mt-3 space-y-2">
          {validation.notes.map((note, index) => (
            <p key={index} className={`p-3 text-sm ${note.severity === "block" ? "bg-accent text-paper" : note.severity === "warn" ? "border border-ink" : "bg-surface"}`}>
              {note.message}
            </p>
          ))}
        </div>
      )}
      <div className="mt-4 flex gap-2">
        <Button full onClick={onClose}>Huỷ</Button>
        <Button
          full
          tone="primary"
          disabled={!target || validation?.severity === "block"}
          onClick={() => target && onConfirm({ type: "ReorderMatch", matchId: moving.id, toRound: target.round, toCourt: target.court })}
        >
          Đổi hai trận
        </Button>
      </div>
    </Dialog>
  );
}

/** Một trận, dạng hàng gọn. Bấm vào là mở hộp nhập tỷ số nếu được phép. */
function ScheduleRow({
  code,
  match,
  state,
  pending,
  onOpen,
}: {
  code: string;
  match: Match;
  state: EventState;
  pending?: { scoreA: number; scoreB: number };
  onOpen?: (m: Match) => void;
}) {
  const shown = pending ?? match.result;
  const dead = match.status === "cancelled" || match.status === "abandoned";
  const clickable = !!onOpen && !dead;

  const body = (
    <>
      <span title={matchCourtName(state, match)} className="w-14 flex-none truncate font-display text-[9px] font-extrabold uppercase text-mute-600">
        {matchCourtName(state, match)}
      </span>
      <TeamCell code={code} ids={match.teamA} state={state} />
      <span
        className={`flex-none font-display text-[15px] font-extrabold tracking-[-0.02em] tabular-nums ${
          pending ? "animate-pulse text-mute-600" : shown ? "text-ink" : "text-mute-400"
        }`}
      >
        {shown ? `${shown.scoreA}–${shown.scoreB}` : "·"}
      </span>
      <TeamCell code={code} ids={match.teamB} state={state} align="right" />
    </>
  );

  const cls = `flex w-full items-center gap-3 border-b border-line py-3.5 text-left ${
    dead ? "opacity-50 line-through" : ""
  }`;

  if (!clickable) return <div className={cls}>{body}</div>;
  return (
    <button type="button" onClick={() => onOpen!(match)} className={`${cls} hover:bg-ink/[0.04]`}>
      {body}
    </button>
  );
}

function matchCourtName(state: EventState, match: Match): string {
  const court = state.courts.find((item) => item.id === match.courtId) ?? state.courts.find((item) => item.order === match.court);
  if (!court) return `Sân ${match.court}`;
  return court.labels.find((label) => label.id === match.courtLabelId)?.name ?? courtLabelAt(court, match.round).name;
}

function QuickCourtDialog({ open, fromRound, onClose, onIntent }: { open: boolean; fromRound: number; onClose: () => void; onIntent: (intent: StructureIntent) => void }) {
  const [name, setName] = useState("");
  const [to, setTo] = useState<string>("");
  if (!open) return null;
  return (
    <Dialog open onClose={onClose} title="Thêm sân">
      <h2 className="font-display text-lg font-extrabold uppercase">Thêm sân</h2>
      <label className="mt-4 block text-xs">Tên sân<input autoFocus value={name} maxLength={40} onChange={(event) => setName(event.target.value)} placeholder="Ví dụ: Sân số 9" className="mt-1 min-h-tap w-full border border-line px-3" /></label>
      <label className="mt-3 block text-xs">Đến vòng<select value={to} onChange={(event) => setTo(event.target.value)} className="mt-1 min-h-tap w-full border border-line px-3"><option value="">Đến cuối</option>{Array.from({ length: 20 }, (_, index) => fromRound + index).map((round) => <option key={round} value={round}>{round}</option>)}</select></label>
      <div className="mt-4 grid grid-cols-2 gap-2"><Button onClick={onClose}>Huỷ</Button><Button tone="primary" disabled={!name.trim()} onClick={() => onIntent({ type: "add-court", courtId: crypto.randomUUID(), labelId: crypto.randomUUID(), name, availability: [{ from: fromRound, to: to === "" ? null : Number(to) }], requestedFromRound: fromRound })}>Xem trước</Button></div>
    </Dialog>
  );
}

function TransferCourtDialog({ match, fromRound, onClose, onIntent }: { match: Match | null; fromRound: number; onClose: () => void; onIntent: (intent: StructureIntent) => void }) {
  const { data } = useEvent();
  const [courtId, setCourtId] = useState("");
  const [newName, setNewName] = useState("");
  const [closeSource, setCloseSource] = useState(false);
  if (!match || !data) return null;
  const candidates = activeCourtsAt(data.state, match.round).filter(
    (court) => court.id !== match.courtId && !data.state.matches.some(
      (other) => other.id !== match.id && other.courtId === court.id && (other.status === "playing" || (other.round === match.round && other.status === "scheduled")),
    ),
  );
  const submit = () => {
    const target = candidates.find((court) => court.id === courtId);
    if (target) {
      onIntent({ type: "transfer-match", matchId: match.id, toCourtId: target.id, toCourtLabelId: courtLabelAt(target, match.round).id, closeSourceAfter: closeSource, requestedFromRound: fromRound });
      return;
    }
    if (newName.trim()) {
      const id = crypto.randomUUID();
      onIntent({ type: "transfer-match", matchId: match.id, toCourtId: id, closeSourceAfter: closeSource, requestedFromRound: fromRound, newCourt: { courtId: id, labelId: crypto.randomUUID(), name: newName, availability: [{ from: fromRound, to: null }] } });
    }
  };
  return (
    <Dialog open onClose={onClose} title="Chuyển sân">
      <h2 className="font-display text-lg font-extrabold uppercase">Chuyển {matchCourtName(data.state, match)}</h2>
      <p className="mt-2 text-xs text-mute-600">Giữ nguyên cặp đấu, trạng thái, giờ bắt đầu và mọi điểm đã lưu.</p>
      <label className="mt-4 block text-xs">Sân trống<select value={courtId} onChange={(event) => setCourtId(event.target.value)} className="mt-1 min-h-tap w-full border border-line px-3"><option value="">Chọn sân</option>{candidates.map((court) => <option key={court.id} value={court.id}>{courtLabelAt(court, match.round).name}</option>)}</select></label>
      <label className="mt-3 block text-xs">Hoặc tạo sân mới<input value={newName} maxLength={40} onChange={(event) => { setNewName(event.target.value); if (event.target.value) setCourtId(""); }} placeholder="Tên sân mới" className="mt-1 min-h-tap w-full border border-line px-3" /></label>
      <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={closeSource} onChange={(event) => setCloseSource(event.target.checked)} className="size-5 accent-accent" />Đóng sân nguồn sau khi chuyển</label>
      <div className="mt-4 grid grid-cols-2 gap-2"><Button onClick={onClose}>Huỷ</Button><Button tone="primary" disabled={!courtId && !newName.trim()} onClick={submit}>Xem trước</Button></div>
    </Dialog>
  );
}

/**
 * Một đôi trong hàng lịch: hai ảnh cỡ nhỏ nhất rồi tới tên.
 *
 * Bốn người trên một hàng ở màn hình điện thoại là chỗ chật nhất trong cả ứng
 * dụng. Ngân sách bề ngang ở máy 375px: 343 còn lại sau lề, trừ 16 cho số sân,
 * 40 cho tỷ số và 36 cho các khoảng cách, còn 125 mỗi đôi. Hai ảnh 20px cộng
 * khoảng cách chiếm 42, để lại khoảng 75px cho chữ — vừa đủ "Linh & Nam", tên
 * dài hơn thì `truncate` cắt bớt như nó vẫn làm từ trước.
 */
function TeamCell({
  code,
  ids,
  state,
  align = "left",
}: {
  code: string;
  ids: readonly [PlayerId, PlayerId];
  state: EventState;
  align?: "left" | "right";
}) {
  const players = ids.map((id) => state.players.find((p) => p.id === id) ?? null);
  const label = players.map((p, i) => p?.name ?? ids[i]).join(" & ");

  return (
    <span
      className={`flex min-w-0 flex-1 items-center gap-2 ${
        align === "right" ? "flex-row-reverse" : ""
      }`}
    >
      <span className={`flex flex-none gap-0.5 ${align === "right" ? "flex-row-reverse" : ""}`}>
        {players.map((p, i) => (
          <Avatar
            key={ids[i]}
            name={p?.name ?? ids[i]!}
            avatarId={p?.avatarId}
            src={`/api/events/${code}/players/${ids[i]}/avatar`}
            size="xs"
          />
        ))}
      </span>
      <span className="min-w-0 truncate text-[13px] font-semibold">{label}</span>
    </span>
  );
}

function PromotionDialog({
  court,
  round,
  onClose,
  onConfirm,
}: {
  court: number | null;
  round: number;
  onClose: () => void;
  onConfirm: (command: Command) => void;
}) {
  const { data } = useEvent();
  const [selected, setSelected] = useState("");
  const [startNow, setStartNow] = useState(true);
  const suggestions = useMemo(
    () => data && court ? suggestedPromotions(data.state, round, court, Date.now()) : [],
    [court, data, round],
  );
  const validation = useMemo(
    () => data && court && selected
      ? validatePromoteMatch(data.state, selected, round, court, startNow, Date.now())
      : null,
    [court, data, round, selected, startNow],
  );

  if (!court || !data) return null;

  return (
    <Dialog open onClose={onClose} title={`Đưa trận lên sân ${court}`}>
      <p className="eyebrow text-mute-600">Lượt bổ sung · vòng {round}</p>
      <p className="mt-3 bg-surface p-3 text-sm">Chỉ một trận được chuyển. Cặp đấu giữ nguyên; hệ thống đã loại các trận trùng người, vi phạm có mặt, nghỉ hoặc chênh công bằng.</p>
      <div className="mt-3 max-h-52 divide-y divide-line overflow-auto border border-line">
        {suggestions.length === 0 ? <p className="p-4 text-sm text-mute-600">Chưa có trận tương lai nào đủ điều kiện.</p> : suggestions.map(({ matchId }) => {
          const match = data.state.matches.find((item) => item.id === matchId)!;
          const names = [...match.teamA, ...match.teamB].map((id) => data.state.players.find((player) => player.id === id)?.name ?? id);
          return <label key={matchId} className="flex min-h-14 items-center gap-3 px-3 text-sm"><input type="radio" name="promotion" checked={selected === matchId} onChange={() => setSelected(matchId)} className="size-5 accent-accent" /><span><b>Vòng {match.round} · sân {match.court}</b><span className="block text-xs text-mute-600">{names.join(" · ")}</span></span></label>;
        })}
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={startNow} onChange={(event) => setStartNow(event.target.checked)} className="size-5 accent-accent" />Bắt đầu trận ngay sau khi lưu</label>
      {validation && <div className="mt-3 space-y-2">
        {validation.notes.map((note, i) => (
          <p
            key={i}
            className={`p-3 text-sm ${
              note.severity === "block"
                ? "bg-accent text-paper"
                : note.severity === "warn"
                  ? "border border-ink"
                  : "bg-surface text-mute-800"
            }`}
          >
            {note.message}
          </p>
        ))}
      </div>}

      <div className="mt-4.5 flex gap-2.5">
        <Button className="min-h-[3.25rem] flex-1" onClick={onClose}>
          Quay lại
        </Button>
        <Button
          tone="primary"
          className="min-h-[3.25rem] flex-1"
          disabled={!selected || validation?.severity === "block"}
          onClick={() =>
            onConfirm({ type: "PromoteMatch", matchId: selected, toRound: round, toCourt: court, startNow })
          }
        >
          Đưa trận lên
        </Button>
      </div>
    </Dialog>
  );
}
