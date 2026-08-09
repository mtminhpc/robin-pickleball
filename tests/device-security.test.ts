/** Hồi quy cho lỗ hổng mạo danh bằng cookie thiết bị bị phát công khai. */

import { describe, expect, it } from "vitest";
import { publicEventSnapshot } from "../lib/api/public-state";
import { emptyState } from "../lib/domain/reduce";
import type { Match, Player } from "../lib/domain/types";
import {
  signDeviceToken,
  verifyDeviceToken,
} from "../lib/identity/device-token";
import {
  signDeviceTokenWeb,
  verifyDeviceTokenWeb,
} from "../lib/identity/device-token-web";

const SECRET = "day-la-khoa-test-du-dai-32-ky-tu";
const VICTIM_DEVICE = "victim-device-12345678";

describe("cookie thiết bị có chữ ký", () => {
  it("không tin UUID/mã máy trần của phiên bản cũ", () => {
    expect(verifyDeviceToken(VICTIM_DEVICE, SECRET)).toBeNull();
  });

  it("đọc được token máy chủ ký và từ chối token bị sửa", () => {
    const token = signDeviceToken(VICTIM_DEVICE, SECRET);
    expect(verifyDeviceToken(token, SECRET)).toBe(VICTIM_DEVICE);
    expect(verifyDeviceToken(`${token.slice(0, -1)}x`, SECRET)).toBeNull();
    expect(verifyDeviceToken(token, `${SECRET}-khac`)).toBeNull();
  });

  it("bản Web Crypto ở middleware tương thích với bộ HMAC Node ở route", async () => {
    const token = await signDeviceTokenWeb(VICTIM_DEVICE, SECRET);
    expect(verifyDeviceToken(token, SECRET)).toBe(VICTIM_DEVICE);
    expect(await verifyDeviceTokenWeb(token, SECRET)).toBe(VICTIM_DEVICE);
  });
});

describe("trạng thái công khai không phát mã thiết bị", () => {
  it("lược mã ở người chơi, người nhập điểm và lịch sử sửa", () => {
    const state = emptyState("SEC001");
    const player: Player = {
      id: "p1",
      name: "Hà",
      avatarId: "a01",
      status: "active",
      deviceId: VICTIM_DEVICE,
      presence: [{ from: 1, to: null }],
      catchUpCredit: 0,
      addedAt: 1,
    };
    const match: Match = {
      id: "m1",
      round: 1,
      court: 1,
      teamA: ["p1", "p2"],
      teamB: ["p3", "p4"],
      status: "submitted",
      result: {
        scoreA: 11,
        scoreB: 7,
        irregular: false,
        partial: false,
        submittedBy: { kind: "player", label: "Hà", ref: VICTIM_DEVICE },
        submittedAt: 2,
      },
      pinned: false,
      edits: [
        {
          at: 3,
          by: { kind: "admin", label: "chủ sân", ref: "admin-device-87654321" },
          from: { scoreA: 11, scoreB: 5 },
          to: { scoreA: 11, scoreB: 7 },
        },
      ],
      createdAt: 1,
    };
    state.players = [player];
    state.matches = [match];

    const snapshot = publicEventSnapshot(state, VICTIM_DEVICE);
    const json = JSON.stringify(snapshot);

    expect(snapshot.claimedPlayerIds).toEqual(["p1"]);
    expect(snapshot.actorRef).toBe("self");
    expect(snapshot.state.players[0]?.deviceId).toBeUndefined();
    expect(snapshot.state.matches[0]?.result?.submittedBy.ref).toBe("self");
    expect(snapshot.state.matches[0]?.edits[0]?.by.ref).toBeUndefined();
    expect(json).not.toContain(VICTIM_DEVICE);
    expect(json).not.toContain("admin-device-87654321");
    // Hàm lược chỉ tạo bản công khai, không được làm hỏng ảnh chụp trong cache.
    expect(state.players[0]?.deviceId).toBe(VICTIM_DEVICE);
  });
});
