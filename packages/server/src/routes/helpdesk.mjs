/**
 * PAAW HelpDesk API — 讓其他 Agent 可以透過 API 提問
 *
 * POST /api/helpdesk/ask          — 提交問題（新建或續問，同步回傳答案）
 * GET  /api/helpdesk/tickets      — 列出所有票
 * GET  /api/helpdesk/ticket/:id   — 查詢單一票
 * POST /api/helpdesk/ticket/:id/reply — 補充問題
 * GET  /api/helpdesk/knowledge    — 取得 PAAW 知識庫
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readBody, json } from "./shared.mjs";
import { callLLMWithRetry } from "../lib/llm-utils.mjs"; // 2026-08-30：fallback 摘要改走統一咽喉（原本 direct fetch 無 retry/log/診斷）
import { JsonTaskPersistence } from "../lib/task-persistence.mjs";
import { resolveDefaultModel } from "../lib/llm-utils.mjs";
import { truncateToolResultsInMessages, limitHistoryTurns } from "../lib/context-truncation.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = resolve(__dirname, "../../../../data");
const HELPDESK_DATA = resolve(DATA_DIR, "helpdesk/tickets.json");
const KNOWLEDGE_FILE = resolve(DATA_DIR, "helpdesk/KNOWLEDGE.md");
const HELPDESK_SKILL = resolve(DATA_DIR, "skills/physical-skill/help-desk/SKILL.md");
const CONFIG_DIR = resolve(DATA_DIR, "config");

await mkdir(resolve(DATA_DIR, "helpdesk"), { recursive: true });

// ── 啟動時快取（不每次讀檔）──
let _skillMd = null;
let _providerConfig = null;
let _knowledgeBase = null;
let _toolDeps = null; // { tools, handlers, ToolEngine }

async function getCachedSkill() {
  if (!_skillMd) {
    try { _skillMd = await readFile(HELPDESK_SKILL, "utf-8"); } catch { _skillMd = ""; }
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
    try { _knowledgeBase = await readFile(KNOWLEDGE_FILE, "utf-8"); } catch { _knowledgeBase = ""; }
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

// Hot-reload hook: call this to clear caches
export async function reloadHelpDeskCache() {
  _skillMd = null;
  _providerConfig = null;
  _knowledgeBase = null;
  _toolDeps = null;
}

// ── Task Persistence (shared with A2A) ──
const TASKS_DIR = resolve(DATA_DIR, "a2a-tasks");
const taskStore = new JsonTaskPersistence(TASKS_DIR);

async function loadTickets() {
  try {
    const raw = await readFile(HELPDESK_DATA, "utf-8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function saveTickets(tickets) {
  await writeFile(HELPDESK_DATA, JSON.stringify(tickets, null, 2), "utf-8");
}

const NEED_INFO_REGEX = /\[NEED_INFO:?\]?\s*(.+)/s;

/**
 * Run the help-desk skill via ToolEngine.
 * @param {Array<{role: string, content: string}>} conversation - Full conversation history
 * @returns {Promise<{text: string, toolsUsed: string[], needsInfo: string|null}>}
 */
