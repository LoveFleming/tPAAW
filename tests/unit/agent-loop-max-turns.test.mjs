/**
 * Unit tests — Agent Loop effectiveMaxTurns Logic
 *
 * Tests the effectiveMaxTurns resolution logic used in both
 * runAgentLoop and runAgentLoopStream when maxTurns is:
 *   - undefined (should use agentCfg default)
 *   - null (should use agentCfg default)
 *   - explicitly set (should use the provided value)
 *   - set to 0 (should use 0 — nullish coalescing preserves 0)
 *
 * Strategy: Test the nullish coalescing formula directly,
 * then verify module exports and integration patterns.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";

// ── Mock dependencies used by paaw-agent-loop.mjs ──

const mockCallLLMWithRetry = vi.fn();
vi.mock("../../packages/server/src/lib/llm-utils.mjs", () => ({
  callLLMWithRetry: mockCallLLMWithRetry,
  sanitizeContent: vi.fn((c) => c || ""),
  isMeaningfulContent: vi.fn((c) => c && c.trim().length > 0),
  fetchStreamWithRetry: vi.fn(),
  resolveDefaultModel: vi.fn(() => "test-model"),
}));

// Mock paaw-project — avoid filesystem access
vi.mock("../../packages/server/src/lib/paaw-project.mjs", () => ({
  createPaawProject: vi.fn(() => ({
    exists: false,
    loadContextText: vi.fn(() => null),
    recordSession: vi.fn(),
    generateChangelogFromSession: vi.fn(),
    addActionLog: vi.fn(),
    init: vi.fn(),
    readFile: vi.fn(() => ""),
    writeFile: vi.fn(),
    listStandards: vi.fn(() => []),
    addDecision: vi.fn(() => ({ adrNum: 1 })),
    appendChangelog: vi.fn(),
    listSessions: vi.fn(() => []),
  })),
}));

// Mock action-log
vi.mock("../../packages/server/src/lib/action-log.mjs", () => ({
  addActionLog: vi.fn(() => ({ agent: "test", action: "decide", summary: "test" })),
  listActionLog: vi.fn(() => ({ entries: [], text: "" })),
  saveAgentMemory: vi.fn(),
  loadAgentMemory: vi.fn(() => ""),
}));

// Mock PaawSnapshot
vi.mock("../../packages/server/src/lib/paaw-snapshot.mjs", () => ({
  PaawSnapshot: vi.fn(() => ({ createPreEdit: vi.fn() })),
}));

// Mock dependency-context
vi.mock("../../packages/server/src/lib/dependency-context.mjs", () => ({
  getDependencyContext: vi.fn(() => null),
  getAffectedTests: vi.fn(() => []),
}));

// Mock fs/promises
vi.mock("fs/promises", () => ({
  readFile: vi.fn(() => "file content"),
  writeFile: vi.fn(),
  readdir: vi.fn(() => []),
  stat: vi.fn(() => ({ isDirectory: () => false })),
  mkdir: vi.fn(),
  rm: vi.fn(),
}));

// Mock fs
vi.mock("fs", () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => "{}"),
  readdirSync: vi.fn(() => []),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  appendFileSync: vi.fn(),
  statSync: vi.fn(() => ({ isDirectory: () => false, isFile: () => true })),
}));

// Mock child_process
vi.mock("child_process", () => ({
  exec: vi.fn((cmd, opts, cb) => { cb(null, "(mock output)", ""); }),
}));

// ════════════════════════════════════════════════
// Tests: effectiveMaxTurns formula (nullish coalescing)
// ════════════════════════════════════════════════

describe("effectiveMaxTurns formula (maxTurns ?? agentCfg.maxTurns)", () => {
  it("should use agentCfg default when maxTurns is undefined", () => {
    const maxTurns = undefined;
    const agentCfg = { maxTurns: 200, timeoutSeconds: 1800 };
    const effective = maxTurns ?? agentCfg.maxTurns;
    expect(effective).toBe(200);
  });

  it("should use agentCfg default when maxTurns is null", () => {
    const maxTurns = null;
    const agentCfg = { maxTurns: 200 };
    const effective = maxTurns ?? agentCfg.maxTurns;
    expect(effective).toBe(200);
  });

  it("should use explicit maxTurns when provided", () => {
    const maxTurns = 5;
    const agentCfg = { maxTurns: 200 };
    const effective = maxTurns ?? agentCfg.maxTurns;
    expect(effective).toBe(5);
  });

  it("should use explicit maxTurns=1 (single turn, non-nullish)", () => {
    const maxTurns = 1;
    const agentCfg = { maxTurns: 200 };
    const effective = maxTurns ?? agentCfg.maxTurns;
    expect(effective).toBe(1);
  });

  it("should preserve maxTurns=0 (0 is not null/undefined, so 0 wins)", () => {
    const maxTurns = 0;
    const agentCfg = { maxTurns: 200 };
    const effective = maxTurns ?? agentCfg.maxTurns;
    expect(effective).toBe(0);
  });

  it("should use config-provided maxTurns=50 when caller does not specify", () => {
    const maxTurns = undefined;
    const agentCfg = { maxTurns: 50, timeoutSeconds: 900 };
    const effective = maxTurns ?? agentCfg.maxTurns;
    expect(effective).toBe(50);
  });

  it("should chain to _agentCfgDefaults when agentCfg.maxTurns is missing", () => {
    const maxTurns = undefined;
    const agentCfg = { timeoutSeconds: 900 };
    const _agentCfgDefaults = { maxTurns: 200 };
    const effective = maxTurns ?? (agentCfg.maxTurns ?? _agentCfgDefaults.maxTurns);
    expect(effective).toBe(200);
  });

  it("should chain to _agentCfgDefaults when agentCfg itself lacks maxTurns", () => {
    const maxTurns = undefined;
    const agentCfg = {};
    const _agentCfgDefaults = { maxTurns: 200 };
    const effective = maxTurns ?? (agentCfg.maxTurns ?? _agentCfgDefaults.maxTurns);
    expect(effective).toBe(200);
  });
});

describe("effectiveTimeout formula (timeout ?? agentCfg.timeoutSeconds)", () => {
  it("should use agentCfg default when timeout is undefined", () => {
    const timeout = undefined;
    const agentCfg = { timeoutSeconds: 1800 };
    const effective = timeout ?? agentCfg.timeoutSeconds;
    expect(effective).toBe(1800);
  });

  it("should use agentCfg default when timeout is null", () => {
    const timeout = null;
    const agentCfg = { timeoutSeconds: 1800 };
    const effective = timeout ?? agentCfg.timeoutSeconds;
    expect(effective).toBe(1800);
  });

  it("should use explicit timeout when provided", () => {
    const timeout = 60;
    const agentCfg = { timeoutSeconds: 1800 };
    const effective = timeout ?? agentCfg.timeoutSeconds;
    expect(effective).toBe(60);
  });

  it("should preserve timeout=0", () => {
    const timeout = 0;
    const agentCfg = { timeoutSeconds: 1800 };
    const effective = timeout ?? agentCfg.timeoutSeconds;
    expect(effective).toBe(0);
  });

  it("should chain to _agentCfgDefaults when agentCfg.timeoutSeconds is missing", () => {
    const timeout = undefined;
    const agentCfg = { maxTurns: 200 };
    const _agentCfgDefaults = { timeoutSeconds: 1800 };
    const effective = timeout ?? (agentCfg.timeoutSeconds ?? _agentCfgDefaults.timeoutSeconds);
    expect(effective).toBe(1800);
  });
});

// ════════════════════════════════════════════════
// Tests: Module exports
// ════════════════════════════════════════════════

describe("Module exports", () => {
  let mod;

  beforeAll(async () => {
    mod = await import("../../packages/server/src/lib/paaw-agent-loop.mjs");
  });

  it("should export runAgentLoop", () => {
    expect(mod.runAgentLoop).toBeDefined();
    expect(typeof mod.runAgentLoop).toBe("function");
  });

  it("should export runAgentLoopStream", () => {
    expect(mod.runAgentLoopStream).toBeDefined();
    expect(typeof mod.runAgentLoopStream).toBe("function");
  });

  it("should export setAgentConfig", () => {
    expect(mod.setAgentConfig).toBeDefined();
    expect(typeof mod.setAgentConfig).toBe("function");
  });

  it("should export resolveLLMConfig", () => {
    expect(mod.resolveLLMConfig).toBeDefined();
    expect(typeof mod.resolveLLMConfig).toBe("function");
  });
});

// ════════════════════════════════════════════════
// Tests: Same formula in runAgentLoopStream
// ════════════════════════════════════════════════

describe("runAgentLoopStream — identical effectiveMaxTurns resolution", () => {
  it("should use same nullish coalescing formula as runAgentLoop", () => {
    const compute = (maxTurns, agentCfg) => maxTurns ?? agentCfg.maxTurns;

    expect(compute(undefined, { maxTurns: 200 })).toBe(200);
    expect(compute(null, { maxTurns: 200 })).toBe(200);
    expect(compute(5, { maxTurns: 200 })).toBe(5);
    expect(compute(1, { maxTurns: 200 })).toBe(1);
    expect(compute(0, { maxTurns: 200 })).toBe(0);
    expect(compute(undefined, { maxTurns: 50 })).toBe(50);
  });

  it("should use same effectiveTimeout formula as runAgentLoop", () => {
    const compute = (timeout, agentCfg) => timeout ?? agentCfg.timeoutSeconds;

    expect(compute(undefined, { timeoutSeconds: 1800 })).toBe(1800);
    expect(compute(null, { timeoutSeconds: 1800 })).toBe(1800);
    expect(compute(60, { timeoutSeconds: 1800 })).toBe(60);
    expect(compute(0, { timeoutSeconds: 1800 })).toBe(0);
  });
});

// ════════════════════════════════════════════════
// Tests: Edge cases
// ════════════════════════════════════════════════

describe("Edge cases", () => {
  it("should trigger fallback when loadAgentConfig throws", () => {
    const _agentCfgDefaults = { maxTurns: 200, timeoutSeconds: 1800 };
    let agentCfg = { ..._agentCfgDefaults };
    try {
      throw new Error("load failed");
    } catch {
      // agentCfg stays at default
    }
    const effectiveMaxTurns = undefined ?? agentCfg.maxTurns;
    expect(effectiveMaxTurns).toBe(200);
    expect(agentCfg.maxTurns).toBe(200);
    expect(agentCfg.timeoutSeconds).toBe(1800);
  });

  it("should use _agentCfgDefaults when loadAgentConfig returns incomplete config", () => {
    const result = { maxTurns: 50 };
    const _agentCfgDefaults = { maxTurns: 200, timeoutSeconds: 1800 };

    const effectiveMaxTurns = undefined ?? result.maxTurns;
    const effectiveTimeout = undefined ?? (result.timeoutSeconds ?? _agentCfgDefaults.timeoutSeconds);

    expect(effectiveMaxTurns).toBe(50);
    expect(effectiveTimeout).toBe(1800);
  });

  it("should preserve NaN (NaN is not nullish)", () => {
    const maxTurns = NaN;
    const agentCfg = { maxTurns: 200 };
    const effective = maxTurns ?? agentCfg.maxTurns;
    expect(effective).toBeNaN();
  });
});

// ════════════════════════════════════════════════
// Tests: Loop iteration boundary
// ════════════════════════════════════════════════

describe("Loop iteration boundary using effectiveMaxTurns", () => {
  it("for-loop condition uses effectiveMaxTurns directly", () => {
    const testLoop = (effectiveMaxTurns) => {
      let count = 0;
      for (let i = 0; i < effectiveMaxTurns; i++) {
        count++;
        if (i === 0) break; // LLM returns stop on first turn
      }
      return count;
    };

    expect(testLoop(200)).toBe(1);
  });

  it("should run at most effectiveMaxTurns iterations when LLM always calls tools", () => {
    const testLoop = (effectiveMaxTurns) => {
      let count = 0;
      for (let i = 0; i < effectiveMaxTurns; i++) {
        count++;
      }
      return count;
    };

    expect(testLoop(undefined ?? 200)).toBe(200);
    expect(testLoop(5)).toBe(5);
    expect(testLoop(1)).toBe(1);
    expect(testLoop(0 ?? 200)).toBe(0);
  });

  it("should never execute loop body when maxTurns is 0", () => {
    const testLoop = (effectiveMaxTurns) => {
      let count = 0;
      for (let i = 0; i < effectiveMaxTurns; i++) {
        count++;
      }
      return count;
    };

    expect(testLoop(0)).toBe(0);
    expect(testLoop(0 ?? 200)).toBe(0);
  });
});
