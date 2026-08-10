/**
 * Use-case xóa mềm và khôi phục một sự kiện, tách khỏi HTTP.
 *
 * Cùng lý do với `event-ownership.ts`: **không bài kiểm thử nào trong dự án chạm
 * tới route handler**, nên phần quyết định "ai được xóa cái gì" mà nằm trong route
 * là phần không ai canh. Ở đây thì kiểm được — kể cả những nhánh khó dựng bằng tay
 * như gọi lặp, buổi đang đánh, và buổi legacy chưa có chủ.
 *
 * Cả hai hàm đọc bằng `EventRepo` **thô**, không qua `readEvent` của `cache.ts`:
 * hàm đó đã cố tình trả `null` cho buổi đã xóa, nên dùng nó ở đây thì khôi phục sẽ
 * không bao giờ tìm thấy thứ cần khôi phục.
 */

import { canDeleteEvent, type DeletionActorKind } from "@/lib/domain/event-deletion";
import { isAppAdminEmail } from "@/lib/domain/app-admin";
import type { EventDeletionRepo } from "@/lib/sheets/event-deletions";
import type { EventRepo } from "@/lib/sheets/repo";

export interface DeletionActor {
  userId: string;
  email: string;
}

export type DeleteEventResult =
  | {
      ok: true;
      /** Đã xóa từ trước; không có dòng mới nào được ghi thêm. */
      repeated: boolean;
      actorKind: DeletionActorKind;
      /** Để route dọn đúng bộ đệm danh sách của câu lạc bộ đó. */
      clubId: string | null;
    }
  | { ok: false; reason: "not-found" | "running" | "invalid-status" | "forbidden" };

export type RestoreEventResult =
  | { ok: true; repeated: boolean; clubId: string | null }
  | { ok: false; reason: "not-found" | "forbidden" };

export async function deleteEventUseCase(input: {
  code: string;
  actor: DeletionActor;
  now: number;
  repo: EventRepo;
  deletions: EventDeletionRepo;
}): Promise<DeleteEventResult> {
  const loaded = await input.repo.load(input.code);
  if (!loaded) return { ok: false, reason: "not-found" };

  const decision = canDeleteEvent({
    ownerUserId: loaded.record.ownerUserId,
    status: loaded.state.status,
    actor: input.actor,
  });
  if (!decision.allowed) return { ok: false, reason: decision.reason };

  const written = await input.deletions.delete({
    eventCode: input.code,
    actorUserId: input.actor.userId,
    actorKind: decision.actorKind,
    createdAt: input.now,
  });
  return {
    ok: true,
    repeated: written.alreadyDeleted,
    actorKind: decision.actorKind,
    clubId: loaded.record.clubId,
  };
}

/**
 * Khôi phục là ngoại lệ chỉ dành cho App admin.
 *
 * Chủ sự kiện không được tự khôi phục: nếu được, một buổi bị xóa để nhường quota
 * có thể quay lại vượt hạn mức mà không ai duyệt. Đổi lại, App admin **không** cần
 * được trao quyền vào sự kiện mới làm được việc này.
 */
export async function restoreEventUseCase(input: {
  code: string;
  actor: DeletionActor;
  now: number;
  repo: EventRepo;
  deletions: EventDeletionRepo;
}): Promise<RestoreEventResult> {
  if (!isAppAdminEmail(input.actor.email)) return { ok: false, reason: "forbidden" };

  const loaded = await input.repo.load(input.code);
  if (!loaded) return { ok: false, reason: "not-found" };

  const written = await input.deletions.restore({
    eventCode: input.code,
    actorUserId: input.actor.userId,
    actorKind: "app-admin",
    createdAt: input.now,
  });
  return { ok: true, repeated: written.alreadyRestored, clubId: loaded.record.clubId };
}
