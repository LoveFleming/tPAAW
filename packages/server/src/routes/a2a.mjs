/**
 * PAAW A2A Server — Agent2Agent Protocol v1.0.0
 *
 * 實作 JSON-RPC 2.0 binding：
 *   GET  /.well-known/agent.json          → Agent Card
 *   POST /a2a                             → JSON-RPC endpoint
 *   POST /a2a                             → SSE streaming (method=message/stream)
 *
 * 支援的 methods：
 *   - message/send         → 同步回傳 Task 或 Message
 *   - message/stream       → SSE 串流
 *   - tasks/get            → 查詢 task 狀態
 *   - tasks/list           → 列出 tasks
 *   - tasks/cancel         → 取消 task
 *
 * Task 存儲：data/a2a-tasks/*.json
 */

import { readdir, readFile, writeFile, mkdir, unlink, appendFile } from "fs/promises";
import { existsSync } from "fs";
import { resolve, join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { JsonTaskPersistence } from "../lib/task-persistence.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PAAW_ROOT = resolve(__dirname, "../../../..");
const DATA_DIR = resolve(PAAW_ROOT, "data");

// ── Agent Rules — injected into every crew's system prompt ──
import { AGENT_RULES } from "../lib/agent-rules.mjs";
import { readFileSync as readSync } from "fs";

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
    return `\n## Feature Map (${features.length} features)\nUse project_feature_detail for full info on any feature.\n${lines}`;
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
          id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
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

// ── Helpers ──

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function sendJSON(res, code, body) {
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(body));
}

