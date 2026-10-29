/**
 * PAAW A2A Server — Agent2Agent Protocol (JSON-RPC 2.0 binding)
 *
 * 協定版本常數集中在 A2A_PROTOCOL_VERSION，Agent Card 與檔頭一律引用同一來源，
 * 避免對外宣稱版本與 protocolVersion 欄位不一致（見 QA-TASK052 M1）。
 * A2A 官方最新穩定版為 0.3.x，無 1.0.0 — 故正規化為 0.3.0。
 *
 * 實作 JSON-RPC 2.0 binding：
 *   GET  /.well-known/agent.json          → Agent Card
 *   GET  /.well-known/agent-card.json     → Agent Card (alias)
 *   POST /a2a                             → JSON-RPC endpoint
 *   POST /a2a/:agentId                    → Domain agent JSON-RPC endpoint
 *   POST /a2a                             → SSE streaming (method=message/stream)
 *
 * 支援的 methods（default /a2a 與 domain /a2a/:agentId 皆一致）：
 *   - message/send         → 同步回傳 Task 或 Message
 *   - message/stream       → SSE 串流
 *   - tasks/get            → 查詢 task 狀態
 *   - tasks/list           → 列出 tasks
 *   - tasks/cancel         → 取消 task
 *
 * Task 存儲：data/a2a-tasks/*.json
 */

import { readdir, readFile, writeFile, mkdir, unlink, appendFile, rename } from "fs/promises";
import { existsSync } from "fs";
import { randomUUID } from "crypto";
import { A2A_PROTOCOL_VERSION } from "../lib/a2a-constants.mjs";

// ── Helper: clean conversation history with tool call context ──
function cleanConversationHistory(conversationHistory) {
  return conversationHistory
    .filter(m => m.role === "user" || m.role === "assistant")
    .filter(m => !m._thinking)
    .map(m => {
      let content = (m.content || "").replace(/^💭 /, "");
      // Append tool call info so LLM knows what it did before
      if (m._toolCalls?.length) {
        const toolLines = m._toolCalls.map(tc => {
          if (tc.result) return `[tool:${tc.name}] result: ${tc.result.slice(0, 300)}`;
          return `[tool:${tc.name}] args: ${typeof tc.args === "string" ? tc.args.slice(0, 200) : "..."}`;
        });
        content += "\n" + toolLines.join("\n");
      }
      return { role: m.role, content };
    });
}
import { resolve, join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { JsonTaskPersistence } from "../lib/task-persistence.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PAAW_ROOT = resolve(__dirname, "../../../..");
const DATA_DIR = resolve(DATA_HOME);

// ── Agent Rules — injected into every crew's system prompt ──
import { AGENT_RULES } from "../lib/agent-rules.mjs";
import { readFileSync as readSync } from "fs";
import { resolveDefaultModel } from "../lib/llm-utils.mjs";
import { DATA_HOME } from "../data-home.mjs";
import { stableStringify } from "../lib/stable-stringify.mjs";

// ── Feature Map Summary (injected into system prompt) ──
async function getFeatureSummary(cwd) {
  if (!cwd) return "";
  const featuresFile = join(cwd, ".paaw", "features", "FEATURES.json");
  if (!existsSync(featuresFile)) return "";
  try {
    const data = JSON.parse(readSync(featuresFile, "utf-8"));
    const features = data.features || [];
    if (features.length === 0) return "";
    const lines = features.map(f => {
      const parts = [`- [${f.id}] ${f.name} (${f.status})`];
      if (f.description) parts.push(`— ${f.description}`);
      const meta = [];
      if (f.codeFiles?.length) meta.push(`${f.codeFiles.length} code files`);
      if (f.apis?.length) meta.push(`${f.apis.length} APIs`);
      if (f.tests?.length) meta.push(`${f.tests.length} tests`);
      if (f.issues?.length) meta.push(`${f.issues.length} issues`);
      if (meta.length) parts.push(`→ ${meta.join(", ")}`);
      return parts.join(" ");
    }).join("\n");

    // Build file→feature reverse index
    const fileMap = {};
    for (const f of features) {
      const allFiles = [
        ...(f.codeFiles || []),
        ...(f.tests || []),
        ...(f.runbooks || []),
        ...(f.apis || []).map(a => a.file).filter(Boolean),
      ];
      for (const file of allFiles) {
        if (!fileMap[file]) fileMap[file] = [];
        fileMap[file].push(`${f.id} ${f.name}`);
      }
    }
    const sortedFiles = Object.keys(fileMap).sort();
    const fileLines = sortedFiles.map(f => `- ${f} → ${fileMap[f].join(", ")}`).join("\n");

    return `\n## Feature Map (${features.length} features)\nUse project_info(category=feature_detail) for full info on any feature.\n${lines}\n\n## File → Feature Index (${sortedFiles.length} files)\nWhen you read or edit a file, check which feature it belongs to here.\n${fileLines}`;
  } catch {
    return "";
  }
}
const TASKS_DIR = resolve(DATA_DIR, "a2a-tasks");
const CONFIG_DIR = resolve(DATA_DIR, "config");
const HELPDESK_DATA = resolve(DATA_DIR, "helpdesk", "tickets.json");

// ── Task Persistence Adapter ──
const taskStore = new JsonTaskPersistence(TASKS_DIR);
await taskStore._ensureDir();

// ── Running Stream Tracker ──
// Maps agentId::cwd → { abortController, res, taskId } for active SSE streams
// 2026-09-15：key 從 agentId 改 agentId::cwd — 兩個 tab 開不同 RU 各自調度同一個 agent 時互不干擾（蓋掉註冊/誤刪/誤殺全修正）
export const runningStreams = new Map();

const _streamKey = (agentId, cwd) => `${agentId}::${cwd || PAAW_ROOT}`;

/** 依 agentId（+可選 cwd）找 running stream — cwd 有帶就精準比對，沒帶掃 prefix 取第一個（舊行為相容） */
export function findRunningStream(agentId, cwd) {
  if (cwd) {
    const k = _streamKey(agentId, cwd);
    const v = runningStreams.get(k);
    return v ? { key: k, stream: v } : null; // 帶了 cwd 但沒命中 = 不 fallback（避免誤殺別的 RU）
  }
  for (const [k, v] of runningStreams) {
    if (k.startsWith(`${agentId}::`)) return { key: k, stream: v };
  }
  return null;
}

// ── Stream State Registry（2026-09-11 治本：斷線不丟對話）──
// client（Chrome refresh /斷網）斷線時 agent 繼續跑，回覆存這裡 + 落地 conversation。
// GET /a2a/:agentId/stream-state 讓重連的 client 接回進度 / 拿 final reply。
// key: agentId::cwd → { agentId, cwd, startedAt, seq, events: [{seq,event,data}], finalContent, done, error, timer }
// 2026-09-15：key 從 agentId 改 agentId::cwd — 同 agent 不同 RU 的 recovery state 各自獨立，第二次 dispatch 不再蓋掉第一次
export const streamStates = new Map();
const STREAM_STATE_TTL_MS = 15 * 60 * 1000; // 完成後保留 15 分鐘給 client 重連取回
const STREAM_STATE_MAX_EVENTS = 300;

function _streamStateCleanup(agentId, cwd) {
  const key = _streamKey(agentId, cwd);
  const st = streamStates.get(key);
  if (!st) return;
  if (st.timer) clearTimeout(st.timer);
  streamStates.delete(key);
}

/** 完成（或出錯）後：把 assistant 回覆落地到 conversation active.json（coding.{agentId}）。
 *  dedupe：檔案最後一筆 assistant 內容前 200 字相同就不重複加（client 正常存檔路徑不受影響）。*/
async function _persistAssistantReply(agentId, cwd, content) {
  try {
    if (!content || typeof content !== "string") return;
    const crewId = `coding.${agentId}`;
    const crewFile = join(DATA_DIR, "crews", `${crewId}.json`);
    if (!existsSync(crewFile)) return; // 非 coding crew 的 a2a agent 不落地（避免猜錯儲存位置）
    const convDir = join(cwd, ".paaw", "coding-memory", "conversations", crewId);
    const activeFile = join(convDir, "active.json");
    let messages = [];
    if (existsSync(activeFile)) {
      try {
        const data = JSON.parse(readSync(activeFile, "utf-8"));
        messages = Array.isArray(data) ? data : (data.messages || []);
      } catch {}
    }
    const last = messages[messages.length - 1];
    if (last && last.role === "assistant" && typeof last.content === "string"
        && last.content.slice(0, 200) === content.slice(0, 200)) return; // client 已存過
    messages.push({ role: "assistant", content, ts: new Date().toISOString() });
    const { writeFile } = await import("fs/promises");
    await mkdir(convDir, { recursive: true });
    await writeFile(activeFile, JSON.stringify({ messages, _meta: { updatedAt: new Date().toISOString(), savedBy: "a2a-stream-recovery" } }, null, 2), "utf-8");
  } catch (err) {
    console.warn(`[A2A:${agentId}] persist assistant reply failed: ${err.message}`);
  }
}

// ── 啟動時快取 ──
let _skillMd = null;
let _providerConfig = null;
let _knowledgeBase = null;
let _toolDeps = null;

async function getCachedSkill() {
  if (!_skillMd) {
    try { _skillMd = await readFile(resolve(DATA_DIR, "skills/physical-skill/help-desk/SKILL.md"), "utf-8"); } catch { _skillMd = ""; }
  }
  return _skillMd;
}
async function getCachedProviders() {
  if (!_providerConfig) {
    _providerConfig = JSON.parse(await readFile(resolve(CONFIG_DIR, "providers.json"), "utf-8"));
  }
  return _providerConfig;
}
async function getCachedKnowledge() {
  if (_knowledgeBase === null) {
    try { _knowledgeBase = await readFile(resolve(DATA_DIR, "helpdesk/KNOWLEDGE.md"), "utf-8"); } catch { _knowledgeBase = ""; }
  }
  return _knowledgeBase;
}
async function getCachedTools() {
  if (!_toolDeps) {
    const { ToolEngine } = await import("../lib/tool-engine/index.mjs");
    const { getToolsAndHandlers } = await import("../tools/index.mjs");
    const { tools: toolDefs, handlers: toolHandlers } = await getToolsAndHandlers();
    const executors = Object.entries(toolHandlers).map(([name, handler]) => ({
      name,
      description: toolDefs.find(t => t.function.name === name)?.function?.description || name,
      parameters: toolDefs.find(t => t.function.name === name)?.function?.parameters || { type: "object", properties: {} },
      execute: async (args) => handler(args),
    }));
    _toolDeps = { ToolEngine, executors };
  }
  return _toolDeps;
}

// ── A2A → Ticket bridge ──
async function loadTickets() {
  try {
    const raw = await readFile(HELPDESK_DATA, "utf-8");
    return JSON.parse(raw);
  } catch { return []; }
}
async function saveTicketsFile(tickets) {
  await writeFile(HELPDESK_DATA, JSON.stringify(tickets, null, 2), "utf-8");
}

/** Create or update a HelpDesk ticket from an A2A task. */
async function syncTicketFromTask(task) {
  try {
    const tickets = await loadTickets();
    // Get all meaningful messages (skip placeholders)
    const historyMsgs = (task.history || []).filter(
      h => h.parts?.[0]?.text !== "⏳ 處理中..."
    );
    const userMsg = historyMsgs.find(h => h.role === "user");
    const userText = userMsg?.parts?.map(p => p.text).join("") || "(A2A request)";
    const ticketTag = `a2a:${task.id}`;

    // Find existing ticket by tag
    let ticket = tickets.find(t => t.tags?.includes(ticketTag));

    if (!ticket) {
      // Create new ticket
      ticket = {
        ticketId: `TKT-${Date.now()}`,
        agentName: "Agent Orchestrator",
        agentType: "a2a",
        subject: userText.slice(0, 60),
        status: "working",
        priority: "medium",
        messages: [],
        tags: [ticketTag, "a2a"],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      tickets.push(ticket);
      console.log(`[A2A→Ticket] Created ticket ${ticket.ticketId} for task ${task.id}`);
    }

    // Sync ALL messages from task history (skip placeholders)
    for (const h of historyMsgs) {
      const text = h.parts?.map(p => p.text).join("") || "";
      if (!text) continue;
      const role = h.role === "agent" ? "agent" : "user";
      // Only add if not already in ticket
      if (!ticket.messages.find(m => m.text === text)) {
        ticket.messages.push({
          id: genMsgId(),
          role,
          text,
          ts: Date.now(),
        });
      }
    }

    // Sync status
    const state = task.status?.state;
    if (state === "completed") ticket.status = "answered";
    else if (state === "input-required") ticket.status = "input-required";
    else ticket.status = "working";
    ticket.updatedAt = new Date().toISOString();

    await saveTicketsFile(tickets);
    console.log(`[A2A→Ticket] Synced ticket ${ticket.ticketId} state=${state} msgs=${ticket.messages.length}`);
    return ticket;
  } catch (err) {
    console.error(`[A2A→Ticket] ERROR: ${err.message}\n${err.stack}`);
    return null;
  }
}

// ── Constants ──

/** PAAW agent 自身版本（A2A card 的 version 欄位，非協定版本）。 */
const PAAW_AGENT_VERSION = "1.0.0";

/** CORS 允許來源：預設不開放萬用字元，只有顯式列出者（含同源）可跨域。
 *  可用 PAAW_A2A_ALLOWED_ORIGINS 環境變數（逗號分隔）追加白名單。QA M3。 */
const A2A_ALLOWED_ORIGINS = (() => {
  const env = (process.env.PAAW_A2A_ALLOWED_ORIGINS || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  return new Set(env);
})();

/** 依請求 Origin 決定回傳的 CORS 標頭；不在白名單則不回 Access-Control-Allow-Origin（瀏覽器即封鎖跨域讀取）。 */
export function corsHeadersFor(req) {
  const origin = req?.headers?.origin;
  if (origin && A2A_ALLOWED_ORIGINS.has(origin)) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Vary": "Origin",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };
  }
  // 無 Origin（非瀏覽器 / 同源 curl）不打 CORS 標頭；有 Origin 但未入白名單也不放行
  return {};
}

/** Webhook URL 安全檢查 — 阻擋 SSRF（QA C2）。
 *  只允許 http(s)、且 host 不得為 loopback / link-local / 私有網段 / 內部主機名。 */
const WEBHOOK_BLOCKED_HOSTNAMES = new Set([
  "localhost", "metadata", "metadata.google.internal", "169.254.169.254",
]);
function isBlockedWebhookHost(hostname) {
  const h = String(hostname || "").toLowerCase();
  if (!h) return true;
  if (WEBHOOK_BLOCKED_HOSTNAMES.has(h)) return true;
  if (h === "::1" || h === "[::1]" || h === "0.0.0.0") return true;
  // IPv4 loopback / link-local（SSRF 高風險目標一律封鎖）
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
  }
  // IPv6 loopback / link-local (fe80::/10)
  if (/^fe[89ab][0-9a-f]:/.test(h)) return true;
  return false;
}
/** 私有網段判定（供 webhook 決定是否允許 http 明文；私網走 http 僅限內網用途）。 */
function isPrivateHost(hostname) {
  const h = String(hostname || "").toLowerCase();
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  if (/^f[cd][0-9a-f]{2}:/.test(h)) return true; // IPv6 unique-local
  return false;
}
export function assertSafeWebhookUrl(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { throw new Error("Invalid webhook URL"); }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new Error("Webhook URL must be http(s)");
  }
  if (isBlockedWebhookHost(u.hostname)) {
    throw new Error("Webhook URL host is not allowed (loopback/link-local blocked)");
  }
  // 公網位址強制 https；私有網段允許 http（內部 webhook）
  if (u.protocol === "http:" && !isPrivateHost(u.hostname)) {
    throw new Error("Public webhook URL must use https");
  }
  return u;
}

