/**
 * Unit tests — Coding Security Extended
 *
 * Additional edge cases for safeResolve and sanitizeId from coding-security.mjs,
 * complementing the existing coding-security.test.mjs.
 */
import { describe, it, expect } from "vitest";
import { tmpdir } from "os";
import { join } from "path";
import {
  sanitizeId,
  safeResolve,
  sendPathTraversalError,
} from "../../packages/server/src/lib/coding-security.mjs";

// ── safeResolve extended ──

describe("safeResolve — extended edge cases", () => {
  const root = join(tmpdir(), "paaw-sec-ext-root");

  it("resolves a normal nested subpath", () => {
    expect(safeResolve(root, "src", "app.js")).toBe(join(root, "src", "app.js"));
  });

  it("resolves multi-level nested directories", () => {
    expect(safeResolve(root, "a", "b", "c", "d.txt")).toBe(
      join(root, "a", "b", "c", "d.txt")
    );
  });

  it("blocks single parent escape (..)", () => {
    expect(() => safeResolve(root, "..")).toThrow(/traversal/i);
  });

  it("blocks ../etc/passwd", () => {
    expect(() => safeResolve(root, "../etc/passwd")).toThrow(/traversal/i);
  });

  it("blocks multi-level ../../../ escape", () => {
    expect(() => safeResolve(root, "../../../etc/passwd")).toThrow(/traversal/i);
  });

  it("blocks deeply nested traversal ../../../...", () => {
    expect(() => safeResolve(root, "..", "..", "..", "..", "..", "etc", "passwd")).toThrow(/traversal/i);
  });

  it("blocks absolute path pointing outside root", () => {
    expect(() => safeResolve(root, "/etc/passwd")).toThrow(/traversal/i);
  });

  it("allows interior normalization a/../b → b", () => {
    expect(safeResolve(root, "a/../b")).toBe(join(root, "b"));
  });

  it("allows interior normalization with multiple levels", () => {
    expect(safeResolve(root, "a/b/../c")).toBe(join(root, "a", "c"));
  });

  it("handles empty segments (no segments)", () => {
    // Just root with no extra segments should resolve to root
    const result = safeResolve(root);
    expect(result).toBe(root);
  });

  it("handles dot segments (./foo)", () => {
    expect(safeResolve(root, "./foo")).toBe(join(root, "foo"));
  });

  it("blocks traversal hidden in longer path", () => {
    expect(() => safeResolve(root, "valid/../../../escape")).toThrow(/traversal/i);
  });

  it("throws error with PATH_TRAVERSAL code", () => {
    try {
      safeResolve(root, "../../escape");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err.code).toBe("PATH_TRAVERSAL");
      expect(err.message).toMatch(/traversal/i);
    }
  });
});

// ── sanitizeId edge cases ──

describe("sanitizeId — edge cases", () => {
  it("accepts a normal alphanumeric id", () => {
    expect(sanitizeId("agent123")).toBe("agent123");
  });

  it("accepts dots (crewId like coding.architect)", () => {
    expect(sanitizeId("coding.architect")).toBe("coding.architect");
  });

  it("accepts hyphens and underscores", () => {
    expect(sanitizeId("my-agent_v2")).toBe("my-agent_v2");
  });

  it("accepts a long string (256 chars)", () => {
    const long = "a".repeat(256);
    expect(sanitizeId(long)).toBe(long);
  });

  it("accepts Unicode characters (Chinese)", () => {
    // Chinese characters are NOT in [a-zA-Z0-9._-], so they should be rejected
    expect(() => sanitizeId("測試agent")).toThrow(/Invalid identifier/i);
  });

  it("rejects Japanese characters", () => {
    expect(() => sanitizeId("エージェント")).toThrow(/Invalid identifier/i);
  });

  it("accepts spaces? No — spaces are not in the whitelist", () => {
    expect(() => sanitizeId("agent 123")).toThrow(/Invalid identifier/i);
  });

  it("rejects special characters @#$%^&*", () => {
    expect(() => sanitizeId("agent@#$")).toThrow(/Invalid identifier/i);
  });

  it("rejects path separator /", () => {
    expect(() => sanitizeId("agent/../../../etc")).toThrow(/Invalid identifier/i);
  });

  it("rejects backslash \\", () => {
    expect(() => sanitizeId("agent\\..\\..")).toThrow(/Invalid identifier/i);
  });

  it("rejects double dots (..)", () => {
    expect(() => sanitizeId("..")).toThrow(/Invalid identifier/i);
  });

  it("rejects mixed valid/invalid characters", () => {
    expect(() => sanitizeId("valid|invalid")).toThrow(/Invalid identifier/i);
    expect(() => sanitizeId("valid!invalid")).toThrow(/Invalid identifier/i);
    expect(() => sanitizeId("valid\ninvalid")).toThrow(/Invalid identifier/i);
  });

  it("rejects empty string", () => {
    expect(() => sanitizeId("")).toThrow(/Invalid identifier/i);
  });

  it("rejects null/undefined", () => {
    expect(() => sanitizeId(null)).toThrow(/Invalid identifier/i);
    expect(() => sanitizeId(undefined)).toThrow(/Invalid identifier/i);
  });

  it("throws error with PATH_TRAVERSAL code", () => {
    try {
      sanitizeId("../etc/passwd");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err.code).toBe("PATH_TRAVERSAL");
    }
  });
});

// ── sendPathTraversalError ──

describe("sendPathTraversalError", () => {
  function createMockRes() {
    const chunks = [];
    return {
      writeHead: (_status, _headers) => {},
      end: (data) => {
        chunks.push(data);
      },
      getBody: () => chunks.join(""),
    };
  }

  it("sends a 400 JSON response with error message", () => {
    const res = createMockRes();
    const err = new Error("Path traversal blocked: ../etc/passwd");
    err.code = "PATH_TRAVERSAL";
    const result = sendPathTraversalError(res, err);
    expect(result).toBe(true);
    const body = JSON.parse(res.getBody());
    expect(body.error).toMatch(/traversal/i);
    expect(body.code).toBe("PATH_TRAVERSAL");
  });

  it("uses default code if not set", () => {
    const res = createMockRes();
    const err = new Error("Something went wrong");
    const result = sendPathTraversalError(res, err);
    expect(result).toBe(true);
    const body = JSON.parse(res.getBody());
    expect(body.code).toBe("PATH_TRAVERSAL");
    expect(body.error).toBe("Something went wrong");
  });
});
