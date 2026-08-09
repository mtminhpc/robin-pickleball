/**
 * Kiểm thử ảnh đại diện thật và quyền chủ theo tài khoản.
 *
 * Ba nhóm rủi ro, và cả ba đều là loại "chạy thử bằng tay sẽ không thấy":
 *
 * 1. **Ảnh gửi thẳng không qua trình duyệt.** Bước thu nhỏ chạy trên máy người
 *    dùng, nên nó không phải là một lớp bảo vệ — `curl` bỏ qua nó dễ dàng. Phép
 *    kiểm ở máy chủ mới là lớp thật, và nó phải chặn đúng thứ cần chặn.
 * 2. **Gộp `prefs` chứ không đè.** Hai đường ghi khác nhau vào cùng một ô JSON:
 *    đăng nhập Google ghi `picture`, người dùng bấm tải ảnh ghi `photo`. Đè nhau
 *    thì mất dữ liệu một cách lặng lẽ.
 * 3. **Chuỗi rỗng bằng chuỗi rỗng.** `ownerUserId` rỗng với mọi buổi tạo lúc chưa
 *    đăng nhập. Một phép so sánh thiếu canh là người lạ thành chủ mọi buổi cũ.
 */

import { describe, expect, it } from "vitest";
import {
  MAX_PHOTO_CHARS,
  checkPhotoDataUri,
  coverBox,
} from "../lib/avatars/photo";
import { isOwnerByAccount, roleFor } from "../lib/api/context";
import { FakeSheetsClient } from "../lib/sheets/client";
import { AccountRepo } from "../lib/sheets/accounts";

/** Một điểm ảnh PNG hợp lệ, đủ ngắn để đọc được trong mã kiểm thử. */
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("kiểm ảnh gửi lên", () => {
  it("nhận data URI đúng khuôn", () => {
    const checked = checkPhotoDataUri(TINY_PNG);
    expect(checked.ok).toBe(true);
    if (checked.ok) expect(checked.mime).toBe("image/png");
  });

  it("nhận cả webp và jpeg", () => {
    for (const mime of ["image/webp", "image/jpeg"]) {
      const checked = checkPhotoDataUri(`data:${mime};base64,AAAA`);
      expect(checked.ok, mime).toBe(true);
    }
  });

  it("từ chối SVG", () => {
    // SVG là tài liệu chạy được kịch bản, mà ảnh đại diện thì hiện trên màn hình
    // của mọi người trong buổi đánh chứ không riêng người tải lên.
    const checked = checkPhotoDataUri("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=");
    expect(checked.ok).toBe(false);
  });

  it("từ chối chuỗi không phải data URI", () => {
    for (const bad of ["https://example.com/a.png", "", "data:image/png,abc", null, 7]) {
      expect(checkPhotoDataUri(bad).ok, String(bad)).toBe(false);
    }
  });

  it("từ chối base64 lẻ nhóm bốn", () => {
    // Dữ liệu hỏng dọc đường. Cho qua thì ảnh giải mã ra bị vỡ mà không ai báo lỗi.
    expect(checkPhotoDataUri("data:image/png;base64,AAA").ok).toBe(false);
  });

  it("từ chối ảnh vượt trần, và trần đủ rộng cho một tấm 128×128 thật", () => {
    const huge = `data:image/webp;base64,${"A".repeat(MAX_PHOTO_CHARS)}`;
    expect(checkPhotoDataUri(huge).ok).toBe(false);

    // Một tấm 128×128 nén WebP nằm quanh 3–5KB, tức khoảng 6.700 ký tự sau base64.
    // Trần phải rộng hơn thế nhiều lần, nếu không người dùng bình thường sẽ đụng.
    expect(MAX_PHOTO_CHARS).toBeGreaterThan(4 * 6_700);
    // Và vẫn phải nằm dưới giới hạn 50.000 ký tự của một ô Google Sheets, còn
    // chừa chỗ cho phần còn lại của `prefs_json`.
    expect(MAX_PHOTO_CHARS).toBeLessThan(40_000);
  });
});

describe("khung cắt ảnh vuông", () => {
  it("ảnh ngang thì cắt hai bên", () => {
    expect(coverBox(200, 100)).toEqual({ sx: 50, sy: 0, size: 100 });
  });

  it("ảnh dọc thì cắt trên dưới", () => {
    expect(coverBox(100, 300)).toEqual({ sx: 0, sy: 100, size: 100 });
  });

  it("ảnh vuông thì không cắt gì", () => {
    expect(coverBox(64, 64)).toEqual({ sx: 0, sy: 0, size: 64 });
  });

  it("cạnh lẻ vẫn cho số nguyên", () => {
    // `drawImage` nhận số thực, nhưng toạ độ lẻ làm ảnh mờ đi một chút vì trình
    // duyệt phải nội suy. Làm tròn xuống là đủ và luôn đoán trước được.
    const box = coverBox(101, 100);
    expect(Number.isInteger(box.sx)).toBe(true);
    expect(Number.isInteger(box.size)).toBe(true);
  });

  it("không bao giờ trả về cạnh bằng 0", () => {
    expect(coverBox(0, 0).size).toBe(1);
  });
});

