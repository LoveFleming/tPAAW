/**
 * Unit tests — packages/server/src/lib/tool-engine/index.mjs (F-007)
 *
 * Covers the ToolEngine ReAct loop:
 *   - Plain text streaming (no tool calls)
 *   - Tool registration / definition passthrough (registerTool / unregisterTool)
 *   - Tool call execution (tool_start / tool_end events, tool result messages)
 *   - Write-operation success verification (verifyWriteResult paths)
 *   - Error detection (error:true / ❌ text / throw)
 *   - Security kernel blocking
 *   - Fake tool call detection + retry round
 *   - maxToolRounds exhaustion fallback
 *   - Provider error propagation
 *   - Malformed JSON tool arguments
 *
 * Strategy: mock createProviderAdapter to return scripted async generators,
 * and mock the SecurityKernel with a controllable stub.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock the provider adapter factory ──
// ToolEngine does: createProviderAdapter({ ...options.provider }) — we smuggle
// our fake adapter through the spread and return it.
vi.mock("@server/lib/tool-engine/provider.mjs", () => ({
  createProviderAdapter: (cfg) => cfg.__adapter,
}));

// ── Mock the security kernel ──
const { securityDecision } = vi.hoisted(() => ({ securityDecision: { value: { allowed: true } } }));
vi.mock("@server/lib/security/index.mjs", () => ({
  SecurityKernel: class {
    async init() {}
    async dispose() {}
    async checkToolCall() { return securityDecision.value; }
    async recordResult() {}
  },
}));

import { ToolEngine, createToolEngine } from "@server/lib/tool-engine/index.mjs";

// ── Helpers ──

/** Build a scripted fake provider whose chat() plays back the given rounds. */
function fakeProvider(rounds) {
  return {
    name: "fake",
    chatCalls: [],
    async *chat(messages, tools, model) {
      this.chatCalls.push({ messages: structuredClone(messages), tools: tools.length, model });
      const round = rounds[this.chatCalls.length - 1];
      for (const c of typeof round === "function" ? round() : round) yield c;
    },
  };
}

function tc(id, name, args) {
  return { id, type: "function", function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) } };
}

const textChunk = (delta) => ({ type: "text", delta });
const doneStop = (fullText = "") => ({ type: "done", finishReason: "stop", toolCalls: [], fullText });
const doneTools = (calls) => ({ type: "done", finishReason: "tool_calls", toolCalls: calls });