function genId() {
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Task Storage (delegates to TaskPersistenceAdapter) ──

/** Save task to disk, preserving events/tokens that were appended during tool execution */
async function saveTask(task) {
  // Reload from disk to merge any events/tokens written by appendEvent during tool calls
  const persisted = await taskStore.load(task.id);
  if (persisted?.events?.length) task.events = persisted.events;
  if (persisted?.tokenUsage) task.tokenUsage = persisted.tokenUsage;
  if (persisted?.memory?.length) task.memory = persisted.memory;
  return taskStore.save(task);
}
async function getTask(taskId) { return taskStore.load(taskId); }
async function listTasks() { return taskStore.list(); }

// ── Webhook notification helper ──
/** POST task status update to pushNotification webhook URL */
async function notifyWebhook(task, pushConfig) {
  if (!pushConfig?.url) return;
  try {
    const whHeaders = { "Content-Type": "application/json" };
    if (pushConfig.token) whHeaders["Authorization"] = `Bearer ${pushConfig.token}`;
    await fetch(pushConfig.url, {
      method: "POST",
      headers: whHeaders,
      body: JSON.stringify({ jsonrpc: "2.0", result: task, id: `notify-${task.id}` }),
    });
    console.log(`[A2A] webhook notified: task=${task.id} state=${task.status.state}`);
  } catch (err) {
    console.error(`[A2A] webhook notify failed: ${err.message}`);
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

function makeAgentMessage(text) {
  return {
    role: "agent",
    parts: [{ type: "text", text }],
    messageId: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    taskId: null,
  };
}

// ── Agent Card ──

function getAgentCard(req) {
  const host = req.headers.host || `localhost:${process.env.PAAW_PORT || 4097}`;
  const protocol = req.headers["x-forwarded-proto"] || "http";
  const baseUrl = `${protocol}://${host}`;

  return {
    protocolVersion: "0.3.0",
    name: "PAAW Agent",
    description: "Personal AI Assistant Workspace — A2A-enabled agent that can execute skills, manage data apps, and collaborate with other agents.",
    url: `${baseUrl}/a2a`,
    version: "1.0.0",
    capabilities: {
      streaming: true,
      pushNotifications: true,
      stateTransition: true,
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
  const model = providerConfig.defaultModel || "glm-5.1";

  // Build context (reuse chat context)
  const ctx = await contextEngine.build({ target: "chat" });

  // executors from cache

  const engine = new ToolEngine({
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
      approval: { mode: process.env.NODE_ENV === "development" ? "auto" : "always" },
      audit: { enabled: true },
    },
    sessionKey: "a2a",
    agentId: "a2a-server",
  });

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
  const model = modelOverride || providerConfig.defaultModel || "glm-5.1";

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
      body: JSON.stringify({ model, messages: [{ role: "system", content: systemPrompt }, ...summaryMessages], temperature: 0.3 }),
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

  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
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
            const conversationHistory = params?.conversationHistory || null;
            const rootDir = clientContext.cwd || PAAW_ROOT;

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
            const featureSummary = getFeatureSummary(rootDir);
            if (featureSummary) extraContext.push(featureSummary);
            extraContext.push(AGENT_RULES);
            const fullSystemPrompt = systemPrompt + extraContext.join("");

            // Build messages array with conversation history
            const messages = [];
            if (fullSystemPrompt) messages.push({ role: "system", content: fullSystemPrompt });

            if (conversationHistory && Array.isArray(conversationHistory) && conversationHistory.length > 0) {
              const cleanHistory = conversationHistory
                .filter(m => m.role === "user" || m.role === "assistant")
                .filter(m => !m._thinking)
                .map(m => ({ role: m.role, content: (m.content || "").replace(/^💭 /, "") }));

              // Smart context window: token budget management
              const estimateTokens = (text) => Math.ceil((text || "").length / 4);
              const systemPromptTokens = estimateTokens(fullSystemPrompt);
              const maxContextTokens = 12000;
              const responseReserve = 2000;
              const budget = maxContextTokens - systemPromptTokens - responseReserve;

              const selected = [];
              let usedTokens = 0;
              for (let i = cleanHistory.length - 1; i >= 0; i--) {
                const msgTokens = estimateTokens(cleanHistory[i].content);
                if (usedTokens + msgTokens > budget && selected.length > 0) break;
                selected.unshift(cleanHistory[i]);
                usedTokens += msgTokens;
              }

              const trimmedCount = cleanHistory.length - selected.length;
              if (trimmedCount > 0) {
                const trimmedMessages = cleanHistory.slice(0, trimmedCount);
                const summaryParts = trimmedMessages.map(m => {
                  const role = m.role === "user" ? "👤" : "🤖";
                  return `${role} ${m.content.slice(0, 150)}`;
                });
                messages.push({
                  role: "system",
                  content: `[Earlier conversation summary (${trimmedCount} messages trimmed)]:\n${summaryParts.join("\n")}`,
                });
              }

              for (const m of selected) {
                messages.push({ role: m.role, content: m.content });
              }
            }
            messages.push({ role: "user", content: userText });

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
                totalMessages: messages.length,
                messagesSummary: messages.map(m => ({ role: m.role, contentLength: m.content?.length || 0, preview: (m.content || "").slice(0, 120) })),
              };
              await appendFile(logPath, JSON.stringify(logEntry, null, 2) + "\n---\n");
            } catch (_logErr) {}

            // SSE headers
            res.writeHead(200, {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
              "Access-Control-Allow-Origin": "*",
              "X-Accel-Buffering": "no",
            });
            res.flushHeaders();
            if (res.socket?.setNoDelay) res.socket.setNoDelay(true);

            // Run agent loop with streaming
            const { runAgentLoopStream } = await import("../lib/paaw-agent-loop.mjs");

            await runAgentLoopStream({
              prompt: "", // handled by messages array
              systemPrompt: "", // handled by messages array
              messages,
              model: modelOverride,
              cwd: clientContext.cwd,
              maxTurns: agent.maxTurns,
              timeout: 1800,
              rootDir,
              agentId,
            }, res);

            res.end();
            console.log(`[A2A:${agentId}] stream completed`);
          } catch (err) {
            console.error(`[A2A:${agentId}] stream error:`, err);
            if (res.headersSent) {
              res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
              res.end();
            } else {
              sendJSON(res, 200, { jsonrpc: "2.0", error: { code: -32603, message: err.message }, id });
            }
          }
          return true;
        }

        // message/send — sync response (EM 調度用這條)
        if (method === "message/send") {
          try {
            const userText = extractText(params?.message);
            if (!userText) {
              sendJSON(res, 200, { jsonrpc: "2.0", error: { code: -32602, message: "Empty message" }, id });
              return true;
            }

            const clientContext = params?.context || {};
            const modelOverride = params?.metadata?.model;
            const conversationHistory = params?.conversationHistory || null;
            const rootDir = clientContext.cwd || PAAW_ROOT;

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
            const featureSummary2 = getFeatureSummary(rootDir);
            if (featureSummary2) extraContext.push(featureSummary2);
            extraContext.push(AGENT_RULES);
            const fullSystemPrompt = systemPrompt + extraContext.join("");

            // Build messages array with conversation history
            const messages = [];
            if (fullSystemPrompt) messages.push({ role: "system", content: fullSystemPrompt });
            if (conversationHistory && Array.isArray(conversationHistory) && conversationHistory.length > 0) {
              const cleanHistory = conversationHistory
                .filter(m => m.role === "user" || m.role === "assistant")
                .filter(m => !m._thinking)
                .map(m => ({ role: m.role, content: (m.content || "").replace(/^💭 /, "") }));

              // Smart context window: token budget management
              const estimateTokens = (text) => Math.ceil((text || "").length / 4);
              const systemPromptTokens = estimateTokens(fullSystemPrompt);
              const maxContextTokens = 12000;
              const responseReserve = 2000;
              const budget = maxContextTokens - systemPromptTokens - responseReserve;

              const selected = [];
              let usedTokens = 0;
              for (let i = cleanHistory.length - 1; i >= 0; i--) {
                const msgTokens = estimateTokens(cleanHistory[i].content);
                if (usedTokens + msgTokens > budget && selected.length > 0) break;
                selected.unshift(cleanHistory[i]);
                usedTokens += msgTokens;
              }

              const trimmedCount = cleanHistory.length - selected.length;
              if (trimmedCount > 0) {
                const trimmedMessages = cleanHistory.slice(0, trimmedCount);
                const summaryParts = trimmedMessages.map(m => {
                  const role = m.role === "user" ? "👤" : "🤖";
                  return `${role} ${m.content.slice(0, 150)}`;
                });
                messages.push({
                  role: "system",
                  content: `[Earlier conversation summary (${trimmedCount} messages trimmed)]:\n${summaryParts.join("\n")}`,
                });
              }

              for (const m of selected) {
                messages.push({ role: m.role, content: m.content });
              }
            }
            messages.push({ role: "user", content: userText });

            const { runAgentLoop } = await import("../lib/paaw-agent-loop.mjs");

            const result = await runAgentLoop({
              prompt: "", // handled by messages array
              systemPrompt: "", // handled by messages array
              messages,
              model: modelOverride,
              cwd: clientContext.cwd,
              maxTurns: agent.maxTurns,
              timeout: 1800,
              rootDir,
              agentId,
            });

            sendJSON(res, 200, {
              jsonrpc: "2.0",
              result: {
                artifacts: [{
                  artifactId: `art-${Date.now()}`,
                  name: "Response",
                  parts: [{ type: "text", text: result.content }],
                }],
                metadata: { turns: result.turns, toolCalls: result.toolCalls?.length || 0 },
              },
              id,
            });
          } catch (err) {
            sendJSON(res, 200, { jsonrpc: "2.0", error: { code: -32603, message: err.message }, id });
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
        id: id || null,
      });
      return true;
    }

    console.log(`[A2A] RPC ${method} id=${id}`);

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
              console.error(`[A2A] task=${task.id} background error:`, bgErr);
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
        console.error(`[A2A] message/send error:`, err);
        sendJSON(res, 200, {
          jsonrpc: "2.0",
          error: { code: -32603, message: err.message },
          id,
        });
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

        // SSE streaming
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": "*",
          "X-Accel-Buffering": "no",
        });
        res.flushHeaders();
        if (res.socket?.setNoDelay) res.socket.setNoDelay(true);

        // Send initial task event
        res.write(`data: ${JSON.stringify({
          jsonrpc: "2.0",
          result: { kind: "task", task },
          id,
        })}\n\n`);
        if (typeof res.flush === "function") res.flush();

        // Status update: working
        res.write(`data: ${JSON.stringify({
          jsonrpc: "2.0",
          result: {
            kind: "status-update",
            taskId: task.id,
            status: { state: "working", timestamp: new Date().toISOString() },
            final: false,
          },
          id,
        })}\n\n`);
        if (typeof res.flush === "function") res.flush();

        // Run agent with streaming
        let fullText = "";
        let toolsUsed = [];

        const result = await runAgentLoop({
          message,
          onChunk: (chunk) => {
            if (chunk.type === "text" && chunk.delta) {
              fullText += chunk.delta;
              // Stream as artifact update
              res.write(`data: ${JSON.stringify({
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
              if (typeof res.flush === "function") res.flush();
            }
            if (chunk.type === "tool_start") {
              toolsUsed.push(chunk.name);
              // Status update with tool info
              res.write(`data: ${JSON.stringify({
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
              if (typeof res.flush === "function") res.flush();
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

        // Send final status update
        res.write(`data: ${JSON.stringify({
          jsonrpc: "2.0",
          result: {
            kind: "status-update",
            taskId: task.id,
            status: { state: "completed", timestamp: new Date().toISOString() },
            final: true,
          },
          id,
        })}\n\n`);
        if (typeof res.flush === "function") res.flush();

        res.end();
        console.log(`[A2A] message/stream task=${task.id} completed`);
      } catch (err) {
        console.error(`[A2A] message/stream error:`, err);
        // If headers already sent, try to send error via SSE
        if (res.headersSent) {
          res.write(`data: ${JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32603, message: err.message },
            id,
          })}\n\n`);
          res.end();
        } else {
          sendJSON(res, 200, {
            jsonrpc: "2.0",
            error: { code: -32603, message: err.message },
            id,
          });
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

  // GET /api/a2a/agent-card — PAAW UI 用
  if (req.method === "GET" && path === "/api/a2a/agent-card") {
    sendJSON(res, 200, { ok: true, data: getAgentCard(req) });
    return true;
  }

  return false; // not handled
}