describe("lưu ảnh vào tài khoản", () => {
  function fresh() {
    const sheets = new FakeSheetsClient();
    return { sheets, repo: new AccountRepo(sheets) };
  }

  const seed = {
    email: "nam@example.com",
    displayName: "Nam",
    avatarId: "e01-c01",
    at: 1000,
  };

  it("gộp khoá mới vào prefs chứ không đè cả cụm", async () => {
    const { repo } = fresh();
    const account = await repo.upsertByEmail({
      ...seed,
      prefs: { picture: "https://lh3.example/nam.jpg" },
    });

    const updated = await repo.updatePrefs(account.userId, { photo: TINY_PNG });

    expect(updated?.prefs.photo).toBe(TINY_PNG);
    // Địa chỉ ảnh Google phải còn nguyên, nếu không thì bấm "Xoá ảnh" sau này sẽ
    // không quay về đâu được.
    expect(updated?.prefs.picture).toBe("https://lh3.example/nam.jpg");
  });

  it("đặt undefined là xoá hẳn khoá, không phải ghi chuỗi rỗng", async () => {
    const { repo } = fresh();
    const account = await repo.upsertByEmail({
      ...seed,
      prefs: { picture: "https://lh3.example/nam.jpg", photo: TINY_PNG },
    });

    const updated = await repo.updatePrefs(account.userId, { photo: undefined });

    expect(updated?.prefs.photo).toBeUndefined();
    expect("photo" in (updated?.prefs ?? {})).toBe(false);
    expect(updated?.prefs.picture).toBe("https://lh3.example/nam.jpg");
  });

  it("tài khoản không tồn tại thì trả null và không ghi gì", async () => {
    const { sheets, repo } = fresh();
    await repo.upsertByEmail(seed);
    const before = sheets.calls.batch;

    expect(await repo.updatePrefs("u-khong-co", { photo: TINY_PNG })).toBeNull();
    expect(sheets.calls.batch).toBe(before);
  });

  it("ảnh sống sót qua lần đăng nhập Google kế tiếp", async () => {
    // `upsertByEmail` chạy lại mỗi lần đăng nhập và merge `prefs`. Nếu nó đè cả
    // cụm thì ảnh người dùng tự chọn sẽ biến mất sau mỗi lần mở app trên máy mới.
    const { repo } = fresh();
    const account = await repo.upsertByEmail(seed);
    await repo.updatePrefs(account.userId, { photo: TINY_PNG });

    const again = await repo.upsertByEmail({
      ...seed,
      at: 2000,
      prefs: { picture: "https://lh3.example/moi.jpg" },
    });

    expect(again.prefs.photo).toBe(TINY_PNG);
    expect(again.prefs.picture).toBe("https://lh3.example/moi.jpg");
  });
});

describe("quyền chủ theo tài khoản", () => {
  const owned = { ownerUserId: "u-nam" };
  const anonymous = { ownerUserId: "" };

  it("chủ theo tài khoản thắng cookie chế độ xem", () => {
    expect(roleFor(owned, "viewer", "u-nam")).toBe("owner");
    expect(roleFor(owned, null, "u-nam")).toBe("owner");
  });

  it("tài khoản khác vẫn chỉ là người xem", () => {
    expect(roleFor(owned, null, "u-mai")).toBe("viewer");
    expect(isOwnerByAccount(owned, "u-mai")).toBe(false);
  });

  it("buổi tạo lúc chưa đăng nhập không biến ai thành chủ", () => {
    // Đây là bẫy chính. `ownerUserId` rỗng với mọi buổi tạo trước khi có tài
    // khoản, và một phép so sánh thiếu canh sẽ cho chuỗi rỗng khớp chuỗi rỗng —
    // tức người lạ bất kỳ thành chủ mọi buổi đánh cũ.
    expect(roleFor(anonymous, null, "")).toBe("viewer");
    expect(roleFor(anonymous, null, null)).toBe("viewer");
    expect(isOwnerByAccount(anonymous, "")).toBe(false);
    expect(isOwnerByAccount(anonymous, null)).toBe(false);
  });

  it("không có tài khoản thì mật khẩu vẫn quyết định như cũ", () => {
    expect(roleFor(anonymous, "admin", null)).toBe("admin");
    expect(roleFor(anonymous, "player", null)).toBe("player");
    expect(roleFor(anonymous, null, null)).toBe("viewer");
  });
});