const WEBHOOK_TIMEOUT_MS = 10_000;

// ── Helpers ──

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function sendJSON(res, code, body, req) {
  // JSON-RPC notification 語意（QA m3）：標記為 notification 的請求不回應，但仍完成處理
  if (res._a2aSuppressResponse) {
    if (!res.writableEnded) res.end();
    return;
  }
  res.writeHead(code, {
    "Content-Type": "application/json",
    ...corsHeadersFor(req),
  });
  res.end(JSON.stringify(body));
}

// SSE 寫入 helper（QA M4）：
//  - 斷線後不再寫（避免 EPIPE / 事件持續堆積）
//  - 檢查 res.write 回傳值，false 表示緩衝已滿 → 以 drain/短延遲讓背壓回饋，避免記憶體累積
async function sseWrite(res, payload) {
  if (res.writableEnded || res.destroyed || res._a2aClientGone) return false;
  try {
    const ok = res.write(payload);
    if (!ok && !res.writableEnded) {
      // 等待 drain（最多 30s 保護），讓 backpressure 生效
      await new Promise((resolve) => {
        let done = false;
        const finish = () => { if (!done) { done = true; resolve(); } };
        res.once("drain", finish);
        setTimeout(finish, 30_000);
      });
    }
    if (typeof res.flush === "function") res.flush();
    return true;
  } catch {
    return false;
  }
}

// 內部錯誤對外一律回通用訊息，詳細資料只進 server log（QA C3）
const GENERIC_INTERNAL_ERROR = "Internal error";
function logInternalError(scope, err) {
  console.error(`[A2A] ${scope} error:`, err);  // nosemgrep: unsafe-formatstring
}

// JSON-RPC id 型別驗證（QA m3）：合法型別為 string / number / null
export function isValidRpcId(id) {
  return id === null || typeof id === "string" || typeof id === "number";
}

/** JSON-RPC method 名稱驗證（QA 協定合規）：依 JSON-RPC 2.0 spec §4，method 必為非空字串；
 *  缺失或非字串一律 Invalid Request（-32600），不可落入 dispatch 被誤判為 Method not found（-32601）。 */
export function isValidRpcMethod(method) {
  return typeof method === "string" && method.trim().length > 0;
}

// 對外可見的識別碼一律用加密隨機（QA m2）：不帶時間前綴避免可預測/碰撞
function genId() {
  return `task-${randomUUID()}`;
}
function genMsgId() {
  return `msg-${randomUUID()}`;
}

// ── Task Storage (delegates to TaskPersistenceAdapter) ──

/** Per-task 序列化鎖：把 saveTask 的 read-modify-write 串成序列，
 *  避免並發 appendEvent 與 saveTask 交錯造成事件遺失（QA m1）。
 *  key = taskId，value = 目前尾端的 Promise。 */
const _taskSaveChains = new Map();
function _withTaskLock(taskId, fn) {
  const prev = _taskSaveChains.get(taskId) || Promise.resolve();
  // 鏈的尾端：不管前一步成功或失敗都接續執行 fn（失敗不阻斷後續寫入）
  const run = prev.then(fn, fn);
  // 存進 Map 的是「吞掉錯誤」的版本，避免未處理 rejection 且維持串行
  const chained = run.catch(() => {});
  _taskSaveChains.set(taskId, chained);
  // 完成後若自己仍是尾端就清掉，避免 Map 無界成長
  chained.then(() => {
    if (_taskSaveChains.get(taskId) === chained) _taskSaveChains.delete(taskId);
  });
  return run;
}

/** Save task to disk, preserving events/tokens that were appended during tool execution */
async function saveTask(task) {
  return _withTaskLock(task.id, async () => {
    // Reload from disk to merge any events/tokens written by appendEvent during tool calls
    const persisted = await taskStore.load(task.id);
    if (persisted?.events?.length) task.events = persisted.events;
    if (persisted?.tokenUsage) task.tokenUsage = persisted.tokenUsage;
    if (persisted?.memory?.length) task.memory = persisted.memory;
    return taskStore.save(task);
  });
}
async function getTask(taskId) { return taskStore.load(taskId); }
async function listTasks() { return taskStore.list(); }

// ── Webhook notification helper ──
/** 具名常數：重試與退避參數（QA C2）。 */
const WEBHOOK_MAX_ATTEMPTS = 3;
const WEBHOOK_BACKOFF_BASE_MS = 200;

/** 以 HMAC-SHA256 對 payload 簽章，接收方可驗證來源真實性（QA C2）。
 *  簽章金鑰來自 pushConfig.secret（呼叫方於 A2A configuration.pushNotification 帶入）。 */
async function _signWebhookPayload(secret, body) {
  const { createHmac } = await import("crypto");
  return createHmac("sha256", secret).update(body).digest("hex");
}

/**
 * POST task status update to pushNotification webhook URL。
 * 安全強化（QA C2）：
 *  1. URL 白名單檢查（阻擋 loopback/link-local，公網強制 https）
 *  2. fetch 帶 timeout（AbortController）
 *  3. 指數退避 + jitter 重試（僅對可重試失敗：timeout / 429 / 5xx / 連線中斷）
 *  4. 選配 HMAC-SHA256 簽章（X-A2A-Signature）
 */
