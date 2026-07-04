/**
 * PAAW HelpDesk API — 讓其他 Agent 可以透過 API 提問
 *
 * POST /api/helpdesk/ask     — 外部 Agent 提交問題
 * GET  /api/helpdesk/tickets — 列出所有票
 * GET  /api/helpdesk/ticket/:id — 查詢單一票
 * POST /api/helpdesk/ticket/:id/reply — Agent 補充問題
 * GET  /api/helpdesk/knowledge — 取得 PAAW 知識庫
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { resolve, join, dirname } from "path";
import { fileURLToPath } from "url";
import { readBody, json } from "./shared.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = resolve(__dirname, "../../../data");
const HELPDESK_DATA = resolve(DATA_DIR, "app-data/paaw-helpdesk.json");
const KNOWLEDGE_FILE = resolve(DATA_DIR, "apps/paaw-helpdesk/KNOWLEDGE.md");

await mkdir(resolve(DATA_DIR, "app-data"), { recursive: true });

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

export default async function helpdeskRoute(req, res) {
  const url = req.url?.split("?")[0];
  const method = req.method;

  // ── POST /api/helpdesk/ask — Agent submits a question ──
  if (method === "POST" && url === "/api/helpdesk/ask") {
    const body = JSON.parse(await readBody(req));
    const { agentName, agentType, subject, message, priority, tags } = body;

    if (!agentName || !message) {
      json(res, 400, { error: "agentName and message are required" });
      return true;
    }

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

    json(res, 201, {
      ok: true,
      ticketId: ticket.ticketId,
      message: "問題已提交，PAAW 客服將會回覆",
    });
    return true;
  }

  // ── GET /api/helpdesk/tickets — List all tickets ──
  if (method === "GET" && url === "/api/helpdesk/tickets") {
    const tickets = await loadTickets();
    // Return summary (no full messages)
    const summary = tickets.map(t => ({
      ticketId: t.ticketId,
      agentName: t.agentName,
      agentType: t.agentType,
      subject: t.subject,
      status: t.status,
      priority: t.priority,
      messageCount: (t.messages || []).length,
      tags: t.tags || [],
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }));
    json(res, 200, { tickets: summary, total: summary.length });
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
