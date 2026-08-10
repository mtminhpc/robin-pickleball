import { createHmac } from "node:crypto";
import type { Command, Role } from "../domain/commands";
import type { StructureDiff } from "../domain/structure";
import { readPayload, signPayload } from "./hmac";
import { sessionSecret } from "./secret";

const PURPOSE = "robin-pickleball:structure-preview:v1";
export const STRUCTURE_PREVIEW_TTL_MS = 5 * 60 * 1000;

export interface StructurePreviewPayload {
  v: 1;
  code: string;
  processed: number;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
  subject: string;
  effectiveRound: number;
  commands: Command[];
  schedule: Extract<Command, { type: "SetSchedule" }>;
  diff: StructureDiff;
  warnings: string[];
}

function derivedSecret(): string {
  return createHmac("sha256", sessionSecret()).update(PURPOSE).digest("base64url");
}

/** Dấu mù để token không chứa email/userId/deviceId thô nhưng vẫn không chuyển tay được. */
export function structurePreviewSubject(
  role: Role,
  userId: string | null,
  deviceId: string,
): string {
  const identity = userId ? `account:${userId}` : `device:${deviceId}`;
  return createHmac("sha256", derivedSecret())
    .update(`${role}:${identity}`)
    .digest("base64url");
}

export function signStructurePreview(payload: StructurePreviewPayload): string {
  return signPayload(payload, derivedSecret());
}

export function verifyStructurePreview(
  token: string | undefined,
  code: string,
  subject: string,
  now = Date.now(),
): StructurePreviewPayload | null {
  const payload = readPayload<StructurePreviewPayload>(token, derivedSecret());
  if (!payload || payload.v !== 1) return null;
  if (payload.code !== code || payload.subject !== subject) return null;
  if (!Number.isInteger(payload.processed) || payload.processed < 0) return null;
  if (!Number.isInteger(payload.effectiveRound) || payload.effectiveRound < 1) return null;
  if (payload.expiresAt <= now || payload.issuedAt > now + 30_000) return null;
  if (!Array.isArray(payload.commands) || payload.commands.length < 1) return null;
  if (payload.schedule?.type !== "SetSchedule") return null;
  return payload;
}