async function notifyWebhook(task, pushConfig) {
  if (!pushConfig?.url) return;

  // 1. SSRF 防護：不合法 URL 直接丟棄並記審計
  let safeUrl;
  try {
    safeUrl = assertSafeWebhookUrl(pushConfig.url);
  } catch (err) {
    console.error(`[A2A] webhook URL rejected task=${task.id}: ${err.message}`);
    return;
  }

  const payload = JSON.stringify({ jsonrpc: "2.0", result: task, id: `notify-${task.id}` });
  const whHeaders = { "Content-Type": "application/json" };
  if (pushConfig.token) whHeaders["Authorization"] = `Bearer ${pushConfig.token}`;
  // 4. 選配簽章
  if (pushConfig.secret) {
    try {
      whHeaders["X-A2A-Signature"] = `sha256=${await _signWebhookPayload(pushConfig.secret, payload)}`;
    } catch (err) {
      console.warn(`[A2A] webhook sign failed task=${task.id}: ${err.message}`);
    }
  }

  for (let attempt = 1; attempt <= WEBHOOK_MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
    try {
      const resp = await fetch(safeUrl, {
        method: "POST",
        headers: whHeaders,
        body: payload,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (resp.ok) {
        console.log(`[A2A] webhook notified: task=${task.id} state=${task.status.state} attempt=${attempt}`);
        return;
      }
      // 只有 429 / 5xx 可重試；其餘（4xx）為呼叫方問題，不再重試
      const retryable = resp.status === 429 || resp.status >= 500;
      if (!retryable || attempt === WEBHOOK_MAX_ATTEMPTS) {
        console.error(`[A2A] webhook notify failed: task=${task.id} status=${resp.status} attempt=${attempt}`);
        return;
      }
      console.warn(`[A2A] webhook retry: task=${task.id} status=${resp.status} attempt=${attempt}`);
    } catch (err) {
      clearTimeout(timer);
      const isAbort = err?.name === "AbortError";
      if (attempt === WEBHOOK_MAX_ATTEMPTS) {
        console.error(`[A2A] webhook notify failed: task=${task.id} ${isAbort ? "timeout" : err.message} attempt=${attempt}`);
        return;
      }
      console.warn(`[A2A] webhook retry: task=${task.id} ${isAbort ? "timeout" : err.message} attempt=${attempt}`);
    }
    // 2. 指數退避 + jitter：200ms, 400ms（+ 隨機 0-100ms）
    const backoff = WEBHOOK_BACKOFF_BASE_MS * 2 ** (attempt - 1) + Math.floor(Math.random() * 100);
    await new Promise(r => setTimeout(r, backoff));
  }
}

// ── A2A Data Types ──

function makeTask({ message, contextId, taskId }) {
  const id = taskId || genId();
  return {
    id,
    contextId: contextId || id,
    status: { state: "submitted", timestamp: new Date().toISOString() },
    message,  // user message
    history: [{ role: "user", parts: [{ type: "text", kind: "text", text: extractText(message) }] }],
    artifacts: [],
    metadata: {},
  };
}

function extractText(message) {
  if (!message?.parts) return "";
  return message.parts
    .filter(p => p.type === "text" || p.kind === "text")
    .map(p => p.text)
    .join("\n");
}

// 👁 2026-08-30：抽取 message.parts 裡的圖（coding app agent chat 貼圖）
// 安全：只允許 uploads/<安全檔名> — 防路徑穿越（客戶端可傳任意 path）
const UPLOADS_PATH_RE = /^(paaw-)?uploads\/[A-Za-z0-9][A-Za-z0-9._-]*$/; // paaw-uploads = RU 資產圖（2026-09-06）
export function extractImages(message) {
  if (!message?.parts) return [];
  const paths = message.parts
    .filter(p => (p.type === "image" || p.kind === "image") && typeof p.path === "string")
    .map(p => p.path);
  const valid = [...new Set(paths)].filter(p => UPLOADS_PATH_RE.test(p));
  const dropped = paths.length - valid.length;
  if (dropped > 0) console.warn(`[A2A] ⚠️ 丟棄 ${dropped} 個不合法圖片 path（僅允許 uploads/xxx）`);
  return valid.slice(0, 4); // 與 chat 面同上限 4 張
}

// 👁 圖 append 成 user attachment message（重用 Phase 3 機制：vision 自動路由/降級/上限都在裡面）
// uploads/<name> 是 data 相對路徑 → 解成絕對路徑（buildImageAttachmentMessage 吃絕對路徑）
async function appendImageMessages(messages, imagePaths, sourceLabel) {
  if (!imagePaths?.length) return;
  const { buildImageAttachmentMessage } = await import("../lib/vision-content.mjs");
  const { resolveUploadRef } = await import("./uploads.mjs");
  const abs = (await Promise.all(imagePaths.map(p => resolveUploadRef(p)))).filter(Boolean);
  const imgMsg = buildImageAttachmentMessage(abs, `使用者貼的圖（${sourceLabel}）`);
  if (imgMsg) messages.push(imgMsg);
  else console.warn("[A2A] ⚠️ 圖片檔讀取失敗 — 降級為純文字輪");
}

function makeAgentMessage(text) {
  return {
    role: "agent",
    parts: [{ type: "text", text }],
    messageId: genMsgId(),
    taskId: null,
  };
}

// ── Agent Card ──

function getAgentCard(req) {
  const host = req.headers.host || `localhost:${process.env.PAAW_PORT || 4097}`;
  const protocol = req.headers["x-forwarded-proto"] || "http";
  const baseUrl = `${protocol}://${host}`;

  return {
    protocolVersion: A2A_PROTOCOL_VERSION,
    name: "PAAW Agent",
    description: "Personal AI Assistant Workspace — A2A-enabled agent that can execute skills, manage data apps, and collaborate with other agents.",
    url: `${baseUrl}/a2a`,
    version: PAAW_AGENT_VERSION,
    capabilities: {
      streaming: true,
      pushNotifications: true,
      stateTransitionHistory: true,
    },
    defaultInputModes: ["text"],
    defaultOutputModes: ["text"],
    skills: [
      {
        id: "paaw-helpdesk",
        name: "PAAW HelpDesk",
        description: "Customer service — ask any question about PAAW features, architecture, usage, or report issues. Other agents can submit questions and get answers.",
        tags: ["helpdesk", "support", "faq", "customer-service", "agent-to-agent"],
        inputModes: ["text"],
        outputModes: ["text"],
        endpoints: {
          ask: `${baseUrl}/api/helpdesk/ask`,
          tickets: `${baseUrl}/api/helpdesk/tickets`,
          knowledge: `${baseUrl}/api/helpdesk/knowledge`,
        },
      },
    ],
    authentication: {
      schemes: ["none"],
    },
  };
}

// ── Core: Run Agent (reuse PAAW ToolEngine) ──

async function runAgentLoop({ message, systemPrompt, onChunk }) {
  const { contextEngine } = await import("../context-engine.mjs");

  // Use cached providers and tools
  const providerConfig = await getCachedProviders();
  const { ToolEngine, executors } = await getCachedTools();

  const providerId = providerConfig.active;
  const provider = providerConfig.providers[providerId];
  if (!provider?.apiKey || provider.apiKey === "na") {
    throw new Error(`No API key for provider: ${providerId}`);
  }
  const model = resolveDefaultModel(providerConfig);

  // Build context (reuse chat context)
  const ctx = await contextEngine.build({ target: "chat" });

  // executors from cache

  const engine = new ToolEngine({
    cwd: PAAW_ROOT,
    provider: {
      id: providerId,
      baseURL: provider.baseURL,
      apiKey: provider.apiKey,
      defaultModel: model,
      extraHeaders: providerId === "openrouter"
        ? { "HTTP-Referer": "https://paaw.ai", "X-Title": "PAAW" }
        : undefined,
    },
    executors,
    maxToolRounds: 5,
    security: {
      // 2026-10-29 修正：同 chat.mjs — 審批 UI/API 不存在，'always' = 所有寫入工具卡死
      approval: { mode: "auto" },
      audit: { enabled: true },
    },
    sessionKey: "a2a",
    agentId: "a2a-server",
    caller: "a2a",
  });

  // Inject shared registry tools
  const { injectRegistryTools } = await import("../lib/tool-registry-init.mjs");
  injectRegistryTools(engine, { cwd: PAAW_ROOT, rootDir: PAAW_ROOT, agentId: "a2a-server" });

  // Convert A2A message → chat messages format
  const userText = typeof message === "string" ? message : extractText(message);
  const messages = [{ role: "user", content: userText }];

  let fullText = "";
  let toolsUsed = [];

  for await (const chunk of engine.run(ctx.systemPrompt, messages, model)) {
    if (onChunk) onChunk(chunk);
    switch (chunk.type) {
      case "text":
        fullText += chunk.delta;
        break;
      case "tool_start":
        toolsUsed.push(chunk.name);
        break;
    }
  }

  return { text: fullText, toolsUsed };
}

// ── Helpers for multi-turn ──

async function findLatestTaskInContext(contextId) {
  if (!contextId) return null;
  const task = await taskStore.findByContext(contextId);
  return task?.id || null;
}

const A2A_NEED_INFO_REGEX = /\[NEED_INFO:?\]?\s*([\s\S]+)/;

/**
 * Run HelpDesk skill for A2A messages — with NEED_INFO detection.
 * Reuses helpdesk route's runHelpDeskSkill logic.
 */
async function runHelpDeskViaA2A(conversation, { onProgress, modelOverride, taskId } = {}) {
  // Use cached values
  const skillMd = await getCachedSkill();
  const knowledgeBase = await getCachedKnowledge();
  const providerConfig = await getCachedProviders();
  const { ToolEngine, executors } = await getCachedTools();

  const providerId = providerConfig.active;
  const provider = providerConfig.providers[providerId];
  if (!provider?.apiKey || provider.apiKey === "na") {
    throw new Error(`No API key for provider: ${providerId}`);
  }
  const model = modelOverride || resolveDefaultModel(providerConfig);

  // Load task memory if available
  let memoryContext = "";
  if (taskId) {
    const task = await taskStore.load(taskId);
    if (task?.memory?.length > 0) {
      memoryContext = "\n\n## Previous Memory\n" + task.memory
        .map(m => `- [${m.type}] ${m.content}`)
        .join("\n");
    }
    if (task?.events?.length > 0) {
      const recentEvents = task.events.slice(-10);
      memoryContext += "\n\n## Recent Events\n" + recentEvents
        .map(e => `- ${e.type}: ${e.name || JSON.stringify(e).slice(0, 80)}`)
        .join("\n");
    }
  }

  const engine = new ToolEngine({
    cwd: PAAW_ROOT,
    provider: {
      id: providerId,
      baseURL: provider.baseURL,
      apiKey: provider.apiKey,
      defaultModel: model,
      extraHeaders: providerId === "openrouter"
        ? { "HTTP-Referer": "https://paaw.ai", "X-Title": "PAAW" }
        : undefined,
    },
    executors,
    maxToolRounds: 6,
    security: { approval: { mode: "auto" }, audit: { enabled: false } },
    sessionKey: "a2a-helpdesk",
    agentId: "a2a-helpdesk",
  });

  // Inject shared registry tools
  const { injectRegistryTools } = await import("../lib/tool-registry-init.mjs");
  injectRegistryTools(engine, { cwd: PAAW_ROOT, rootDir: PAAW_ROOT, agentId: "a2a-helpdesk" });

  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const weekday = ["日", "一", "二", "三", "四", "五", "六"][now.getDay()];
  const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  const systemPrompt = `${skillMd}

---

## Knowledge Base

${knowledgeBase}
${memoryContext}
---

## Current Date & Time

今天是 ${dateStr}（星期${weekday}），時間 ${timeStr}，時區 Asia/Taipei (UTC+8)。

---

你是 PAAW HelpDesk。回答用繁體中文，技術術語保留英文。
使用 file_read 和 file_list 搜尋知識庫。

## 工具使用紀律
- 最多讀 3-4 個知識庫檔案
- 讀完後直接產出完整答案

## 互動規則
如果需要更多資訊才能回答，在回答開頭加：
[NEED_INFO: 釐清問題]
之後只輸出釐清問題本身。`;

  let fullText = "";
  let toolsUsed = [];

  for await (const chunk of engine.run(systemPrompt, conversation, model)) {
    switch (chunk.type) {
      case "text":
        fullText += chunk.delta;
        break;
      case "tool_start":
        toolsUsed.push(chunk.name);
        if (onProgress) await onProgress({ type: "tool_start", name: chunk.name, toolsUsed });
        // Persist event
        if (taskId) {
          await taskStore.appendEvent(taskId, { type: "tool_call", name: chunk.name });
        }
        break;
    }
  }

  // ── Fallback: if ToolEngine exhausted rounds without producing text, force a final summary ──
  if (fullText.trim().length < 100 && toolsUsed.length > 0) {
    console.log(`[A2A-HelpDesk] Text too short (${fullText.length} chars), forcing final summary call`);
    const summaryMessages = [
      ...conversation,
      { role: "user", content: "剛才你讀了知識庫檔案。現在請直接根據你讀到的內容，用繁體中文完整回答使用者的問題。不要使用任何工具，直接輸出答案。" },
    ];
    const res = await fetch(`${provider.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${provider.apiKey}`,
        ...(providerId === "openrouter" ? { "HTTP-Referer": "https://paaw.ai", "X-Title": "PAAW" } : {}),
      },
      body: stableStringify({ model, messages: [{ role: "system", content: systemPrompt }, ...summaryMessages], temperature: 0.3 }),
    });
    const data = await res.json();
    fullText = data.choices?.[0]?.message?.content || fullText;
    console.log(`[A2A-HelpDesk] Summary call result: ${fullText.length} chars`);
  }

  const needMatch = fullText.match(A2A_NEED_INFO_REGEX);
  let needsInfo = needMatch ? needMatch[1].trim() : null;
  if (needsInfo && needsInfo.endsWith("]")) needsInfo = needsInfo.slice(0, -1).trim();
  const cleanText = needsInfo ? fullText.replace(A2A_NEED_INFO_REGEX, "").replace(/\]$/, "").trim() : fullText;

  return { text: cleanText || fullText, toolsUsed, needsInfo };
}

