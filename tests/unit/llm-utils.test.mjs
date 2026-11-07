/**
 * Unit tests — LLM Utilities (sanitizeContent, isMeaningfulContent, resolveDefaultModel)
 *
 * Tests the pure functions from llm-utils.mjs that handle invisible character
 * sanitization, content validation, and provider config model resolution.
 */
import { describe, it, expect } from "vitest";
import {
  sanitizeContent,
  isMeaningfulContent,
  resolveDefaultModel,
} from "../../packages/server/src/lib/llm-utils.mjs";

// ── sanitizeContent ──

describe("sanitizeContent", () => {
  it("clears BOM (U+FEFF)", () => {
    const input = "\uFEFFHello World";
    expect(sanitizeContent(input)).toBe("Hello World");
  });

  it("clears zero-width space (U+200B)", () => {
    const input = "Hello\u200BWorld";
    expect(sanitizeContent(input)).toBe("HelloWorld");
  });

  it("clears zero-width non-joiner (U+200C)", () => {
    const input = "Hello\u200CWorld";
    expect(sanitizeContent(input)).toBe("HelloWorld");
  });

  it("clears soft hyphen (U+00AD)", () => {
    const input = "Hello\u00ADWorld";
    expect(sanitizeContent(input)).toBe("HelloWorld");
  });

  it("clears text direction marks (LRE, RLE, PDF, LRO, RLO)", () => {
    const input = "Hello\u202AWorld\u202C";
    const result = sanitizeContent(input);
    expect(result).toBe("HelloWorld");
  });

  it("clears LRM/RLM marks (U+200E, U+200F)", () => {
    const input = "Hello\u200EWorld\u200F";
    expect(sanitizeContent(input)).toBe("HelloWorld");
  });

  it("returns empty string for null/undefined/empty", () => {
    expect(sanitizeContent(null)).toBe("");
    expect(sanitizeContent(undefined)).toBe("");
    expect(sanitizeContent("")).toBe("");
  });

  it("does not modify normal text", () => {
    const input = "Hello, World! 你好世界！";
    expect(sanitizeContent(input)).toBe(input);
  });

  it("handles mixed hidden chars and normal text", () => {
    const input = "\uFEFF\u200BHello\u00AD \u200CWorld\u200D!\u200E";
    expect(sanitizeContent(input)).toBe("Hello World!");
  });

  it("trims leading/trailing whitespace", () => {
    expect(sanitizeContent("  hello  ")).toBe("hello");
    expect(sanitizeContent("\n\nhello\n\n")).toBe("hello");
  });

  it("collapses excessive newlines (4+) into 3", () => {
    const input = "line1\n\n\n\n\nline2";
    const result = sanitizeContent(input);
    expect(result).not.toContain("\n\n\n\n");
  });
});

// ── isMeaningfulContent ──

describe("isMeaningfulContent", () => {
  it("returns true for normal text", () => {
    expect(isMeaningfulContent("Hello, World!")).toBe(true);
    expect(isMeaningfulContent("你好世界")).toBe(true);
  });

  it("returns false for empty string", () => {
    expect(isMeaningfulContent("")).toBe(false);
  });

  it("returns false for null/undefined", () => {
    expect(isMeaningfulContent(null)).toBe(false);
    expect(isMeaningfulContent(undefined)).toBe(false);
  });

  it("returns false for only whitespace", () => {
    expect(isMeaningfulContent("   ")).toBe(false);
    expect(isMeaningfulContent("\n\n\n")).toBe(false);
    expect(isMeaningfulContent("\t\t")).toBe(false);
  });

  it("returns false for only hidden characters", () => {
    expect(isMeaningfulContent("\u200B\u200C\u200D\uFEFF")).toBe(false);
    expect(isMeaningfulContent("\u00AD\u200E\u200F")).toBe(false);
  });

  it("returns false for only punctuation", () => {
    expect(isMeaningfulContent("。，．")).toBe(false);
    expect(isMeaningfulContent(". , ; ! ?")).toBe(false);
  });

  it("returns true for text with real content even with hidden chars", () => {
    expect(isMeaningfulContent("\u200BHello\u200B")).toBe(true);
    expect(isMeaningfulContent("\uFEFF你好\uFEFF")).toBe(true);
  });
});

// ── resolveDefaultModel ──

describe("resolveDefaultModel", () => {
  it("returns defaultModel when it exists", () => {
    const config = { defaultModel: "gpt-4o" };
    expect(resolveDefaultModel(config)).toBe("gpt-4o");
  });

  it("returns defaultModel even when providers are configured", () => {
    const config = {
      defaultModel: "claude-3.5-sonnet",
      active: "anthropic",
      providers: {
        anthropic: { models: ["claude-3-haiku", "claude-3.5-sonnet"] },
      },
    };
    expect(resolveDefaultModel(config)).toBe("claude-3.5-sonnet");
  });

  it("returns first model string from active provider when no defaultModel", () => {
    const config = {
      active: "openai",
      providers: {
        openai: { models: ["gpt-4o", "gpt-4o-mini"] },
      },
    };
    expect(resolveDefaultModel(config)).toBe("gpt-4o");
  });

  it("returns first model .id when models is array of objects", () => {
    const config = {
      active: "openai",
      providers: {
        openai: { models: [{ id: "gpt-4o" }, { id: "gpt-4o-mini" }] },
      },
    };
    expect(resolveDefaultModel(config)).toBe("gpt-4o");
  });

  it('returns "default" when nothing is configured', () => {
    expect(resolveDefaultModel({})).toBe("default");
    expect(resolveDefaultModel(null)).toBe("default");
    expect(resolveDefaultModel(undefined)).toBe("default");
  });

  it('returns "default" when active provider has no models', () => {
    const config = {
      active: "custom",
      providers: {
        custom: { models: [] },
      },
    };
    expect(resolveDefaultModel(config)).toBe("default");
  });

  it('returns "default" when active provider does not exist', () => {
    const config = {
      active: "nonexistent",
      providers: {},
    };
    expect(resolveDefaultModel(config)).toBe("default");
  });
});
