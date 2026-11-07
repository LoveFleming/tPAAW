/**
 * Unit tests — F-011 chat/uploads 品質補強（security & reliability hardening）
 *
 * Covers the fixes from QA review qr-20261017-013108-1ziy:
 *  - C1: chatId path-traversal rejection (sanitizeId + safeResolve)
 *  - M2: image static service — Content-Type derived from magic bytes, not client ext
 *  - M4: bad JSON body → 400 (not 500)
 *  - M5: readBody size cap (DoS guard)
 *
 * Only pure / independently importable pieces are asserted here; the route
 * handlers themselves are exercised via API/e2e. This is a smoke regression net
 * for the security properties that the review flagged as Critical/Major.
 */
import { describe, it, expect } from "vitest";
import { tmpdir } from "os";
import { join } from "path";
import { sanitizeId, safeResolve } from "../../packages/server/src/lib/coding-security.mjs";
import { detectImageType } from "../../packages/server/src/routes/uploads.mjs";

describe("C1 — chatId path traversal guard", () => {
  const root = join(tmpdir(), "paaw-chat-root");

  it("accepts legitimate chat ids", () => {
    expect(sanitizeId("chat_1730000000")).toBe("chat_1730000000");
    expect(sanitizeId("c-2026-10-17-ab12")).toBe("c-2026-10-17-ab12");
  });

  it("rejects traversal payloads", () => {
    expect(() => sanitizeId("../../etc/passwd")).toThrow();
    expect(() => sanitizeId("a/b")).toThrow();
    expect(() => sanitizeId("..")).toThrow();
  });

  it("safeResolve keeps resolved chat file inside chat dir", () => {
    expect(safeResolve(root, "chat_1.json")).toBe(join(root, "chat_1.json"));
    expect(() => safeResolve(root, "../evil.json")).toThrowError(/traversal/i);
  });

  it("sanitizeId + safeResolve together block overwriting arbitrary .json", () => {
    let blocked = false;
    try {
      const id = sanitizeId("../../../tmp/evil");
      safeResolve(root, `${id}.json`);
    } catch (e) {
      blocked = true;
      expect(e.code).toBe("PATH_TRAVERSAL");
    }
    expect(blocked).toBe(true);
  });
});

describe("M2 — image type detection by magic bytes", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const gif = Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(10)]);
  const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")]);

  it("identifies real image formats", () => {
    expect(detectImageType(png)).toEqual({ ext: ".png", mime: "image/png" });
    expect(detectImageType(jpeg)).toEqual({ ext: ".jpg", mime: "image/jpeg" });
    expect(detectImageType(gif)).toEqual({ ext: ".gif", mime: "image/gif" });
    expect(detectImageType(webp)).toEqual({ ext: ".webp", mime: "image/webp" });
  });

  it("rejects content that is not a known image (stored-XSS payload)", () => {
    const html = Buffer.from("<html><script>alert(1)</script></html>", "utf8");
    expect(detectImageType(html)).toBeNull();
    // SVG is deliberately NOT in the allow-list — it can carry script.
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>', "utf8");
    expect(detectImageType(svg)).toBeNull();
  });

  it("rejects empty / too-short buffers", () => {
    expect(detectImageType(Buffer.alloc(0))).toBeNull();
    expect(detectImageType(Buffer.from([0xff, 0xd8]))).toBeNull();
  });
});