async function collect(gen) {
  const out = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

const exec = (name, fn) => ({
  name,
  description: `test executor ${name}`,
  parameters: { type: "object", properties: {} },
  execute: fn,
});

// ── Tests ──

describe("ToolEngine — construction & registry passthrough", () => {
  it("registers executors and exposes OpenAI-format definitions", () => {
    const engine = new ToolEngine({
      provider: { __adapter: fakeProvider([]) },
      executors: [exec("pocket_list", async () => ({ text: "ok" }))],
    });
    const defs = engine.getToolDefinitions();
    expect(defs).toHaveLength(1);
    expect(defs[0].type).toBe("function");
    expect(defs[0].function.name).toBe("pocket_list");
    expect(defs[0].function.description).toContain("test executor");
  });

  it("registerTool / unregisterTool add and remove tools dynamically", () => {
    const engine = new ToolEngine({ provider: { __adapter: fakeProvider([]) } });
    engine.registerTool(exec("tmp_tool", async () => ({ text: "x" })));
    expect(engine.getToolDefinitions().map((d) => d.function.name)).toContain("tmp_tool");
    engine.unregisterTool("tmp_tool");
    expect(engine.getToolDefinitions().map((d) => d.function.name)).not.toContain("tmp_tool");
  });

  it("createToolEngine factory wires provider + executors", () => {
    const engine = createToolEngine({ __adapter: fakeProvider([]) }, [exec("a", async () => 1)]);
    expect(engine).toBeInstanceOf(ToolEngine);
    expect(engine.registry.listNames()).toEqual(["a"]);
  });

  it("applies defaults (maxToolRounds=5, agentId=default, sessionKey=default)", () => {
    const engine = new ToolEngine({ provider: { __adapter: fakeProvider([]) } });
    expect(engine.maxToolRounds).toBe(5);
    expect(engine.agentId).toBe("default");
    expect(engine.sessionKey).toBe("default");
  });
});

describe("ToolEngine — plain text run", () => {
  it("streams text deltas then a done event with fullText", async () => {
    const adapter = fakeProvider([[textChunk("你"), textChunk("好"), doneStop()]]);
    const engine = new ToolEngine({ provider: { __adapter: adapter }, executors: [] });
    const events = await collect(engine.run("sys", [{ role: "user", content: "hi" }]));
    expect(events.filter((e) => e.type === "text").map((e) => e.delta).join("")).toBe("你好");
    const done = events.find((e) => e.type === "done");
    expect(done).toBeDefined();
    expect(done.fullText).toBe("你好");
    expect(events.some((e) => e.type === "tool_start")).toBe(false);
    // provider got system prompt prepended
    expect(adapter.chatCalls[0].messages[0].role).toBe("system");
  });
});

describe("ToolEngine — tool execution loop", () => {
  it("executes a tool call and feeds the tool result back for round 2", async () => {
    const adapter = fakeProvider([
      [doneTools([tc("c1", "pocket_list", {})]), { type: "done", finishReason: "stop", toolCalls: [] }],
      [textChunk("done!"), doneStop()],
    ]);
    const listFn = vi.fn(async () => ({ text: "口袋清單" }));
    const engine = new ToolEngine({ provider: { __adapter: adapter }, executors: [exec("pocket_list", listFn)] });

    const events = await collect(engine.run("sys", [{ role: "user", content: "list" }]));
    expect(listFn).toHaveBeenCalledTimes(1);

    expect(events.some((e) => e.type === "tool_start" && e.name === "pocket_list")).toBe(true);
    const toolEnd = events.find((e) => e.type === "tool_end");
    expect(toolEnd.result.text).toBe("口袋清單");

    // Round 2 messages: assistant tool_calls + tool result
    const round2 = adapter.chatCalls[1].messages;
    expect(round2.some((m) => m.role === "assistant" && m.tool_calls?.[0]?.function.name === "pocket_list")).toBe(true);
    const toolMsg = round2.find((m) => m.role === "tool" && m.tool_call_id === "c1");
    expect(toolMsg).toBeDefined();
    expect(toolMsg.content).toContain("口袋清單");
  });

  it("falls back to { raw } when tool arguments are malformed JSON", async () => {
    const adapter = fakeProvider([
      [doneTools([tc("c9", "pocket_list", "{not json")], )],
      [doneStop()],
    ]);
    const listFn = vi.fn(async (args) => ({ text: JSON.stringify(args) }));
    const engine = new ToolEngine({ provider: { __adapter: adapter }, executors: [exec("pocket_list", listFn)] });
    const events = await collect(engine.run("s", [{ role: "user", content: "x" }]));
    const start = events.find((e) => e.type === "tool_start");
    expect(start.args).toEqual({ raw: "{not json" });
  });

  it("wraps executor exceptions into an error tool result", async () => {
    const adapter = fakeProvider([
      [doneTools([tc("c2", "pocket_list", {})])],
      [doneStop()],
    ]);
    const engine = new ToolEngine({
      provider: { __adapter: adapter },
      executors: [exec("pocket_list", async () => { throw new Error("boom"); })],
    });
    const events = await collect(engine.run("s", [{ role: "user", content: "x" }]));
    const toolEnd = events.find((e) => e.type === "tool_end");
    expect(toolEnd.result.error).toBe(true);
    expect(toolEnd.result.text).toContain("pocket_list");
    expect(toolEnd.result.text).toContain("boom");
  });
});

describe("ToolEngine — error detection", () => {
  it("marks results with error:true and instructs the LLM to admit failure", async () => {
    const adapter = fakeProvider([
      [doneTools([tc("c3", "pocket_add", { content: "x" })])],
      [doneStop()],
    ]);
    const engine = new ToolEngine({
      provider: { __adapter: adapter },
      executors: [exec("pocket_add", async () => ({ text: "已新增（其實失敗）", error: true }))],
    });
    const events = await collect(engine.run("s", [{ role: "user", content: "x" }]));
    const toolEnd = events.find((e) => e.type === "tool_end");
    expect(toolEnd.result._validation.error).toBe(true);
    const round2 = adapter.chatCalls[1].messages;
    const toolMsg = round2.find((m) => m.role === "tool");
    expect(toolMsg.content).toContain("工具執行失敗");
  });

  it("flags results whose text starts with ❌", async () => {
    const adapter = fakeProvider([
      [doneTools([tc("c4", "pocket_add", {})])],
      [doneStop()],
    ]);
    const engine = new ToolEngine({
      provider: { __adapter: adapter },
      executors: [exec("pocket_add", async () => ({ text: "❌ 找不到資源" }))],
    });
    const events = await collect(engine.run("s", [{ role: "user", content: "x" }]));
    expect(events.find((e) => e.type === "tool_end").result._validation.error).toBe(true);
  });
});

describe("ToolEngine — write verification (verifyWriteResult)", () => {
  it("verifies *_add via the corresponding *_get tool and reports verified", async () => {
    const adapter = fakeProvider([
      [doneTools([tc("c5", "pocket_add", { content: "milk tea" })])],
      [doneStop()],
    ]);
    const engine = new ToolEngine({
      provider: { __adapter: adapter },
      executors: [
        exec("pocket_add", async () => ({ text: "已新增", record: { id: "p1", content: "milk tea" } })),
        exec("pocket_get", async ({ id }) => ({ text: `record ${id}` })),
      ],
    });
    const events = await collect(engine.run("s", [{ role: "user", content: "x" }]));
    const toolEnd = events.find((e) => e.type === "tool_end");
    expect(toolEnd.result._validation.verified).toBe(true);
    expect(toolEnd.result._validation.detail).toContain("p1");
  });

  it("reports verified:false when the verify lookup still sees an error", async () => {
    const adapter = fakeProvider([
      [doneTools([tc("c6", "pocket_add", {})])],
      [doneStop()],
    ]);
    const engine = new ToolEngine({
      provider: { __adapter: adapter },
      executors: [
        exec("pocket_add", async () => ({ text: "已新增", record: { id: "p2" } })),
        exec("pocket_get", async () => ({ text: "❌ not found" })),
      ],
    });
    const events = await collect(engine.run("s", [{ role: "user", content: "x" }]));
    const toolEnd = events.find((e) => e.type === "tool_end");
    expect(toolEnd.result._validation.verified).toBe(false);
  });

  it("treats a write op without a matching verify tool as verified (no verify tool)", async () => {
    const adapter = fakeProvider([
      [doneTools([tc("c7", "note_add", {})])],
      [doneStop()],
    ]);
    const engine = new ToolEngine({
      provider: { __adapter: adapter },
      executors: [exec("note_add", async () => ({ text: "ok" }))], // no note_get registered
    });
    const events = await collect(engine.run("s", [{ role: "user", content: "x" }]));
    const toolEnd = events.find((e) => e.type === "tool_end");
    expect(toolEnd.result._validation.verified).toBe(true);
  });

  it("verifies *_delete via the corresponding *_list tool", async () => {
    const adapter = fakeProvider([
      [doneTools([tc("c8", "pocket_delete", { id: "p9" })])],
      [doneStop()],
    ]);
    const listFn = vi.fn(async () => ({ text: "[]", records: [] }));
    const engine = new ToolEngine({
      provider: { __adapter: adapter },
      executors: [
        exec("pocket_delete", async () => ({ text: "已刪除 p9" })),
        exec("pocket_list", listFn),
      ],
    });
    const events = await collect(engine.run("s", [{ role: "user", content: "x" }]));
    expect(listFn).toHaveBeenCalledTimes(1);
    const toolEnd = events.find((e) => e.type === "tool_end");
    expect(toolEnd.result._validation.verified).toBe(true);
  });

  it("reports verified:false for delete when the ID still appears in the list", async () => {
    const adapter = fakeProvider([
      [doneTools([tc("c10", "pocket_delete", { id: "p9" })])],
      [doneStop()],
    ]);
    const engine = new ToolEngine({
      provider: { __adapter: adapter },
      executors: [
        exec("pocket_delete", async () => ({ text: "已刪除" })),
        exec("pocket_list", async () => ({ text: "p9 還在", records: [{ id: "p9" }] })),
      ],
    });
    const events = await collect(engine.run("s", [{ role: "user", content: "x" }]));
    expect(events.find((e) => e.type === "tool_end").result._validation.verified).toBe(false);
  });

  it("degrades gracefully when the verify lookup itself throws (刪除完成（無法回查）)", async () => {
    const adapter = fakeProvider([
      [doneTools([tc("c11", "pocket_delete", { id: "p9" })])],
      [doneStop()],
    ]);
    const engine = new ToolEngine({
      provider: { __adapter: adapter },
      executors: [
        exec("pocket_delete", async () => ({ text: "已刪除" })),
        exec("pocket_list", async () => { throw new Error("verify boom"); }),
      ],
    });
    const events = await collect(engine.run("s", [{ role: "user", content: "x" }]));
    const toolEnd = events.find((e) => e.type === "tool_end");
    // verify throw is caught by the registry and treated as "no longer listed" → verified
    expect(toolEnd.result._validation.verified).toBe(true);
    expect(toolEnd.result._validation.detail).toContain("已刪除");
  });

  it("does NOT attach _validation to read-only (non-write) tools", async () => {
    const adapter = fakeProvider([
      [doneTools([tc("c12", "pocket_list", {})])],
      [doneStop()],
    ]);
    const engine = new ToolEngine({
      provider: { __adapter: adapter },
      executors: [exec("pocket_list", async () => ({ text: "items" }))],
    });
    const events = await collect(engine.run("s", [{ role: "user", content: "x" }]));
    const toolEnd = events.find((e) => e.type === "tool_end");
    expect(toolEnd.result._validation).toBeUndefined();
  });
});

describe("ToolEngine — security kernel integration", () => {
  it("blocks tool execution when checkToolCall denies (no executor call)", async () => {
    securityDecision.value = { allowed: false, reason: "危險操作" };
    try {
      const adapter = fakeProvider([
        [doneTools([tc("c13", "pocket_delete", { id: "x" })])],
        [doneStop()],
      ]);
      const deleteFn = vi.fn(async () => ({ text: "deleted" }));
      const engine = new ToolEngine({
        provider: { __adapter: adapter },
        security: { strict: true },
        executors: [exec("pocket_delete", deleteFn)],
      });
      const events = await collect(engine.run("s", [{ role: "user", content: "x" }]));
      expect(deleteFn).not.toHaveBeenCalled();
      const toolEnd = events.find((e) => e.type === "tool_end");
      expect(toolEnd.result.securityBlocked).toBe(true);
      expect(toolEnd.result.error).toBe(true);
      expect(toolEnd.result.text).toContain("安全性攔截");
      expect(toolEnd.result.text).toContain("危險操作");
    } finally {
      securityDecision.value = { allowed: true };
    }
  });

  it("uses the approval wording when the block asks for user approval", async () => {
    securityDecision.value = { allowed: false, approval: { id: "a1" }, reason: "needs ok" };
    try {
      const adapter = fakeProvider([
        [doneTools([tc("c14", "pocket_delete", {})])],
        [doneStop()],
      ]);
      const engine = new ToolEngine({
        provider: { __adapter: adapter },
        security: {},
        executors: [exec("pocket_delete", async () => ({ text: "x" }))],
      });
      const events = await collect(engine.run("s", [{ role: "user", content: "x" }]));
      expect(events.find((e) => e.type === "tool_end").result.text).toContain("等待用戶批准");
    } finally {
      securityDecision.value = { allowed: true };
    }
  });
});

describe("ToolEngine — fake tool call retry", () => {
  it("detects fake tool call text and retries without executing any tool", async () => {
    const adapter = fakeProvider([
      // Round 1: LLM hallucinates a tool call as plain text
      [textChunk("> 🔧 **Pocket List**\n"), doneStop()],
      // Round 2: proper answer
      [textChunk("真正的答案"), doneStop()],
    ]);
    const listFn = vi.fn(async () => ({ text: "ok" }));
    const engine = new ToolEngine({ provider: { __adapter: adapter }, executors: [exec("pocket_list", listFn)] });
    const events = await collect(engine.run("s", [{ role: "user", content: "list pockets" }]));
    expect(listFn).not.toHaveBeenCalled();
    const done = events.find((e) => e.type === "done");
    expect(done.fullText).not.toContain("**Pocket List**");
    expect(done.fullText).toContain("真正的答案");
  });
});

describe("ToolEngine — loop exhaustion & provider errors", () => {
  it("stops after maxToolRounds rounds of non-stop tool calls and still yields done", async () => {
    const rounds = Array.from({ length: 6 }, () => [doneTools([tc("cx", "pocket_list", {})])]);
    const adapter = fakeProvider(rounds);
    const engine = new ToolEngine({
      provider: { __adapter: adapter },
      maxToolRounds: 3,
      executors: [exec("pocket_list", async () => ({ text: "items" }))],
    });
    const events = await collect(engine.run("s", [{ role: "user", content: "x" }]));
    // only 3 provider rounds happened
    expect(adapter.chatCalls).toHaveLength(3);
    expect(events.filter((e) => e.type === "tool_end")).toHaveLength(3);
    expect(events.some((e) => e.type === "done")).toBe(true);
  });

  it("propagates provider error chunks and terminates the run", async () => {
    const adapter = fakeProvider([[textChunk("partial"), { type: "error", message: "API error 500" }]]);
    const engine = new ToolEngine({ provider: { __adapter: adapter }, executors: [] });
    const events = await collect(engine.run("s", [{ role: "user", content: "x" }]));
    expect(events[events.length - 1].type).toBe("error");
    expect(events[events.length - 1].message).toContain("500");
    expect(events.some((e) => e.type === "done")).toBe(false);
  });
});