// ── Route Handler ──

export default async function a2aRoutes(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const path = url.pathname;

  // CORS preflight（依白名單回標頭；無 Origin 或未入白名單則不給 CORS 放行 — QA M3）
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      ...corsHeadersFor(req),
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    res.end();
    return true;
  }

  // ════════════════════════════════════════
  // GET /.well-known/agent.json — Agent Card discovery
  // ════════════════════════════════════════
  if (req.method === "GET" && (path === "/.well-known/agent.json" || path === "/.well-known/agent-card.json")) {
    sendJSON(res, 200, getAgentCard(req));
    return true;
  }

  // ════════════════════════════════════════
  // Domain Agent routes: /a2a/:agentId/*
  // ════════════════════════════════════════
  {
    // Match /a2a/:agentId or /a2a/:agentId/.well-known/agent.json
    const agentMatch = path.match(/^\/a2a\/([^/]+)(\/.*)?$/);
    if (agentMatch) {
      const { getAgent, buildAgentCard, buildSystemPrompt } = await import("../lib/domain-agent-registry.mjs");
      const agentId = agentMatch[1];
      const subPath = agentMatch[2];
      const agent = getAgent(agentId);

      if (!agent) {
        sendJSON(res, 404, { error: `Unknown domain agent: ${agentId}` });
        return true;
      }

      // GET /a2a/:agentId/.well-known/agent.json — Domain Agent Card
      if (req.method === "GET" && subPath && subPath.includes(".well-known/agent")) {
        const card = buildAgentCard(agentId, req);
        sendJSON(res, 200, card);
        return true;
      }

      // GET /a2a/:agentId/system-prompt — Debug: view injected system context
      if (req.method === "GET" && subPath === "/system-prompt") {
        try {
          const q = new URL(req.url, `http://${req.headers.host || "localhost"}`).searchParams;
          const cwd = q.get("cwd") || undefined;
          const agentInfo = getAgent(agentId);
          const systemPrompt = await buildSystemPrompt(agentId, {
            cwd,
            clientContext: {},
          });
          // Also load dynamic context (action log, feature map, agent memory, AGENT_RULES)
          const { listActionLog, loadAgentMemory } = await import("../lib/action-log.mjs");
          const actionLogText = (await listActionLog({ cwd: PAAW_ROOT, limit: 10 })).text;
          const agentMemoryText = await loadAgentMemory(agentId, PAAW_ROOT);
          const extraContext = [];
          if (actionLogText) extraContext.push({ source: "action-log", content: actionLogText });
          if (agentMemoryText) extraContext.push({ source: "agent-memory", content: agentMemoryText });
          const { AGENT_RULES } = await import("../lib/agent-rules.mjs");
          const featureSummary = await getFeatureSummary(cwd || PAAW_ROOT);
          if (featureSummary) extraContext.push({ source: "feature-map", content: featureSummary });
          // Code Intelligence
          const ciFile = join(cwd || PAAW_ROOT, ".paaw", "code-intelligence", "code-intelligence.json"); // nosemgrep: express-path-join-resolve-traversal, path-join-resolve-traversal — local-first: 使用者自選專案根目錄（localhost 單人工具）
          if (existsSync(ciFile)) { // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
            try {
              const ci = JSON.parse(readSync(ciFile, "utf-8")); // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
              if (ci.files?.length) {
                const fileLines = ci.files.slice(0, 200).map(f => {
                  const parts = [`- ${f.path}`];
                  if (f.exports?.length) parts.push(`exports: ${f.exports.slice(0, 10).join(", ")}`);
                  if (f.imports?.length) parts.push(`imports: ${f.imports.slice(0, 10).join(", ")}`);
                  return parts.join(" ");
                }).join("\n");
                extraContext.push({ source: "code-intelligence", content: `Code Intelligence File Map (${ci.files.length} files, showing first ${Math.min(ci.files.length, 200)})\n${fileLines}` });
              }
            } catch {}
          }
          // Security Scan
          const secFile = join(cwd || PAAW_ROOT, ".paaw", "security", "scan-results.json"); // nosemgrep: express-path-join-resolve-traversal, path-join-resolve-traversal — local-first: 使用者自選專案根目錄（localhost 單人工具）
          if (existsSync(secFile)) { // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
            try {
              const sec = JSON.parse(readSync(secFile, "utf-8")); // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
              if (sec.stats?.total > 0) {
                extraContext.push({ source: "security-scan", content: `Security Scan Summary (${sec.stats.total} findings, scanned ${sec.scannedAt || "unknown"})\nBy severity: ${JSON.stringify(sec.stats.bySeverity)}\nBy category: ${JSON.stringify(sec.stats.byCategory)}` });
              }
            } catch {}
          }
          if (AGENT_RULES) extraContext.push({ source: "agent-rules", content: AGENT_RULES });

          // Skill bindings — 跟 paaw-agent-loop 實際送 LLM 的內容完全一致（同一個 appendSkillBindings）
          const { appendSkillBindings } = await import("../lib/paaw-agent-loop.mjs");
          const promptWithSkills = await appendSkillBindings(systemPrompt, cwd, agentId);
          if (promptWithSkills !== systemPrompt) {
            const { readProjectSkills } = await import("../lib/project-crew.mjs");
            const bound = readProjectSkills(cwd, agentId) || [];
            extraContext.push({
              source: "skill-bindings",
              content: `已注入 ${bound.length} 個 skill（完整內容含附件檔案路徑已附加在 baseSystemPrompt 尾部，與 agent 實際收到的一致）：\n` +
                bound.map(s => `- ${s.name}（${s.prompt.length} 字元）\n  預覽：${(s.prompt || "").slice(0, 500)}${(s.prompt || "").length > 500 ? "\n  ...（完整內容在 baseSystemPrompt）" : ""}`).join("\n"),
            });
          }

          sendJSON(res, 200, {
            agentId,
            agentName: agentInfo?.name,
            crewId: agentInfo?.crewId,
            contextProviders: agentInfo?.contextProviders || [],
            baseSystemPrompt: promptWithSkills,
            baseSystemPromptLength: promptWithSkills.length,
            dynamicContext: extraContext,
            dynamicContextLength: extraContext.reduce((s, c) => s + c.content.length, 0),
            totalLength: promptWithSkills.length + extraContext.reduce((s, c) => s + c.content.length, 0),
          });
        } catch (err) {
          logInternalError("system-prompt", err);
          sendJSON(res, 500, { error: GENERIC_INTERNAL_ERROR }, req);
        }
        return true;
      }

      // GET /a2a/:agentId/stream-state?cwd=...&since=<seq> — 斷線重連：查執行狀態/事件/最終回覆（2026-09-11 治本）
      if (req.method === "GET" && subPath === "/stream-state") {
        const q = new URL(url, "http://localhost").searchParams;
        const cwd = q.get("cwd") || "";
        const since = parseInt(q.get("since") || "0", 10) || 0;
        // 2026-09-15：沒帶 cwd 一律 exists:false（舊版會回「任意一筆」— 多 RU 時另一邊會接錯線）
        const st = cwd ? streamStates.get(_streamKey(agentId, cwd)) : null;
        if (!st || st.cwd !== cwd) {
          sendJSON(res, 200, { running: false, done: false, exists: false });
          return true;
        }
        const events = st.events.filter(e => e.seq > since).slice(-100);
        sendJSON(res, 200, {
          exists: true,
          running: !st.done,
          done: st.done,
          startedAt: st.startedAt,
          seq: st.seq,
          events,
          finalContent: st.done ? (st.finalContent || null) : null,
          error: st.error || null,
        });
        return true;
      }

      // POST /a2a/:agentId — Domain Agent JSON-RPC
      if (req.method === "POST" && !subPath) {
        let body;
        try {
          body = JSON.parse(await readBody(req));
        } catch {
          sendJSON(res, 200, { jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null });
          return true;
        }

        const { jsonrpc, method, params, id } = body;
        if (jsonrpc !== "2.0") {
          sendJSON(res, 200, { jsonrpc: "2.0", error: { code: -32600, message: "Invalid Request" }, id: id || null });
          return true;
        }

        // method 驗證（QA 協定合規）：非字串/空字串 → Invalid Request（-32600）
        if (!isValidRpcMethod(method)) {
          sendJSON(res, 200, {
            jsonrpc: "2.0",
            error: { code: -32600, message: "Invalid Request — method must be a non-empty string" },
            id: isValidRpcId(id) ? id : null,
          });
          return true;
        }

        console.log(`[A2A:${agentId}] RPC ${method} id=${id}`);

        // message/stream — SSE streaming (前端聊天 + EM 調度都用這條)
        if (method === "message/stream") {
          try {
            const userText = extractText(params?.message);
            if (!userText) {
              sendJSON(res, 200, { jsonrpc: "2.0", error: { code: -32602, message: "Empty message" }, id });
              return true;
            }

            const clientContext = params?.context || {};
            const modelOverride = params?.metadata?.model;
            const modelFallbacks = Array.isArray(params?.metadata?.fallbacks) ? params.metadata.fallbacks : undefined; // 2026-09-23：a2aCallAgent 帶的 per-agent fallbacks
            const conversationHistory = params?.conversationHistory || null;
            const rootDir = clientContext.cwd || PAAW_ROOT;

            // ── requiresVision 派工（2026-08-30 Phase 3）：agent 宣告需要視覺 → 沒人為指定 model 時自動配 visionModel ──
            // （registry 沒開 flag 的 agent 靠 loop 內建自動路由 — 截圖進上下文才切）
            let effectiveModel = modelOverride;
            if (agent?.requiresVision && !modelOverride) {
              const { getVisionModel } = await import("../lib/vision-content.mjs");
              const vm = getVisionModel();
              if (vm) {
                effectiveModel = vm;
                console.log(`[A2A:${agentId}] 👁 requiresVision → ${vm}`);
              } else {
                console.warn(`[A2A:${agentId}] ⚠️ requiresVision 但 providers.json 沒設 visionModel — 用原 model`);
              }
            }

            // Build system prompt from crew + context providers + action log + agent memory
            const { listActionLog, loadAgentMemory } = await import("../lib/action-log.mjs");
            const actionLogText = (await listActionLog({ cwd: rootDir, limit: 10 })).text;
            const agentMemoryText = await loadAgentMemory(agentId, rootDir);

            const systemPrompt = await buildSystemPrompt(agentId, {
              cwd: clientContext.cwd,
              clientContext,
            });

            // Inject action log and agent memory into system prompt
            const extraContext = [];
            if (actionLogText) extraContext.push(`\n## Recent Action Log (跨 Agent 交接紀錄)\n${actionLogText}`);
            if (agentMemoryText) extraContext.push(`\n## Your Long-term Memory (你的長期記憶)\n${agentMemoryText}`);
            const featureSummary = await getFeatureSummary(rootDir);
            if (featureSummary) extraContext.push(featureSummary);
            // Inject Code Intelligence file map for coding projects
            const ciFile = join(rootDir, ".paaw", "code-intelligence", "code-intelligence.json");
            if (existsSync(ciFile)) {
              try {
                const ci = JSON.parse(readSync(ciFile, "utf-8"));
                if (ci.files?.length) {
                  const fileLines = ci.files.slice(0, 200).map(f => {
                    const parts = [`- ${f.path}`];
                    if (f.exports?.length) parts.push(`exports: ${f.exports.slice(0, 10).join(", ")}`);
                    if (f.imports?.length) parts.push(`imports: ${f.imports.slice(0, 10).join(", ")}`);
                    return parts.join(" ");
                  }).join("\n");
                  extraContext.push(`\n## Code Intelligence File Map (${ci.files.length} files, showing first ${Math.min(ci.files.length, 200)})\n${fileLines}`);
                }
              } catch {}
            }
            // Inject Security Scan summary
            const secFile = join(rootDir, ".paaw", "security", "scan-results.json");
            if (existsSync(secFile)) {
              try {
                const sec = JSON.parse(readSync(secFile, "utf-8"));
                if (sec.stats?.total > 0) {
                  extraContext.push(`\n## Security Scan Summary (${sec.stats.total} findings, scanned ${sec.scannedAt || "unknown"})\nBy severity: ${JSON.stringify(sec.stats.bySeverity)}\nBy category: ${JSON.stringify(sec.stats.byCategory)}`);
                }
              } catch {}
            }
            extraContext.push(`\n## Current Project Root\n${rootDir}（呼叫 tool 需要路徑時，cwd 帶這個值）`);
            extraContext.push(AGENT_RULES);
            const fullSystemPrompt = systemPrompt + extraContext.join("");

            // Build messages array with conversation history
            const messages = [];
            if (fullSystemPrompt) messages.push({ role: "system", content: fullSystemPrompt });

            if (conversationHistory && Array.isArray(conversationHistory) && conversationHistory.length > 0) {
              const cleanHistory = cleanConversationHistory(conversationHistory);
              for (const m of cleanHistory) {
                messages.push({ role: m.role, content: m.content });
              }
            }
            messages.push({ role: "user", content: userText });

            // 👁 2026-08-30：coding app agent chat 貼圖 — message.parts 帶圖 → append vision attachment（loop 自動路由 visionModel）
            const _imgs = extractImages(params?.message);
            if (_imgs.length > 0) await appendImageMessages(messages, _imgs, agentId);

            // ── Apply context window trimming (aligned with agent loop: 262K budget) ──
            const { trimMessagesToFit } = await import("../lib/paaw-agent-loop.mjs");
            const finalMessages = trimMessagesToFit(messages);

            // ── Dispatch Logging ──
            try {
              const logPath = join(rootDir, ".paaw", "coding-memory", "dispatch-log.jsonl");
              const logEntry = {
                ts: new Date().toISOString(),
                route: "A2A message/stream",
                agentId,
                model: modelOverride || "default",
                systemPromptLength: fullSystemPrompt.length,
                systemPromptPreview: fullSystemPrompt.slice(0, 500),
                actionLogInjected: actionLogText ? actionLogText.slice(0, 300) : "(none)",
                agentMemoryInjected: agentMemoryText ? agentMemoryText.slice(0, 300) : "(none)",
                conversationHistoryCount: conversationHistory?.length || 0,
                cleanHistoryCount: conversationHistory?.filter(m => m.role === "user" || m.role === "assistant").filter(m => !m._thinking).length || 0,
                currentMessage: userText,
                totalMessages: finalMessages.length,
                messagesSummary: finalMessages.map(m => ({ role: m.role, contentLength: m.content?.length || 0, preview: (m.content || "").slice(0, 120) })),
              };
              await appendFile(logPath, JSON.stringify(logEntry, null, 2) + "\n---\n");
            } catch (_logErr) {}

            // SSE headers（CORS 依白名單；QA M3）
            res.writeHead(200, {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
              ...corsHeadersFor(req),
              "X-Accel-Buffering": "no",
            });
            res.flushHeaders();
            if (res.socket?.setNoDelay) res.socket.setNoDelay(true);
            // 斷線偵測（QA M4）
            res._a2aClientGone = false;
            req.on("close", () => { res._a2aClientGone = true; });

            // Register running stream for interrupt support
            const streamAbort = new AbortController();
            const streamKey = _streamKey(agentId, rootDir); // 2026-09-15：agentId::cwd — 多 RU 併發不互蓋
            runningStreams.set(streamKey, { abortController: streamAbort, res, startedAt: Date.now() });

            // ── Stream State（2026-09-11 治本）：onStreamEvent 側車 buffer — 斷線後 client 可接回 ──
            // 注：不走 res.write 攔截 — sendSSE 在 res.destroyed 後直接 return（loop 4167），
            // 攔截永遠收不到斷線後事件；改由 runAgentLoopStream 的 onStreamEvent hook 直送（2026-09-11 Test A 實測發現）
            _streamStateCleanup(agentId, rootDir); // 同 agent 同 RU 蓋掉舊紀錄（同 key 重複派工沿舊行為；不同 RU 不互蓋）
            const stState = {
              agentId, cwd: rootDir, startedAt: Date.now(), seq: 0,
              events: [], finalContent: null, done: false, error: null, timer: null,
            };
            streamStates.set(streamKey, stState);
            const _stBuffer = (evName, dataObj) => {
              stState.seq += 1;
              stState.events.push({ seq: stState.seq, event: evName, data: dataObj });
              if (stState.events.length > STREAM_STATE_MAX_EVENTS) stState.events.splice(0, stState.events.length - STREAM_STATE_MAX_EVENTS);
              if (evName === "content" && dataObj?.done && typeof dataObj.content === "string") {
                stState.finalContent = dataObj.content; // 斷線期間完成的回覆 — 重連後靠這個補回 UI
              }
              if (evName === "error" && dataObj?.error) stState.error = String(dataObj.error).slice(0, 500);
              if (evName === "interrupted") stState.interrupted = true; // 2026-09-21：使用者中斷 — poller 據此顯示中斷訊息而非錯誤
            };
            // 完成後：標記 done + 落地回覆 + TTL 清理
            const _finishState = () => {
              if (stState.done) return;
              stState.done = true;
              _persistAssistantReply(agentId, rootDir, stState.finalContent).finally(() => {
                stState.timer = setTimeout(() => _streamStateCleanup(agentId, rootDir), STREAM_STATE_TTL_MS);
              });
            };
            // Clean up on client disconnect — ⚠️ 不 abort：agent 繼續跑（Fleming 2026-09-11：refresh 後回覆不能丟）
            req.on("close", () => { runningStreams.delete(streamKey); });

            // Run agent loop with streaming
            const { runAgentLoopStream } = await import("../lib/paaw-agent-loop.mjs");

            await runAgentLoopStream({
              prompt: "", // handled by messages array
              systemPrompt: "", // handled by messages array
              messages: finalMessages, // trimmed with 262K budget
              model: effectiveModel,
              fallbackModels: modelFallbacks, // 2026-09-23：per-agent fallback 鏈不再被 A2A 邊界丟掉
              cwd: clientContext.cwd,
              maxTurns: agent.maxTurns,
              timeout: 0, // no timeout — complex agent tasks may take arbitrarily long
              rootDir,
              agentId,
              abortSignal: streamAbort.signal,
              onStreamEvent: _stBuffer, // 2026-09-11：事件側車 — res.destroyed 後仍 buffer（斷線接回用）
            }, res);

            runningStreams.delete(streamKey);
            _finishState();
            if (!res.writableEnded) res.end();
            console.log(`[A2A:${agentId}] stream completed`);
          } catch (err) {
            logInternalError(`domain message/stream ${agentId}`, err);
            // 2026-09-15：streamKey/rootDir 是 try 內變數 — catch 裡重算（同一條 key）
            const errRootDir = params?.context?.cwd || PAAW_ROOT;
            const stErr = streamStates.get(_streamKey(agentId, errRootDir));
            if (stErr) { stErr.error = String(err.message || err).slice(0, 500); stErr.done = true; stErr.timer = setTimeout(() => _streamStateCleanup(agentId, errRootDir), STREAM_STATE_TTL_MS); }
            if (res.headersSent && !res.writableEnded) {
              // 2026-10-17（QA C3）：對外只回通用錯誤，細節留 server log
              try { res.write(`data: ${JSON.stringify({ error: GENERIC_INTERNAL_ERROR })}\n\n`); res.end(); } catch {} // nosemgrep: missing-template-string-indicator
            } else if (!res.headersSent) {
              sendJSON(res, 200, { jsonrpc: "2.0", error: { code: -32603, message: GENERIC_INTERNAL_ERROR }, id }, req);
            }
          }
          return true;
        }

        // message/send — sync response (EM 調度用這條)
        if (method === "message/send") {
          // ── Stream State 側車（2026-09-30）：message/send（EM 派工主路徑）也要註冊 ──
          // 2026-10-17（QA C1）：側車變數宣告於 try 之外，確保 catch 區塊（任何失敗點）都能安全收尾，
          // 避免 const 在 TDZ 時被 catch 引用而拋 ReferenceError、側車永久卡 working。
          let _sendSt = null;
          let _stBuf = () => {};        // 未初始化前的 no-op，catch 呼叫安全
          let _finishSendState = () => {};
          try {
            const userText = extractText(params?.message);
            if (!userText) {
              sendJSON(res, 200, { jsonrpc: "2.0", error: { code: -32602, message: "Empty message" }, id });
              return true;
            }

            const clientContext = params?.context || {};
            const modelOverride = params?.metadata?.model;
            const modelFallbacks = Array.isArray(params?.metadata?.fallbacks) ? params.metadata.fallbacks : undefined; // 2026-09-23：同 message/stream
            const conversationHistory = params?.conversationHistory || null;
            const rootDir = clientContext.cwd || PAAW_ROOT;

            // ── requiresVision 派工（2026-08-30 Phase 3）：同 message/stream — EM 調度主要走這條 ──
            let effectiveModel = modelOverride;
            if (agent?.requiresVision && !modelOverride) {
              const { getVisionModel } = await import("../lib/vision-content.mjs");
              const vm = getVisionModel();
              if (vm) {
                effectiveModel = vm;
                console.log(`[A2A:${agentId}] 👁 requiresVision → ${vm}`);
              } else {
                console.warn(`[A2A:${agentId}] ⚠️ requiresVision 但 providers.json 沒設 visionModel — 用原 model`);
              }
            }

            // Build system prompt from crew + context providers + action log + agent memory
            const { listActionLog, loadAgentMemory } = await import("../lib/action-log.mjs");
            const actionLogText = (await listActionLog({ cwd: rootDir, limit: 10 })).text;
            const agentMemoryText = await loadAgentMemory(agentId, rootDir);

            const systemPrompt = await buildSystemPrompt(agentId, {
              cwd: clientContext.cwd,
              clientContext,
            });

            const extraContext = [];
            if (actionLogText) extraContext.push(`\n## Recent Action Log (跨 Agent 交接紀錄)\n${actionLogText}`);
            if (agentMemoryText) extraContext.push(`\n## Your Long-term Memory (你的長期記憶)\n${agentMemoryText}`);
            const featureSummary2 = await getFeatureSummary(rootDir);
            if (featureSummary2) extraContext.push(featureSummary2);
            // Inject Code Intelligence file map for coding projects
            const ciFile2 = join(rootDir, ".paaw", "code-intelligence", "code-intelligence.json");
            if (existsSync(ciFile2)) {
              try {
                const ci2 = JSON.parse(readSync(ciFile2, "utf-8"));
                if (ci2.files?.length) {
                  const fileLines2 = ci2.files.slice(0, 200).map(f => {
                    const parts = [`- ${f.path}`];
                    if (f.exports?.length) parts.push(`exports: ${f.exports.slice(0, 10).join(", ")}`);
                    if (f.imports?.length) parts.push(`imports: ${f.imports.slice(0, 10).join(", ")}`);
                    return parts.join(" ");
                  }).join("\n");
                  extraContext.push(`\n## Code Intelligence File Map (${ci2.files.length} files, showing first ${Math.min(ci2.files.length, 200)})\n${fileLines2}`);
                }
              } catch {}
            }
            const secFile2 = join(rootDir, ".paaw", "security", "scan-results.json");
            if (existsSync(secFile2)) {
              try {
                const sec2 = JSON.parse(readSync(secFile2, "utf-8"));
                if (sec2.stats?.total > 0) {
                  extraContext.push(`\n## Security Scan Summary (${sec2.stats.total} findings, scanned ${sec2.scannedAt || "unknown"})\nBy severity: ${JSON.stringify(sec2.stats.bySeverity)}\nBy category: ${JSON.stringify(sec2.stats.byCategory)}`);
                }
              } catch {}
            }
            extraContext.push(`\n## Current Project Root\n${rootDir}（呼叫 tool 需要路徑時，cwd 帶這個值）`);
            extraContext.push(AGENT_RULES);
            const fullSystemPrompt = systemPrompt + extraContext.join("");

            // Build messages array with conversation history
            const messages = [];
            if (fullSystemPrompt) messages.push({ role: "system", content: fullSystemPrompt });
            if (conversationHistory && Array.isArray(conversationHistory) && conversationHistory.length > 0) {
              const cleanHistory = cleanConversationHistory(conversationHistory);
              for (const m of cleanHistory) {
                messages.push({ role: m.role, content: m.content });
              }
            }
            messages.push({ role: "user", content: userText });

            // 👁 2026-08-30：coding app agent chat 貼圖 — message.parts 帶圖 → append vision attachment（loop 自動路由 visionModel）
            const _imgs = extractImages(params?.message);
            if (_imgs.length > 0) await appendImageMessages(messages, _imgs, agentId);

            // ── Apply context window trimming (aligned with agent loop: 262K budget) ──
            const { trimMessagesToFit } = await import("../lib/paaw-agent-loop.mjs");
            const finalMessages = trimMessagesToFit(messages);

            const { runAgentLoop } = await import("../lib/paaw-agent-loop.mjs");

            // ── Stream State 側車（2026-09-30）：message/send（EM 派工主路徑）也要註冊 ──
            // 以前只有 message/stream 註冊 → EM 派工的 developer/tester tab 查 /stream-state 永遠 exists:false
            // → ⚡ Tool Calls 面板永遠不出現（Fleming：「EM 的 chat ui 有 tool calls 但開發只顯示思考中」）
            _streamStateCleanup(agentId, rootDir);
            _sendSt = { agentId, cwd: rootDir, startedAt: Date.now(), seq: 0, events: [], finalContent: null, done: false, error: null, timer: null };
            streamStates.set(_streamKey(agentId, rootDir), _sendSt);
            _stBuf = (evName, dataObj) => {
              _sendSt.seq += 1;
              _sendSt.events.push({ seq: _sendSt.seq, event: evName, data: dataObj });
              if (_sendSt.events.length > STREAM_STATE_MAX_EVENTS) _sendSt.events.splice(0, _sendSt.events.length - STREAM_STATE_MAX_EVENTS);
              if (evName === "content" && dataObj?.done && typeof dataObj.content === "string") _sendSt.finalContent = dataObj.content;
              if (evName === "error" && dataObj?.error) _sendSt.error = String(dataObj.error).slice(0, 500);
            };
            _finishSendState = () => {
              if (_sendSt.done) return;
              _sendSt.done = true;
              if (_sendSt.timer) clearTimeout(_sendSt.timer);
              _sendSt.timer = setTimeout(() => { if (streamStates.get(_streamKey(agentId, rootDir)) === _sendSt) streamStates.delete(_streamKey(agentId, rootDir)); }, STREAM_STATE_TTL_MS);
            };

            const result = await runAgentLoop({
              prompt: "", // handled by messages array
              systemPrompt: "", // handled by messages array
              messages: finalMessages, // trimmed with 262K budget
              model: effectiveModel,
              fallbackModels: modelFallbacks, // 2026-09-23：per-agent fallback 鏈不再被 A2A 邊界丟掉
              cwd: clientContext.cwd,
              maxTurns: agent.maxTurns,
              timeout: 0, // no timeout — complex agent tasks may take arbitrarily long
              rootDir,
              agentId,
              // 2026-09-30：runAgentLoop 的 onEvent（tool_start/tool_end/tool_error/turn_start/error）
              // 映射成 stream 事件形狀進側車 — agent tab 的 reattach poller 才吃得到
              onEvent: (ev) => {
                if (!ev) return;
                if (ev.type === "tool_start") _stBuf("tool", { name: ev.name, args: ev.args });
                else if (ev.type === "tool_end") _stBuf("tool_result", { name: ev.name, result: ev.result });
                else if (ev.type === "tool_error") _stBuf("tool_result", { name: ev.name, result: String(ev.error || "tool error") });
                else if (ev.type === "turn_start") _stBuf("thinking", {});
                else if (ev.type === "error") _stBuf("error", { error: String(ev.message || ev.error || "agent loop error") });
                else if (ev.type === "approval_request") _stBuf("approval_request", { id: ev.id, command: ev.command, reason: ev.reason, agentId: ev.agentId || null }); // 2026-10-09 審批卡；2026-10-13 加 agentId（審批只在其 crew 視窗顯示）
              },
            });
            _stBuf("content", { content: String(result.content || ""), done: true }); // 斷線期間完成的回覆
            _finishSendState();

            sendJSON(res, 200, {
              jsonrpc: "2.0",
              result: {
                artifacts: [{
                  artifactId: `art-${Date.now()}`,
                  name: "Response",
                  parts: [{ type: "text", text: result.content }],
                }],
                metadata: { turns: result.turns, toolCalls: result.toolCalls?.length || 0, usage: result.usage || null },
              },
              id,
            });
          } catch (err) {
            logInternalError("domain message/send", err);
            // 2026-10-17（QA C1）：_stBuf/_finishSendState 已確保存在（try 外宣告 + no-op 預設），呼叫安全
            try { _stBuf("error", { error: String(err.message || err) }); _finishSendState(); } catch {}
            sendJSON(res, 200, { jsonrpc: "2.0", error: { code: -32603, message: GENERIC_INTERNAL_ERROR }, id }, req);
          }
          return true;
        }

        // ── tasks/get（domain agent 版本，QA M2）──
        if (method === "tasks/get") {
          const { id: taskId, historyLength } = params || {};
          const task = await getTask(taskId);
          if (!task || (task.metadata?.agentId && task.metadata.agentId !== agentId)) {
            sendJSON(res, 200, { jsonrpc: "2.0", error: { code: -32001, message: `Task not found: ${taskId}` }, id });
          } else {
            if (historyLength && task.history) task.history = task.history.slice(-historyLength);
            sendJSON(res, 200, { jsonrpc: "2.0", result: task, id });
          }
          return true;
        }

        // ── tasks/list（domain agent 版本：只列此 agent 的 task，QA M2）──
        if (method === "tasks/list") {
          const all = await listTasks();
          const tasks = all.filter(t => t.metadata?.agentId === agentId);
          sendJSON(res, 200, { jsonrpc: "2.0", result: { tasks, nextPageToken: "" }, id });
          return true;
        }

        // ── tasks/cancel（domain agent 版本，QA M2）──
        if (method === "tasks/cancel") {
          const { id: taskId } = params || {};
          const task = await getTask(taskId);
          if (!task || (task.metadata?.agentId && task.metadata.agentId !== agentId)) {
            sendJSON(res, 200, { jsonrpc: "2.0", error: { code: -32001, message: `Task not found: ${taskId}` }, id });
          } else {
            const runningHit = findRunningStream(agentId, task.metadata?.cwd);
            if (runningHit) {
              runningHit.stream.abortController.abort();
              try {
                await sseWrite(runningHit.stream.res, `event: interrupted\ndata: ${JSON.stringify({ message: "Task canceled by user", taskId })}\n\n`); // nosemgrep: missing-template-string-indicator
                if (!runningHit.stream.res.writableEnded) runningHit.stream.res.end();
              } catch {}
              runningStreams.delete(runningHit.key);
            }
            task.status = { state: "canceled", timestamp: new Date().toISOString() };
            await saveTask(task);
            sendJSON(res, 200, { jsonrpc: "2.0", result: task, id });
          }
          return true;
        }

        // Unknown method for domain agent
        sendJSON(res, 200, { jsonrpc: "2.0", error: { code: -32601, message: `Method not found: ${method}` }, id });
        return true;
      }

      // GET /a2a/:agentId — return agent card as default
      if (req.method === "GET" && !subPath) {
        const card = buildAgentCard(agentId, req);
        sendJSON(res, 200, card);
        return true;
      }
    }
  }

  // ════════════════════════════════════════
  // POST /a2a — JSON-RPC 2.0 endpoint (PAAW default agent)
  // ════════════════════════════════════════
  if (req.method === "POST" && path === "/a2a") {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      sendJSON(res, 200, {
        jsonrpc: "2.0",
        error: { code: -32700, message: "Parse error" },
        id: null,
      });
      return true;
    }

    const { jsonrpc, method, params, id } = body;

    // Validate JSON-RPC
    if (jsonrpc !== "2.0") {
      sendJSON(res, 200, {
        jsonrpc: "2.0",
        error: { code: -32600, message: "Invalid Request — jsonrpc must be '2.0'" },
        id: isValidRpcId(id) ? id : null,
      }, req);
      return true;
    }

    // id 型別驗證（QA m3）：非法型別回 Invalid Request
    if (id !== undefined && !isValidRpcId(id)) {
      sendJSON(res, 200, {
        jsonrpc: "2.0",
        error: { code: -32600, message: "Invalid Request — id must be string, number or null" },
        id: null,
      }, req);
      return true;
    }

    // method 驗證（QA 協定合規）：非字串/空字串 → Invalid Request（-32600），不可誤判 -32601
    if (!isValidRpcMethod(method)) {
      sendJSON(res, 200, {
        jsonrpc: "2.0",
        error: { code: -32600, message: "Invalid Request — method must be a non-empty string" },
        id: isValidRpcId(id) ? id : null,
      }, req);
      return true;
    }

    // JSON-RPC notification 語意（QA m3）：無 id 的方法呼叫不回傳回應，但 server 仍處理
    const isNotification = id === undefined;
    if (isNotification) res._a2aSuppressResponse = true;

    console.log(`[A2A] RPC ${method} id=${id}${isNotification ? " (notification)" : ""}`);

    // ── message/send ──
    if (method === "message/send") {
      try {
        const { message, configuration } = params || {};
        const userText = extractText(message);

        if (!userText) {
          sendJSON(res, 200, {
            jsonrpc: "2.0",
            error: { code: -32602, message: "Message must contain at least one text part" },
            id,
          });
          return true;
        }

        // Create or load task (for multi-turn, contextId links tasks)
        // contextId can be in params.contextId OR message.contextId (A2A SDK format)
        const ctxId = params?.contextId || message?.contextId;
        const modelOverride = params?.metadata?.model || message?.metadata?.model;
        const existingTaskId = params?.taskId || (ctxId ? await findLatestTaskInContext(ctxId) : null);
        let task;
        let isFollowUp = false;
        if (existingTaskId) {
          task = await getTask(existingTaskId);
          if (task) {
            isFollowUp = true;
            task.history.push({ role: "user", parts: [{ type: "text", kind: "text", text: userText }] });
          }
        }
        if (!task) {
          task = makeTask({ message, contextId: ctxId });
        }
        task.status = { state: "working", timestamp: new Date().toISOString() };
        await saveTask(task);

        const pushConfig = configuration?.pushNotification;
        console.log(`[A2A] message/send task=${task.id} ${isFollowUp ? "(follow-up)" : ""} text="${userText.slice(0, 80)}..." webhook=${!!pushConfig}`);

        // ══ ASYNC MODE (webhook): return working immediately, process in background ══
        if (pushConfig?.url) {
          sendJSON(res, 200, { jsonrpc: "2.0", result: task, id });
          console.log(`[A2A] task=${task.id} returned working (webhook → ${pushConfig.url})`);

          ; (async () => {
            try {
              const conversation = (task.history || []).map(h => ({
                role: h.role === "agent" ? "assistant" : "user",
                content: h.parts?.map(p => p.text || "").join("") || "",
              })).filter(m => m.content);

              // ── Intermediate status webhook notifications ──
              const onStatus = async (statusUpdate) => {
                task.status = { state: statusUpdate.state || "working", timestamp: new Date().toISOString(), ...statusUpdate };
                await saveTask(task);
                await notifyWebhook(task, pushConfig);
              };

              // Notify: thinking
              await onStatus({ state: "working", message: "thinking" });

              const hdResult = await runHelpDeskViaA2A(conversation, { modelOverride, taskId: task.id, onProgress: async (prog) => {
                // Notify: tool execution
                if (prog.type === "tool_start") {
                  await onStatus({ state: "working", message: `executing tool: ${prog.name}` });
                }
              }});

              if (hdResult.needsInfo) {
                task.status = { state: "input-required", timestamp: new Date().toISOString() };
                task.history.push({ role: "agent", parts: [{ type: "text", kind: "text", text: hdResult.needsInfo }] });
                task.artifacts = [{ artifactId: `art-${Date.now()}`, name: "Clarification", parts: [{ type: "text", kind: "text", text: hdResult.needsInfo }] }];
                task.metadata = { toolsUsed: hdResult.toolsUsed, needsInfo: true };
              } else {
                task.status = { state: "completed", timestamp: new Date().toISOString() };
                task.history.push({ role: "agent", parts: [{ type: "text", kind: "text", text: hdResult.text }] });
                task.artifacts = [{ artifactId: `art-${Date.now()}`, name: "Response", parts: [{ type: "text", kind: "text", text: hdResult.text }] }];
                task.metadata = { toolsUsed: hdResult.toolsUsed };
              }
              await saveTask(task);
              console.log(`[A2A] task=${task.id} background done: ${task.status.state}`);

              // POST webhook (final result)
              await notifyWebhook(task, pushConfig);
            } catch (bgErr) {
              console.error(`[A2A] task=${task.id} background error:`, bgErr); // nosemgrep: unsafe-formatstring — 模板無 % 指示符，內部 log
              task.status = { state: "failed", timestamp: new Date().toISOString() };
              task.metadata = { error: bgErr.message };
              await saveTask(task);
              await notifyWebhook(task, pushConfig);
            }
          })();
          return true;
        }

        // ══ SYNC MODE: process and return ══
        let result;
        let needsInfo = null;

        {
          const conversation = (task.history || []).map(h => ({
            role: h.role === "agent" ? "assistant" : "user",
            content: h.parts?.map(p => p.text || "").join("") || "",
          })).filter(m => m.content);

          const hdResult = await runHelpDeskViaA2A(conversation, {
            onProgress: async (prog) => {
              if (prog.type === "tool_start") {
                // Live-update task so UI polling can see progress
                task.metadata = { ...task.metadata, toolsUsed: prog.toolsUsed, liveState: "processing" };
                task.history = [
                  ...task.history.filter(h => h.role !== "agent" || h.parts?.[0]?.text !== "⏳ 處理中..."),
                  { role: "agent", parts: [{ type: "text", kind: "text", text: "⏳ 處理中..." }] },
                ];
                await saveTask(task);
              }
            },
            modelOverride,
            taskId: task.id,
          });
          result = { text: hdResult.text, toolsUsed: hdResult.toolsUsed };
          needsInfo = hdResult.needsInfo;
        }

        // Remove placeholder "⏳ 處理中..." before pushing final answer
        task.history = task.history.filter(h => !(h.role === "agent" && h.parts?.[0]?.text === "⏳ 處理中..."));

        if (needsInfo) {
          // Return input-required state — caller can follow up with same contextId
          task.status = { state: "input-required", timestamp: new Date().toISOString() };
          task.history.push({ role: "agent", parts: [{ type: "text", kind: "text", text: needsInfo }] });
          task.artifacts = [{
            artifactId: `art-${Date.now()}`,
            name: "Clarification Question",
            parts: [{ type: "text", kind: "text", text: needsInfo }],
          }];
          task.metadata = { toolsUsed: result.toolsUsed, model: "paaw-helpdesk", needsInfo: true };
          await saveTask(task);
          await syncTicketFromTask(task);

          console.log(`[A2A] task=${task.id} input-required: "${needsInfo.slice(0, 80)}"`);

          sendJSON(res, 200, { jsonrpc: "2.0", result: task, id });
        } else {
          // Completed with answer
          task.status = { state: "completed", timestamp: new Date().toISOString() };
          task.history.push({ role: "agent", parts: [{ type: "text", kind: "text", text: result.text }] });
          task.artifacts = [{
            artifactId: `art-${Date.now()}`,
            name: "Response",
            parts: [{ type: "text", kind: "text", text: result.text }],
          }];
          task.metadata = { toolsUsed: result.toolsUsed, model: "paaw-helpdesk" };
          await saveTask(task);
          await syncTicketFromTask(task);

          console.log(`[A2A] task=${task.id} completed (${result.text.length} chars)`);

          sendJSON(res, 200, { jsonrpc: "2.0", result: task, id });
        }
      } catch (err) {
        logInternalError("message/send", err);
        sendJSON(res, 200, {
          jsonrpc: "2.0",
          error: { code: -32603, message: GENERIC_INTERNAL_ERROR },
          id,
        }, req);
      }
      return true;
    }

    // ── message/stream ──
    if (method === "message/stream") {
      try {
        const { message, configuration } = params || {};
        const userText = extractText(message);

        if (!userText) {
          sendJSON(res, 200, {
            jsonrpc: "2.0",
            error: { code: -32602, message: "Message must contain at least one text part" },
            id,
          });
          return true;
        }

        // Create task
        const ctxId2 = params?.contextId || message?.contextId;
        const task = makeTask({ message, contextId: ctxId2 });
        task.status = { state: "working", timestamp: new Date().toISOString() };
        await saveTask(task);

        console.log(`[A2A] message/stream task=${task.id} text="${userText.slice(0, 80)}..."`);

        // SSE streaming（CORS 依白名單；QA M3）
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          ...corsHeadersFor(req),
          "X-Accel-Buffering": "no",
        });
        res.flushHeaders();
        if (res.socket?.setNoDelay) res.socket.setNoDelay(true);
        // 斷線偵測（QA M4）：client 離線後停止寫入，避免事件堆積
        res._a2aClientGone = false;
        req.on("close", () => { res._a2aClientGone = true; });

        // Send initial task event
        await sseWrite(res, `data: ${JSON.stringify({
          jsonrpc: "2.0",
          result: { kind: "task", task },
          id,
        })}\n\n`);

        // Status update: working
        await sseWrite(res, `data: ${JSON.stringify({
          jsonrpc: "2.0",
          result: {
            kind: "status-update",
            taskId: task.id,
            status: { state: "working", timestamp: new Date().toISOString() },
            final: false,
          },
          id,
        })}\n\n`);

        // Run agent with streaming
        let fullText = "";
        let toolsUsed = [];

        const result = await runAgentLoop({
          message,
          onChunk: async (chunk) => {
            if (chunk.type === "text" && chunk.delta) {
              fullText += chunk.delta;
              // Stream as artifact update（背壓感知，QA M4）
              await sseWrite(res, `data: ${JSON.stringify({
                jsonrpc: "2.0",
                result: {
                  kind: "artifact-update",
                  taskId: task.id,
                  artifact: {
                    artifactId: `art-stream-${Date.now()}`,
                    name: "Streaming Response",
                    parts: [{ type: "text", kind: "text", text: chunk.delta }],
                  },
                  append: true,
                  lastChunk: false,
                },
                id,
              })}\n\n`);
            }
            if (chunk.type === "tool_start") {
              toolsUsed.push(chunk.name);
              // Status update with tool info
              await sseWrite(res, `data: ${JSON.stringify({
                jsonrpc: "2.0",
                result: {
                  kind: "status-update",
                  taskId: task.id,
                  status: {
                    state: "working",
                    timestamp: new Date().toISOString(),
                    message: { role: "agent", parts: [{ type: "text", kind: "text", text: `🔧 ${chunk.name}(...)` }] },
                  },
                  final: false,
                },
                id,
              })}\n\n`);
            }
          },
        });

        // Final status: completed
        task.status = { state: "completed", timestamp: new Date().toISOString() };
        task.history.push({ role: "agent", parts: [{ type: "text", kind: "text", text: result.text }] });
        task.artifacts = [{
          artifactId: `art-final-${Date.now()}`,
          name: "Response",
          parts: [{ type: "text", kind: "text", text: result.text }],
        }];
        task.metadata = { toolsUsed: result.toolsUsed, model: "paaw-default" };
        await saveTask(task);

        // Send final status update（背壓感知，QA M4）
        await sseWrite(res, `data: ${JSON.stringify({
          jsonrpc: "2.0",
          result: {
            kind: "status-update",
            taskId: task.id,
            status: { state: "completed", timestamp: new Date().toISOString() },
            final: true,
          },
          id,
        })}\n\n`);

        if (!res.writableEnded) res.end();
        console.log(`[A2A] message/stream task=${task.id} completed`);
      } catch (err) {
        logInternalError("message/stream", err);
        // If headers already sent, try to send error via SSE
        if (res.headersSent && !res.writableEnded) {
          try { res.write(`data: ${JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32603, message: GENERIC_INTERNAL_ERROR },
            id,
          })}\n\n`); res.end(); } catch {}
        } else if (!res.headersSent) {
          sendJSON(res, 200, {
            jsonrpc: "2.0",
            error: { code: -32603, message: GENERIC_INTERNAL_ERROR },
            id,
          }, req);
        }
      }
      return true;
    }

    // ── tasks/get ──
    if (method === "tasks/get") {
      const { id: taskId, historyLength } = params || {};
      const task = await getTask(taskId);
      if (!task) {
        sendJSON(res, 200, {
          jsonrpc: "2.0",
          error: { code: -32001, message: `Task not found: ${taskId}` },
          id,
        });
      } else {
        if (historyLength && task.history) {
          task.history = task.history.slice(-historyLength);
        }
        sendJSON(res, 200, { jsonrpc: "2.0", result: task, id });
      }
      return true;
    }

    // ── tasks/list ──
    if (method === "tasks/list") {
      const tasks = await listTasks();
      sendJSON(res, 200, {
        jsonrpc: "2.0",
        result: { tasks, nextPageToken: "" },
        id,
      });
      return true;
    }

    // ── tasks/cancel ──
    if (method === "tasks/cancel") {
      const { id: taskId } = params || {};
      const task = await getTask(taskId);
      if (!task) {
        sendJSON(res, 200, {
          jsonrpc: "2.0",
          error: { code: -32001, message: `Task not found: ${taskId}` },
          id,
        });
      } else {
        // Abort running stream if this agentId has an active stream
        const agentId = task.metadata?.agentId || taskId;
        // 2026-09-15：compound key — task metadata 有 cwd 精準刪，沒有掃 prefix（舊行為相容）
        const runningHit = findRunningStream(agentId, task.metadata?.cwd);
        if (runningHit) {
          runningHit.stream.abortController.abort();
          // Send interrupted event to SSE client
          try {
            await sseWrite(runningHit.stream.res, `event: interrupted\ndata: ${JSON.stringify({ message: "Task canceled by user", taskId })}\n\n`); // nosemgrep: missing-template-string-indicator
            if (!runningHit.stream.res.writableEnded) runningHit.stream.res.end();
          } catch {}
          runningStreams.delete(runningHit.key);
          console.log(`[A2A] Aborted running stream for ${runningHit.key}`);
        }
        task.status = { state: "canceled", timestamp: new Date().toISOString() };
        await saveTask(task);
        sendJSON(res, 200, { jsonrpc: "2.0", result: task, id });
      }
      return true;
    }

    // ── Unknown method ──
    sendJSON(res, 200, {
      jsonrpc: "2.0",
      error: { code: -32601, message: `Method not found: ${method}` },
      id,
    });
    return true;
  }

  // ════════════════════════════════════════
  // GET /api/a2a/tasks — PAAW UI 用（非 A2A 標準）
  // ════════════════════════════════════════
  if (req.method === "GET" && path === "/api/a2a/tasks") {
    const tasks = await listTasks();
    sendJSON(res, 200, { ok: true, data: tasks });
    return true;
  }

  // ── POST /api/a2a/interrupt — 直接中斷某個 agent 的 running stream (PAAW UI 用) ──
  // 2026-09-15：body 可帶 cwd 精準中斷該 RU 的 run；帶了 cwd 但沒命中就不動（不誤殺其他 RU）
  if (req.method === "POST" && path === "/api/a2a/interrupt") {
    const body = await new Promise((ok, fail) => { let d = ""; req.on("data", c => d += c); req.on("end", () => ok(d)); req.on("error", fail); });
    const { agentId: aid, cwd: icwd } = JSON.parse(body || "{}");
    if (!aid) {
      sendJSON(res, 400, { ok: false, error: "Missing agentId" });
      return true;
    }
    const runningHit = findRunningStream(aid, icwd);
    if (!runningHit) {
      sendJSON(res, 200, { ok: true, message: `No running stream for agentId=${aid}${icwd ? ` cwd=${icwd}` : ""}` });
      return true;
    }
    runningHit.stream.abortController.abort();
    try {
      await sseWrite(runningHit.stream.res, `event: interrupted\ndata: ${JSON.stringify({ message: "Interrupted by user", agentId: aid })}\n\n`); // nosemgrep: missing-template-string-indicator
      if (!runningHit.stream.res.writableEnded) runningHit.stream.res.end();
    } catch {}
    runningStreams.delete(runningHit.key);
    console.log(`[A2A] Interrupted stream for ${runningHit.key}`);
    sendJSON(res, 200, { ok: true, message: `Interrupted ${runningHit.key}` });
    return true;
  }

  // GET /api/a2a/agent-card — PAAW UI 用
  if (req.method === "GET" && path === "/api/a2a/agent-card") {
    sendJSON(res, 200, { ok: true, data: getAgentCard(req) });
    return true;
  }

  return false; // not handled
}
