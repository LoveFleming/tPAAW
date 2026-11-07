/**
 * Unit tests — Context Truncation utilities
 *
 * Tests estimateTokens, smartTruncateToolResult, truncateToolResultsInMessages,
 * and limitHistoryTurns from context-truncation.mjs.
 */
import { describe, it, expect } from "vitest";
import {
  estimateTokens,
  smartTruncateToolResult,
  truncateToolResultsInMessages,
  limitHistoryTurns,
} from "../../packages/server/src/lib/context-truncation.mjs";

// ── estimateTokens ──

describe("estimateTokens", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("returns 0 for null/undefined", () => {
    expect(estimateTokens(null)).toBe(0);
    expect(estimateTokens(undefined)).toBe(0);
  });

  it("approximates ~4 chars per token for English", () => {
    const text = "Hello World, this is a test string"; // 33 chars
    const tokens = estimateTokens(text);
    // Pure latin => chars/4 ≈ 8.25 => ceil => 9
    expect(tokens).toBeGreaterThan(5);
    expect(tokens).toBeLessThan(15);
  });

  it("returns higher token count for CJK text", () => {
    const cjk = "你好世界測試字串"; // 8 CJK chars
    const tokens = estimateTokens(cjk);
    // CJK: 8 * 1.5 = 12
    expect(tokens).toBe(12);
  });

  it("handles mixed CJK and Latin text", () => {
    const mixed = "Hello 你好 World 世界"; // 12 latin + 4 CJK
    const tokens = estimateTokens(mixed);
    // 4 * 1.5 + 12/4 = 6 + 3 = 9
    expect(tokens).toBeGreaterThan(5);
    expect(tokens).toBeLessThan(20);
  });

  it("handles pure CJK characters", () => {
    const text = "日本語テスト"; // 6 CJK chars
    const tokens = estimateTokens(text);
    expect(tokens).toBeGreaterThan(0);
    // CJK chars have higher token density than latin
    const latinTokens = estimateTokens("abcdef"); // 6 chars
    expect(tokens).toBeGreaterThan(latinTokens);
  });
});

// ── smartTruncateToolResult ──

describe("smartTruncateToolResult", () => {
  it("does not truncate short text", () => {
    const text = "short output";
    expect(smartTruncateToolResult(text, 1000)).toBe(text);
  });

  it("returns empty string for null/undefined", () => {
    expect(smartTruncateToolResult(null)).toBe("");
    expect(smartTruncateToolResult(undefined)).toBe("");
  });

  it("truncates long text to specified maxChars", () => {
    const text = "A".repeat(20_000);
    const result = smartTruncateToolResult(text, 5000, { alwaysKeepTail: false });
    expect(result.length).toBeLessThan(text.length);
    expect(result.length).toBeLessThanOrEqual(5100); // head + marker
  });

  it("preserves head and tail when alwaysKeepTail is true", () => {
    const head = "HEAD_CONTENT_HERE";
    const tail = "TAIL_CONTENT_HERE";
    const middle = "X".repeat(20_000);
    const text = `${head}${middle}${tail}`;
    const result = smartTruncateToolResult(text, 5000, { alwaysKeepTail: true });
    expect(result).toContain("HEAD_CONTENT");
    expect(result).toContain("TAIL_CONTENT");
    expect(result).toContain("omitted");
  });

  it("prioritizes tail when error keywords are present", () => {
    const head = "START_OF_OUTPUT";
    const tail = "ERROR: something failed\nTraceback (most recent call last)";
    const middle = "M".repeat(20_000);
    const text = `${head}${middle}${tail}`;
    const result = smartTruncateToolResult(text, 5000);
    // Tail with error should be preserved
    expect(result).toContain("ERROR");
    expect(result).toContain("Traceback");
  });

  it("prioritizes tail when 'failed' keyword is present", () => {
    const tail = "Tests: 3 failed, 5 passed";
    const middle = "M".repeat(20_000);
    const text = `START${middle}${tail}`;
    const result = smartTruncateToolResult(text, 5000);
    expect(result).toContain("failed");
    expect(result).toContain("passed");
  });

  it("includes truncation marker when truncated", () => {
    const text = "A".repeat(20_000);
    const result = smartTruncateToolResult(text, 3000);
    expect(result).toMatch(/omitted|truncated/i);
  });
});

