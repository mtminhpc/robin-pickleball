import { normalizeEmail } from "./account";

export const APP_ADMIN_EMAILS = new Set([
  "mtminhpc@gmail.com",
  "prolathevt02@gmail.com",
]);

export const DEFAULT_EVENT_LIMIT = 3;

export function isAppAdminEmail(email: string | null | undefined): boolean {
  return APP_ADMIN_EMAILS.has(normalizeEmail(email ?? ""));
}

export function validEventLimit(value: unknown): value is number | null {
  return value === null || (Number.isInteger(value) && Number(value) >= 3 && Number(value) <= 100);
}
