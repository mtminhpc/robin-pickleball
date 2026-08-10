import { describe, expect, it } from "vitest";
import { APP_VERSION, buildVersionLabel } from "../lib/version";

describe("dấu phiên bản trên giao diện", () => {
  it("lấy đúng phiên bản từ package.json", () => {
    expect(APP_VERSION).toBe("v0.6.2");
  });

  it("rút commit Vercel còn bảy ký tự", () => {
    expect(buildVersionLabel("9ef76fc5ebadc403bc9765f57f1c4d4972cc9eeb")).toBe(
      "v0.6.2 · 9ef76fc",
    );
  });

  it("nói rõ local khi chưa có commit Vercel", () => {
    expect(buildVersionLabel(undefined)).toBe("v0.6.2 · local");
    expect(buildVersionLabel("  ")).toBe("v0.6.2 · local");
  });
});
