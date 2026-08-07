/**
 * Kiểm thử mật khẩu và cookie phiên.
 *
 * Đây là thứ duy nhất ngăn người ngoài sửa kết quả của cả nhóm, nên các bài dưới
 * đây kiểm cả đường thành công lẫn mọi cách làm giả mà một người biết chút kỹ
 * thuật sẽ thử: sửa nội dung cookie, dùng cookie của sự kiện khác, dùng cookie
 * đã hết hạn.
 */

import { describe, expect, it } from "vitest";
import {
  generateEventCode,
  hashPassword,
  verifyPassword,
} from "../lib/auth/passwords";
import {
  checkRateLimit,
  clearRateLimit,
  resetRateLimitsForTesting,
} from "../lib/auth/ratelimit";
import {
  cookieName,
  newSession,
  signSession,
  verifySession,
} from "../lib/auth/session";

const SECRET = "khoa-thu-nghiem-du-dai-16-ky-tu";

describe("mật khẩu", () => {
  it("băm rồi kiểm lại được", async () => {
    const stored = await hashPassword("choi123");
    expect(await verifyPassword("choi123", stored)).toBe(true);
    expect(await verifyPassword("choi124", stored)).toBe(false);
  });

  it("không bao giờ lưu mật khẩu thô", async () => {
    const stored = await hashPassword("matkhaudedoan");
    expect(stored).not.toContain("matkhaudedoan");
    expect(stored.split(":")).toHaveLength(2);
  });

  it("hai lần băm cùng mật khẩu cho hai chuỗi khác nhau", async () => {
    // Muối ngẫu nhiên: nhìn vào bảng tính không đoán được ai đặt trùng mật khẩu.
    const a = await hashPassword("giongnhau");
    const b = await hashPassword("giongnhau");
    expect(a).not.toBe(b);
    expect(await verifyPassword("giongnhau", a)).toBe(true);
    expect(await verifyPassword("giongnhau", b)).toBe(true);
  });

  it("chuỗi lưu bị hỏng thì trả về sai chứ không nổ", async () => {
    expect(await verifyPassword("bất kỳ", "")).toBe(false);
    expect(await verifyPassword("bất kỳ", "rác")).toBe(false);
    expect(await verifyPassword("bất kỳ", "a:b:c")).toBe(false);
  });
});

describe("mã sự kiện", () => {
  it("sáu ký tự, bỏ những ký tự dễ đọc nhầm", () => {
    // Mã được đọc to cho nhau nghe ở sân, nên 0/O và 1/I phải không có mặt.
    for (let i = 0; i < 200; i++) {
      const code = generateEventCode();
      expect(code).toHaveLength(6);
      expect(code).toMatch(/^[ACDEFGHJKMNPQRTUVWXY234679]{6}$/);
    }
  });
});

describe("cookie phiên", () => {
  it("ký rồi đọc lại được", () => {
    const token = signSession(newSession("ABC123", "admin"), SECRET);
    const payload = verifySession(token, "ABC123", SECRET);
    expect(payload?.role).toBe("admin");
  });

  it("từ chối cookie bị sửa nội dung", () => {
    // Đây là cách tấn công hiển nhiên nhất: đổi "player" thành "admin".
    const token = signSession(newSession("ABC123", "player"), SECRET);
    const [body, signature] = token.split(".");
    const tampered = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(body!, "base64url").toString()), role: "admin" }),
      "utf8",
    ).toString("base64url");

    expect(verifySession(`${tampered}.${signature}`, "ABC123", SECRET)).toBeNull();
  });

  it("từ chối cookie ký bằng khoá khác", () => {
    const token = signSession(newSession("ABC123", "admin"), "khoa-khac-hoan-toan");
    expect(verifySession(token, "ABC123", SECRET)).toBeNull();
  });

  it("cookie của sự kiện này không dùng cho sự kiện khác", () => {
    const token = signSession(newSession("ABC123", "admin"), SECRET);
    expect(verifySession(token, "XYZ789", SECRET)).toBeNull();
  });

  it("từ chối cookie hết hạn", () => {
    const past = Date.now() - 20 * 60 * 60 * 1000;
    const token = signSession(newSession("ABC123", "admin", past), SECRET);
    expect(verifySession(token, "ABC123", SECRET)).toBeNull();
    // Cùng cookie đó ở thời điểm nó còn hạn thì phải chấp nhận.
    expect(verifySession(token, "ABC123", SECRET, past + 1000)).not.toBeNull();
  });

  it("từ chối chuỗi rác", () => {
    expect(verifySession(undefined, "ABC123", SECRET)).toBeNull();
    expect(verifySession("", "ABC123", SECRET)).toBeNull();
    expect(verifySession("khong-co-dau-cham", "ABC123", SECRET)).toBeNull();
    expect(verifySession("a.b", "ABC123", SECRET)).toBeNull();
  });

  it("mỗi sự kiện một cookie riêng", () => {
    // Nhờ vậy chủ sân mở đồng thời buổi tối nay và buổi tuần trước không bị đá
    // quyền lẫn nhau.
    expect(cookieName("ABC123")).not.toBe(cookieName("XYZ789"));
  });
});

describe("chặn dò mật khẩu", () => {
  it("cho năm lần thử rồi khoá trong một phút", () => {
    resetRateLimitsForTesting();
    const key = "1.2.3.4:ABC123";
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(key).allowed, `lần thứ ${i + 1}`).toBe(true);
    }
    const blocked = checkRateLimit(key);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("nhập đúng thì xoá bộ đếm", () => {
    // Người gõ nhầm vài lần rồi gõ đúng không nên bị phạt tiếp ở lần sau.
    resetRateLimitsForTesting();
    const key = "1.2.3.4:ABC123";
    checkRateLimit(key);
    checkRateLimit(key);
    clearRateLimit(key);
    expect(checkRateLimit(key).remaining).toBe(4);
  });

  it("đếm riêng cho từng sự kiện và từng địa chỉ", () => {
    resetRateLimitsForTesting();
    for (let i = 0; i < 6; i++) checkRateLimit("1.1.1.1:AAA111");
    expect(checkRateLimit("1.1.1.1:AAA111").allowed).toBe(false);
    expect(checkRateLimit("1.1.1.1:BBB222").allowed).toBe(true);
    expect(checkRateLimit("2.2.2.2:AAA111").allowed).toBe(true);
  });

  it("mở lại sau khi hết cửa sổ", () => {
    resetRateLimitsForTesting();
    const key = "1.2.3.4:ABC123";
    const t0 = 1_000_000;
    for (let i = 0; i < 6; i++) checkRateLimit(key, t0);
    expect(checkRateLimit(key, t0).allowed).toBe(false);
    expect(checkRateLimit(key, t0 + 61_000).allowed).toBe(true);
  });
});
