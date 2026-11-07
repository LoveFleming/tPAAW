/**
 * Unit tests — coding-security safeResolve (path traversal guard)
 *
 * Verifies that safeResolve rejects paths that escape the root while allowing
 * legitimate paths inside it. This guards static file serving against
 * path traversal (CWE-22).
 */
import { describe, it, expect } from "vitest";
import { tmpdir } from "os";
import { join } from "path";
import { safeResolve, sanitizeId } from "../../packages/server/src/lib/coding-security.mjs";

describe("safeResolve — path traversal guard", () => {
  const root = join(tmpdir(), "paaw-saferesolve-root");

  describe("allows legitimate paths inside root", () => {
    it("resolves a plain nested path", () => {
      expect(safeResolve(root, "js/app.js")).toBe(join(root, "js/app.js"));
    });

    it("resolves the root itself", () => {
      expect(safeResolve(root, "index.html")).toBe(join(root, "index.html"));
    });

    it("normalizes interior segments", () => {
      // "a/../b" stays inside root once resolved
      expect(safeResolve(root, "a/../b")).toBe(join(root, "b"));
    });
  });

  describe("rejects path traversal", () => {
    it("blocks a direct parent escape", () => {
      expect(() => safeResolve(root, "../secret")).toThrowError(/traversal/i);
    });

    it("blocks multi-level escape", () => {
      expect(() => safeResolve(root, "../../etc/passwd")).toThrowError(/traversal/i);
    });

    it("throws with PATH_TRAVERSAL code", () => {
      try {
        safeResolve(root, "../../etc/passwd");
        expect.fail("should have thrown");
      } catch (err) {
        expect(err.code).toBe("PATH_TRAVERSAL");
      }
    });

    it("blocks encoded backslash escapes", () => {
      // On Windows, backslash is a path separator — test there.
      // On Unix, backslashes are valid filename chars and won't trigger traversal.
      if (process.platform === "win32") {
        expect(() => safeResolve(root, "..\\..\\win")).toThrowError(/traversal/i);
      } else {
        // On Unix this resolves to a normal subdirectory — should NOT throw
        const result = safeResolve(root, "..\\..\\win");
        expect(result.startsWith(root)).toBe(true);
      }
    });
  });
});

// ── 2026-10-02 補：sanitizeId 覆蓋（crewId/sessionId 白名單）──
describe("sanitizeId — identifier 白名單", () => {
  it("允許合法 id（含 dot crewId）", () => {
    expect(sanitizeId("coding.architect")).toBe("coding.architect");
    expect(sanitizeId("s-2026-10-02-ab12")).toBe("s-2026-10-02-ab12");
    expect(sanitizeId("task_42")).toBe("task_42");
  });

  it("拒絕路徑字元與穿越", () => {
    expect(() => sanitizeId("../etc/passwd")).toThrow();
    expect(() => sanitizeId("a/b")).toThrow();
    expect(() => sanitizeId("a\\b")).toThrow();
    expect(() => sanitizeId("..")).toThrow();
  });

  it("拒絕非字串與空值", () => {
    expect(() => sanitizeId(null)).toThrow();
    expect(() => sanitizeId("")).toThrow();
    expect(() => sanitizeId(42)).toThrow();
  });

  it("錯誤帶 PATH_TRAVERSAL code", () => {
    try { sanitizeId("../x"); expect.unreachable(); }
    catch (e) { expect(e.code).toBe("PATH_TRAVERSAL"); }
  });
});