async function runHelpDeskSkill(conversation, modelOverride, options = {}) {
  const skillMd = await readFile(HELPDESK_SKILL, "utf-8");

  const providerConfig = JSON.parse(await readFile(resolve(CONFIG_DIR, "providers.json"), "utf-8"));
  const providerId = providerConfig.active;
  const provider = providerConfig.providers[providerId];
  if (!provider?.apiKey || provider.apiKey === "na") {
    throw new Error(`No API key for provider: ${providerId}`);
  }
  const model = modelOverride || resolveDefaultModel(providerConfig);

  // Use cached tools
  const { ToolEngine, executors } = await getCachedTools();

  // Load task memory if available
  let memoryContext = "";
  if (taskId && tStore) {
    const task = await tStore.load(taskId);
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
    sessionKey: "helpdesk",
    agentId: "helpdesk-skill",
  });

  // Inject shared registry tools
  const { injectRegistryTools } = await import("../lib/tool-registry-init.mjs");
  injectRegistryTools(engine, { cwd: DATA_DIR, rootDir: DATA_DIR, agentId: "helpdesk-skill" });

    // knowledgeBase already loaded via cache

  const systemPrompt = `${skillMd}

---

## Knowledge Base（即時參考）

${knowledgeBase}
${memoryContext}
---

你是 PAAW HelpDesk。請根據上面的 Skill 定義和 Knowledge Base 回答問題。
使用 file_read 和 file_list 工具搜尋 knowledge workspace 獲取更詳細的資訊。
回答用繁體中文，技術術語保留英文。

## 重要：工具使用紀律

- 最多讀 3-4 個知識庫檔案，不要讀完所有檔案
- 讀完檔案後**直接產出完整答案**，不要說「讓我再看看」
- 如果知識庫已有足夠資訊，立即回答，不要繼續搜尋
- 回答必須是完整的、結構化的內容，不要只給前言

## 互動規則

如果你需要更多資訊才能回答（例如問題太模糊、需要知道具體的使用情境等），
請在回答的**最開頭**加上：

[NEED_INFO: 你想問的釐清問題]

然後系統會把你的問題轉給提問者，拿到補充資訊後再繼續。
不要在 [NEED_INFO:] 之後加其他內容，只輸出釐清問題本身。
一個 [NEED_INFO:] 只能問一個問題。`;

  let fullText = "";
  let toolsUsed = [];

  for await (const chunk of engine.run(systemPrompt, conversation, model)) {
    switch (chunk.type) {
      case "text":
        fullText += chunk.delta;
        break;
      case "tool_start":
        toolsUsed.push(chunk.name);
        // Persist event (await, not fire-and-forget)
        if (taskId && tStore) {
          await tStore.appendEvent(taskId, { type: "tool_call", name: chunk.name });
        }
        break;
    }
  }

  // ── Fallback: force summary if ToolEngine exhausted rounds without producing text ──
  if (fullText.trim().length < 100 && toolsUsed.length > 0) {
    console.log(`[HelpDesk] Text too short (${fullText.length} chars), forcing summary call`);
    const data = await callLLMWithRetry(`${provider.baseURL.replace(/\/+$/, "")}/chat/completions`, {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.apiKey}`,
      ...(providerId === "openrouter" ? { "HTTP-Referer": "https://paaw.ai", "X-Title": "PAAW" } : {}),
    }, { model, messages: [{ role: "system", content: systemPrompt }, ...conversation, { role: "user", content: "剛才你讀了知識庫檔案。現在請直接根據你讀到的內容，用繁體中文完整回答使用者的問題。不要使用任何工具，直接輸出答案。" }], temperature: 0.3 }, {
      maxRetries: 2,
      timeoutMs: 120_000,
      caller: "helpdesk",
      agentId: "helpdesk",
      disableThinking: true, // 強制摘要=結構化回答，thinking 燒額度風險（2026-08-30）
    });
    fullText = data.content || fullText;
    console.log(`[HelpDesk] Summary call result: ${fullText.length} chars`);
  }

  // Check if AI wants more info
  const needMatch = fullText.match(NEED_INFO_REGEX);
  let needsInfo = needMatch ? needMatch[1].trim() : null;
  // Strip trailing ] from malformed markers
  if (needsInfo && needsInfo.endsWith(']')) needsInfo = needsInfo.slice(0, -1).trim();
  // Clean text: if NEED_INFO found, strip the marker from the stored text
  const cleanText = needsInfo ? fullText.replace(NEED_INFO_REGEX, "").replace(/\]$/, "").trim() : fullText;

  return { text: cleanText || fullText, toolsUsed, needsInfo };
}

export default async function helpdeskRoute(req, res) {
  const url = req.url?.split("?")[0];
  const method = req.method;

  // ── POST /api/helpdesk/ask — Submit question (new or follow-up) ──
  if (method === "POST" && url === "/api/helpdesk/ask") {
    const body = JSON.parse(await readBody(req));
    const { agentName, agentType, subject, message, priority, tags, ticketId, model: modelOverride } = body;

    if (!agentName || !message) {
      json(res, 400, { error: "agentName and message are required" });
      return true;
    }

    const tickets = await loadTickets();

    // ── Case A: Follow-up on existing ticket (multi-turn) ──
    if (ticketId) {
      const ticket = tickets.find(t => t.ticketId === ticketId);
      if (!ticket) {
        json(res, 404, { error: `Ticket ${ticketId} not found` });
        return true;
      }

      // Add user follow-up message
      ticket.messages.push({
        id: `msg_${Date.now()}`,
        role: "user",
        text: message,
        ts: Date.now(),
      });
      ticket.status = "working";
      ticket.updatedAt = new Date().toISOString();

      console.log(`[HelpDesk] Ticket ${ticketId} follow-up: "${message.slice(0, 80)}"`);

      // Build conversation from ticket history (with smart truncation)
      const rawConversation = ticket.messages
        .filter(m => m.role === "user" || m.role === "agent")
        .map(m => ({ role: m.role === "agent" ? "assistant" : "user", content: m.text }));
      // Limit history to recent turns + truncate any oversized content
      const conversation = limitHistoryTurns(rawConversation, 8);

      try {
        const result = await runHelpDeskSkill(conversation, modelOverride, { taskStore });

        if (result.needsInfo) {
          // Still needs more info
          ticket.status = "input-required";
          ticket.messages.push({
            id: `msg_${Date.now()}`,
            role: "agent",
            text: result.needsInfo,
            ts: Date.now(),
          });
          await saveTickets(tickets);

          console.log(`[HelpDesk] Ticket ${ticketId} needs info: "${result.needsInfo.slice(0, 80)}"`);

          json(res, 200, {
            ok: true,
            ticketId: ticket.ticketId,
            status: "input-required",
            question: result.needsInfo,
            answer: null,
            round: ticket.messages.filter(m => m.role === "user").length,
          });
        } else {
          // Final answer
          ticket.status = "answered";
          ticket.messages.push({
            id: `msg_${Date.now()}`,
            role: "agent",
            text: result.text,
            ts: Date.now(),
          });
          ticket.updatedAt = new Date().toISOString();
          await saveTickets(tickets);

          console.log(`[HelpDesk] Ticket ${ticketId} answered (round ${ticket.messages.filter(m => m.role === "user").length}, ${result.text.length} chars)`);

          json(res, 200, {
            ok: true,
            ticketId: ticket.ticketId,
            status: "answered",
            answer: result.text,
            toolsUsed: result.toolsUsed,
            round: ticket.messages.filter(m => m.role === "user").length,
          });
        }
      } catch (err) {
        console.error(`[HelpDesk] Skill execution failed:`, err.message);
        ticket.status = "open";
        await saveTickets(tickets);
        json(res, 200, {
          ok: true, ticketId: ticket.ticketId, status: "open", answer: null,
          error: `自動回答失敗：${err.message}`,
        });
      }
      return true;
    }

    // ── Case B: New ticket ──
    const now = new Date().toISOString();
    const ticket = {
      ticketId: `TKT-${Date.now()}`,
      agentName,
      agentType: agentType || "custom",
      subject: subject || message.slice(0, 50),
      status: "working",
      priority: priority || "medium",
      messages: [{
        id: `msg_${Date.now()}`,
        role: "user",
        text: message,
        ts: Date.now(),
      }],
      tags: tags || [],
      createdAt: now,
      updatedAt: now,
    };

    tickets.unshift(ticket);
    await saveTickets(tickets);

    console.log(`[HelpDesk] Ticket ${ticket.ticketId} created: "${message.slice(0, 80)}"`);

    try {
      const conversation = [{ role: "user", content: message }];
      const result = await runHelpDeskSkill(conversation, modelOverride, { taskStore });

      if (result.needsInfo) {
        // Need more info before answering
        ticket.status = "input-required";
        ticket.messages.push({
          id: `msg_${Date.now()}`,
          role: "agent",
          text: result.needsInfo,
          ts: Date.now(),
        });
        ticket.updatedAt = new Date().toISOString();
        await saveTickets(tickets);

        console.log(`[HelpDesk] Ticket ${ticket.ticketId} needs info: "${result.needsInfo.slice(0, 80)}"`);

        json(res, 200, {
          ok: true,
          ticketId: ticket.ticketId,
          status: "input-required",
          question: result.needsInfo,
          answer: null,
          round: 1,
        });
      } else {
        // Answered directly
        ticket.status = "answered";
        ticket.messages.push({
          id: `msg_${Date.now()}`,
          role: "agent",
          text: result.text,
          ts: Date.now(),
        });
        ticket.updatedAt = new Date().toISOString();
        await saveTickets(tickets);

        console.log(`[HelpDesk] Ticket ${ticket.ticketId} answered (${result.text.length} chars, tools: ${result.toolsUsed.join(",")})`);

        json(res, 200, {
          ok: true,
          ticketId: ticket.ticketId,
          status: "answered",
          answer: result.text,
          toolsUsed: result.toolsUsed,
          round: 1,
        });
      }
    } catch (err) {
      console.error(`[HelpDesk] Skill execution failed:`, err.message);
      ticket.status = "open";
      ticket.messages.push({
        id: `msg_${Date.now()}`,
        role: "system",
        text: `[自動回答失敗：${err.message}]`,
        ts: Date.now(),
      });
      ticket.updatedAt = new Date().toISOString();
      await saveTickets(tickets);

      json(res, 200, {
        ok: true, ticketId: ticket.ticketId, status: "open", answer: null,
        error: `自動回答失敗：${err.message}`,
        message: "問題已記錄，將由人工回覆",
      });
    }
    return true;
  }

  // ── GET /api/helpdesk/tickets ──
  if (method === "GET" && url === "/api/helpdesk/tickets") {
    const tickets = await loadTickets();
    json(res, 200, { tickets, total: tickets.length });
    return true;
  }

  // ── PUT /api/helpdesk/tickets ──
  if (method === "PUT" && url === "/api/helpdesk/tickets") {
    const body = JSON.parse(await readBody(req));
    if (!Array.isArray(body)) {
      json(res, 400, { error: "Expected array of tickets" });
      return true;
    }
    await saveTickets(body);
    json(res, 200, { ok: true, count: body.length });
    return true;
  }

  // ── GET /api/helpdesk/ticket/:id ──
  {
    const m = method === "GET" && url?.match(/^\/api\/helpdesk\/ticket\/([\w.-]+)$/);
    if (m) {
      const tickets = await loadTickets();
      const ticket = tickets.find(t => t.ticketId === m[1]);
      if (!ticket) { json(res, 404, { error: "Ticket not found" }); return true; }
      json(res, 200, ticket);
      return true;
    }
  }

  // ── POST /api/helpdesk/ticket/:id/reply ──
  {
    const m = method === "POST" && url?.match(/^\/api\/helpdesk\/ticket\/([\w.-]+)\/reply$/);
    if (m) {
      const body = JSON.parse(await readBody(req));
      const { message } = body;
      if (!message) { json(res, 400, { error: "message is required" }); return true; }

      const tickets = await loadTickets();
      const ticket = tickets.find(t => t.ticketId === m[1]);
      if (!ticket) { json(res, 404, { error: "Ticket not found" }); return true; }

      ticket.messages.push({ id: `msg_${Date.now()}`, role: "user", text: message, ts: Date.now() });
      ticket.status = "open";
      ticket.updatedAt = new Date().toISOString();
      await saveTickets(tickets);
      json(res, 200, { ok: true, message: "補充訊息已加入" });
      return true;
    }
  }

  // ── GET /api/helpdesk/knowledge ──
  if (method === "GET" && url === "/api/helpdesk/knowledge") {
    try {
      const md = await readFile(KNOWLEDGE_FILE, "utf-8");
      json(res, 200, { knowledge: md });
    } catch { json(res, 404, { error: "Knowledge base not found" }); }
    return true;
  }

  // ── GET /api/helpdesk/models ──
  if (method === "GET" && url === "/api/helpdesk/models") {
    try {
      const cfg = JSON.parse(await readFile(resolve(CONFIG_DIR, "providers.json"), "utf-8"));
      const models = [];
      for (const [pid, p] of Object.entries(cfg.providers || {})) {
        for (const m of (p.models || [])) {
          models.push({ id: m.id, name: m.name, provider: pid, providerName: p.name });
        }
      }
      json(res, 200, { active: cfg.active, defaultModel: cfg.defaultModel, models });
    } catch { json(res, 500, { error: "Failed to load providers" }); }
    return true;
  }

  return false;
}
