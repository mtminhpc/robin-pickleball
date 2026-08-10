/**
 * Bản trạng thái an toàn để gửi xuống trình duyệt.
 *
 * `EventState` là ảnh chụp nội bộ để phát lại nhật ký nên có cả mã thiết bị.
 * Không được trả thẳng nó ở bất kỳ biên HTTP/RSC nào: mã máy là một phần của
 * danh tính, không phải dữ liệu bảng đấu công khai.
 */

import type { Actor, EventState, Match } from "../domain/types";
import { isGuestUser } from "../domain/account";

export interface PublicEventSnapshot {
  state: EventState;
  /** Mã giả chỉ dùng để đối chiếu quyền tự sửa tỷ số trong giao diện. */
  actorRef: "self" | "";
  /** Ô tên nào đã có máy hoặc tài khoản nhận, không tiết lộ mã nhận là gì. */
  claimedPlayerIds: string[];
}

export function publicEventSnapshot(
  state: EventState,
  viewerDeviceId: string,
  viewerUserId?: string | null,
): PublicEventSnapshot {
  return {
    state: redactEventState(state, viewerDeviceId, viewerUserId),
    actorRef: viewerDeviceId || viewerUserId ? "self" : "",
    claimedPlayerIds: state.players
      .filter((player) => Boolean(player.deviceId || player.userId))
      .map((player) => player.id),
  };
}

/** Chỉ ID ô tên có Google thật; account ảnh vãng lai `g-…` không được tính. */
export function googleLinkedPlayerIds(state: EventState): string[] {
  return state.players
    .filter((player) => player.userId && !isGuestUser(player.userId))
    .map((player) => player.id);
}

/** Sao chép đúng các nhánh có danh tính; tuyệt đối không sửa ảnh chụp trong cache. */
export function redactEventState(
  state: EventState,
  viewerDeviceId: string,
  viewerUserId?: string | null,
): EventState {
  const viewerRefs = new Set([viewerDeviceId, viewerUserId ?? ""].filter(Boolean));
  return {
    ...state,
    players: state.players.map((player) => {
      const {
        deviceId: _privateDeviceId,
        userId: _privateUserId,
        ...publicPlayer
      } = player;
      return publicPlayer;
    }),
    matches: state.matches.map((match) => redactMatch(match, viewerRefs)),
  };
}

function redactMatch(match: Match, viewerRefs: Set<string>): Match {
  return {
    ...match,
    result: match.result
      ? {
          ...match.result,
          submittedBy: redactActor(match.result.submittedBy, viewerRefs),
        }
      : null,
    edits: match.edits.map((edit) => ({
      ...edit,
      by: redactActor(edit.by, viewerRefs),
    })),
  };
}

function redactActor(actor: Actor, viewerRefs: Set<string>): Actor {
  const { ref: _privateRef, ...publicActor } = actor;
  return actor.ref && viewerRefs.has(actor.ref)
    ? { ...publicActor, ref: "self" }
    : publicActor;
}
