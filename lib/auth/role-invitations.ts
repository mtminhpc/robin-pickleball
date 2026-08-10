import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { sessionSecret } from "./secret";

const NAMESPACE = "robin-pickleball:event-role-invitation:v1";

function key(): Buffer {
  return createHmac("sha256", sessionSecret()).update(NAMESPACE).digest();
}

export function newRoleInvitationToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashRoleInvitation(token: string): string {
  return createHmac("sha256", key()).update(token).digest("base64url");
}

export function roleInvitationMatches(token: string, expectedHash: string): boolean {
  if (!token || !expectedHash) return false;
  const actual = Buffer.from(hashRoleInvitation(token));
  const expected = Buffer.from(expectedHash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function roleInvitationStatus(
  token: string,
  expectedHash: string,
  expiresAt: number | null | undefined,
  now = Date.now(),
): "valid" | "invalid" | "expired" {
  if (!roleInvitationMatches(token, expectedHash)) return "invalid";
  return expiresAt !== null && expiresAt !== undefined && expiresAt <= now
    ? "expired"
    : "valid";
}
