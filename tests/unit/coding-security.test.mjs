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
import { safeResolve } from "../../packages/server/src/lib/coding-security.mjs";

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
      expect(() => safeResolve(root, "..\\..\\win")).toThrowError(/traversal/i);
    });
  });
});
