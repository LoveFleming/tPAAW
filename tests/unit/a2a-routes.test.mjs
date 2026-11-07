/**
 * A2A 路由整合測試 — TASK-052 test 階段補強（tester Divya Reddy）
 *
 * 受測對象：packages/server/src/routes/a2a.mjs（F20261016-009 A2A 代理協作協定服務）
 * 層級：HTTP 整合 — 真實 node:http server（port 0）跑真實 a2aRoutes handler，
 *       只 mock 外部邊界（ToolEngine/LLM provider、domain-agent-registry、
 *       paaw-agent-loop、webhook 目標 fetch），不 mock 被測邏輯。
 *
 * Mock 面積（全部是外部邊界）：
 *   - lib/tool-engine/index.mjs + tools/index.mjs → FakeToolEngine（固定 text chunks + tool_start）
 *   - context-engine.mjs        → contextEngine.build 回固定 systemPrompt
 *   - lib/domain-agent-registry → architect agent 存在、其他 undefined
 *   - lib/paaw-agent-loop       → runAgentLoop 回 "domain reply"；runAgentLoopStream 直寫 SSE
 *   - lib/vision-content / action-log / project-crew / uploads → 空實作（不觸發的支線）
 *   - globalThis.fetch         → 只攔 webhook.example.com，其餘走真實 fetch（測試 client 用）
 *   - providers.json           → 寫入 TMP/config（真實 getCachedProviders 解析）
 *   - task 持久化              → 用真實 JsonTaskPersistence 落在 TMP（真檔案 round-trip）
 *
 * 既有覆蓋（tests/unit/a2a-protocol.test.mjs，不重測）：
 *   assertSafeWebhookUrl SSRF 純函式、A2A_PROTOCOL_VERSION 常數、corsHeadersFor 純函式、
 *   isValidRpcId/isValidRpcMethod 純函式。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import http from "node:http";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── 沙箱資料目錄與 CORS 白名單 — module const 認 env，必須在 import 受測模組前設好 ──
const TMP = mkdtempSync(join(tmpdir(), "a2a-it-"));
process.env.PAAW_DATA_HOME = TMP;
process.env.PAAW_LOG_HOME = TMP;
process.env.PAAW_A2A_ALLOWED_ORIGINS = "http://allowed.example";

mkdirSync(join(TMP, "config"), { recursive: true });
writeFileSync(
  join(TMP, "config", "providers.json"),
  JSON.stringify({
    active: "mocked",
    providers: { mocked: { apiKey: "test-key", baseURL: "http://llm.invalid", models: ["m1"], defaultModel: "m1" } },
  })
);

// ── FakeToolEngine：text 總長 ≥100 字元避免觸發 helpdesk fallback summary fetch ──
const SEG = "PAAW A2A mock engine reply segment. "; // 34 chars
const FULL_TEXT = SEG.repeat(5); // 170 chars ≥ 100

const { MockToolEngine, mockRunAgentLoop, mockRunAgentLoopStream } = vi.hoisted(() => {
  class MockToolEngine {
    constructor(opts) { this.opts = opts; MockToolEngine.lastOpts = opts; }
    async *run(systemPrompt, messages, model) {
      MockToolEngine.calls.push({ systemPrompt, messages, model });
      for (let i = 0; i < 4; i++) yield { type: "text", delta: "PAAW A2A mock engine reply segment. " };
      yield { type: "tool_start", name: "helpdesk_search" };
      yield { type: "text", delta: "PAAW A2A mock engine reply segment. " };
    }
  }
  MockToolEngine.calls = [];
  MockToolEngine.lastOpts = null;
  return {
    MockToolEngine,
    mockRunAgentLoop: vi.fn(async () => ({ content: "domain reply", turns: 1, toolCalls: [] })),
    mockRunAgentLoopStream: vi.fn(async (opts, res) => {
      res.write(`data: ${JSON.stringify({ jsonrpc: "2.0", result: { kind: "status-update", taskId: "t-dom", status: { state: "completed" }, final: true }, id: 1 })}\n\n`);
      if (!res.writableEnded) res.end();
    }),
  };
});

vi.mock("../../packages/server/src/lib/tool-engine/index.mjs", () => ({
  ToolEngine: MockToolEngine,
  createToolEngine: vi.fn(),
}));
vi.mock("../../packages/server/src/tools/index.mjs", () => ({
  getToolsAndHandlers: vi.fn(async () => ({ tools: [], handlers: {} })),
  invalidateCache: vi.fn(),
  buildAppInstructions: vi.fn(() => ""),
  getHandlers: vi.fn(async () => ({})),
}));
vi.mock("../../packages/server/src/context-engine.mjs", () => ({
  contextEngine: { build: vi.fn(async () => ({ systemPrompt: "MOCK_SYS_PROMPT" })) },
}));
vi.mock("../../packages/server/src/lib/domain-agent-registry.mjs", () => ({
  getAgent: vi.fn(id => (id === "architect" ? { agentId: "architect", codename: "曉薇", role: "architect", maxTurns: 5 } : undefined)),
  buildAgentCard: vi.fn((id, req) => ({ protocolVersion: "0.3.0", name: `Domain-${id}`, url: `http://${req.headers.host}/a2a/${id}` })),
  buildSystemPrompt: vi.fn(() => "DOMAIN_SYS_PROMPT"),
  listAgents: vi.fn(() => []),
}));
vi.mock("../../packages/server/src/lib/paaw-agent-loop.mjs", () => ({
  runAgentLoop: mockRunAgentLoop,
  runAgentLoopStream: mockRunAgentLoopStream,
  appendSkillBindings: vi.fn(async m => m),
  trimMessagesToFit: vi.fn(m => m),
  getToolsForAgent: vi.fn(async () => ({ tools: [], handlers: {} })),
  setAgentConfig: vi.fn(),
  getAgentGroups: vi.fn(() => ({})),
  clearCrewGroupCache: vi.fn(),
  executeTool: vi.fn(),
}));
vi.mock("../../packages/server/src/lib/vision-content.mjs", () => ({
  getVisionModel: vi.fn(() => undefined),
  buildImageAttachmentMessage: vi.fn(),
  resolveVisionLlmConfig: vi.fn(),
  messagesForModel: vi.fn(m => m),
  isVisionModel: vi.fn(() => false),
  visionAvailable: vi.fn(() => false),
  hasImages: vi.fn(() => false),
}));
vi.mock("../../packages/server/src/lib/action-log.mjs", () => ({
  listActionLog: vi.fn(async () => []),
  loadAgentMemory: vi.fn(async () => null),
  addActionLog: vi.fn(),
}));
vi.mock("../../packages/server/src/lib/project-crew.mjs", () => ({
  readProjectSkills: vi.fn(async () => []),
}));
vi.mock("../../packages/server/src/lib/tool-registry-init.mjs", () => ({
  injectRegistryTools: vi.fn(),
}));
vi.mock("../../packages/server/src/routes/uploads.mjs", () => ({
  resolveUploadRef: vi.fn(async () => null),
  uploadsDir: TMP,
}));
vi.mock("../../packages/server/src/lib/llm-utils.mjs", async importOriginal => {
  const orig = await importOriginal();
  return { ...orig, resolveDefaultModel: vi.fn(() => "m1") };
});

const { default: a2aRoutes } = await import("../../packages/server/src/routes/a2a.mjs");

// ── HTTP harness ──
let server, baseUrl, realFetch;
const webhookCalls = [];

beforeAll(async () => {
  realFetch = globalThis.fetch;
  // 只攔 webhook 目標；測試 client 的 fetch 走真實路徑
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : (input?.href || input?.url || "");
    if (url.includes("webhook.example.com")) {
      webhookCalls.push({ url, init });
      return { ok: true, status: 200 };
    }
    return realFetch(input, init);
  };
  server = http.createServer((req, res) => {
    Promise.resolve()
      .then(() => a2aRoutes(req, res))
      .then(handled => {
        if (!handled && !res.writableEnded) { res.statusCode = 404; res.end("not a2a"); }
      })
      .catch(err => {
        if (!res.writableEnded) { res.statusCode = 500; res.end(JSON.stringify({ fatal: String(err?.message || err) })); }
      });
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  await new Promise(r => { server.closeAllConnections?.(); r(); });
  await new Promise(r => server.close(r));
  rmSync(TMP, { recursive: true, force: true });
});

beforeEach(() => {
  webhookCalls.length = 0;
  MockToolEngine.calls = [];
});

async function call(method, path, { headers = {}, rawBody, body } = {}) {
  const res = await realFetch(`${baseUrl}${path}`, {
    signal: AbortSignal.timeout(5000),
    method,
    headers: { "content-type": "application/json", ...headers },
    body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  if (text) { try { json = JSON.parse(text); } catch { json = null; } }
  return { status: res.status, headers: res.headers, text, json };
}

const rpc = (method, params, id = 1) => ({ jsonrpc: "2.0", method, params, id });
const msg = text => ({ role: "user", parts: [{ type: "text", kind: "text", text }] });

// ════════════════════════════════════════════════
// 1. Agent Card 端點
// ════════════════════════════════════════════════
describe("Agent Card 探索端點", () => {
  it("GET /.well-known/agent.json → 200 + 完整 PAAW Agent Card", async () => {
    const r = await call("GET", "/.well-known/agent.json");
    expect(r.status).toBe(200);
    expect(r.json.protocolVersion).toBe("0.3.0");
    expect(r.json.name).toBe("PAAW Agent");
    expect(r.json.url).toBe(`${baseUrl}/a2a`);
    expect(r.json.capabilities).toEqual({ streaming: true, pushNotifications: true, stateTransitionHistory: true });
    expect(r.json.skills[0].id).toBe("paaw-helpdesk");
    expect(r.json.authentication.schemes).toEqual(["none"]);
  });

  it("GET /.well-known/agent-card.json → alias，同一份卡", async () => {
    const r = await call("GET", "/.well-known/agent-card.json");
    expect(r.status).toBe(200);
    expect(r.json.protocolVersion).toBe("0.3.0");
    expect(r.json.url).toContain("/a2a");
  });

  it("GET /api/a2a/agent-card → 200 + ok:true + data 為卡", async () => {
    const r = await call("GET", "/api/a2a/agent-card");
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);
    expect(r.json.data.name).toBe("PAAW Agent");
    expect(r.json.data.protocolVersion).toBe("0.3.0");
  });

  it("非 A2A 路徑 → handler 回 false，server 落 404", async () => {
    const r = await call("GET", "/api/nothing-here");
    expect(r.status).toBe(404);
  });
});

// ════════════════════════════════════════════════
// 2. CORS
// ════════════════════════════════════════════════
describe("CORS（QA M3 白名單）", () => {
  it("OPTIONS /a2a 白名單 Origin → 204 + ACAO 回映", async () => {
    const r = await call("OPTIONS", "/a2a", { headers: { origin: "http://allowed.example" } });
    expect(r.status).toBe(204);
    expect(r.headers.get("access-control-allow-origin")).toBe("http://allowed.example");
    expect(r.headers.get("access-control-allow-methods")).toContain("POST");
  });

  it("OPTIONS /a2a 非白名單 Origin → 204 但無 ACAO 標頭", async () => {
    const r = await call("OPTIONS", "/a2a", { headers: { origin: "http://evil.example" } });
    expect(r.status).toBe(204);
    expect(r.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("JSON-RPC 回應帶白名單 CORS 標頭", async () => {
    const r = await call("POST", "/a2a", { headers: { origin: "http://allowed.example" }, body: rpc("tasks/list", {}) });
    expect(r.headers.get("access-control-allow-origin")).toBe("http://allowed.example");
  });
});

// ════════════════════════════════════════════════
// 3. JSON-RPC 2.0 錯誤處理（POST /a2a 預設端點）
// ════════════════════════════════════════════════
describe("JSON-RPC 錯誤處理", () => {
  it("非 JSON body → -32700 Parse error，id null", async () => {
    const r = await call("POST", "/a2a", { rawBody: "{not-json" });
    expect(r.json.error).toEqual({ code: -32700, message: "Parse error" });
    expect(r.json.id).toBeNull();
  });

  it("jsonrpc 非 2.0 → -32600 Invalid Request", async () => {
    const r = await call("POST", "/a2a", { body: { jsonrpc: "1.0", method: "tasks/list", id: 7 } });
    expect(r.json.error.code).toBe(-32600);
    expect(r.json.id).toBe(7);
  });

  it("id 非法型別（陣列）→ -32600，回 id null", async () => {
    const r = await call("POST", "/a2a", { body: { jsonrpc: "2.0", method: "tasks/list", id: ["x"] } });
    expect(r.json.error.code).toBe(-32600);
    expect(r.json.id).toBeNull();
  });

  it("method 非字串 → -32600（不可誤判 -32601）", async () => {
    const r = await call("POST", "/a2a", { body: { jsonrpc: "2.0", method: 123, id: 3 } });
    expect(r.json.error.code).toBe(-32600);
    expect(r.json.error.message).toContain("method");
  });

  it("未知 method → -32601 Method not found", async () => {
    const r = await call("POST", "/a2a", { body: rpc("bogus/method", {}) });
    expect(r.json.error).toEqual({ code: -32601, message: "Method not found: bogus/method" });
  });

  it("message 無 text part → -32602", async () => {
    const r = await call("POST", "/a2a", { body: rpc("message/send", { message: { role: "user", parts: [] } }) });
    expect(r.json.error.code).toBe(-32602);
  });

  it("tasks/get 不存在 → -32001 Task not found", async () => {
    const r = await call("POST", "/a2a", { body: rpc("tasks/get", { id: "task-nope" }) });
    expect(r.json.error.code).toBe(-32001);
    expect(r.json.error.message).toContain("task-nope");
  });
});

// ════════════════════════════════════════════════
// 4. 同步模式：message/send → completed
// ════════════════════════════════════════════════
describe("message/send 同步模式", () => {
  it("completed：回傳 task 含 artifacts 文字與 toolsUsed metadata", async () => {
    const r = await call("POST", "/a2a", { body: rpc("message/send", { message: msg("請介紹 PAAW 的 A2A 功能") }) });
    expect(r.json.jsonrpc).toBe("2.0");
    expect(r.json.id).toBe(1);
    const task = r.json.result;
    expect(task.status.state).toBe("completed");
    expect(task.artifacts[0].parts[0].text).toBe(FULL_TEXT);
    expect(task.metadata.toolsUsed).toEqual(["helpdesk_search"]);
    expect(task.history.at(-1).role).toBe("agent");
  });

  it("contextId 多輪：同 context 第二次送 → 同 task id、history 累積 3 筆", async () => {
    const first = await call("POST", "/a2a", { body: rpc("message/send", { message: msg("第一輪"), contextId: "ctx-followup" }) });
    expect(first.json.result.contextId).toBe("ctx-followup");
    const second = await call("POST", "/a2a", { body: rpc("message/send", { message: msg("第二輪"), contextId: "ctx-followup" }) });
    expect(second.json.result.id).toBe(first.json.result.id); // 同一 task 接續
    expect(second.json.result.history.length).toBe(4); // user, agent, user, agent user+agent? → 至少含兩輪
    expect(second.json.result.history.some(h => h.parts?.[0]?.text === "第二輪")).toBe(true);
  });
});

// ════════════════════════════════════════════════
// 5. SSE 串流模式：message/stream
// ════════════════════════════════════════════════
describe("message/stream SSE 串流", () => {
  it("事件序列 task → status-update(working) → artifact-update* → completed(final)", async () => {
    const res = await realFetch(`${baseUrl}/a2a`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(rpc("message/stream", { message: msg("串流測試") }, "sse-1")),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const text = await Promise.race([
      res.text(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("SSE timeout")), 8000)),
    ]);
    const events = text.split("\n\n")
      .filter(b => b.startsWith("data: "))
      .map(b => JSON.parse(b.slice(6)));

    expect(events.length).toBeGreaterThan(3);
    expect(events[0].result.kind).toBe("task");
    const kinds = events.map(e => e.result.kind);
    expect(kinds).toContain("status-update");
    expect(kinds).toContain("artifact-update");

    const finals = events.filter(e => e.result.final === true);
    expect(finals.length).toBeGreaterThan(0);
    expect(finals.at(-1).result.status.state).toBe("completed");
    expect(finals.at(-1).id).toBe("sse-1");
  });
});

// ════════════════════════════════════════════════
// 6. Webhook 非同步模式
// ════════════════════════════════════════════════
describe("message/send webhook 非同步模式", () => {
  it("立即回 working；背景完成後 POST webhook（含 Bearer token）", async () => {
    const r = await call("POST", "/a2a", {
      body: rpc("message/send", {
        message: msg("非同步 webhook 測試"),
        configuration: { pushNotification: { url: "https://webhook.example.com/hook", token: "tok-1" } },
      }),
    });
    expect(r.json.result.status.state).toBe("working"); // 立即回 working

    // 中途狀態（thinking / executing tool）也會推 webhook — 等「最終 completed」那筆
    await vi.waitFor(() => {
      const done = webhookCalls.find(c => {
        try { return JSON.parse(c.init.body).result.status.state === "completed"; } catch { return false; }
      });
      expect(done).toBeTruthy();
    }, { timeout: 5000 });
    const { url, init } = webhookCalls.find(c => {
      try { return JSON.parse(c.init.body).result.status.state === "completed"; } catch { return false; }
    });
    expect(url).toBe("https://webhook.example.com/hook");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer tok-1");
    const payload = JSON.parse(init.body);
    expect(payload.jsonrpc).toBe("2.0");
    expect(payload.result.status.state).toBe("completed");
    expect(payload.result.artifacts[0].parts[0].text).toBe(FULL_TEXT);
  });

  it("SSRF URL（loopback http）被拒 → 不發任何 fetch，task 照常完成", async () => {
    const r = await call("POST", "/a2a", {
      body: rpc("message/send", {
        message: msg("SSRF 防護測試"),
        configuration: { pushNotification: { url: "http://127.0.0.1:9/steal" } },
      }),
    });
    expect(r.json.result.status.state).toBe("working");
    const taskId = r.json.result.id;
    await vi.waitFor(async () => {
      const t = await call("POST", "/a2a", { body: rpc("tasks/get", { id: taskId }) });
      expect(t.json.result.status.state).toBe("completed");
    }, { timeout: 5000 });
    await new Promise(r2 => setTimeout(r2, 200)); // 給背景殘餘時間
    expect(webhookCalls.length).toBe(0); // 從未對外發 fetch
  });
});

// ════════════════════════════════════════════════
// 7. Notification（無 id）語意
// ════════════════════════════════════════════════
describe("JSON-RPC notification（QA m3）", () => {
  it("無 id → 不回應 body，但 task 仍被處理（tasks/list 可見）", async () => {
    const r = await call("POST", "/a2a", {
      body: { jsonrpc: "2.0", method: "message/send", params: { message: msg("通知語意測試"), contextId: "ctx-notify" } },
    });
    expect(r.status).toBe(200);
    expect(r.text).toBe(""); // suppress：不回 body

    await vi.waitFor(async () => {
      const list = await call("POST", "/a2a", { body: rpc("tasks/list", {}) });
      const hit = list.json.result.tasks.find(t => t.contextId === "ctx-notify");
      expect(hit).toBeTruthy();
      expect(hit.status.state).toBe("completed");
    }, { timeout: 5000 });
  });
});

// ════════════════════════════════════════════════
// 8. Task 生命週期（tasks/get / list / cancel）
// ════════════════════════════════════════════════
describe("tasks/get、tasks/cancel", () => {
  it("tasks/get historyLength 裁切 history", async () => {
    const send = await call("POST", "/a2a", { body: rpc("message/send", { message: msg("裁切測試"), contextId: "ctx-trim" }) });
    const id = send.json.result.id;
    const got = await call("POST", "/a2a", { body: rpc("tasks/get", { id, historyLength: 1 }) });
    expect(got.json.result.history.length).toBe(1);
  });

  it("tasks/cancel → task 狀態 canceled", async () => {
    const send = await call("POST", "/a2a", { body: rpc("message/send", { message: msg("取消測試"), contextId: "ctx-cancel" }) });
    const id = send.json.result.id;
    const c = await call("POST", "/a2a", { body: rpc("tasks/cancel", { id }) });
    expect(c.json.result.status.state).toBe("canceled");
  });
});

// ════════════════════════════════════════════════
// 9. Domain Agent（/a2a/:agentId）
// ════════════════════════════════════════════════
describe("Domain agent 端點", () => {
  it("GET /a2a/architect → 200 + 該 agent 的 card", async () => {
    const r = await call("GET", "/a2a/architect");
    expect(r.status).toBe(200);
    expect(r.json.name).toBe("Domain-architect");
    expect(r.json.url).toContain("/a2a/architect");
  });

  it("GET /a2a/architect/.well-known/agent.json → 同卡", async () => {
    const r = await call("GET", "/a2a/architect/.well-known/agent.json");
    expect(r.status).toBe(200);
    expect(r.json.name).toBe("Domain-architect");
  });

  it("未知 agent → 404 Unknown domain agent", async () => {
    const r = await call("GET", "/a2a/who-is-this");
    expect(r.status).toBe(404);
    expect(r.json.error).toContain("Unknown domain agent");
  });

  it("POST /a2a/architect message/send → runAgentLoop 結果進 artifacts", async () => {
    mockRunAgentLoop.mockClear();
    const r = await call("POST", "/a2a/architect", { body: rpc("message/send", { message: msg("域代理同步") }) });
    expect(mockRunAgentLoop).toHaveBeenCalledTimes(1);
    expect(r.json.result.artifacts[0].parts[0].text).toBe("domain reply");
  });

  it("POST /a2a/architect message/stream → SSE（runAgentLoopStream 接手）", async () => {
    mockRunAgentLoopStream.mockClear();
    const res = await realFetch(`${baseUrl}/a2a/architect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(rpc("message/stream", { message: msg("域代理串流") }, 9)),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await Promise.race([
      res.text(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("SSE timeout")), 8000)),
    ]);
    expect(mockRunAgentLoopStream).toHaveBeenCalledTimes(1);
    expect(text).toContain('"state":"completed"');
  });

  it("POST /a2a/architect 非 JSON → -32700；未知 method → -32601", async () => {
    const p = await call("POST", "/a2a/architect", { rawBody: "nope" });
    expect(p.json.error.code).toBe(-32700);
    const m = await call("POST", "/a2a/architect", { body: rpc("no/such", {}) });
    expect(m.json.error.code).toBe(-32601);
  });

  it("POST /a2a/architect tasks/get 不存在 → -32001", async () => {
    const r = await call("POST", "/a2a/architect", { body: rpc("tasks/get", { id: "missing" }) });
    expect(r.json.error.code).toBe(-32001);
  });
});
