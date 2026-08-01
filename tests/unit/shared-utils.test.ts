/**
 * Unit tests — packages/shared/src/utils/index.ts
 *
 * Covers all exported utility functions:
 *   - generateId()
 *   - resolveTemplate()
 *   - resolveTemplateObj()
 *   - validateRequired()
 *   - measureMs()
 *   - nowISO()
 *   - todayStr()
 *
 * Strategy: Pure functions with no external dependencies — test directly.
 */
import { describe, it, expect, vi } from "vitest";
import {
  generateId,
  resolveTemplate,
  resolveTemplateObj,
  validateRequired,
  measureMs,
  nowISO,
  todayStr,
} from "@shared/utils";

// ═══════════════════════════════════════════════════════════════
// generateId()
// ═══════════════════════════════════════════════════════════════

describe("generateId()", () => {
  it("should return a non-empty string", () => {
    const id = generateId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("should return unique values on consecutive calls", () => {
    const id1 = generateId();
    const id2 = generateId();
    expect(id1).not.toBe(id2);
  });

  it("should prepend the prefix with underscore when prefix is provided", () => {
    const id = generateId("crew");
    expect(id.startsWith("crew_")).toBe(true);
  });

  it("should not prepend underscore when no prefix is provided", () => {
    const id = generateId();
    expect(id.startsWith("_")).toBe(false);
  });

  it("should produce empty prefix variant with base36 chars only", () => {
    const id = generateId();
    // base36: 0-9, a-z
    expect(id).toMatch(/^[0-9a-z]+$/);
  });

  it("should produce prefixed variant with valid format", () => {
    const id = generateId("feat");
    expect(id).toMatch(/^feat_[0-9a-z]+$/);
  });
});

// ═══════════════════════════════════════════════════════════════
// resolveTemplate()
// ═══════════════════════════════════════════════════════════════

describe("resolveTemplate()", () => {
  it("should replace a simple variable", () => {
    const result = resolveTemplate("Hello {{name}}", { name: "World" });
    expect(result).toBe("Hello World");
  });

  it("should replace multiple variables in one template", () => {
    const result = resolveTemplate("{{greeting}}, {{name}}!", { greeting: "Hi", name: "Bob" });
    expect(result).toBe("Hi, Bob!");
  });

  it("should resolve nested dot-path variables", () => {
    const result = resolveTemplate("{{user.name}}", { user: { name: "Alice" } });
    expect(result).toBe("Alice");
  });

  it("should resolve deeply nested dot-path variables", () => {
    const result = resolveTemplate("{{a.b.c}}", { a: { b: { c: "deep" } } });
    expect(result).toBe("deep");
  });

  it("should return empty string for missing variables", () => {
    const result = resolveTemplate("Hello {{missing}}", {});
    expect(result).toBe("Hello ");
  });

  it("should return empty string for null intermediate path", () => {
    const result = resolveTemplate("{{a.b}}", { a: null });
    expect(result).toBe("");
  });

  it("should return empty string for undefined intermediate path", () => {
    const result = resolveTemplate("{{a.b}}", { a: undefined });
    expect(result).toBe("");
  });

  it("should stringify non-string values", () => {
    const result = resolveTemplate("Count: {{count}}", { count: 42 });
    expect(result).toBe("Count: 42");
  });

  it("should stringify boolean values", () => {
    const result = resolveTemplate("Active: {{active}}", { active: true });
    expect(result).toBe("Active: true");
  });

  it("should not modify template without placeholders", () => {
    const result = resolveTemplate("plain text", {});
    expect(result).toBe("plain text");
  });

  it("should handle empty vars object", () => {
    const result = resolveTemplate("Hello {{name}}", {});
    expect(result).toBe("Hello ");
  });

  it("should handle null value in vars (treated as empty)", () => {
    const result = resolveTemplate("Val: {{x}}", { x: null });
    expect(result).toBe("Val: ");
  });
});

// ═══════════════════════════════════════════════════════════════
// resolveTemplateObj()
// ═══════════════════════════════════════════════════════════════

describe("resolveTemplateObj()", () => {
  it("should resolve string values in an object", () => {
    const result = resolveTemplateObj({ msg: "Hello {{name}}" }, { name: "World" });
    expect(result.msg).toBe("Hello World");
  });

  it("should resolve nested object values", () => {
    const result = resolveTemplateObj(
      { outer: { inner: "{{value}}" } },
      { value: "resolved" }
    );
    expect(result.outer.inner).toBe("resolved");
  });

  it("should keep non-string values as-is (numbers)", () => {
    const result = resolveTemplateObj({ count: 42 }, {});
    expect(result.count).toBe(42);
  });

  it("should keep non-string values as-is (booleans)", () => {
    const result = resolveTemplateObj({ active: true }, {});
    expect(result.active).toBe(true);
  });

  it("should recursively process arrays (converts to object with numeric keys)", () => {
    const result = resolveTemplateObj({ list: [1, 2, 3] }, {});
    // Arrays are typeof "object", so resolveTemplateObj recurses into them,
    // producing an object with numeric string keys instead of an array
    expect(result.list).toEqual({ "0": 1, "1": 2, "2": 3 });
  });

  it("should resolve multiple keys independently", () => {
    const result = resolveTemplateObj(
      { a: "{{x}}", b: "{{y}}" },
      { x: "1", y: "2" }
    );
    expect(result.a).toBe("1");
    expect(result.b).toBe("2");
  });

  it("should not modify the original object", () => {
    const original = { msg: "{{name}}" };
    resolveTemplateObj(original, { name: "test" });
    expect(original.msg).toBe("{{name}}");
  });
});

// ═══════════════════════════════════════════════════════════════
// validateRequired()
// ═══════════════════════════════════════════════════════════════

describe("validateRequired()", () => {
  it("should return null when all required fields are present", () => {
    const result = validateRequired({ name: "test", age: 25 }, ["name", "age"]);
    expect(result).toBeNull();
  });

  it("should return error message for missing field", () => {
    const result = validateRequired({ name: "test" }, ["name", "email"]);
    expect(result).toBe("Missing required field: email");
  });

  it("should return error for undefined field", () => {
    const result = validateRequired({ name: undefined }, ["name"]);
    expect(result).toBe("Missing required field: name");
  });

  it("should return error for null field", () => {
    const result = validateRequired({ name: null }, ["name"]);
    expect(result).toBe("Missing required field: name");
  });

  it("should return error for empty string field", () => {
    const result = validateRequired({ name: "" }, ["name"]);
    expect(result).toBe("Missing required field: name");
  });

  it("should accept falsy values that are not undefined/null/empty", () => {
    const result = validateRequired({ count: 0, active: false }, ["count", "active"]);
    expect(result).toBeNull();
  });

  it("should return error for the first missing field only", () => {
    const result = validateRequired({}, ["a", "b", "c"]);
    expect(result).toBe("Missing required field: a");
  });

  it("should return null when required array is empty", () => {
    const result = validateRequired({}, []);
    expect(result).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// measureMs()
// ═══════════════════════════════════════════════════════════════

describe("measureMs()", () => {
  it("should return the result of the async function", async () => {
    const { result } = await measureMs(async () => 42);
    expect(result).toBe(42);
  });

  it("should return the elapsed time as a number", async () => {
    const { ms } = await measureMs(async () => "done");
    expect(typeof ms).toBe("number");
    expect(ms).toBeGreaterThanOrEqual(0);
  });

  it("should measure actual elapsed time", async () => {
    const { ms } = await measureMs(async () => {
      await new Promise(r => setTimeout(r, 50));
      return "slow";
    });
    expect(ms).toBeGreaterThanOrEqual(30); // Allow some tolerance
  });

  it("should propagate errors from the async function", async () => {
    await expect(
      measureMs(async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
  });

  it("should handle functions returning objects", async () => {
    const { result } = await measureMs(async () => ({ a: 1 }));
    expect(result).toEqual({ a: 1 });
  });
});

// ═══════════════════════════════════════════════════════════════
// nowISO()
// ═══════════════════════════════════════════════════════════════

describe("nowISO()", () => {
  it("should return a valid ISO 8601 string", () => {
    const result = nowISO();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("should return a string that can be parsed by Date", () => {
    const result = nowISO();
    const parsed = new Date(result);
    expect(parsed.getTime()).not.toBeNaN();
  });
});

// ═══════════════════════════════════════════════════════════════
// todayStr()
// ═══════════════════════════════════════════════════════════════

describe("todayStr()", () => {
  it("should return a YYYY-MM-DD format string", () => {
    const result = todayStr();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("should match the date portion of nowISO()", () => {
    const iso = nowISO();
    const today = todayStr();
    expect(iso.startsWith(today)).toBe(true);
  });
});
