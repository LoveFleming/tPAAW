/**
 * Unit tests — conversation crew/session id sanitization against path traversal
 *
 * Verifies sanitizeId rejects path traversal payloads and accepts safe ids.
 */
import { describe, it, expect } from "vitest";
import {
  sanitizeId,
  sendPathTraversalError,
} from "../../packages/server/src/lib/coding-security.mjs";

describe("sanitizeId — path traversal guard", () => {
  it("accepts a normal safe crew id", () => {
    expect(sanitizeId("coding.architect")).toBe("coding.architect");
    expect(sanitizeId("coding_architect")).toBe("coding_architect");
    expect(sanitizeId("crew-123")).toBe("crew-123");
  });

  it("accepts a normal session id with dashes/dots", () => {
    expect(sanitizeId("s-2026-08-03T21-00-00")).toBe("s-2026-08-03T21-00-00");
    expect(sanitizeId("a1.b2-c3_d4")).toBe("a1.b2-c3_d4");
  });

  it("rejects classic path traversal sequences", () => {
    for (const evil of ["../..", "..", "../../etc/passwd", "..%2F..", "a/../b", "..\\..\\win"]) {
      expect(() => sanitizeId(evil), `should reject: ${evil}`).toThrow();
    }
  });

  it("rejects null bytes, slashes, backslashes and empty strings", () => {
    for (const evil of ["../../", "/etc/passwd", "a\\b", "", " ", "a/b", "\0"]) {
      expect(() => sanitizeId(evil), `should reject: ${JSON.stringify(evil)}`).toThrow();
    }
  });

  it("rejects non-string input and throws with PATH_TRAVERSAL code", () => {
    for (const bad of [null, undefined, 123, {}, [".."]]) {
      expect(() => sanitizeId(bad)).toThrow();
    }
    try {
      sanitizeId("../../etc/passwd");
      // Should not reach here
      expect(true).toBe(false);
    } catch (err) {
      expect(err.code).toBe("PATH_TRAVERSAL");
    }
  });
});

describe("sendPathTraversalError", () => {
  it("writes a 400 with the error message and code", () => {
    let status = 0;
    let body = "";
    const res = {
      writeHead(code) {
        status = code;
        return this;
      },
      end(str) {
        body = str;
        return this;
      },
    };
    const err = new Error("Invalid identifier: ../..");
    err.code = "PATH_TRAVERSAL";
    const result = sendPathTraversalError(res, err);
    expect(result).toBe(true);
    expect(status).toBe(400);
    expect(JSON.parse(body)).toEqual({
      error: "Invalid identifier: ../..",
      code: "PATH_TRAVERSAL",
    });
  });
});
