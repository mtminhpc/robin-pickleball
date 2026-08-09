import { describe, expect, it } from "vitest";
import {
  CLIENT_DATA_VERSION_KEY,
  refreshLocalDataVersion,
  type StorageLike,
} from "../lib/client-data-version";

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>();

  constructor(initial: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(initial)) this.values.set(key, value);
  }

  get length(): number {
    return this.values.size;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe("làm mới dữ liệu trình duyệt theo phiên bản", () => {
  it("không làm gì khi đã đúng phiên bản", () => {
    const storage = new MemoryStorage({ [CLIENT_DATA_VERSION_KEY]: "v0.3.0" });

    expect(refreshLocalDataVersion(storage, "v0.3.0")).toEqual({
      changed: false,
      shouldReload: false,
      removedKeys: [],
      previousVersion: "v0.3.0",
    });
  });

  it("xoá khóa tạm cũ nhưng giữ toàn bộ dữ liệu người dùng", () => {
    const storage = new MemoryStorage({
      [CLIENT_DATA_VERSION_KEY]: "v0.2.1",
      rp_profile: "profile",
      rp_recent_events: "events",
      rp_recent_events_account: "user-id",
      rp_recent_clubs: "clubs",
      rp_old_draft: "temporary",
      another_library: "untouched",
    });

    const result = refreshLocalDataVersion(storage, "v0.3.0");

    expect(result).toMatchObject({
      changed: true,
      shouldReload: true,
      removedKeys: ["rp_old_draft"],
      previousVersion: "v0.2.1",
    });
    expect(storage.getItem("rp_profile")).toBe("profile");
    expect(storage.getItem("rp_recent_events")).toBe("events");
    expect(storage.getItem("rp_recent_events_account")).toBe("user-id");
    expect(storage.getItem("rp_recent_clubs")).toBe("clubs");
    expect(storage.getItem("another_library")).toBe("untouched");
    expect(storage.getItem("rp_old_draft")).toBeNull();
    expect(storage.getItem(CLIENT_DATA_VERSION_KEY)).toBe("v0.3.0");
  });

  it("lượt mở đầu tiên chỉ ghi phiên bản, không bắt tải lại", () => {
    const storage = new MemoryStorage();

    const result = refreshLocalDataVersion(storage, "v0.3.0");

    expect(result.shouldReload).toBe(false);
    expect(storage.getItem(CLIENT_DATA_VERSION_KEY)).toBe("v0.3.0");
  });

  it("nhận ra máy cũ chưa từng có khóa phiên bản và tải lại một lần", () => {
    const storage = new MemoryStorage({ rp_profile: "profile" });

    const result = refreshLocalDataVersion(storage, "v0.3.0");

    expect(result.shouldReload).toBe(true);
    expect(storage.getItem("rp_profile")).toBe("profile");
  });
});
