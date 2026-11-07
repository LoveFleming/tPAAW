/**
 * Unit tests — packages/server/src/lib/tool-engine/provider.mjs (F-007)
 *
 * Covers:
 *   - createProviderAdapter factory shape
 *   - Request assembly: URL joining (trailing slash, full path), headers,
 *     body (model/messages/stream/tools/tool_choice, extraHeaders, extraBody)
 *   - SSE stream parsing: text deltas (invisible-char stripping, empty delta
 *     suppression), tool_call delta accumulation across chunks, finish_reason
 *   - Stream ends without finish_reason → synthesized done event
 *   - Error paths: !ok response, missing body, fetch failure after retries
 *   - [DONE] marker and choice-less chunks are ignored
 *
 * Strategy: mock @server/lib/llm-utils.mjs (fetchStreamWithRetry spy) and
 * @server/lib/vision-content.mjs (pure passthroughs), redirect PAAW_DATA_HOME
 * to a temp dir before importing (module-top-level const).
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// ── Mocks ──
const { mockFetchStream, mockSanitize } = vi.hoisted(() => ({
  mockFetchStream: vi.fn(),
  mockSanitize: vi.fn((s) => s),
}));
vi.mock("@server/lib/llm-utils.mjs", () => ({
  fetchStreamWithRetry: mockFetchStream,
  sanitizeContent: mockSanitize,
  jsonStringifySafe: (x) => JSON.stringify(x),
}));
vi.mock("@server/lib/vision-content.mjs", () => ({
  messagesForModel: (m) => m,
  isVisionModel: () => false,
}));

// Redirect module-top-level DATA_HOME before the module graph loads
const TMP = mkdtempSync(join(tmpdir(), "paaw-provider-test-"));
process.env.PAAW_DATA_HOME = TMP;
const providerMod = await import("@server/lib/tool-engine/provider.mjs");
const { createProviderAdapter } = providerMod;

// ── Helpers ──
const sse = (obj) => `data: ${JSON.stringify(obj)}\n\n`;
const textDelta = (content) => sse({ choices: [{ delta: { content } }] });
const tcDelta = (index, id, name, args) =>
  sse({ choices: [{ delta: { tool_calls: [{ index, id, function: { name, arguments: args } }] } }] });
const tcArgsDelta = (index, args) =>
  sse({ choices: [{ delta: { tool_calls: [{ index, function: { arguments: args } }] } }] });
const finish = (reason) => sse({ choices: [{ delta: {}, finish_reason: reason }] });

function sseResponse(text) {
  return new Response(text, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

async function collect(gen) {
  const out = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

function adapter(overrides = {}) {
  return createProviderAdapter({
    id: "test-prov",
    baseURL: "http://llm.example.com/v1",
    apiKey: "sk-test",
    defaultModel: "test-model",
    ...overrides,
  });
}

beforeEach(() => {
  mockFetchStream.mockReset();
  mockSanitize.mockClear();
});

afterAll(() => rmSync(TMP, { recursive: true, force: true }));

// ── Tests ──

describe("createProviderAdapter — factory", () => {
  it("returns an adapter with chat() and name", () => {
    const a = adapter();
    expect(typeof a.chat).toBe("function");
    expect(a.name).toBeTruthy();
  });

  it("falls back to defaultModel when chat() gets no model", async () => {
    mockFetchStream.mockResolvedValue(sseResponse(finish("stop")));
    const a = createProviderAdapter({ baseURL: "http://x/v1", apiKey: "k", defaultModel: "fallback-m" });
    await collect(a.chat([{ role: "user", content: "q" }], [], undefined));
    const body = JSON.parse(mockFetchStream.mock.calls[0][1].body);
    expect(body.model).toBe("fallback-m");
  });
});

describe("provider.chat — request assembly", () => {
  it("joins baseURL + /chat/completions and strips trailing slashes", async () => {
    mockFetchStream.mockResolvedValue(sseResponse(textDelta("hi") + finish("stop")));
    const a = adapter({ baseURL: "http://llm.example.com/v1/" });
    await collect(a.chat([{ role: "user", content: "q" }], [], undefined));
    const url = mockFetchStream.mock.calls[0][0];
    expect(url).toBe("http://llm.example.com/v1/chat/completions");
    expect(url).not.toContain("//chat");
  });

  it("keeps a full /chat/completions baseURL as-is", async () => {
    mockFetchStream.mockResolvedValue(sseResponse(finish("stop")));
    const a = adapter({ baseURL: "http://llm.example.com/v1/chat/completions" });
    await collect(a.chat([{ role: "user", content: "q" }], [], undefined));
    expect(mockFetchStream.mock.calls[0][0]).toBe("http://llm.example.com/v1/chat/completions");
  });

  it("sends Authorization bearer, Content-Type, and extraHeaders", async () => {
    mockFetchStream.mockResolvedValue(sseResponse(finish("stop")));
    const a = adapter({ extraHeaders: { "X-Org": "paaw" } });
    await collect(a.chat([{ role: "user", content: "q" }], [], undefined));
    const headers = mockFetchStream.mock.calls[0][1].headers;
    expect(headers.Authorization).toBe("Bearer sk-test");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["X-Org"]).toBe("paaw");
  });

  it("builds a streaming JSON body with tools + tool_choice when tools are given", async () => {
    mockFetchStream.mockResolvedValue(sseResponse(finish("stop")));
    const a = adapter({ extraBody: { temperature: 0.2 } });
    const tools = [{ type: "function", function: { name: "t1", description: "d", parameters: {} } }];
    await collect(a.chat([{ role: "user", content: "q" }], tools, "m-override"));
    const body = JSON.parse(mockFetchStream.mock.calls[0][1].body);
    expect(body.model).toBe("m-override");
    expect(body.stream).toBe(true);
    expect(body.tools).toEqual(tools);
    expect(body.tool_choice).toBe("auto");
    expect(body.temperature).toBe(0.2);
    expect(body.messages).toEqual([{ role: "user", content: "q" }]);
  });

  it("omits tools/tool_choice when no tools are registered", async () => {
    mockFetchStream.mockResolvedValue(sseResponse(finish("stop")));
    const a = adapter();
    await collect(a.chat([{ role: "user", content: "q" }], [], undefined));
    const body = JSON.parse(mockFetchStream.mock.calls[0][1].body);
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
  });
});

describe("provider.chat — SSE text streaming", () => {
  it("emits one text event per non-empty delta", async () => {
    mockFetchStream.mockResolvedValue(
      sseResponse(textDelta("你") + textDelta("好") + textDelta("！") + finish("stop"))
    );
    const a = adapter();
    const events = await collect(a.chat([{ role: "user", content: "q" }], [], undefined));
    expect(events.filter((e) => e.type === "text").map((e) => e.delta)).toEqual(["你", "好", "！"]);
  });

  it("strips invisible characters (BOM / zero-width) from deltas", async () => {
    mockFetchStream.mockResolvedValue(sseResponse(textDelta("a\uFEFFb\u200Bc") + finish("stop")));
    const a = adapter();
    const events = await collect(a.chat([{ role: "user", content: "q" }], [], undefined));
    expect(events.find((e) => e.type === "text").delta).toBe("abc");
  });

  it("suppresses text events for deltas that are entirely invisible chars", async () => {
    mockFetchStream.mockResolvedValue(sseResponse(textDelta("\uFEFF\u200B") + textDelta("x") + finish("stop")));
    const a = adapter();
    const events = await collect(a.chat([{ role: "user", content: "q" }], [], undefined));
    expect(events.filter((e) => e.type === "text")).toHaveLength(1);
  });

  it("handles SSE events split across chunk boundaries", async () => {
    // One ReadableStream chunk per arbitrary split of the same payload
    const payload = textDelta("he") + textDelta("llo") + finish("stop");
    const stream = new ReadableStream({
      start(c) {
        for (let i = 0; i < payload.length; i += 7) c.enqueue(new TextEncoder().encode(payload.slice(i, i + 7)));
        c.close();
      },
    });
    mockFetchStream.mockResolvedValue(new Response(stream, { status: 200 }));
    const a = adapter();
    const events = await collect(a.chat([{ role: "user", content: "q" }], [], undefined));
    expect(events.filter((e) => e.type === "text").map((e) => e.delta).join("")).toBe("hello");
    expect(events.at(-1).type).toBe("done");
  });

  it("ignores [DONE] markers and chunks without choices", async () => {
    mockFetchStream.mockResolvedValue(
      sseResponse(textDelta("ok") + "data: [DONE]\n\n" + sse({ choices: [] }) + finish("stop"))
    );
    const a = adapter();
    const events = await collect(a.chat([{ role: "user", content: "q" }], [], undefined));
    expect(events.filter((e) => e.type === "text")).toHaveLength(1);
    expect(events.at(-1).type).toBe("done");
  });
});

describe("provider.chat — tool call accumulation", () => {
  it("assembles tool calls whose arguments stream across multiple deltas", async () => {
    mockFetchStream.mockResolvedValue(
      sseResponse(
        tcDelta(0, "call_1", "pocket_add", '{"con') +
          tcArgsDelta(0, 'tent":"milk') +
          tcArgsDelta(0, ' tea"}') +
          finish("tool_calls")
      )
    );
    const a = adapter();
    const events = await collect(a.chat([{ role: "user", content: "q" }], [], undefined));
    const done = events.at(-1);
    expect(done.type).toBe("done");
    expect(done.finishReason).toBe("tool_calls");
    expect(done.toolCalls).toHaveLength(1);
    expect(done.toolCalls[0]).toEqual({
      id: "call_1",
      type: "function",
      function: { name: "pocket_add", arguments: '{"content":"milk tea"}' },
    });
  });

  it("keeps multiple concurrent tool calls separated by index", async () => {
    mockFetchStream.mockResolvedValue(
      sseResponse(
        tcDelta(0, "c1", "a_tool", "{}") +
          tcDelta(1, "c2", "b_tool", '{"x"') +
          tcArgsDelta(1, ':1}') +
          finish("tool_calls")
      )
    );
    const a = adapter();
    const events = await collect(a.chat([{ role: "user", content: "q" }], [], undefined));
    const calls = events.at(-1).toolCalls;
    expect(calls.map((c) => c.id).sort()).toEqual(["c1", "c2"]);
    expect(calls.find((c) => c.id === "c2").function.arguments).toBe('{"x":1}');
  });

  it("synthesizes a tool_calls done event when the stream ends without finish_reason", async () => {
    mockFetchStream.mockResolvedValue(
      sseResponse(tcDelta(0, "c9", "t", "{}")) // stream just ends, no finish marker
    );
    const a = adapter();
    const events = await collect(a.chat([{ role: "user", content: "q" }], [], undefined));
    const done = events.at(-1);
    expect(done.type).toBe("done");
    expect(done.finishReason).toBe("tool_calls");
    expect(done.toolCalls).toHaveLength(1);
  });

  it("synthesizes a plain stop done event when the stream ends with no pending calls", async () => {
    mockFetchStream.mockResolvedValue(sseResponse(textDelta("bye")));
    const a = adapter();
    const events = await collect(a.chat([{ role: "user", content: "q" }], [], undefined));
    const done = events.at(-1);
    expect(done.type).toBe("done");
    expect(done.finishReason).toBe("stop");
    expect(done.toolCalls).toEqual([]);
  });
});

describe("provider.chat — error paths", () => {
  it("yields an error event on non-2xx responses", async () => {
    mockFetchStream.mockResolvedValue(new Response("upstream exploded", { status: 500 }));
    const a = adapter();
    const events = await collect(a.chat([{ role: "user", content: "q" }], [], undefined));
    expect(events.at(-1).type).toBe("error");
    expect(events.at(-1).message).toContain("API error 500");
  });

  it("yields an error event when the response has no body", async () => {
    mockFetchStream.mockResolvedValue({ ok: true, body: null });
    const a = adapter();
    const events = await collect(a.chat([{ role: "user", content: "q" }], [], undefined));
    expect(events.at(-1).type).toBe("error");
    expect(events.at(-1).message).toContain("沒有 body");
  });

  it("yields an error event when fetchStreamWithRetry throws after retries", async () => {
    mockFetchStream.mockRejectedValue(new Error("ETIMEDOUT"));
    const a = adapter();
    const events = await collect(a.chat([{ role: "user", content: "q" }], [], undefined));
    expect(events.at(-1).type).toBe("error");
    expect(events.at(-1).message).toContain("ETIMEDOUT");
  });
});
