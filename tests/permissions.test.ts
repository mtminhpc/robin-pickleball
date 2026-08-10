/**
 * Ai được gửi lệnh gì.
 *
 * Bảng phân quyền là thứ duy nhất đứng giữa một mật khẩu cả nhóm biết và việc ai
 * đó sửa hồ sơ hay cho người khác "đã về". Nó nằm ở tầng `domain` chính vì lý do
 * này: **không bài kiểm thử nào trong dự án chạm tới route handler**, nên logic
 * để trong route là logic không ai canh.
 */

import { describe, expect, it } from "vitest";
import {
  ADMIN_ONLY,
  PUBLIC_COMMANDS,
  SELF_SERVICE,
  isAllowedForActor,
  isAllowedForRole,
  type CommandType,
} from "../lib/domain/commands";

const ME = "p-nam";
const AI_KHAC = "p-linh";

describe("quyền theo vai", () => {
  it("chủ sự kiện làm được mọi thứ", () => {
    for (const type of [...ADMIN_ONLY, ...PUBLIC_COMMANDS, ...SELF_SERVICE]) {
      expect(isAllowedForRole(type, "admin"), type).toBe(true);
    }
  });

  it("người quét mã QR chỉ gửi được ba lệnh công khai", () => {
    for (const type of PUBLIC_COMMANDS) {
      expect(isAllowedForRole(type, "viewer"), type).toBe(true);
    }
    for (const type of ADMIN_ONLY) {
      expect(isAllowedForRole(type, "viewer"), type).toBe(false);
    }
  });

  it("có mật khẩu người chơi thì nhập được điểm nhưng không quản được buổi", () => {
    expect(isAllowedForRole("SubmitResult", "player")).toBe(true);
    expect(isAllowedForRole("StartMatch", "player")).toBe(true);
    expect(isAllowedForRole("RemovePlayer", "player")).toBe(false);
    expect(isAllowedForRole("SwapRounds", "player")).toBe(false);
  });

  it("chỉ Chủ và Phó được đổi thể thức round robin", () => {
    for (const type of [
      "StartRoundRobinCampaign",
      "RemoveRoundRobinPlayer",
      "ResumeAmericano",
    ] as const) {
      expect(isAllowedForRole(type, "owner"), type).toBe(true);
      expect(isAllowedForRole(type, "manager"), type).toBe(true);
      expect(isAllowedForRole(type, "operator"), type).toBe(false);
      expect(isAllowedForRole(type, "player"), type).toBe(false);
      expect(isAllowedForRole(type, "viewer"), type).toBe(false);
    }
  });
});

describe("quyền theo chính chủ", () => {
  it("sửa phần của mình thì được, kể cả khi chưa gõ mật khẩu nào", () => {
    // Người quét mã QR ở sân là `viewer`. Bắt họ xin mật khẩu chỉ để bấm "tôi về
    // đây" là dựng cửa ải đúng vào việc chỉ mình họ biết.
    for (const type of SELF_SERVICE) {
      expect(isAllowedForActor(type, "viewer", ME, ME), type).toBe(true);
      expect(isAllowedForActor(type, "player", ME, ME), type).toBe(true);
    }
  });

  it("mật khẩu người chơi KHÔNG cho sửa phần của người khác", () => {
    // Đây là lỗ hổng bài này sinh ra để bịt: mật khẩu người chơi thì cả nhóm
    // biết, mà trước đây nó đủ để đổi tên hoặc cho bất kỳ ai "đã về".
    for (const type of SELF_SERVICE) {
      expect(isAllowedForActor(type, "player", ME, AI_KHAC), type).toBe(false);
      expect(isAllowedForActor(type, "viewer", ME, AI_KHAC), type).toBe(false);
    }
  });

  it("chủ sự kiện vẫn sửa được cho mọi người", () => {
    for (const type of SELF_SERVICE) {
      expect(isAllowedForActor(type, "admin", ME, AI_KHAC), type).toBe(true);
      // Chủ sự kiện thường không có tên trong buổi mình tổ chức.
      expect(isAllowedForActor(type, "admin", null, AI_KHAC), type).toBe(true);
    }
  });

  it("chưa có tên trong buổi thì không sửa được gì của ai", () => {
    for (const type of SELF_SERVICE) {
      expect(isAllowedForActor(type, "viewer", null, AI_KHAC), type).toBe(false);
      expect(isAllowedForActor(type, "player", null, ME), type).toBe(false);
    }
  });

  it("chuỗi rỗng không được khớp với chuỗi rỗng", () => {
    // Cùng cái bẫy đã bắt ở `roleFor`: bỏ hai phép `&&` thì một `myPlayerId`
    // rỗng khớp với `targetPlayerId` rỗng, và người lạ bất kỳ lọt qua.
    for (const type of SELF_SERVICE) {
      expect(isAllowedForActor(type, "viewer", "", ""), type).toBe(false);
      expect(isAllowedForActor(type, "player", "", ""), type).toBe(false);
      expect(isAllowedForActor(type, "player", null, null), type).toBe(false);
    }
  });

  it("lệnh ngoài danh sách tự phục vụ vẫn xét theo vai như cũ", () => {
    const khac: CommandType[] = ["SubmitResult", "RemovePlayer", "ClaimPlayer"];
    for (const type of khac) {
      expect(isAllowedForActor(type, "player", ME, AI_KHAC), type).toBe(
        isAllowedForRole(type, "player"),
      );
      expect(isAllowedForActor(type, "viewer", ME, AI_KHAC), type).toBe(
        isAllowedForRole(type, "viewer"),
      );
    }
  });

  it("nghỉ tạm và vào lại: tự mình thì được, cho người khác thì phải là chủ", () => {
    // Hai lệnh này cố ý nằm cả trong `ADMIN_ONLY` lẫn `SELF_SERVICE`, và đó là
    // cách duy nhất diễn đạt đúng luật: "tự xin nghỉ thì không cần hỏi ai, cho
    // người khác nghỉ thì phải là chủ sân".
    for (const type of ["PausePlayer", "ResumePlayer"] as const) {
      expect(ADMIN_ONLY.includes(type), type).toBe(true);
      expect(isAllowedForActor(type, "viewer", ME, ME), type).toBe(true);
      expect(isAllowedForActor(type, "player", ME, AI_KHAC), type).toBe(false);
      expect(isAllowedForActor(type, "admin", null, AI_KHAC), type).toBe(true);
    }
  });

  it("cửa nghỉ phải mở được cả hai chiều", () => {
    // Cho người ta tự bấm về mà bắt đi tìm chủ sân mới quay lại được là một cánh
    // cửa chỉ mở một chiều — và người bấm sẽ chỉ phát hiện ra sau khi đã bấm.
    expect(SELF_SERVICE.includes("PlayerLeft")).toBe(true);
    expect(SELF_SERVICE.includes("PausePlayer")).toBe(true);
    expect(SELF_SERVICE.includes("ResumePlayer")).toBe(true);
  });
});
