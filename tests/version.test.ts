import { describe, expect, it } from "vitest";
import {
  APP_CODENAME,
  APP_VERSION,
  buildVersionLabel,
  buildVersionLabelWithCodename,
} from "../lib/version";

describe("dấu phiên bản trên giao diện", () => {
  it("lấy đúng phiên bản từ package.json", () => {
    expect(APP_VERSION).toBe("v0.7.0");
  });

  it("rút commit Vercel còn bảy ký tự", () => {
    expect(buildVersionLabel("9ef76fc5ebadc403bc9765f57f1c4d4972cc9eeb")).toBe(
      "v0.7.0 · 9ef76fc",
    );
  });

  it("nói rõ local khi chưa có commit Vercel", () => {
    expect(buildVersionLabel(undefined)).toBe("v0.7.0 · local");
    expect(buildVersionLabel("  ")).toBe("v0.7.0 · local");
  });

  it("có tên hiệu cho bản phát hành", () => {
    expect(APP_CODENAME).toBe("Ánh kim");
  });

  /**
   * Bài này canh quy trình phát hành chứ không canh cách viết chữ: `AGENTS.md` bảo
   * đối chiếu Production bằng cách tìm `vX.Y.Z · <7 ký tự>` trong HTML. Ai đó chèn
   * tên hiệu vào giữa cho đẹp thì bước kiểm ấy trượt mà không ai hay.
   */
  it("đặt tên hiệu sau cặp phiên bản · commit, không chen vào giữa", () => {
    const label = buildVersionLabelWithCodename("9ef76fc5ebadc403bc9765f57f1c4d4972cc9eeb");
    expect(label).toBe("v0.7.0 · 9ef76fc · Ánh kim");
    expect(label.startsWith(buildVersionLabel("9ef76fc5ebadc403bc9765f57f1c4d4972cc9eeb"))).toBe(true);
  });
});
