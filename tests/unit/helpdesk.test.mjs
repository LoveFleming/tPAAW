/**
 * Unit tests — F-036 Help Desk (packages/server/src/routes/helpdesk.mjs)
 *
 * TASK-085 品質補強（不重做實作）。單一路由檔，7 個端點：
 *   1. POST /api/helpdesk/ask          — 新建票 / 續問（多輪）
 *   2. GET  /api/helpdesk/tickets      — 列出所有票
 *   3. PUT  /api/helpdesk/tickets      — 整批覆寫票
 *   4. GET  /api/helpdesk/ticket/:id   — 查單票
 *   5. POST /api/helpdesk/ticket/:id/reply — 補充問題（轉人工）
 *   6. GET  /api/helpdesk/knowledge    — 知識庫
 *   7. GET  /api/helpdesk/models       — provider 模型清單
 *
 * 隔離策略：
 *   - route handler 直接注入 mock req/res（不開 server、不污染 data/helpdesk/tickets.json）
 *   - mock fs/promises 為「記憶體 store」，以路徑後綴為 key（tickets.json / KNOWLEDGE.md / providers.json / SKILL.md）
 *   - mock 重型依賴（ToolEngine、tool registry、llm-utils），避免真連網
 *
 * ⚠️ 缺陷登錄（不修實作，依 TASK-085 out-of-scope）：
 *   B1 (Critical) — runHelpDeskSkill 內引用未宣告的 taskId / tStore（模組只有 taskStore）→ ReferenceError
 *   B2 (Critical) — runHelpDeskSkill 內 ${knowledgeBase} 引用未宣告變數（應為 await getCachedKnowledge()）
 *   兩者使 POST /ask 的核心問答路徑失效：改由 caller catch 吞掉 → 回 status:"open" 而非 "answered"。
 *   以下 "🚩 B1/B2 缺陷登錄" 區塊以斷言證明缺陷存在；修好後斷言會轉綠（tester 不改實作）。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── In-memory file store (keyed by path suffix) ──
const files = new Map();
const memStore = {
  reset() { files.clear(); },
  set(key, content) { files.set(key, content); },
  get(key) { return files.get(key); },
};
function keyFor(p) {
  const s = String(p);
  if (s.endsWith("/helpdesk/tickets.json")) return "tickets.json";
  if (s.endsWith("/helpdesk/KNOWLEDGE.md")) return "KNOWLEDGE.md";
  if (s.endsWith("/config/providers.json")) return "providers.json";
  if (s.endsWith("/help-desk/SKILL.md")) return "SKILL.md";
  return s;
}

// ── Mock fs/promises ──
vi.mock("fs/promises", () => ({
  readFile: vi.fn(async (p) => {
    const k = keyFor(p);
    if (!files.has(k)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    return files.get(k);
  }),
  writeFile: vi.fn(async (p, content) => { files.set(keyFor(p), content); }),
  mkdir: vi.fn(async () => {}),
}));

// ── Mock ToolEngine（避免真連網 / 真跑 agent loop）──
// engine.run 回傳一個 text chunk；正常情況會走到 runHelpDeskSkill 的 B1 ReferenceError，
// 因此 engine 本身不是被測重點（B1 會更早炸），但需存在避免 import 失敗。
vi.mock("../../packages/server/src/lib/tool-engine/index.mjs", () => ({
  ToolEngine: class {
    constructor() {}
    async *run() { yield { type: "text", delta: "mocked answer" }; }
  },
  createToolEngine: vi.fn(),
}));

vi.mock("../../packages/server/src/tools/index.mjs", () => ({
  getToolsAndHandlers: vi.fn(async () => ({ tools: [], handlers: {} })),
  getHandlers: vi.fn(async () => ({})),
}));

vi.mock("../../packages/server/src/lib/tool-registry-init.mjs", () => ({
  injectRegistryTools: vi.fn(),
}));

vi.mock("../../packages/server/src/lib/llm-utils.mjs", () => ({
  callLLMWithRetry: vi.fn(async () => ({ content: "fallback" })),
  resolveDefaultModel: vi.fn(() => "test-model"),
}));

vi.mock("../../packages/server/src/lib/context-truncation.mjs", () => ({
  truncateToolResultsInMessages: vi.fn((m) => m),
  limitHistoryTurns: vi.fn((m) => m),
}));

// ── Subject under test (dynamic import after mocks) ──
let helpdeskRoute;
beforeEach(async () => {
  vi.clearAllMocks();
  memStore.reset();
  // default: providers 有 apiKey，讓 runHelpDeskSkill 能通過 provider 檢查
  files.set("providers.json", JSON.stringify({
    active: "openai",
    defaultModel: "gpt-4o-mini",
    providers: { openai: { name: "OpenAI", apiKey: "sk-test", models: [{ id: "gpt-4o-mini", name: "GPT-4o mini" }] } },
  }));
  files.set("SKILL.md", "# HelpDesk Skill");
  files.set("KNOWLEDGE.md", "# Knowledge\npaaw docs");
  files.set("tickets.json", "[]");
  ({ default: helpdeskRoute } = await import("../../packages/server/src/routes/helpdesk.mjs"));
});

// ── Helpers: inject mock req/res ──
function mockReq(method, url, body) {
  const bodyStr = body === undefined ? "" : (typeof body === "string" ? body : JSON.stringify(body));
  return {
    method, url,
    on(ev, cb) {
      if (ev === "data" && bodyStr) cb(bodyStr);
      if (ev === "end") cb();
      if (ev === "error") cb();
    },
  };
}
function mockRes() {
  const r = { code: 0, body: null };
  r.writeHead = (c) => { r.code = c; return r; };
  r.end = (b) => { r.body = String(b || ""); return r; };
  return r;
}
async function call(method, url, body) {
  const res = mockRes();
  const handled = await helpdeskRoute(mockReq(method, url, body), res);
  return { handled, code: res.code, json: res.body ? JSON.parse(res.body) : null };
}
function seedTickets(tickets) { files.set("tickets.json", JSON.stringify(tickets)); }
function readTickets() { return JSON.parse(files.get("tickets.json")); }

// ════════════════════════════════════════════════════════════════
// 1. POST /api/helpdesk/ask
// ════════════════════════════════════════════════════════════════
describe("POST /api/helpdesk/ask", () => {
  it("缺 agentName → 400（不寫檔）", async () => {
    const { code, json } = await call("POST", "/api/helpdesk/ask", { message: "hello" });
    expect(code).toBe(400);
    expect(json.error).toMatch(/required/);
    expect(readTickets()).toHaveLength(0);
  });

  it("缺 message → 400（不寫檔）", async () => {
    const { code, json } = await call("POST", "/api/helpdesk/ask", { agentName: "A" });
    expect(code).toBe(400);
    expect(json.error).toMatch(/required/);
    expect(readTickets()).toHaveLength(0);
  });

  it("續問指定不存在的 ticketId → 404 (Ticket not found)", async () => {
    const { code, json } = await call("POST", "/api/helpdesk/ask", {
      agentName: "A", message: "follow up", ticketId: "TKT-does-not-exist",
    });
    expect(code).toBe(404);
    expect(json.error).toMatch(/not found/i);
  });

  it("新建票：即使問答引擎失敗，仍會先落地票（status:open + error）", async () => {
    // 因 B1，runHelpDeskSkill 會 ReferenceError → caller catch → 200 status:open
    const { code, json } = await call("POST", "/api/helpdesk/ask", {
      agentName: "tester-agent", agentType: "custom", subject: "S1", message: "如何重啟 PAAW?", priority: "high",
    });
    expect(code).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.ticketId).toMatch(/^TKT-/);
    expect(["open", "answered", "input-required"]).toContain(json.status);

    // 票必須被寫入 tickets.json，且含使用者訊息
    const tickets = readTickets();
    expect(tickets).toHaveLength(1);
    const t = tickets[0];
    expect(t.agentName).toBe("tester-agent");
    expect(t.subject).toBe("S1");
    expect(t.priority).toBe("high");
    // status 由流程後續覆寫（working→answered/open），僅檢查為合法狀態字串
    expect(["working", "open", "answered", "input-required"]).toContain(t.status);
    expect(t.messages.some(m => m.role === "user" && m.text === "如何重啟 PAAW?")).toBe(true);
  });

  it("subject 預設為 message 前 50 字（未提供 subject 時）", async () => {
    const long = "x".repeat(80);
    await call("POST", "/api/helpdesk/ask", { agentName: "A", message: long });
    const t = readTickets()[0];
    expect(t.subject).toBe(long.slice(0, 50));
    expect(t.priority).toBe("medium"); // 預設
    expect(t.agentType).toBe("custom"); // 預設
  });

  // ════════════════════════════════════════════════════════════════
  // 🚩 B1 / B2 缺陷登錄（紅燈 → 修好轉綠）
  // ════════════════════════════════════════════════════════════════
  it("🚩 B1/B2 缺陷登錄：新建票應能取得 AI 答案（answered），而非因 ReferenceError 降級為 open", async () => {
    const { json } = await call("POST", "/api/helpdesk/ask", {
      agentName: "A", message: "如何重啟 PAAW?",
    });
    // 預期（正確行為）：status === "answered"、answer 非空、無 error
    // 現況（缺陷）：runHelpDeskSkill 內 taskId/knowledgeBase 未宣告 → ReferenceError → status "open"
    expect(json.status).toBe("answered");
    expect(json.error).toBeUndefined();
    expect(typeof json.answer).toBe("string");
    expect(json.answer.length).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════════
// 2. GET /api/helpdesk/tickets
// ════════════════════════════════════════════════════════════════
describe("GET /api/helpdesk/tickets", () => {
  it("空 store → 200 { tickets: [], total: 0 }", async () => {
    const { code, json } = await call("GET", "/api/helpdesk/tickets");
    expect(code).toBe(200);
    expect(json.tickets).toEqual([]);
    expect(json.total).toBe(0);
  });

  it("有票 → 回全部並附 total", async () => {
    seedTickets([{ ticketId: "TKT-1" }, { ticketId: "TKT-2" }]);
    const { code, json } = await call("GET", "/api/helpdesk/tickets");
    expect(code).toBe(200);
    expect(json.total).toBe(2);
    expect(json.tickets.map(t => t.ticketId)).toEqual(["TKT-1", "TKT-2"]);
  });

  it("tickets.json 為損毀 JSON → loadTickets 容錯回 []（不 throw）", async () => {
    files.set("tickets.json", "{ this is not json");
    const { code, json } = await call("GET", "/api/helpdesk/tickets");
    expect(code).toBe(200);
    expect(json.tickets).toEqual([]);
    expect(json.total).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════
// 3. PUT /api/helpdesk/tickets
// ════════════════════════════════════════════════════════════════
describe("PUT /api/helpdesk/tickets", () => {
  it("合法陣列 → 200 { ok, count } 並覆寫 store", async () => {
    const { code, json } = await call("PUT", "/api/helpdesk/tickets", [{ ticketId: "TKT-X" }]);
    expect(code).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.count).toBe(1);
    expect(readTickets()).toEqual([{ ticketId: "TKT-X" }]);
  });

  it("非陣列（物件）→ 400 且不覆寫 store", async () => {
    seedTickets([{ ticketId: "TKT-KEEP" }]);
    const { code, json } = await call("PUT", "/api/helpdesk/tickets", { not: "array" });
    expect(code).toBe(400);
    expect(json.error).toMatch(/array/i);
    expect(readTickets()).toEqual([{ ticketId: "TKT-KEEP" }]);
  });

  it("非陣列（字串）→ 400", async () => {
    const { code } = await call("PUT", "/api/helpdesk/tickets", JSON.stringify("nope"));
    expect(code).toBe(400);
  });

  it("空陣列 → 200 count:0（清空 store）", async () => {
    seedTickets([{ ticketId: "TKT-OLD" }]);
    const { code, json } = await call("PUT", "/api/helpdesk/tickets", []);
    expect(code).toBe(200);
    expect(json.count).toBe(0);
    expect(readTickets()).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════
// 4. GET /api/helpdesk/ticket/:id
// ════════════════════════════════════════════════════════════════
describe("GET /api/helpdesk/ticket/:id", () => {
  it("存在 → 200 回單票", async () => {
    seedTickets([{ ticketId: "TKT-1", subject: "s" }]);
    const { code, json } = await call("GET", "/api/helpdesk/ticket/TKT-1");
    expect(code).toBe(200);
    expect(json.ticketId).toBe("TKT-1");
  });

  it("不存在 → 404 Ticket not found", async () => {
    seedTickets([{ ticketId: "TKT-1" }]);
    const { code, json } = await call("GET", "/api/helpdesk/ticket/TKT-NOPE");
    expect(code).toBe(404);
    expect(json.error).toMatch(/not found/i);
  });

  it("id 含非法字元（路徑穿越）→ 不 match 路由，回 false（未處理）", async () => {
    const { handled } = await call("GET", "/api/helpdesk/ticket/..%2fetc%2fpasswd");
    expect(handled).toBe(false); // regex [\w.-]+ 不含 % 與 /
  });
});

// ════════════════════════════════════════════════════════════════
// 5. POST /api/helpdesk/ticket/:id/reply
// ════════════════════════════════════════════════════════════════
describe("POST /api/helpdesk/ticket/:id/reply", () => {
  it("合法 → 200 加入訊息、狀態轉 open", async () => {
    seedTickets([{ ticketId: "TKT-1", status: "input-required", messages: [] }]);
    const { code, json } = await call("POST", "/api/helpdesk/ticket/TKT-1/reply", { message: "補充資訊" });
    expect(code).toBe(200);
    expect(json.ok).toBe(true);
    const t = readTickets()[0];
    expect(t.status).toBe("open");
    expect(t.messages).toHaveLength(1);
    expect(t.messages[0]).toMatchObject({ role: "user", text: "補充資訊" });
  });

  it("缺 message → 400 且不寫檔", async () => {
    seedTickets([{ ticketId: "TKT-1", status: "input-required", messages: [] }]);
    const { code, json } = await call("POST", "/api/helpdesk/ticket/TKT-1/reply", {});
    expect(code).toBe(400);
    expect(json.error).toMatch(/message/i);
    expect(readTickets()[0].messages).toHaveLength(0);
  });

  it("票不存在 → 404 Ticket not found", async () => {
    const { code, json } = await call("POST", "/api/helpdesk/ticket/TKT-NOPE/reply", { message: "x" });
    expect(code).toBe(404);
    expect(json.error).toMatch(/not found/i);
  });
});

// ════════════════════════════════════════════════════════════════
// 6. GET /api/helpdesk/knowledge
// ════════════════════════════════════════════════════════════════
describe("GET /api/helpdesk/knowledge", () => {
  it("有 KNOWLEDGE.md → 200 { knowledge }", async () => {
    const { code, json } = await call("GET", "/api/helpdesk/knowledge");
    expect(code).toBe(200);
    expect(json.knowledge).toContain("Knowledge");
  });

  it("KNOWLEDGE.md 不存在 → 404 Knowledge base not found", async () => {
    files.delete("KNOWLEDGE.md");
    const { code, json } = await call("GET", "/api/helpdesk/knowledge");
    expect(code).toBe(404);
    expect(json.error).toMatch(/not found/i);
  });
});

// ════════════════════════════════════════════════════════════════
// 7. GET /api/helpdesk/models
// ════════════════════════════════════════════════════════════════
describe("GET /api/helpdesk/models", () => {
  it("有 providers → 200 攤平 models 並回 active/defaultModel", async () => {
    const { code, json } = await call("GET", "/api/helpdesk/models");
    expect(code).toBe(200);
    expect(json.active).toBe("openai");
    expect(json.defaultModel).toBe("gpt-4o-mini");
    expect(json.models).toEqual([
      { id: "gpt-4o-mini", name: "GPT-4o mini", provider: "openai", providerName: "OpenAI" },
    ]);
  });

  it("providers.json 不存在 → 500 Failed to load providers", async () => {
    files.delete("providers.json");
    const { code, json } = await call("GET", "/api/helpdesk/models");
    expect(code).toBe(500);
    expect(json.error).toMatch(/providers/i);
  });
});

// ════════════════════════════════════════════════════════════════
// 路由契約
// ════════════════════════════════════════════════════════════════
describe("路由契約（fallthrough）", () => {
  it("未知路徑 → 回 false（交由其他 route 處理）", async () => {
    const { handled } = await call("GET", "/api/helpdesk/unknown");
    expect(handled).toBe(false);
  });
  it("已知路徑但錯誤方法 → 回 false", async () => {
    const { handled } = await call("DELETE", "/api/helpdesk/tickets");
    expect(handled).toBe(false);
  });
});
