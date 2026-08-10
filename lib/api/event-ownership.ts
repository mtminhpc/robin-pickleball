import type { EventCreationReservationRepo } from "@/lib/sheets/event-reservations";
import type { EventOwnerClaimRepo } from "@/lib/sheets/event-owner-claims";
import type { EventRepo } from "@/lib/sheets/repo";

export type ClaimOwnershipResult =
  | { ok: true; alreadyOwned: boolean }
  | {
      ok: false;
      reason: "not-found" | "owned-by-other" | "quota-full" | "reservation-lost";
      used?: number;
      limit?: number;
    };

/**
 * Use-case thuần I/O cho việc nhận lại buổi cũ, tách khỏi HTTP để kiểm thử được
 * quota, vé đồng thời và sổ claim mà không cần giả cookie Next.js.
 */
export async function claimEventOwnership(input: {
  code: string;
  userId: string;
  limit: number | null;
  now: number;
  repo: EventRepo;
  reservations: EventCreationReservationRepo;
  claims: EventOwnerClaimRepo;
  /** Mã đã xóa mềm, để chúng không tiếp tục chiếm hạn mức của người nhận lại buổi cũ. */
  deletedCodes?: ReadonlySet<string>;
}): Promise<ClaimOwnershipResult> {
  const current = await input.repo.load(input.code);
  if (!current) return { ok: false, reason: "not-found" };
  if (current.record.ownerUserId === input.userId) {
    return { ok: true, alreadyOwned: true };
  }
  if (current.record.ownerUserId !== "") {
    return { ok: false, reason: "owned-by-other" };
  }

  let reservation: string | null = null;
  let reservationFinished = false;
  try {
    if (current.state.status !== "finished" && input.limit !== null) {
      const used = await activeOwnedCount(input.repo, input.userId, input.deletedCodes);
      if (used >= input.limit) {
        return { ok: false, reason: "quota-full", used, limit: input.limit };
      }

      reservation = await input.reservations.acquire(
        input.userId,
        input.limit - used,
        input.now,
      );
      if (!reservation) return { ok: false, reason: "reservation-lost" };

      const refreshedUsed = await activeOwnedCount(
        input.repo,
        input.userId,
        input.deletedCodes,
      );
      if (refreshedUsed >= input.limit) {
        return {
          ok: false,
          reason: "quota-full",
          used: refreshedUsed,
          limit: input.limit,
        };
      }
    }

    if (!(await input.claims.acquire(input.code, input.userId, input.now))) {
      return { ok: false, reason: "owned-by-other" };
    }

    const write = await input.repo.claimOwner(input.code, input.userId);
    if (write === "not-found") return { ok: false, reason: "not-found" };
    if (write === "owned-by-other") {
      return { ok: false, reason: "owned-by-other" };
    }

    if (reservation) {
      await input.reservations.finish(reservation, "consumed", input.now);
      reservationFinished = true;
    }
    return { ok: true, alreadyOwned: write === "already-owned" };
  } finally {
    if (reservation && !reservationFinished) {
      await input.reservations.finish(reservation, "released", input.now);
    }
  }
}

async function activeOwnedCount(
  repo: EventRepo,
  userId: string,
  deletedCodes?: ReadonlySet<string>,
): Promise<number> {
  return (await repo.listByOwner(userId)).filter(
    (item) =>
      item.state.status !== "finished" &&
      !deletedCodes?.has(item.record.code.toUpperCase()),
  ).length;
}
