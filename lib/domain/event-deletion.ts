/** Chính sách xóa mềm tách khỏi route để UI không bao giờ là hàng rào quyền duy nhất. */

import { isAppAdminEmail } from "./app-admin";

export type DeletionActorKind = "owner" | "app-admin";

export type DeleteEventDecision =
  | { allowed: true; actorKind: DeletionActorKind }
  | { allowed: false; reason: "running" | "invalid-status" | "forbidden" };

export function canDeleteEvent(input: {
  ownerUserId: string;
  status: string;
  actor: { userId: string; email: string };
}): DeleteEventDecision {
  // Cố ý kiểm tra trạng thái trước quyền: không App admin nào có thể lách quy trình
  // kết thúc/đối soát khi một buổi đang đánh.
  if (input.status === "running") return { allowed: false, reason: "running" };
  if (input.status !== "draft" && input.status !== "finished") {
    return { allowed: false, reason: "invalid-status" };
  }
  if (input.ownerUserId && input.ownerUserId === input.actor.userId) {
    return { allowed: true, actorKind: "owner" };
  }
  if (isAppAdminEmail(input.actor.email)) return { allowed: true, actorKind: "app-admin" };
  return { allowed: false, reason: "forbidden" };
}

export function normalizeEventCode(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

/** Server dùng lại điều kiện modal: mã phải khớp tuyệt đối sau khi trim/uppercase. */
export function isDeleteConfirmationValid(code: string, confirmation: unknown): boolean {
  return normalizeEventCode(code) !== "" && normalizeEventCode(code) === normalizeEventCode(confirmation);
}
