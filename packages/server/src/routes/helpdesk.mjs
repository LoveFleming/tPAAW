/**
 * PAAW HelpDesk API — 讓其他 Agent 可以透過 API 提問
 *
 * POST /api/helpdesk/ask     — 外部 Agent 提交問題（同步：建工單 → 跑 HelpDesk skill → 回傳答案）
 * GET  /api/helpdesk/tickets — 列出所有票
 * GET  /api/helpdesk/ticket/:id — 查詢單一票
 * POST /api/helpdesk/ticket/:id/reply — Agent 補充問題
 * GET  /api/helpdesk/knowledge — 取得 PAAW 知識庫
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readBody, json } from "./shared.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = resolve(__dirname, "../../../../data");
const HELPDESK_DATA = resolve(DATA_DIR, "helpdesk/tickets.json");
const KNOWLEDGE_FILE = resolve(DATA_DIR, "helpdesk/KNOWLEDGE.md");
const HELPDESK_SKILL = resolve(DATA_DIR, "skills/physical-skill/help-desk/SKILL.md");
const CONFIG_DIR = resolve(DATA_DIR, "config");

await mkdir(resolve(DATA_DIR, "helpdesk"), { recursive: true });

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

/**
 * Run the help-desk skill via ToolEngine to generate an answer.
 * Returns { text, toolsUsed } or throws on error.
 */
async function runHelpDeskSkill(question) {
  // Load SKILL.md
  const skillMd = await readFile(HELPDESK_SKILL, "utf-8");

  // Load provider config
  const providerConfig = JSON.parse(await readFile(resolve(CONFIG_DIR, "providers.json"), "utf-8"));
  const providerId = providerConfig.active;
  const provider = providerConfig.providers[providerId];
  if (!provider?.apiKey || provider.apiKey === "na") {
    throw new Error(`No API key for provider: ${providerId}`);
  }
  const model = providerConfig.defaultModel || "glm-5.1";

  const { ToolEngine } = await import("../lib/tool-engine/index.mjs");
  const { getToolsAndHandlers } = await import("../tools/index.mjs");

  // Load tools
  const { tools: toolDefs, handlers: toolHandlers } = await getToolsAndHandlers();
  const executors = Object.entries(toolHandlers).map(([name, handler]) => ({
    name,
    description: toolDefs.find(t => t.function.name === name)?.function?.description || name,
    parameters: toolDefs.find(t => t.function.name === name)?.function?.parameters || { type: "object", properties: {} },
    execute: async (args) => handler(args),
  }));

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
    maxToolRounds: 10,
    security: {
      approval: { mode: "auto" },
      audit: { enabled: false },
    },
    sessionKey: "helpdesk",
    agentId: "helpdesk-skill",
  });

  // Build system prompt from SKILL.md + knowledge
  let knowledgeBase = "";
  try {
    knowledgeBase = await readFile(KNOWLEDGE_FILE, "utf-8");
  } catch { /* no knowledge file */ }

  const systemPrompt = `${skillMd}

---

## Knowledge Base（即時參考）

${knowledgeBase}

---

你是 PAAW HelpDesk。請根據上面的 Skill 定義和 Knowledge Base 回答問題。
使用 file_read 和 file_list 工具搜尋 knowledge workspace 獲取更詳細的資訊。
回答用繁體中文，技術術語保留英文。`;

  const messages = [{ role: "user", content: question }];

  let fullText = "";
  let toolsUsed = [];

  for await (const chunk of engine.run(systemPrompt, messages, model)) {
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

export default async function helpdeskRoute(req, res) {
  const url = req.url?.split("?")[0];
  const method = req.method;

  // ── POST /api/helpdesk/ask — Agent submits a question (returns answer) ──
  if (method === "POST" && url === "/api/helpdesk/ask") {
    const body = JSON.parse(await readBody(req));
    const { agentName, agentType, subject, message, priority, tags } = body;

    if (!agentName || !message) {
      json(res, 400, { error: "agentName and message are required" });
      return true;
    }

    // 1. Create ticket
    const tickets = await loadTickets();
    const now = new Date().toISOString();
    const ticket = {
      ticketId: `TKT-${Date.now()}`,
      agentName,
      agentType: agentType || "custom",
      subject: subject || message.slice(0, 50),
      status: "open",
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

    // 2. Run help-desk skill to generate answer
    try {
      const result = await runHelpDeskSkill(message);

      // 3. Update ticket with answer
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
      });
    } catch (err) {
      console.error(`[HelpDesk] Skill execution failed:`, err.message);

      // Update ticket with error
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
        ok: true,
        ticketId: ticket.ticketId,
        status: "open",
        answer: null,
        error: `自動回答失敗：${err.message}`,
        message: "問題已記錄，將由人工回覆",
      });
    }
    return true;
  }

  // ── GET /api/helpdesk/tickets — List all tickets (full data) ──
  if (method === "GET" && url === "/api/helpdesk/tickets") {
    const tickets = await loadTickets();
    json(res, 200, { tickets, total: tickets.length });
    return true;
  }

  // ── PUT /api/helpdesk/tickets — Batch save all tickets (for UI) ──
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

  // ── GET /api/helpdesk/ticket/:id — Get single ticket with messages ──
  {
    const m = method === "GET" && url?.match(/^\/api\/helpdesk\/ticket\/([\w.-]+)$/);
    if (m) {
      const ticketId = m[1];
      const tickets = await loadTickets();
      const ticket = tickets.find(t => t.ticketId === ticketId);
      if (!ticket) {
        json(res, 404, { error: "Ticket not found" });
        return true;
      }
      json(res, 200, ticket);
      return true;
    }
  }

  // ── POST /api/helpdesk/ticket/:id/reply — Agent adds follow-up ──
  {
    const m = method === "POST" && url?.match(/^\/api\/helpdesk\/ticket\/([\w.-]+)\/reply$/);
    if (m) {
      const ticketId = m[1];
      const body = JSON.parse(await readBody(req));
      const { message } = body;

      if (!message) {
        json(res, 400, { error: "message is required" });
        return true;
      }

      const tickets = await loadTickets();
      const ticket = tickets.find(t => t.ticketId === ticketId);
      if (!ticket) {
        json(res, 404, { error: "Ticket not found" });
        return true;
      }

      ticket.messages.push({
        id: `msg_${Date.now()}`,
        role: "user",
        text: message,
        ts: Date.now(),
      });
      ticket.status = "open"; // Reopen if was answered
      ticket.updatedAt = new Date().toISOString();
      await saveTickets(tickets);

      json(res, 200, { ok: true, message: "補充訊息已加入" });
      return true;
    }
  }

  // ── GET /api/helpdesk/knowledge — Get PAAW knowledge base ──
  if (method === "GET" && url === "/api/helpdesk/knowledge") {
    try {
      const md = await readFile(KNOWLEDGE_FILE, "utf-8");
      json(res, 200, { knowledge: md });
    } catch {
      json(res, 404, { error: "Knowledge base not found" });
    }
    return true;
  }

  return false; // Not handled
}
