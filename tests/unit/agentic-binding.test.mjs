/**
 * Unit tests — packages/server/src/lib/agentic-binding.mjs (F-007)
 *
 * Covers:
 *   - initAgenticBindings: config loading (missing / malformed / empty / valid),
 *     enabled vs disabled bindings, duplicate-name skip, definition shape
 *   - handler: request assembly (defaults vs args vs ctx), success result,
 *     platform error passthrough, network failure result
 *   - getBindings / reloadBindings lifecycle
 *
 * Uses the real shared toolRegistry (cleaned via unregisterBySource) and a
 * stubbed global fetch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { initAgenticBindings, getBindings, reloadBindings } from "@server/lib/agentic-binding.mjs";
import { toolRegistry } from "@server/lib/tool-registry.mjs";

function makeConfig(bindings, tmpRoot) {
  const dir = mkdtempSync(join(tmpRoot, "agentic-cfg-"));
  writeFileSync(join(dir, "agentic-bindings.json"), JSON.stringify(bindings));
  return dir;
}

const sampleBinding = {
  toolName: "order_afternoon_tea",
  workflowId: "wf-tea-001",
  description: "發起下午茶團購",
  enabled: true,
  agenticPlatformUrl: "http://agentic.test:4200",
  triggers: ["訂下午茶", "團購"],
  defaults: {
    title: "週四下午茶",
    roomId: "room-42",
    participants: ["Amy", "Bob"],
    deadline: "20 分鐘",
  },
};

let fetchSpy;

beforeEach(() => {
  toolRegistry.clear(); // full isolation: drop tools from any source
  fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  toolRegistry.clear();
  vi.unstubAllGlobals();
});

describe("initAgenticBindings — config loading", () => {
  it("registers nothing when the config file is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentic-cfg-empty-"));
    initAgenticBindings(dir);
    expect(toolRegistry.getNames()).toEqual([]);
    expect(getBindings()).toEqual({});
    rmSync(dir, { recursive: true, force: true });
  });

  it("registers nothing when the config JSON is malformed", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentic-cfg-bad-"));
    writeFileSync(join(dir, "agentic-bindings.json"), "{ not json ]]");
    initAgenticBindings(dir);
    expect(toolRegistry.getNames()).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("registers enabled bindings and skips disabled ones", () => {
    const dir = makeConfig(
      { tea: sampleBinding, off: { ...sampleBinding, toolName: "disabled_tool", enabled: false } },
      tmpdir()
    );
    initAgenticBindings(dir);
    expect(toolRegistry.has("order_afternoon_tea")).toBe(true);
    expect(toolRegistry.has("disabled_tool")).toBe(false);
    expect(getBindings()).toHaveProperty("tea");
    rmSync(dir, { recursive: true, force: true });
  });

  it("skips bindings whose toolName is already registered (no overwrite)", async () => {
    toolRegistry.register({
      name: "order_afternoon_tea",
      definition: { type: "function", function: { name: "order_afternoon_tea", description: "orig", parameters: {} } },
      source: "someone-else",
      handler: async () => ({ text: "original" }),
    });
    const dir = makeConfig({ tea: sampleBinding }, tmpdir());
    initAgenticBindings(dir);
    const res = await toolRegistry.execute("order_afternoon_tea", {}, {});
    expect(res).toEqual({ text: "original" });
    rmSync(dir, { recursive: true, force: true });
  });

  it("builds an OpenAI-format definition with trigger hints and defaults in descriptions", () => {
    const dir = makeConfig({ tea: sampleBinding }, tmpdir());
    initAgenticBindings(dir);
    const def = toolRegistry.getDefinitions().find((d) => d.function.name === "order_afternoon_tea");
    expect(def.type).toBe("function");
    expect(def.function.description).toContain("訂下午茶、團購"); // triggers joined
    expect(def.function.description).toContain("room-42"); // default roomId surfaced
    expect(def.function.parameters.required).toEqual(["menu"]);
    expect(def.function.parameters.properties).toHaveProperty("participants");
    rmSync(dir, { recursive: true, force: true });
  });

  it("omits the trigger hint when a binding has no triggers", () => {
    const noTriggers = { ...sampleBinding, triggers: undefined };
    const dir = makeConfig({ tea: noTriggers }, tmpdir());
    initAgenticBindings(dir);
    const def = toolRegistry.getDefinitions().find((d) => d.function.name === "order_afternoon_tea");
    expect(def.function.description).not.toContain("觸發場景");
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("agentic-binding handler — workflow launch", () => {
  it("POSTs to the workflow run endpoint and returns ok with runId + pollingUrl", async () => {
    const dir = makeConfig({ tea: sampleBinding }, tmpdir());
    initAgenticBindings(dir);

    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ runId: "run-7", workflowId: "wf-tea-001", status: "started" }), { status: 200 })
    );

    const res = await toolRegistry.execute(
      "order_afternoon_tea",
      { menu: "珍奶 $65" },
      { agentId: "agent-lin" }
    );

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("http://agentic.test:4200/api/workflows/wf-tea-001/run");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(init.body);
    // args win over defaults; defaults fill the rest; organizer from ctx
    expect(body.input).toMatchObject({
      title: "週四下午茶",
      menu: "珍奶 $65",
      roomId: "room-42",
      targetChatId: "room-42",
      participants: ["Amy", "Bob"],
      deadline: "20 分鐘",
      organizer: "agent-lin",
    });

    expect(res.ok).toBe(true);
    expect(res.runId).toBe("run-7");
    expect(res.workflowId).toBe("wf-tea-001");
    expect(res.status).toBe("started");
    expect(res.message).toContain("已啟動「週四下午茶」");
    expect(res.message).toContain("Run ID: run-7");
    expect(res.pollingUrl).toBe("http://agentic.test:4200/api/runs/run-7");
    rmSync(dir, { recursive: true, force: true });
  });

  it("lets args override defaults and falls back to hardcoded values", async () => {
    const dir = makeConfig({ tea: sampleBinding }, tmpdir());
    initAgenticBindings(dir);
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ runId: "r2" }), { status: 200 }));

    await toolRegistry.execute(
      "order_afternoon_tea",
      { menu: "紅茶", roomId: "other-room", deadline: "5 分鐘", title: "臨時團" },
      {}
    );
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.input).toMatchObject({
      title: "臨時團",
      roomId: "other-room",
      targetChatId: "other-room",
      deadline: "5 分鐘",
      organizer: "assistant", // ctx.agentId absent → hardcoded fallback
    });
    rmSync(dir, { recursive: true, force: true });
  });

  it("falls back to default baseUrl when agenticPlatformUrl is absent", async () => {
    const noUrl = { ...sampleBinding, agenticPlatformUrl: undefined };
    const dir = makeConfig({ tea: noUrl }, tmpdir());
    initAgenticBindings(dir);
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ runId: "r3" }), { status: 200 }));
    await toolRegistry.execute("order_afternoon_tea", { menu: "x" }, {});
    expect(fetchSpy.mock.calls[0][0]).toContain("http://localhost:4200/api/workflows/");
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns an error result when the platform responds with { error }", async () => {
    const dir = makeConfig({ tea: sampleBinding }, tmpdir());
    initAgenticBindings(dir);
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ error: "workflow disabled" }), { status: 200 }));

    const res = await toolRegistry.execute("order_afternoon_tea", { menu: "x" }, {});
    expect(res.error).toBe(true);
    expect(res.message).toContain("Agentic Platform error: workflow disabled");
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns a friendly error result when fetch fails (platform down)", async () => {
    const dir = makeConfig({ tea: sampleBinding }, tmpdir());
    initAgenticBindings(dir);
    fetchSpy.mockRejectedValue(new Error("ECONNREFUSED"));

    const res = await toolRegistry.execute("order_afternoon_tea", { menu: "x" }, {});
    expect(res.error).toBe(true);
    expect(res.message).toContain("無法啟動 workflow");
    expect(res.message).toContain("ECONNREFUSED");
    expect(res.message).toContain("http://agentic.test:4200");
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("reloadBindings", () => {
  it("replaces agentic-binding tools with the fresh config", async () => {
    const dir = makeConfig({ tea: sampleBinding }, tmpdir());
    initAgenticBindings(dir);
    expect(toolRegistry.has("order_afternoon_tea")).toBe(true);

    // rewrite config with a different tool, then reload
    writeFileSync(
      join(dir, "agentic-bindings.json"),
      JSON.stringify({ coffee: { ...sampleBinding, toolName: "order_coffee", workflowId: "wf-coffee" } })
    );
    reloadBindings(dir);

    expect(toolRegistry.has("order_afternoon_tea")).toBe(false);
    expect(toolRegistry.has("order_coffee")).toBe(true);
    expect(getBindings()).toHaveProperty("coffee");
    rmSync(dir, { recursive: true, force: true });
  });
});
