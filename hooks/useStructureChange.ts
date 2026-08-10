"use client";

import { useCallback, useState } from "react";
import type { StructureIntent, StructureDiff } from "@/lib/domain/structure";
import type { Command } from "@/lib/domain/commands";
import { useEvent } from "@/hooks/useEventState";

export interface StructurePreviewResponse {
  effectiveRound: number;
  before?: { courts: number; players: number; scheduledMatches: number };
  after?: { courts: number; players: number; scheduledMatches: number };
  diff: StructureDiff;
  warnings: string[];
  blocked: string[];
  expiresAt?: number;
  token: string | null;
}

export function useStructureChange(code: string) {
  const event = useEvent();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = useCallback(async (intent: StructureIntent) => {
    const baseProcessed = event.data?.state.processed;
    if (baseProcessed === undefined) throw new Error("Trạng thái sự kiện chưa sẵn sàng.");
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/events/${code}/structure/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ baseProcessed, intent }),
      });
      const body = (await response.json().catch(() => ({}))) as StructurePreviewResponse & {
        error?: string;
      };
      if (!response.ok && response.status !== 422) {
        if (response.status === 409) event.refresh();
        throw new Error(body.error ?? "Không xem trước được thay đổi.");
      }
      return body;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Không xem trước được thay đổi.";
      setError(message);
      throw cause;
    } finally {
      setBusy(false);
    }
  }, [code, event]);

  const confirm = useCallback(async (token: string) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/events/${code}/structure/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ token }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
        state?: NonNullable<typeof event.data>["state"];
      };
      if (!response.ok) {
        if (response.status === 409) event.refresh();
        throw new Error(
          body.code === "stale-preview"
            ? "Lịch vừa thay đổi. Hãy xem trước lại trước khi xác nhận."
            : body.error ?? "Không áp dụng được thay đổi.",
        );
      }
      if (body.state) event.applyServerState(body.state);
      return body;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Không áp dụng được thay đổi.";
      setError(message);
      throw cause;
    } finally {
      setBusy(false);
    }
  }, [code, event]);

  const sendOnline = useCallback(async (command: Command) => {
    const baseRevision = event.data?.state.processed;
    if (baseRevision === undefined) throw new Error("Trạng thái sự kiện chưa sẵn sàng.");
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/events/${code}/mutate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          commandId: `online-${crypto.randomUUID()}`,
          baseRevision,
          command,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        state?: NonNullable<typeof event.data>["state"];
      };
      if (!response.ok) throw new Error(body.error ?? "Không lưu được thay đổi.");
      if (body.state) event.applyServerState(body.state);
      return body;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Không lưu được thay đổi.";
      setError(message);
      throw cause;
    } finally {
      setBusy(false);
    }
  }, [code, event]);

  return { preview, confirm, sendOnline, busy, error, clearError: () => setError(null) };
}