// ── truncateToolResultsInMessages ──

describe("truncateToolResultsInMessages", () => {
  it("does not modify non-tool messages", () => {
    const messages = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
    ];
    const result = truncateToolResultsInMessages(messages);
    expect(result).toEqual(messages);
  });

  it("truncates long tool results in messages", () => {
    const longContent = "A".repeat(50_000);
    const messages = [
      { role: "user", content: "run tool" },
      { role: "assistant", content: "", tool_calls: [{ id: "tc1", function: { name: "shell", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "tc1", content: longContent },
    ];
    const result = truncateToolResultsInMessages(messages);
    const toolMsg = result.find((m) => m.role === "tool");
    expect(toolMsg.content.length).toBeLessThan(longContent.length);
  });

  it("preserves short tool results", () => {
    const messages = [
      { role: "user", content: "run tool" },
      { role: "assistant", content: "", tool_calls: [{ id: "tc1", function: { name: "shell", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "tc1", content: "short result" },
    ];
    const result = truncateToolResultsInMessages(messages);
    expect(result.find((m) => m.role === "tool").content).toBe("short result");
  });

  it("handles empty messages array", () => {
    expect(truncateToolResultsInMessages([])).toEqual([]);
  });

  it("respects total budget across multiple tool results", () => {
    const messages = [
      { role: "user", content: "go" },
    ];
    for (let i = 0; i < 5; i++) {
      messages.push({
        role: "assistant",
        content: "",
        tool_calls: [{ id: `tc${i}`, function: { name: "shell", arguments: "{}" } }],
      });
      messages.push({
        role: "tool",
        tool_call_id: `tc${i}`,
        content: "B".repeat(20_000),
      });
    }
    const result = truncateToolResultsInMessages(messages);
    const totalToolChars = result
      .filter((m) => m.role === "tool")
      .reduce((sum, m) => sum + (m.content || "").length, 0);
    // With tier-based truncation, should be significantly reduced
    expect(totalToolChars).toBeLessThan(100_000);
  });
});

// ── limitHistoryTurns ──

describe("limitHistoryTurns", () => {
  it("preserves system + first user message", () => {
    const messages = [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "First message" },
      { role: "assistant", content: "Response 1" },
    ];
    const result = limitHistoryTurns(messages, 5);
    expect(result[0].role).toBe("system");
    expect(result.find((m) => m.content === "First message")).toBeTruthy();
  });

  it("keeps only recent N user turns", () => {
    const messages = [
      { role: "system", content: "system prompt" },
      { role: "user", content: "msg1" },
      { role: "assistant", content: "resp1" },
      { role: "user", content: "msg2" },
      { role: "assistant", content: "resp2" },
      { role: "user", content: "msg3" },
      { role: "assistant", content: "resp3" },
    ];
    const result = limitHistoryTurns(messages, 1);
    // Should keep system, first user, and the most recent user turn
    const userMsgs = result.filter((m) => m.role === "user" || (m.role === "system" && m.content?.includes("msg")));
    // msg2 should be trimmed
    const allContent = result.map((m) => m.content).join(" ");
    expect(allContent).toContain("msg3");
  });

  it("returns messages unchanged if under limit", () => {
    const messages = [
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
    ];
    const result = limitHistoryTurns(messages, 10);
    expect(result).toEqual(messages);
  });

  it("handles empty array", () => {
    expect(limitHistoryTurns([], 5)).toEqual([]);
  });

  it("handles very short arrays (<=4)", () => {
    const messages = [
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
    ];
    expect(limitHistoryTurns(messages, 1)).toEqual(messages);
  });

  it("includes a summary of trimmed messages", () => {
    const messages = [
      { role: "system", content: "sys" },
      { role: "user", content: "question1" },
      { role: "assistant", content: "answer1" },
      { role: "user", content: "question2" },
      { role: "assistant", content: "answer2" },
      { role: "user", content: "question3" },
      { role: "assistant", content: "answer3" },
      { role: "user", content: "question4" },
      { role: "assistant", content: "answer4" },
    ];
    const result = limitHistoryTurns(messages, 1);
    // Should contain a system summary of trimmed content
    const summaryMsg = result.find(
      (m) => m.role === "system" && m.content?.includes("trimmed")
    );
    expect(summaryMsg).toBeTruthy();
  });
});
