/**
 * Unit tests — F-007 tool registries & init:
 *   - packages/server/src/lib/tool-engine/tool-registry.mjs (class-based, per-engine)
 *   - packages/server/src/lib/tool-registry.mjs (shared singleton)
 *   - packages/server/src/lib/tool-registry-init.mjs (init + injectRegistryTools)
 *
 * Covers registration, duplicate handling, definition conversion,
 * execution (ok / unknown / throw), and the init/injection wiring
 * with mocked Loop A (paaw-agent-loop) and Loop B (tools/index) sources.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Loop A (paaw-agent-loop) and Loop B (tools/index) sources ──
const { loopATools, loopAExecute, loopBGetTools } = vi.hoisted(() => ({
  loopAExecute: vi.fn(),
  loopATools: [],
  loopBGetTools: vi.fn(),
}));
vi.mock("@server/lib/paaw-agent-loop.mjs", () => ({
  PAAW_TOOLS: loopATools,
  executeTool: loopAExecute,
}));
vi.mock("@server/tools/index.mjs", () => ({
  getToolsAndHandlers: loopBGetTools,
}));
vi.mock("@server/routes/context.mjs", () => ({
  PATHS: { CONFIG_ROOT: "/tmp/test-config-root" },
}));

import { ToolRegistry } from "@server/lib/tool-engine/tool-registry.mjs";
import { toolRegistry } from "@server/lib/tool-registry.mjs";
import {
  initLoopATools,
  initLoopBTools,
  initAllTools,
  registerTool,
  injectRegistryTools,
} from "@server/lib/tool-registry-init.mjs";

// fake ToolEngine: only needs registry.listNames() + registerTool()
function fakeEngine(existing = []) {
  const registered = [];
  return {
    registry: { listNames: () => [...existing, ...registered.map((r) => r.name)] },
    registerTool: (ex) => registered.push(ex),
    registered,
  };
}

const exec = (name, fn) => ({
  name,
  description: `${name} executor`,
  parameters: { type: "object", properties: { a: { type: "string" } } },
  execute: fn,
});

beforeEach(() => {
  // reset shared singleton state between tests
  toolRegistry.clear();
  toolRegistry.initialized = false;
  loopAExecute.mockReset().mockResolvedValue({ text: "loop-a ok" });
  loopBGetTools.mockReset().mockResolvedValue({ tools: [], handlers: {} });
  loopATools.length = 0;
});

// ── Class-based registry (tool-engine) ──

describe("ToolRegistry (class) — registration", () => {
  it("registers executors and converts them to OpenAI definitions", () => {
    const r = new ToolRegistry();
    r.register(exec("pocket_list", async () => 1));
    const defs = r.getToolDefinitions();
    expect(defs).toHaveLength(1);
    expect(defs[0]).toEqual({
      type: "function",
      function: {
        name: "pocket_list",
        description: "pocket_list executor",
        parameters: { type: "object", properties: { a: { type: "string" } } },
      },
    });
  });

  it("registerAll registers in order; has() reflects membership", () => {
    const r = new ToolRegistry();
    r.registerAll([exec("a", async () => 1), exec("b", async () => 2)]);
    expect(r.listNames()).toEqual(["a", "b"]);
    expect(r.has("a")).toBe(true);
    expect(r.has("c")).toBe(false);
  });

  it("unregister removes a single tool; clear empties everything", () => {
    const r = new ToolRegistry();
    r.registerAll([exec("a", async () => 1), exec("b", async () => 2)]);
    r.unregister("a");
    expect(r.listNames()).toEqual(["b"]);
    r.clear();
    expect(r.listNames()).toEqual([]);
    expect(r.has("b")).toBe(false);
  });

  it("getToolDef returns the definition for a known name only", () => {
    const r = new ToolRegistry();
    r.register(exec("a", async () => 1));
    expect(r.getToolDef("a").function.name).toBe("a");
    expect(r.getToolDef("missing")).toBeUndefined();
  });

  it("re-registering the same name replaces the tool (last wins)", () => {
    const r = new ToolRegistry();
    r.register(exec("a", async () => "first"));
    r.register(exec("a", async () => "second"));
    expect(r.listNames()).toEqual(["a"]);
    expect(r.getToolDef("a").function.description).toBe("a executor");
  });
});

describe("ToolRegistry (class) — execute paths", () => {
  it("executes the handler with the provided args", async () => {
    const r = new ToolRegistry();
    const spy = vi.fn(async ({ a }) => ({ text: `got ${a}` }));
    r.register(exec("t", spy));
    const res = await r.execute("t", { a: "x" });
    expect(spy).toHaveBeenCalledWith({ a: "x" });
    expect(res.text).toBe("got x");
  });

  it("returns an error result for unknown tools", async () => {
    const r = new ToolRegistry();
    const res = await r.execute("ghost", {});
    expect(res.error).toBe(true);
    expect(res.text).toContain("未知工具");
    expect(res.text).toContain("ghost");
  });

  it("wraps handler exceptions into an error result", async () => {
    const r = new ToolRegistry();
    r.register(exec("t", async () => { throw new Error("kaboom"); }));
    const res = await r.execute("t", {});
    expect(res.error).toBe(true);
    expect(res.text).toContain("kaboom");
  });

  it("passes through plain string return values", async () => {
    const r = new ToolRegistry();
    r.register(exec("t", async () => "plain text"));
    const res = await r.execute("t", {});
    expect(res).toBe("plain text");
  });
});

// ── Shared singleton registry ──

describe("toolRegistry (shared singleton)", () => {
  it("register + getDefinitions + getNames round-trip with source tag", () => {
    toolRegistry.register({
      name: "shared_tool",
      definition: { type: "function", function: { name: "shared_tool", description: "d", parameters: {} } },
      source: "unit-test",
      handler: async () => ({ text: "ok" }),
    });
    expect(toolRegistry.has("shared_tool")).toBe(true);
    expect(toolRegistry.getNames()).toContain("shared_tool");
    expect(toolRegistry.getDefinitions()[0].function.name).toBe("shared_tool");
  });

  it("execute() dispatches to the handler with (args, ctx)", async () => {
    const handler = vi.fn(async (args, ctx) => ({ text: `${args.v}-${ctx.agentId}` }));
    toolRegistry.register({
      name: "ctx_tool",
      definition: { type: "function", function: { name: "ctx_tool", description: "d", parameters: {} } },
      handler,
    });
    const res = await toolRegistry.execute("ctx_tool", { v: "x" }, { agentId: "ag1" });
    expect(handler).toHaveBeenCalledWith({ v: "x" }, { agentId: "ag1" });
    expect(res.text).toBe("x-ag1");
  });

  it("execute() returns an error string for unknown tools", async () => {
    const res = await toolRegistry.execute("nope", {});
    // shared registry returns { error: "<message>" } (message string, not boolean)
    expect(res.error).toContain("Unknown tool: nope");
  });

  it("execute() catches handler throws and returns an error string", async () => {
    toolRegistry.register({
      name: "thrower",
      definition: { type: "function", function: { name: "thrower", description: "d", parameters: {} } },
      handler: async () => { throw new Error("handler exploded"); },
    });
    const res = await toolRegistry.execute("thrower", {});
    expect(res.error).toContain("handler exploded");
  });

  it("unregisterBySource removes exactly the tools from that source", () => {
    for (const n of ["s1_a", "s1_b"]) {
      toolRegistry.register({
        name: n,
        definition: { type: "function", function: { name: n, description: "d", parameters: {} } },
        source: "src-one",
        handler: async () => ({ text: "ok" }),
      });
    }
    toolRegistry.register({
      name: "s2_a",
      definition: { type: "function", function: { name: "s2_a", description: "d", parameters: {} } },
      source: "src-two",
      handler: async () => ({ text: "ok" }),
    });
    toolRegistry.unregisterBySource("src-one");
    expect(toolRegistry.getNames().sort()).toEqual(["s2_a"]);
  });

  it("registerTool() (init re-export) delegates to the shared registry", () => {
    registerTool({
      name: "via_helper",
      definition: { type: "function", function: { name: "via_helper", description: "d", parameters: {} } },
      handler: async () => ({ text: "ok" }),
    });
    expect(toolRegistry.has("via_helper")).toBe(true);
  });
});

// ── Init module ──

describe("initLoopATools / initLoopBTools", () => {
  it("registers all Loop A definitions with source paaw-agent-loop and sets initialized", () => {
    loopATools.push(
      { type: "function", function: { name: "la_one", description: "d1", parameters: {} } },
      { type: "function", function: { name: "la_two", description: "d2", parameters: {} } },
      { type: "broken-no-name", function: {} }, // skipped
    );
    initLoopATools();
    expect(toolRegistry.initialized).toBe(true);
    expect(toolRegistry.has("la_one")).toBe(true);
    expect(toolRegistry.has("la_two")).toBe(true);
    expect(toolRegistry.getNames()).not.toContain("broken-no-name");

    // idempotent: second call is a no-op even if tools list changed
    const before = toolRegistry.getNames().length;
    loopATools.push({ type: "function", function: { name: "la_three", description: "d3", parameters: {} } });
    initLoopATools();
    expect(toolRegistry.getNames().length).toBe(before);
  });

  it("Loop A handler wraps args into a tool call and delegates to executeTool", async () => {
    loopATools.push({ type: "function", function: { name: "la_exec", description: "d", parameters: {} } });
    initLoopATools();
    const res = await toolRegistry.execute("la_exec", { key: "val" }, { cwd: "/w", rootDir: "/r", agentId: "ag" });
    expect(loopAExecute).toHaveBeenCalledTimes(1);
    const call = loopAExecute.mock.calls[0][0];
    expect(call.type).toBe("function");
    expect(call.function.name).toBe("la_exec");
    expect(JSON.parse(call.function.arguments)).toEqual({ key: "val" });
    expect(res).toEqual({ text: "loop-a ok" });
  });

  it("initLoopBTools registers Loop B handlers and skips Loop A duplicates / handlerless defs", async () => {
    loopATools.push({ type: "function", function: { name: "dup_tool", description: "d", parameters: {} } });
    initLoopATools();

    loopBGetTools.mockResolvedValue({
      tools: [
        { type: "function", function: { name: "dup_tool", description: "loopB dup", parameters: {} } },
        { type: "function", function: { name: "lb_new", description: "lb", parameters: {} } },
        { type: "function", function: { name: "lb_no_handler", description: "lb", parameters: {} } },
      ],
      handlers: {
        lb_new: async (args) => ({ text: `lb:${args.x}` }),
        // lb_no_handler intentionally missing
      },
    });

    await initLoopBTools();

    expect(toolRegistry.has("lb_new")).toBe(true);
    expect(toolRegistry.has("lb_no_handler")).toBe(false);
    // dup_tool stays the Loop A registration
    const res = await toolRegistry.execute("lb_new", { x: 1 }, {});
    expect(res.text).toBe("lb:1");
    const dupRes = await toolRegistry.execute("dup_tool", {}, { cwd: "/w" });
    expect(loopAExecute).toHaveBeenCalled(); // served by Loop A path, not undefined
    expect(dupRes).toEqual({ text: "loop-a ok" });
  });

  it("initAllTools wires Loop A + Loop B + agentic bindings", async () => {
    const agenticMock = vi.fn();
    vi.doMock("@server/lib/agentic-binding.mjs", () => ({ initAgenticBindings: agenticMock }));
    // re-import to pick up the doMock for the dynamic import inside initAllTools
    const mod = await import("@server/lib/tool-registry-init.mjs");
    vi.doUnmock("@server/lib/agentic-binding.mjs");

    loopATools.push({ type: "function", function: { name: "all_a", description: "d", parameters: {} } });
    loopBGetTools.mockResolvedValue({
      tools: [{ type: "function", function: { name: "all_b", description: "d", parameters: {} } }],
      handlers: { all_b: async () => ({ text: "b" }) },
    });

    await mod.initAllTools();
    expect(toolRegistry.initialized).toBe(true);
    expect(toolRegistry.has("all_a")).toBe(true);
    expect(toolRegistry.has("all_b")).toBe(true);
  });
});

describe("injectRegistryTools", () => {
  it("is a no-op when the shared registry is not initialized", () => {
    const engine = fakeEngine();
    injectRegistryTools(engine, {});
    expect(engine.registered).toHaveLength(0);
  });

  it("injects shared tools not already on the engine and keeps existing ones", async () => {
    toolRegistry.register({
      name: "new_tool",
      definition: { type: "function", function: { name: "new_tool", description: "shared new", parameters: { p: 1 } } },
      source: "unit",
      handler: async (args) => ({ text: `ran:${args.k}` }),
    });
    toolRegistry.register({
      name: "engine_owned",
      definition: { type: "function", function: { name: "engine_owned", description: "d", parameters: {} } },
      source: "unit",
      handler: async () => ({ text: "should-not-be-injected" }),
    });
    toolRegistry.initialized = true;

    const engine = fakeEngine(["engine_owned"]);
    injectRegistryTools(engine, { agentId: "ag-ctx" });

    const names = engine.registered.map((r) => r.name);
    expect(names).toEqual(["new_tool"]); // engine_owned not overwritten
    const injected = engine.registered[0];
    expect(injected.description).toBe("shared new");
    expect(injected.parameters).toEqual({ p: 1 });

    // executing the injected executor delegates to the shared handler and
    // stringifies object results for the ToolEngine loop
    const out = await injected.execute({ k: 9 }, { cwd: "/exec-cwd" });
    expect(out).toBe('{"text":"ran:9"}');
  });
});
