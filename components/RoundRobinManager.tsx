"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { firstOpenRound } from "@/lib/domain/rounds";
import { roundRobinProgress } from "@/lib/domain/round-robin";
import { activeCourtsAt } from "@/lib/domain/types";
import type { StructureIntent } from "@/lib/domain/structure";
import { useEvent } from "@/hooks/useEventState";
import { useMutationQueue } from "@/hooks/useMutationQueue";
import {
  useStructureChange,
  type StructurePreviewResponse,
} from "@/hooks/useStructureChange";
import { StructurePreviewDialog } from "@/components/StructurePreviewDialog";
import { Button, Card, Field, Marker, inputClass } from "@/components/ui";

export function RoundRobinManager({ compact = false }: { compact?: boolean }) {
  const { code } = useParams<{ code: string }>();
  const { data } = useEvent();
  const queue = useMutationQueue();
  const structure = useStructureChange(code);
  const [requestedRound, setRequestedRound] = useState<number | null>(null);
  const [dialog, setDialog] = useState<{
    title: string;
    preview: StructurePreviewResponse | null;
  } | null>(null);

  const state = data?.state;
  const progress = useMemo(
    () => (state ? roundRobinProgress(state) : null),
    [state],
  );
  if (
    !data ||
    !state ||
    state.status !== "running" ||
    (!data.capabilities.canManageStructure && state.scheduleMode !== "round-robin")
  ) return null;
  const canManage = data.capabilities.canManageStructure;

  const open = firstOpenRound(state);
  const selectedRound = requestedRound ?? open;
  const lastChoice = Math.max(open, state.lastRound + 1);
  const roundOptions = Array.from(
    { length: lastChoice - open + 1 },
    (_, index) => open + index,
  );
  const previewIntent = async (title: string, intent: StructureIntent) => {
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
      setRequestedRound(null);
    } catch {
      // Giữ nguyên preview để người dùng thấy lịch vừa stale hoặc bị chặn.
    }
  };

  const campaign = state.roundRobinCampaign;
  const missing = progress?.missingPairs.length ?? 0;
  const courts = activeCourtsAt(state, open).length;
  const estimatedMatches = Math.ceil(missing / 2);
  const estimatedRounds = courts > 0 ? Math.ceil(estimatedMatches / courts) : 0;
  const estimatedMinutes =
    estimatedRounds *
    (state.config.estimatedMatchMinutes + state.config.courtTurnoverMinutes);
  const openMatches = state.matches.some(
    (match) => match.status === "scheduled" || match.status === "playing",
  );

  return (
    <>
      <Card className={`space-y-4 ${compact ? "p-4" : "p-5"}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="eyebrow text-accent-700">Thể thức</p>
            <h2 className="mt-1 font-display text-lg font-extrabold uppercase">
              {state.scheduleMode === "americano"
                ? "Americano linh hoạt"
                : campaign?.status === "completed"
                  ? "Round robin đã hoàn tất"
                  : "Round robin chuẩn"}
            </h2>
          </div>
          <Marker tone={state.scheduleMode === "round-robin" ? "accent" : "ink"}>
            {state.scheduleMode === "round-robin" ? "Tròn vòng" : "Linh hoạt"}
          </Marker>
        </div>

        {state.scheduleMode === "americano" ? (
          <>
            <p className="text-sm text-mute-700">
              Chốt những người đang trong ca và bổ sung phần lịch còn thiếu để
              mỗi người từng đánh đôi với tất cả người còn lại. Trận đã bắt đầu
              và trận ghim không đổi.
            </p>
            {canManage && (
              <>
                <Field label="Áp dụng từ vòng">
                  <select
                    className={inputClass}
                    value={selectedRound}
                    onChange={(event) => setRequestedRound(Number(event.target.value))}
                  >
                    {roundOptions.map((round) => (
                      <option key={round} value={round}>Vòng {round}</option>
                    ))}
                  </select>
                </Field>
                <Button
                  tone="primary"
                  full
                  disabled={structure.busy}
                  onClick={() => void previewIntent("Chuyển sang round robin chuẩn", {
                    type: "start-round-robin",
                    campaignId: `rr-${crypto.randomUUID()}`,
                    requestedFromRound: selectedRound,
                  })}
                >
                  Xem trước round robin chuẩn
                </Button>
              </>
            )}
          </>
        ) : campaign && progress ? (
          <>
            <div className="border-l-4 border-accent bg-surface p-3">
              <div className="flex items-center justify-between gap-3 text-sm font-semibold">
                <span>{progress.coveredPairs}/{progress.totalPairs} cặp đã phủ</span>
                <span>{Math.round((progress.coveredPairs / Math.max(1, progress.totalPairs)) * 100)}%</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden bg-line">
                <div
                  className="h-full bg-accent transition-[width]"
                  style={{ width: `${(progress.coveredPairs / Math.max(1, progress.totalPairs)) * 100}%` }}
                />
              </div>
              {campaign.status === "active" && courts > 0 && (
                <p className="mt-2 text-xs text-mute-700">
                  Dự kiến tối thiểu còn {estimatedMatches} trận · {estimatedRounds} vòng · khoảng {estimatedMinutes} phút.
                </p>
              )}
              {campaign.status === "active" && courts === 0 && (
                <p className="mt-2 text-xs font-semibold text-accent-800">
                  Tạm dừng — chưa có sân hoạt động. Tiến độ sẽ tiếp tục khi mở sân.
                </p>
              )}
            </div>

            {campaign.status === "active" && (
              <>
                {progress.absentPlayerIds.length > 0 && (
                  <p className="border border-line bg-paper p-3 text-xs">
                    Tạm chờ {progress.absentPlayerIds.length} người trong nhóm quay lại; các cặp khác vẫn tiếp tục.
                  </p>
                )}
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide">Nhóm mục tiêu</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {campaign.playerIds.map((id) => {
                      const player = state.players.find((item) => item.id === id);
                      const absent = player?.status !== "active";
                      const className = `border px-2.5 py-1.5 text-xs font-semibold ${absent ? "border-accent bg-accent-100 text-accent-800" : "border-line bg-paper"}`;
                      return canManage ? (
                        <button
                          key={id}
                          type="button"
                          className={className}
                          onClick={() => void previewIntent(`Loại ${player?.name ?? id} khỏi mục tiêu`, {
                            type: "remove-round-robin-player",
                            playerId: id,
                            requestedFromRound: open,
                          })}
                        >
                          {player?.name ?? id} · loại
                        </button>
                      ) : (
                        <span key={id} className={className}>{player?.name ?? id}</span>
                      );
                    })}
                  </div>
                </div>
                <MissingPairs state={state} progress={progress} />
                {progress.outsiderPlayerIds.length > 0 && (
                  <p className="text-xs text-mute-600">
                    {progress.outsiderPlayerIds.length} người đến sau vẫn được chơi công bằng nhưng không làm đổi mục tiêu.
                  </p>
                )}
              </>
            )}

            {campaign.status === "completed" && canManage && (
              <div className="grid gap-2 sm:grid-cols-2">
                <Button
                  tone="primary"
                  disabled={openMatches}
                  onClick={() => queue.send({ type: "FinishEvent" })}
                >
                  {openMatches ? "Chờ trận cuối hoàn tất" : "Kết thúc sự kiện"}
                </Button>
                <Button
                  onClick={() => void previewIntent("Chuyển lại Americano", {
                    type: "resume-americano",
                    requestedFromRound: open,
                  })}
                >
                  Chơi tiếp Americano
                </Button>
              </div>
            )}
            {campaign.status === "completed" && !canManage && (
              <p className="text-sm font-semibold text-accent-700">Đã hoàn tất round robin.</p>
            )}
          </>
        ) : null}
      </Card>

      <StructurePreviewDialog
        open={dialog !== null}
        title={dialog?.title ?? "Xem trước round robin"}
        preview={dialog?.preview ?? null}
        busy={structure.busy}
        onClose={() => setDialog(null)}
        onConfirm={confirm}
      />
      {structure.error && (
        <p className="border-l-4 border-accent bg-accent-100 p-3 text-xs font-semibold text-accent-800">
          {structure.error}
        </p>
      )}
    </>
  );
}

function MissingPairs({
  state,
  progress,
}: {
  state: NonNullable<ReturnType<typeof useEvent>["data"]>["state"];
  progress: NonNullable<ReturnType<typeof roundRobinProgress>>;
}) {
  if (progress.missingPairs.length === 0) {
    return <p className="text-sm font-semibold text-accent-700">Đã phủ đủ mọi cặp đồng đội.</p>;
  }
  return (
    <details className="border border-line bg-paper p-3">
      <summary className="cursor-pointer text-xs font-bold uppercase tracking-wide">
        {progress.missingPairs.length} cặp còn thiếu
      </summary>
      <div className="mt-3 max-h-48 space-y-1 overflow-y-auto text-xs text-mute-700">
        {progress.missingPairs.map((pair) => (
          <p key={`${pair.a}:${pair.b}`}>
            {state.players.find((player) => player.id === pair.a)?.name ?? pair.a}
            {" × "}
            {state.players.find((player) => player.id === pair.b)?.name ?? pair.b}
          </p>
        ))}
      </div>
    </details>
  );
}
