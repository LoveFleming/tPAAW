/**
 * Project Route — .paaw/ project knowledge API
 *
 * Endpoints:
 *   GET    /api/coding-project/context?path=...        — Get full .paaw/ context
 *   POST   /api/coding-project/init?path=...           — Initialize .paaw/ directory
 *   POST   /api/coding-project/create                   — Create new project directory + .paaw/ init + git init
 *   GET    /api/coding-project/tree?path=...           — Get .paaw/ directory tree
 *   GET    /api/coding-project/sessions?path=...       — List sessions
 *   GET    /api/coding-project/sessions/:filename?path=... — Read specific session
 *   GET    /api/coding-project/standards?path=...      — List standards
 *   GET    /api/coding-project/standards/:name?path=...— Read standard
 *   PUT    /api/coding-project/standards/:name?path=...— Write standard
 *   GET    /api/coding-project/decisions?path=...      — Read decisions
 *   POST   /api/coding-project/decisions?path=...      — Add decision
 *   GET    /api/coding-project/changelog?path=...      — Read changelog
 *   GET    /api/coding-project/file?path=...&file=...  — Read any .paaw/ file
 *   PUT    /api/coding-project/file?path=...&file=...  — Write any .paaw/ file
 *   POST   /api/coding-project/generate-overview?path=... — Auto-generate PROJECT.md
 *
 * Crew Conversation Persistence:
 *   GET    /api/coding-crew/conversations?cwd=...              — List all crew conversations
 *   GET    /api/coding-crew/conversations/:crewId?cwd=...     — Load crew conversation
 *   POST   /api/coding-crew/conversations/:crewId?cwd=...     — Save crew conversation
 *   DELETE /api/coding-crew/conversations/:crewId?cwd=...     — Clear crew conversation
 *   POST   /api/coding-crew/context-window                    — Build optimized context window
 *
 * Crew Conversation Archiving:
 *   POST   /api/coding-crew/conversations/:crewId/archive?cwd=... — Archive current + start new
 *   GET    /api/coding-crew/conversations/:crewId/archives?cwd=... — List archived conversations
 *   GET    /api/coding-crew/conversations/:crewId/archives/:id?cwd=... — Load archived conversation
 */

import { readFile, writeFile, readdir, mkdir, unlink, appendFile } from "fs/promises";
import { existsSync, readFileSync as readSync } from "fs";
import { resolve, join, dirname } from "path";
import { fileURLToPath } from "url";
import { exec as execCb } from "child_process";
import { createPaawProject } from "../lib/paaw-project.mjs";
import { callLLMWithRetry } from "../lib/llm-utils.mjs";
import { normalizePath, readBody } from "./shared.mjs";
import { parseProject, formatForAI, formatCondensed } from "../lib/tree-sitter-parser.mjs";

// ── PAAW root directory (cross-platform safe) ──
// fileURLToPath handles Windows drive-letter URLs correctly,
// unlike new URL(import.meta.url).pathname which adds a leading /
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PAAW_ROOT = resolve(__dirname, "..", "..", "..", "..");

// Debug logger for Code Understanding — writes to .paaw/cu-debug.log
import { appendFileSync, existsSync as existsSyncSync } from "fs";
function cuLog(step, msg) {
  const line = `[${new Date().toISOString()}] [CU] step=${step} ${msg}\n`;
  console.log(line.trim());
  try { appendFileSync(join(PAAW_ROOT, ".paaw", "cu-debug.log"), line); } catch {}
}

// Shared agent rules
import { AGENT_RULES } from "../lib/agent-rules.mjs";
import { resolveDefaultModel } from "../lib/llm-utils.mjs";

// ── LLM Call Helper for project routes ──
// Resolves provider config and calls LLM with proper 4-arg signature
async function callProjectLLM(body, opts = {}) {
  // providers.json lives at {PAAW_ROOT}/data/config/providers.json
  // it resolves to the PAAW server root
  const providersFile = join(PAAW_ROOT, "data", "config", "providers.json");
  let providerConfig;
  try { providerConfig = JSON.parse(readSync(providersFile, "utf8")); } catch { return { content: null }; }
  const providerId = providerConfig.active || "zai";
  const model = body.model || resolveDefaultModel(providerConfig);
  const provider = providerConfig.providers[providerId];
  if (!provider?.apiKey || provider.apiKey === "na") { return { content: null }; }
  const apiUrl = `${provider.baseURL.replace(/\/+$/, "")}/chat/completions`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${provider.apiKey}`,
    ...(providerId === "openrouter" ? { "HTTP-Referer": "https://paaw.ai", "X-Title": "PAAW" } : {}),
  };
  const reqBody = {
    model,
    messages: body.messages,
    temperature: body.temperature ?? 0.3,
    max_tokens: body.maxTokens ?? 4000,
  };
  return callLLMWithRetry(apiUrl, headers, reqBody, {
    maxRetries: opts.maxRetries ?? 3,
    timeoutMs: opts.timeoutMs ?? 60_000,
    validateContent: true,
    sanitize: true,
  });
}

// ── Query parser ──

function parseQuery(url) {
  const u = new URL(url, "http://localhost");
  const params = {};
  u.searchParams.forEach((v, k) => { params[k] = v; });
  return params;
}

// ── Route Handler ──

export default async function projectRoute(req, res) {
  const method = req.method;
  const rawUrl = req.url || "";
  const url = rawUrl.split("?")[0];
  const q = parseQuery(rawUrl);

  // All routes start with /api/coding-project
  if (!url.startsWith("/api/coding-project") && !url.startsWith("/api/coding-crew")) return false;

  const projectPath = q.path;

  // ── GET /api/coding-crew/:crewId — Load crew definition (no project required) ──
  const crewMatch = url.match(/^\/api\/coding-crew\/([^/?]+)$/);
  if (crewMatch && method === "GET") {
    const crewId = decodeURIComponent(crewMatch[1]);
    const crewFile = join(PAAW_ROOT, "data", "crews", `${crewId}.json`);
    try {
      if (existsSync(crewFile)) {
        const crew = JSON.parse(readSync(crewFile, "utf-8"));
        // If crew has injectProjectContext and we have a project path, append .paaw/ context
        if (crew.injectProjectContext && projectPath) {
          const projRoot = resolve(projectPath);
          const projPaaw = createPaawProject(projRoot);
          const ctx = await projPaaw.loadContext();
          if (ctx) crew._projectContext = ctx;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(crew));
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Crew not found", crewId }));
      }
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // ── POST /api/coding-crew/chat — Chat via A2A domain agent dispatch ──
  if (url === "/api/coding-crew/chat" && method === "POST") {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return true;
    }
    const { crewId, message, model, cwd, context, conversationHistory } = body;
    if (!crewId || !message) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing crewId or message" }));
      return true;
    }

    // Resolve agentId from crewId
    const { getAgentByCrewId, buildSystemPrompt } = await import("../lib/domain-agent-registry.mjs");
    const { listActionLog, loadAgentMemory } = await import("../lib/action-log.mjs");
    const agent = getAgentByCrewId(crewId);
    if (!agent) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `No domain agent for crewId: ${crewId}` }));
      return true;
    }

    try {
      // Build system prompt from crew + context providers + action log + agent memory
      const actionLogText = (await listActionLog({ cwd, limit: 10 })).text;
      const agentMemoryText = await loadAgentMemory(agent.agentId, cwd);
      const systemPrompt = await buildSystemPrompt(agent.agentId, {
        cwd: cwd || undefined,
        clientContext: context || {},
      });

      // Inject action log and agent memory into system prompt
      const extraContext = [];
      if (actionLogText) extraContext.push(`\n## Recent Action Log (跨 Agent 交接紀錄)\n${actionLogText}`);
      if (agentMemoryText) extraContext.push(`\n## Your Long-term Memory (你的長期記憶)\n${agentMemoryText}`);
      // Inject feature map summary
      const featuresFile = join(projRoot, ".paaw", "features", "FEATURES.json");
      if (existsSync(featuresFile)) {
        try {
          const fData = JSON.parse(readSync(featuresFile, "utf-8"));
          const feats = fData.features || [];
          if (feats.length > 0) {
            const fLines = feats.map(f => {
              const p = [`- [${f.id}] ${f.name} (${f.status})`];
              if (f.description) p.push(`— ${f.description}`);
              const m = [];
              if (f.codeFiles?.length) m.push(`${f.codeFiles.length} code`);
              if (f.apis?.length) m.push(`${f.apis.length} APIs`);
              if (f.tests?.length) m.push(`${f.tests.length} tests`);
              if (m.length) p.push(`→ ${m.join(", ")}`);
              return p.join(" ");
            }).join("\n");
            // Build file→feature reverse index
            const fileMap = {};
            for (const f of feats) {
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
            extraContext.push(`\n## Feature Map (${feats.length} features)\nUse project_feature_detail for full info.\n${fLines}\n\n## File → Feature Index (${sortedFiles.length} files)\n${fileLines}`);
          }
        } catch {}
      }
      extraContext.push(AGENT_RULES);
      const fullSystemPrompt = systemPrompt + extraContext.join("");

      // Build messages array with conversation history
      const messages = [];
      if (fullSystemPrompt) messages.push({ role: "system", content: fullSystemPrompt });

      // Inject conversation history with smart context window management
      if (conversationHistory && Array.isArray(conversationHistory) && conversationHistory.length > 0) {
        // Filter: only user/assistant, skip thinking bubbles
        const cleanHistory = conversationHistory
          .filter(m => m.role === "user" || m.role === "assistant")
          .filter(m => !m._thinking)
          .map(m => ({ role: m.role, content: (m.content || "").replace(/^💭 /, "") }));

        // Smart context window: token budget management
        const estimateTokens = (text) => Math.ceil((text || "").length / 4);
        const systemPromptTokens = estimateTokens(fullSystemPrompt);
        const maxContextTokens = 12000; // GLM 5.1 context budget for history
        const responseReserve = 2000;
        const budget = maxContextTokens - systemPromptTokens - responseReserve;

        // Greedy fill from most recent backwards
        const selected = [];
        let usedTokens = 0;
        for (let i = cleanHistory.length - 1; i >= 0; i--) {
          const msgTokens = estimateTokens(cleanHistory[i].content);
          if (usedTokens + msgTokens > budget && selected.length > 0) break;
          selected.unshift(cleanHistory[i]);
          usedTokens += msgTokens;
        }

        // If messages were trimmed, add a compact summary
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

        console.log(`[CodingCrew:chat] context window: ${selected.length}/${cleanHistory.length} messages, ~${usedTokens} tokens${trimmedCount > 0 ? `, trimmed ${trimmedCount} with summary` : ""}`);
      }

      // Add current user message
      messages.push({ role: "user", content: message });

      // ── Dispatch Logging ──
      // Write full dispatch context to .paaw/coding-memory/dispatch-log.jsonl
      try {
        const logPath = join(cwd || PAAW_ROOT, ".paaw", "coding-memory", "dispatch-log.jsonl");
        const logEntry = {
          ts: new Date().toISOString(),
          agentId: agent.agentId,
          crewId,
          model: model || "default",
          systemPromptLength: fullSystemPrompt.length,
          systemPromptPreview: fullSystemPrompt.slice(0, 500),
          actionLogInjected: actionLogText ? actionLogText.slice(0, 300) : "(none)",
          agentMemoryInjected: agentMemoryText ? agentMemoryText.slice(0, 300) : "(none)",
          conversationHistoryCount: conversationHistory?.length || 0,
          cleanHistoryCount: conversationHistory?.filter(m => m.role === "user" || m.role === "assistant").filter(m => !m._thinking).length || 0,
          currentMessage: message,
          totalMessages: messages.length,
          messagesSummary: messages.map(m => ({ role: m.role, contentLength: m.content?.length || 0, preview: (m.content || "").slice(0, 120) })),
        };
        await appendFile(logPath, JSON.stringify(logEntry, null, 2) + "\n---\n");
      } catch (logErr) {
        console.error("[dispatch-log] write failed:", logErr.message);
      }

      // SSE streaming
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders();
      if (res.socket?.setNoDelay) res.socket.setNoDelay(true);

      const { runAgentLoopStream } = await import("../lib/paaw-agent-loop.mjs");
      await runAgentLoopStream({
        prompt: "", // handled by messages array
        systemPrompt: "", // handled by messages array
        messages, // pre-built with conversation history + action log + context
        model: model || undefined,
        cwd: cwd || undefined,
        maxTurns: agent.maxTurns,
        timeout: 1800,
        rootDir: cwd || PAAW_ROOT,
        agentId: agent.agentId,
      }, res);

      res.end();
      console.log(`[CodingCrew:chat] ${agent.agentId} stream completed`);
    } catch (err) {
      console.error(`[CodingCrew:chat] error:`, err);
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
        res.end();
      } else {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    }
    return true;
  }

  // ── Crew Conversation Persistence ──
  // GET /api/coding-crew/conversations?cwd=... — list all crew conversations
  if (url === "/api/coding-crew/conversations" && method === "GET") {
    const cwd = q.cwd || PAAW_ROOT;
    const convDir = join(cwd, ".paaw", "coding-memory", "conversations");
    try {
      if (!existsSync(convDir)) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ conversations: [] }));
        return true;
      }
      const files = await readdir(convDir);
      const conversations = [];
      for (const f of files.filter(f => f.endsWith(".json"))) {
        try {
          const data = JSON.parse(readSync(join(convDir, f), "utf-8"));
          conversations.push({
            crewId: f.replace(".json", ""),
            messageCount: Array.isArray(data) ? data.length : (data.messages?.length || 0),
            lastUpdated: data._meta?.lastUpdated || data[data.length - 1]?.ts || null,
            preview: (Array.isArray(data) ? data : data.messages || []).slice(-1)[0]?.content?.slice(0, 100) || "",
          });
        } catch {}
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ conversations }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // GET /api/coding-crew/conversations/:crewId?cwd=... — load crew conversation
  const convLoadMatch = url.match(/^\/api\/coding-crew\/conversations\/([^/?]+)(?:\?.*)?$/);
  if (convLoadMatch && method === "GET") {
    const crewId = decodeURIComponent(convLoadMatch[1]);
    const cwd = q.cwd || PAAW_ROOT;
    const convFile = join(cwd, ".paaw", "coding-memory", "conversations", `${crewId}.json`);
    try {
      if (existsSync(convFile)) {
        const data = JSON.parse(readSync(convFile, "utf-8"));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ messages: Array.isArray(data) ? data : (data.messages || []), crewId }));
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ messages: [], crewId }));
      }
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // POST /api/coding-crew/conversations/:crewId?cwd=... — save crew conversation
  if (convLoadMatch && method === "POST") {
    const crewId = decodeURIComponent(convLoadMatch[1]);
    const cwd = q.cwd || PAAW_ROOT;
    const convDir = join(cwd, ".paaw", "coding-memory", "conversations");
    const convFile = join(convDir, `${crewId}.json`);
    let body;
    try { body = JSON.parse(await readBody(req)); } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return true;
    }
    try {
      await mkdir(convDir, { recursive: true });
      // Store messages with metadata
      const payload = {
        _meta: {
          crewId,
          lastUpdated: new Date().toISOString(),
          messageCount: (body.messages || []).length,
        },
        messages: body.messages || [],
      };
      await writeFile(convFile, JSON.stringify(payload, null, 2), "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, crewId, messageCount: payload.messages.length }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // DELETE /api/coding-crew/conversations/:crewId?cwd=... — clear crew conversation
  if (convLoadMatch && method === "DELETE") {
    const crewId = decodeURIComponent(convLoadMatch[1]);
    const cwd = q.cwd || PAAW_ROOT;
    const convFile = join(cwd, ".paaw", "coding-memory", "conversations", `${crewId}.json`);
    try {
      if (existsSync(convFile)) { await unlink(convFile); }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, crewId }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // POST /api/coding-crew/conversations/:crewId/archive?cwd=... — archive current + start new
  const archiveMatch = url.match(/^\/api\/coding-crew\/conversations\/([^/]+)\/archive(?:\?.*)?$/);
  if (archiveMatch && method === "POST") {
    const crewId = decodeURIComponent(archiveMatch[1]);
    const cwd = q.cwd || PAAW_ROOT;
    const convDir = join(cwd, ".paaw", "coding-memory", "conversations");
    const convFile = join(convDir, `${crewId}.json`);
    const archiveDir = join(convDir, `${crewId}.archive`);
    try {
      // Read current conversation
      if (!existsSync(convFile)) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, crewId, archived: false, message: "No active conversation to archive" }));
        return true;
      }
      const data = JSON.parse(readSync(convFile, "utf-8"));
      const messages = Array.isArray(data) ? data : (data.messages || []);
      if (messages.length === 0) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, crewId, archived: false, message: "Empty conversation" }));
        return true;
      }
      // Generate archive id: timestamp + first user message preview
      const ts = new Date();
      const tsStr = ts.toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const firstUser = messages.find(m => m.role === "user");
      const preview = firstUser ? firstUser.content.slice(0, 40).replace(/[^\w\u4e00-\u9fff -]/g, "").trim() : "conversation";
      const archiveId = `${tsStr}-${preview}`;
      const archiveFile = join(archiveDir, `${archiveId}.json`);
      // Save archive
      await mkdir(archiveDir, { recursive: true });
      const archivePayload = {
        _meta: {
          crewId,
          archivedAt: ts.toISOString(),
          messageCount: messages.length,
          archiveId,
          title: firstUser ? firstUser.content.slice(0, 60) : "對話",
        },
        messages,
      };
      await writeFile(archiveFile, JSON.stringify(archivePayload, null, 2), "utf-8");
      // Clear current conversation
      await unlink(convFile);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, crewId, archived: true, archiveId, messageCount: messages.length }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // GET /api/coding-crew/conversations/:crewId/archives?cwd=... — list archived conversations
  const archivesListMatch = url.match(/^\/api\/coding-crew\/conversations\/([^/]+)\/archives(?:\?.*)?$/);
  if (archivesListMatch && method === "GET") {
    const crewId = decodeURIComponent(archivesListMatch[1]);
    const cwd = q.cwd || PAAW_ROOT;
    const archiveDir = join(cwd, ".paaw", "coding-memory", "conversations", `${crewId}.archive`);
    try {
      if (!existsSync(archiveDir)) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ archives: [] }));
        return true;
      }
      const files = await readdir(archiveDir);
      const archives = [];
      for (const f of files.filter(f => f.endsWith(".json"))) {
        try {
          const data = JSON.parse(readSync(join(archiveDir, f), "utf-8"));
          archives.push({
            archiveId: data._meta?.archiveId || f.replace(".json", ""),
            title: data._meta?.title || "對話",
            messageCount: data._meta?.messageCount || (data.messages?.length || 0),
            archivedAt: data._meta?.archivedAt || null,
          });
        } catch {}
      }
      archives.sort((a, b) => new Date(b.archivedAt) - new Date(a.archivedAt));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ archives }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // GET /api/coding-crew/conversations/:crewId/archives/:archiveId?cwd=... — load archived conversation
  const archiveLoadMatch = url.match(/^\/api\/coding-crew\/conversations\/([^/]+)\/archives\/([^?]+)/);
  if (archiveLoadMatch && method === "GET") {
    const crewId = decodeURIComponent(archiveLoadMatch[1]);
    const archiveId = decodeURIComponent(archiveLoadMatch[2]);
    const cwd = q.cwd || PAAW_ROOT;
    const archiveFile = join(cwd, ".paaw", "coding-memory", "conversations", `${crewId}.archive`, `${archiveId}.json`);
    try {
      if (!existsSync(archiveFile)) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Archive not found" }));
        return true;
      }
      const data = JSON.parse(readSync(archiveFile, "utf-8"));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        messages: data.messages || [],
        meta: data._meta || {},
        crewId,
        archiveId,
      }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // POST /api/coding-crew/context-window — build optimized context window
  // Body: { messages, maxTokens, systemPromptLength }
  // Returns: { messages, stats: { totalInput, trimmed, summaryCreated } }
  if (url === "/api/coding-crew/context-window" && method === "POST") {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return true;
    }
    const { messages = [], maxTokens = 8000, systemPromptLength = 0 } = body;
    
    // Filter: only user/assistant, skip thinking bubbles
    const clean = messages
      .filter(m => m.role === "user" || m.role === "assistant")
      .filter(m => !m._thinking)
      .map(m => ({ role: m.role, content: (m.content || "").replace(/^💭 /, "") }));
    
    // Rough token estimate: ~4 chars per token for mixed CJK/English
    const estimateTokens = (text) => Math.ceil((text || "").length / 4);
    
    // Reserve tokens for system prompt + current message + response
    const reservedTokens = systemPromptLength + 2000; // system + response budget
    const budget = maxTokens - reservedTokens;
    
    // Greedy fill from most recent backwards
    const selected = [];
    let usedTokens = 0;
    for (let i = clean.length - 1; i >= 0; i--) {
      const msgTokens = estimateTokens(clean[i].content);
      if (usedTokens + msgTokens > budget && selected.length > 0) break;
      selected.unshift(clean[i]);
      usedTokens += msgTokens;
    }
    
    // If we trimmed messages, create a summary of what was cut
    const trimmedCount = clean.length - selected.length;
    let summary = null;
    if (trimmedCount > 0) {
      const trimmedMessages = clean.slice(0, trimmedCount);
      // Build a compact summary of trimmed messages
      const summaryParts = trimmedMessages.map(m => {
        const role = m.role === "user" ? "👤" : "🤖";
        return `${role} ${m.content.slice(0, 150)}`;
      });
      summary = `[Earlier conversation summary (${trimmedCount} messages trimmed)]:\n${summaryParts.join("\n")}`;
    }
    
    const result = {
      messages: summary ? [{ role: "system", content: summary }, ...selected] : selected,
      stats: {
        totalInput: clean.length,
        included: selected.length,
        trimmed: trimmedCount,
        estimatedTokens: usedTokens + (summary ? estimateTokens(summary) : 0),
        summaryCreated: summary !== null,
      },
    };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
    return true;
  }

  // ── GET /api/coding-crew/action-log — Read action log ──
  if (url.startsWith("/api/coding-crew/action-log") && method === "GET") {
    const { listActionLog } = await import("../lib/action-log.mjs");
    const params = new URL(url, `http://localhost`).searchParams;
    const agent = params.get("agent") || undefined;
    const limit = parseInt(params.get("limit") || "20");
    const { entries, text } = await listActionLog({ cwd: projectPath || PAAW_ROOT, agent, limit });
    sendJSON(res, 200, { entries, text });
    return true;
  }

  // ── POST /api/coding-crew/em-run — Trigger EM orchestration (SSE) ──
  if (url === "/api/coding-crew/em-run" && method === "POST") {
    const body = await _readBody(req);
    const { cwd } = JSON.parse(body || "{}");
    const rootDir = cwd || projectPath || PAAW_ROOT;

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    if (res.socket?.setNoDelay) res.socket.setNoDelay(true);

    const sendSSE = (type, data) => {
      res.write(`event: ${type}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const { runEMSession } = await import("../lib/overnight-manager.mjs");
      sendSSE("start", { message: "🎖️ EM Session 啟動", ts: new Date().toISOString() });
      const { report, workList, results } = await runEMSession({ rootDir, sendSSE });
      sendSSE("complete", { workList, results, report });
    } catch (err) {
      console.error("[EM] error:", err);
      sendSSE("error", { message: err.message });
    }

    res.end();
    return true;
  }

  // ── GET /api/coding-crew/overnight-report — Get latest report ──
  if (url.startsWith("/api/coding-crew/overnight-report") && method === "GET") {
    const params = new URL(url, "http://localhost").searchParams;
    const date = params.get("date") || new Date().toISOString().slice(0, 10);
    const rootDir = projectPath || PAAW_ROOT;
    const reportPath = join(rootDir, ".paaw", "overnight-reports", `${date}.md`);
    if (!existsSync(reportPath)) {
      sendJSON(res, 200, { exists: false, report: null });
      return true;
    }
    const { readFile: rf } = await import("fs/promises");
    const report = await rf(reportPath, "utf-8");
    sendJSON(res, 200, { exists: true, report, date });
    return true;
  }

  if (!projectPath) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Missing 'path' query parameter" }));
    return true;
  }

  // Normalize path separators (Windows backslash → forward slash)
  const norm = normalizePath;
  const root = resolve(projectPath);
  const paaw = createPaawProject(root);

  try {
    // ── GET /api/coding-project/context ──
    if (url.startsWith("/api/coding-project/context") && method === "GET") {
      const ctx = await paaw.loadContext();
      if (!ctx) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: ".paaw/ not initialized", initialized: false }));
        return true;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ initialized: true, ...ctx }));
      return true;
    }

    // ── POST /api/coding-project/init ──
    if (url.startsWith("/api/coding-project/init") && !url.startsWith("/api/coding-project/initial") && method === "POST") {
      const result = await paaw.init();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
      return true;
    }

    // ── POST /api/coding-project/create — Create new project ──
    if (url.startsWith("/api/coding-project/create") && method === "POST") {
      const body = JSON.parse(await readBody(req) || "{}");
      const parentDir = body.parentDir;
      const projectName = (body.name || "").trim();
      const initGit = body.initGit !== false; // default true
      const initPaaw = body.initPaaw !== false; // default true

      if (!parentDir || !projectName) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing parentDir or name" }));
        return true;
      }

      // Validate project name (no path traversal)
      if (projectName.includes("/") || projectName.includes("\\") || projectName.includes("..")) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid project name" }));
        return true;
      }

      const projectDir = join(resolve(parentDir), projectName);

      // Check if already exists
      if (existsSync(projectDir)) {
        res.writeHead(409, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Directory already exists", path: norm(projectDir) }));
        return true;
      }

      // Create directory
      await mkdir(projectDir, { recursive: true });

      // Initialize .paaw/
      if (initPaaw) {
        const newPaaw = createPaawProject(projectDir);
        await newPaaw.init();
      }

      // Initialize git
      if (initGit) {
        try {
          await runShellCmd("git init", projectDir);
        } catch (e) {
          console.error("[project create] git init failed:", e.message);
        }
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, path: norm(projectDir), name: projectName }));
      return true;
    }

    // ── GET /api/coding-project/dev-config?path=... — Read dev-config.json ──
    if (url.startsWith("/api/coding-project/dev-config") && method === "GET") {
      const devConfigPath = join(root, ".paaw", "dev-config.json");
      if (existsSync(devConfigPath)) {
        try {
          const config = JSON.parse(readSync(devConfigPath, "utf-8"));
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(config));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        }
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({}));
      }
      return true;
    }

    // ── GET /api/coding-project/tree ──
    if (url.startsWith("/api/coding-project/tree") && method === "GET") {
      const tree = await paaw.listTree();
      if (!tree) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: ".paaw/ not initialized" }));
        return true;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(tree));
      return true;
    }

    // ── GET /api/coding-project/sessions/:filename ──
    const sessionMatch = url.match(/^\/api\/project\/sessions\/([^?]+)/);
    if (sessionMatch && method === "GET") {
      const content = await paaw.readSession(decodeURIComponent(sessionMatch[1]));
      if (content === null) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Session not found" }));
      } else {
        res.writeHead(200, { "Content-Type": "text/markdown" });
        res.end(content);
      }
      return true;
    }

    // ── GET /api/coding-project/sessions ──
    if (url.startsWith("/api/coding-project/sessions") && method === "GET") {
      const sessions = await paaw.listSessions();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(sessions));
      return true;
    }

    // ── GET /api/coding-project/standards ──
    if (url.startsWith("/api/coding-project/standards") && !url.match(/\/api\/project\/standards\/[^?]+/) && method === "GET") {
      const standards = await paaw.listStandards();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(standards));
      return true;
    }

    // ── GET/PUT /api/coding-project/standards/:name ──
    const stdMatch = url.match(/^\/api\/project\/standards\/([^?]+)/);
    if (stdMatch) {
      const name = decodeURIComponent(stdMatch[1]);
      if (method === "GET") {
        const content = await paaw.readStandard(name);
        if (content === null) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Standard not found" }));
        } else {
          res.writeHead(200, { "Content-Type": "text/markdown" });
          res.end(content);
        }
        return true;
      }
      if (method === "PUT") {
        const body = await readBody(req);
        const result = await paaw.writeStandard(name, body);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
        return true;
      }
    }

    // ── GET /api/coding-project/decisions ──
    if (url.startsWith("/api/coding-project/decisions") && method === "GET") {
      const content = await paaw.readFile("DECISIONS.md");
      res.writeHead(200, { "Content-Type": "text/markdown" });
      res.end(content || "");
      return true;
    }

    // ── POST /api/coding-project/decisions ──
    if (url.startsWith("/api/coding-project/decisions") && method === "POST") {
      const body = JSON.parse(await readBody(req));
      const result = await paaw.addDecision(body);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
      return true;
    }

    // ── GET /api/coding-project/changelog ──
    if (url.startsWith("/api/coding-project/changelog") && method === "GET") {
      const content = await paaw.readFile("CHANGELOG.md");
      res.writeHead(200, { "Content-Type": "text/markdown" });
      res.end(content || "");
      return true;
    }

    // ── GET /api/coding-project/file ──
    if (url.startsWith("/api/coding-project/file") && method === "GET" && q.file) {
      const content = await paaw.readFile(q.file);
      if (content === null) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "File not found" }));
      } else {
        res.writeHead(200, { "Content-Type": "text/markdown" });
        res.end(content);
      }
      return true;
    }

    // ── PUT /api/coding-project/file ──
    if (url.startsWith("/api/coding-project/file") && method === "PUT" && q.file) {
      const body = await readBody(req);
      const result = await paaw.writeFile(q.file, body);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
      return true;
    }

    // ── POST /api/coding-project/generate-overview ──
    if (url.startsWith("/api/coding-project/generate-overview") && method === "POST") {
      // Ensure .paaw/ exists first
      if (!paaw.exists) await paaw.init();
      const content = await paaw.generateProjectOverview();
      res.writeHead(200, { "Content-Type": "text/markdown" });
      res.end(content);
      return true;
    }

    // ── GET /api/coding-project/templates ──
    if (url.startsWith("/api/coding-project/templates") && method === "GET") {
      const templatesDir = join(PAAW_ROOT, "data", "templates", "standards");
      const templates = [];
      try {
        const entries = await readdir(templatesDir);
        for (const name of entries.filter(f => f.endsWith(".md")).sort()) {
          const content = await readFile(join(templatesDir, name), "utf-8");
          // Extract title from first heading
          const titleLine = content.split("\n").find(l => l.startsWith("# "));
          const title = titleLine ? titleLine.replace(/^#\s*/, "") : name.replace(".md", "");
          templates.push({ name, title, preview: content.slice(0, 200) });
        }
      } catch {}
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(templates));
      return true;
    }

    // ── GET /api/coding-project/templates/:name ──
    const tplMatch = url.match(/^\/api\/project\/templates\/([^?]+)/);
    if (tplMatch && method === "GET") {
      const templatesDir = join(PAAW_ROOT, "data", "templates", "standards");
      const name = decodeURIComponent(tplMatch[1]);
      const filePath = join(templatesDir, name);
      try {
        const content = await readFile(filePath, "utf-8");
        res.writeHead(200, { "Content-Type": "text/markdown" });
        res.end(content);
      } catch {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Template not found" }));
      }
      return true;
    }

    // ── POST /api/coding-project/import-template ──
    if (url.startsWith("/api/coding-project/import-template") && method === "POST") {
      const body = JSON.parse(await readBody(req));
      const templateName = body.template; // e.g. "typescript.md"
      const targetName = body.target || templateName; // save as
      if (!templateName) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing 'template' field" }));
        return true;
      }
      const templatesDir = join(PAAW_ROOT, "data", "templates", "standards");
      try {
        const content = await readFile(join(templatesDir, templateName), "utf-8");
        // Ensure .paaw/ exists
        if (!paaw.exists) await paaw.init();
        await paaw.writeStandard(targetName, content);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, name: targetName, size: content.length }));
      } catch {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Template not found" }));
      }
      return true;
    }

    // ── POST /api/coding-project/generate-standards ──
    // Uses LLM to analyze codebase and generate coding standards
    if (url.startsWith("/api/coding-project/generate-standards") && method === "POST") {
      if (!paaw.exists) await paaw.init();
      const generated = await generateStandardsFromCodebase(root);
      if (generated) {
        await paaw.writeStandard("auto-generated.md", generated);
      }
      res.writeHead(200, { "Content-Type": "text/markdown" });
      res.end(generated || "# Failed to generate standards");
      return true;
    }

    // ── GET /api/coding-project/all ──
    // Returns everything needed for the right-panel tabs in one call
    if (url.startsWith("/api/coding-project/all") && method === "GET") {
      if (!paaw.exists) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ initialized: false }));
        return true;
      }
      const [context, sessions, standards, decisions, changelog] = await Promise.all([
        paaw.loadContext(),
        paaw.listSessions(),
        paaw.listStandards(),
        paaw.readFile("DECISIONS.md"),
        paaw.readFile("CHANGELOG.md"),
      ]);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        initialized: true,
        context,
        sessions,
        standards,
        decisions,
        changelog,
      }));
      return true;
    }

    // ── GET /api/coding-project/health ──
    if (url.startsWith("/api/coding-project/health") && method === "GET") {
      const health = await collectProjectHealth(root, paaw);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(health));
      return true;
    }

    // ── Snapshot endpoints ──

    // POST /api/coding-project/snapshot — create manual snapshot
    if (url.startsWith("/api/coding-project/snapshot") && method === "POST" && !url.includes("/restore")) {
      const { PaawSnapshot } = await import("../lib/paaw-snapshot.mjs");
      const snap = new PaawSnapshot(root, paaw.paawDir);
      if (!paaw.exists) await paaw.init();
      const body = JSON.parse(await readBody(req) || "{}");
      const result = await snap.create(body.label || "manual");
      await snap.cleanup(50);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
      return true;
    }

    // GET /api/coding-project/snapshots — list snapshots
    if (url.startsWith("/api/coding-project/snapshots") && method === "GET") {
      const { PaawSnapshot } = await import("../lib/paaw-snapshot.mjs");
      const snap = new PaawSnapshot(root, paaw.paawDir);
      const list = await snap.list();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(list));
      return true;
    }

    // POST /api/coding-project/snapshot/restore — restore file from snapshot
    if (url.startsWith("/api/coding-project/snapshot/restore") && method === "POST") {
      const { PaawSnapshot } = await import("../lib/paaw-snapshot.mjs");
      const snap = new PaawSnapshot(root, paaw.paawDir);
      const body = JSON.parse(await readBody(req));
      const result = await snap.restoreFile(body.snapshot, body.file);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
      return true;
    }

    // ── Git tracking strategy ──

    // GET /api/coding-project/git-strategy — get .paaw gitignore status
    if (url.startsWith("/api/coding-project/git-strategy") && method === "GET") {
      const gitignorePath = join(root, ".gitignore");
      let paawTracked = true;
      let gitignoreContent = "";
      if (existsSync(gitignorePath)) {
        gitignoreContent = readSync(gitignorePath, "utf-8");
        paawTracked = !gitignoreContent.includes(".paaw/");
      }
      // Check if .paaw/ is already committed
      let committed = false;
      try {
        const check = await runShellCmd(`git ls-files .paaw/`, root, 5000);
        committed = check.trim().length > 0;
      } catch {}
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ paawTracked, committed, gitignoreHasPaaw: !paawTracked }));
      return true;
    }

    // PUT /api/coding-project/git-strategy — set strategy
    if (url.startsWith("/api/coding-project/git-strategy") && method === "PUT") {
      const body = JSON.parse(await readBody(req));
      const strategy = body.strategy; // "track" | "ignore" | "branch"
      const gitignorePath = join(root, ".gitignore");
      let gitignoreContent = existsSync(gitignorePath) ? readSync(gitignorePath, "utf-8") : "";

      if (strategy === "ignore") {
        if (!gitignoreContent.includes(".paaw/")) {
          gitignoreContent = gitignoreContent.trimEnd() + "\n# PAAW AI-Native IDE\n.paaw/\n";
          await writeFile(gitignorePath, gitignoreContent, "utf-8");
        }
      } else if (strategy === "track") {
        // Remove .paaw/ from gitignore if present
        gitignoreContent = gitignoreContent
          .replace(/^\.paaw\/$/gm, "")
          .replace(/^# PAAW AI-Native IDE$/gm, "")
          .replace(/\n{3,}/g, "\n\n");
        await writeFile(gitignorePath, gitignoreContent, "utf-8");
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, strategy }));
      return true;
    }

    // ── AI Initialize — multi-step project knowledge auto-fill ──

    // POST /api/coding-project/ai-initial-step — run a single Code Understanding step
    if (url.startsWith("/api/coding-project/ai-initial-step") && method === "POST") {
      const body = JSON.parse(await readBody(req));
      const stepId = body.step;
      const skipContext = body.skipContext === true; // if true, don't load accumulated context

      const ALL_STEPS = [
        { id: "scan", name: "🔍 掃描專案結構", promptFile: "scan-project.md" },
        { id: "architecture", name: "🏗️ 產出 Architecture Map", promptFile: "gen-architecture.md" },
        { id: "api-spec", name: "📡 產出 API Contract", promptFile: "gen-api-spec.md" },
        { id: "error-mapping", name: "🐛 產出 Error Map + Runbooks", promptFile: "gen-error-mapping.md" },
        { id: "decisions", name: "🏛️ 產出 Decision Records (ADR)", promptFile: "gen-decisions.md" },
        { id: "test-payload", name: "🧪 產出 Test Payloads", promptFile: "gen-test-payload.md" },
        { id: "standards", name: "📏 產出 Coding Standards", promptFile: "gen-standards.md" },
        { id: "faq", name: "🤖 產出 HelpDesk FAQ", promptFile: "gen-faq.md" },
        { id: "overview", name: "📊 產出 PROJECT.md", promptFile: "gen-overview.md" },
        { id: "feature-map", name: "🗺️ 產出 Feature Map", promptFile: "gen-feature-map.md" },
      ];
      const step = ALL_STEPS.find(s => s.id === stepId);
      if (!step) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `Unknown step: ${stepId}` }));
        return true;
      }

      // SSE stream
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });
      const sendEvent = (event, data) => { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };

      try {
        await paaw.init();

        // Gather project context
        let projectContext = `Project root: ${root}\n`;
        try {
          const pkg = JSON.parse(readSync(join(root, "package.json"), "utf-8"));
          projectContext += `Package: ${pkg.name || "unknown"}\nDependencies: ${Object.keys(pkg.dependencies || {}).join(", ")}\n`;
        } catch {}
        try {
          const treeOutput = await scanProjectFiles(root, 500);
          projectContext += `\nFile tree:\n${treeOutput}`;
        } catch {}
        try {
          const gitLog = await runShellCmd("git log --oneline -20", root);
          projectContext += `\nRecent git log:\n${gitLog}`;
        } catch {}

        // Load prompt
        const promptsDir = join(PAAW_ROOT, "data", "prompts", "code-understanding");
        const aiSettingsDir = join(PAAW_ROOT, "data", "ai-settings", "coding");
        const loadPrompt = (filename) => {
          // Priority: ai-settings/coding/ > prompts/code-understanding/
          try { return readSync(resolve(aiSettingsDir, filename), "utf-8"); } catch {}
          try { return readSync(resolve(promptsDir, filename), "utf-8"); } catch { return ""; }
        };
        const loadProjectPrompt = (filename) => {
          // Priority: .paaw/prompts/ > ai-settings/coding/ > prompts/code-understanding/
          const overridePath = join(root, ".paaw", "prompts", "code-understanding", filename);
          if (existsSync(overridePath)) { try { return readSync(overridePath, "utf-8"); } catch {} }
          return loadPrompt(filename);
        };

        sendEvent("step_start", { step: step.id, name: step.name });

        const promptTemplate = loadProjectPrompt(step.promptFile);
        if (!promptTemplate) {
          sendEvent("step_skip", { step: step.id, name: step.name, reason: "Prompt template not found" });
          sendEvent("done", { message: "Step skipped" });
          res.end();
          return true;
        }

          // Load accumulated context from existing .paaw/ files (unless skipContext)
        let fullPrompt = promptTemplate;
        fullPrompt += `\n\n--- PROJECT CONTEXT ---\n${projectContext}`;
        if (!skipContext) {
          const loadCtx = async (file, label, maxLen = 3000) => {
            try {
              const content = await paaw.readFile(file);
              if (content && content.trim()) {
                fullPrompt += `\n\n--- ${label} ---\n${content.slice(0, maxLen)}`;
              }
            } catch {}
          };
          // scan.json is always loaded as context for all steps (except scan itself)
          if (step.id !== "scan") {
            await loadCtx("scan.json", "SCAN RESULTS", 6000);
          }
          if (step.id !== "scan" && step.id !== "architecture") {
            await loadCtx("ARCHITECTURE.md", "ARCHITECTURE");
          }
          if (step.id === "test-payload" || step.id === "faq" || step.id === "overview" || step.id === "feature-map") {
            await loadCtx("specs/api-contract.md", "API SPEC");
          }
          if (step.id === "faq" || step.id === "overview" || step.id === "feature-map") {
            await loadCtx("specs/error-codes.md", "ERROR MAPPING");
          }
          if (step.id === "standards" || step.id === "faq" || step.id === "overview" || step.id === "feature-map") {
            await loadCtx("DECISIONS.md", "DECISIONS", 2000);
          }
        }

          // Tree-sitter source analysis for feature-map step
          if (step.id === "feature-map") {
            try {
              cuLog(step.id, "Running Tree-sitter source analysis...");
              const tsResult = await parseProject(root, PAAW_ROOT, { maxFiles: 500, maxBytes: 100_000 });
              cuLog(step.id, `Tree-sitter: ${tsResult.stats.parsedFiles}/${tsResult.stats.totalFiles} files parsed, ${tsResult.stats.errors} errors`);
              // Add condensed format (compact, fits in context window)
              const condensed = formatCondensed(tsResult);
              if (condensed) {
                fullPrompt += `\n\n--- SOURCE ANALYSIS (Tree-sitter) ---\n${condensed}`;
              }
              // Also save full analysis to .paaw/ for debugging
              const fullAnalysis = formatForAI(tsResult);
              await paaw.writeFile("features/tree-sitter-analysis.txt", fullAnalysis);
            } catch (tsErr) {
              cuLog(step.id, `Tree-sitter failed (non-fatal): ${tsErr.message}`);
            }
          }

        // Call LLM with longer timeout for single step
        try {
          const result = await callProjectLLM({
            messages: [{ role: "user", content: fullPrompt }],
            temperature: 0.2,
            maxTokens: step.id === "feature-map" ? 16000 : 4000,
          }, { timeoutMs: 600_000, maxRetries: 3 }); // 10 min timeout for single step

          const content = result.content || "";
          cuLog(step.id, `LLM response: contentLen=${content.length} finishReason=${result.finishReason} attempts=${result.attempts}`);
          if (!content.trim()) {
            sendEvent("step_error", { step: step.id, name: step.name, error: "Empty response from LLM" });
            sendEvent("done", { message: "Step failed" });
            res.end();
            return true;
          }

          // Save output to .paaw/
          try {
            if (step.id === "scan") {
              await paaw.writeFile("scan.json", content);
            } else if (step.id === "architecture") {
              await paaw.writeFile("ARCHITECTURE.md", content);
            } else if (step.id === "api-spec") {
              await paaw.writeFile("specs/api-contract.md", content);
            } else if (step.id === "error-mapping") {
              await paaw.writeFile("specs/error-codes.md", content);
              const runbookMatches = [...content.matchAll(/## Runbook[:\s]+(\d+).*?\n([\s\S]*?)(?=\n## Runbook|\n---|$)/g)];
              for (const rm of runbookMatches) {
                await paaw.writeFile(`runbook/${rm[1]}.md`, `# Runbook: ${rm[1]}\n\n${rm[2].trim()}`);
              }
            } else if (step.id === "decisions") {
              await paaw.writeFile("DECISIONS.md", content);
            } else if (step.id === "test-payload") {
              await paaw.writeFile("test-payloads/all-payloads.json", content);
              try {
                const payloads = JSON.parse(content);
                if (Array.isArray(payloads)) {
                  for (const p of payloads) {
                    const slug = (p.endpoint || p.name || "unknown").replace(/[^a-zA-Z0-9-]/g, "-");
                    await paaw.writeFile(`test-payloads/${slug}.json`, JSON.stringify(p, null, 2));
                  }
                }
              } catch {}
            } else if (step.id === "standards") {
              await paaw.writeFile("standards/coding-style.md", content);
            } else if (step.id === "faq") {
              await paaw.writeFile("helpdesk/faq.md", content);
            } else if (step.id === "overview") {
              await paaw.writeFile("PROJECT.md", content);
            } else if (step.id === "feature-map") {
              // Parse AI output as JSON array and write to FEATURES.json
              try {
                const cleanJson = content.replace(/^\s*```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();
                if (!cleanJson) throw new Error("AI 回應為空，無法產生 Feature Map");
                const features = JSON.parse(cleanJson);
                if (Array.isArray(features)) {
                  const featuresWithIds = features.map((f, i) => ({
                    ...f,
                    id: `F-${String(i + 1).padStart(3, "0")}`,
                    issues: [],
                    aiUnderstanding: "",
                    aiUnderstandingAt: null,
                    documentation: "",
                    docsUpdatedAt: null,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                  }));
                  const featuresDir = join(root, ".paaw", "features");
                  if (!existsSync(featuresDir)) await mkdir(featuresDir, { recursive: true });
                  await writeFile(join(featuresDir, "FEATURES.json"), JSON.stringify({ features: featuresWithIds, updatedAt: new Date().toISOString() }, null, 2), "utf-8");
                  // Generate file→features reverse mapping (FILE-FEATURES.json)
                  const fileFeatureMap = {};
                  for (const feat of featuresWithIds) {
                    const allFiles = [...(feat.codeFiles || []), ...(feat.tests || []), ...(feat.runbooks || [])];
                    for (const f of allFiles) {
                      const norm = f.replace(/\\/g, "/");
                      if (!fileFeatureMap[norm]) fileFeatureMap[norm] = [];
                      fileFeatureMap[norm].push({ id: feat.id, name: feat.name, tags: feat.tags || [] });
                    }
                    // Also map API files
                    for (const api of (feat.apis || [])) {
                      if (api.file) {
                        const norm = api.file.replace(/\\/g, "/");
                        if (!fileFeatureMap[norm]) fileFeatureMap[norm] = [];
                        if (!fileFeatureMap[norm].some(f => f.id === feat.id)) {
                          fileFeatureMap[norm].push({ id: feat.id, name: feat.name, tags: feat.tags || [] });
                        }
                      }
                    }
                  }
                  await writeFile(join(featuresDir, "FILE-FEATURES.json"), JSON.stringify({ files: fileFeatureMap, updatedAt: new Date().toISOString() }, null, 2), "utf-8");
                  cuLog(step.id, `Saved ${featuresWithIds.length} features + ${Object.keys(fileFeatureMap).length} file→feature mappings`);
                }
              } catch (parseErr) {
                cuLog(step.id, `Failed to parse feature JSON: ${parseErr.message}`);
                // Try recovery: find last complete object
                try {
                  const cleanJson = content.replace(/^\s*```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();
                  if (!cleanJson) throw new Error("empty content — cannot recover");
                  let lastComplete = 0, braceCount = 0, inStr = false, esc = false;
                  for (let i = 0; i < cleanJson.length; i++) {
                    const c = cleanJson[i];
                    if (esc) { esc = false; continue; }
                    if (c === '\\') { esc = true; continue; }
                    if (c === '"') { inStr = !inStr; continue; }
                    if (inStr) continue;
                    if (c === '{') braceCount++;
                    if (c === '}') { braceCount--; if (braceCount === 0) lastComplete = i; }
                  }
                  if (lastComplete === 0) throw new Error("no complete JSON object found");
                  const recovered = cleanJson.substring(0, lastComplete + 1).trim() + '\n]';
                  const feats = JSON.parse(recovered);
                  if (Array.isArray(feats) && feats.length > 0) {
                    const featuresWithIds = feats.map((f, i) => ({ ...f, id: `F-${String(i+1).padStart(3,"0")}`, issues: [], aiUnderstanding: "", aiUnderstandingAt: null, documentation: "", docsUpdatedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
                    const featuresDir = join(root, ".paaw", "features");
                    if (!existsSync(featuresDir)) await mkdir(featuresDir, { recursive: true });
                    await writeFile(join(featuresDir, "FEATURES.json"), JSON.stringify({ features: featuresWithIds, updatedAt: new Date().toISOString() }, null, 2), "utf-8");
                    // Generate file→features reverse mapping
                    const fileFeatureMap = {};
                    for (const feat of featuresWithIds) {
                      const allFiles = [...(feat.codeFiles || []), ...(feat.tests || []), ...(feat.runbooks || [])];
                      for (const f of allFiles) {
                        const norm = f.replace(/\\/g, "/");
                        if (!fileFeatureMap[norm]) fileFeatureMap[norm] = [];
                        fileFeatureMap[norm].push({ id: feat.id, name: feat.name, tags: feat.tags || [] });
                      }
                    }
                    await writeFile(join(featuresDir, "FILE-FEATURES.json"), JSON.stringify({ files: fileFeatureMap, updatedAt: new Date().toISOString() }, null, 2), "utf-8");
                    cuLog(step.id, `Recovery: saved ${featuresWithIds.length} features + ${Object.keys(fileFeatureMap).length} file→feature mappings`);
                  } else throw new Error("recovered array is empty");
                } catch (recoverErr) {
                  cuLog(step.id, `Recovery also failed: ${recoverErr.message}`);
                  await paaw.writeFile("features/raw-feature-map.txt", content);
                  sendEvent("step_error", { step: step.id, name: step.name, error: `Feature Map 產生失敗：AI 回應無法解析為 JSON。已儲存原始內容到 raw-feature-map.txt，請重新執行此步驟。(${parseErr.message})` });
                  // Don't continue to step_done — step failed
                  res.end();
                  return true;
                }
              }
            }
            cuLog(step.id, `wrote file OK (${content.length} chars)`);
          } catch (writeErr) {
            cuLog(step.id, `FAILED to write file: ${writeErr.message}`);
          }

          sendEvent("step_done", { step: step.id, name: step.name, size: content.length, preview: content.slice(0, 200) });
          cuLog(step.id, `sendEvent step_done (${content.length} chars)`);
        } catch (err) {
          sendEvent("step_error", { step: step.id, name: step.name, error: err.message });
        }
        sendEvent("done", { message: "Step complete" });
      } catch (err) {
        sendEvent("error", { error: err.message });
      }
      res.end();
      return true;
    }

    // POST /api/coding-project/ai-initial (Code Understanding)
    if (url.startsWith("/api/coding-project/ai-initial") && method === "POST") {
      const steps = [
        { id: "scan", name: "🔍 掃描專案結構", promptFile: "scan-project.md" },
        { id: "architecture", name: "🏗️ 產出 Architecture Map", promptFile: "gen-architecture.md" },
        { id: "api-spec", name: "📡 產出 API Contract", promptFile: "gen-api-spec.md" },
        { id: "error-mapping", name: "🐛 產出 Error Map + Runbooks", promptFile: "gen-error-mapping.md" },
        { id: "decisions", name: "🏛️ 產出 Decision Records (ADR)", promptFile: "gen-decisions.md" },
        { id: "test-payload", name: "🧪 產出 Test Payloads", promptFile: "gen-test-payload.md" },
        { id: "standards", name: "📏 產出 Coding Standards", promptFile: "gen-standards.md" },
        { id: "faq", name: "🤖 產出 HelpDesk FAQ", promptFile: "gen-faq.md" },
        { id: "overview", name: "📊 產出 PROJECT.md", promptFile: "gen-overview.md" },
        { id: "feature-map", name: "🗺️ 產出 Feature Map", promptFile: "gen-feature-map.md" },
      ];

      // SSE stream — send progress as each step completes
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });

      const sendEvent = (event, data) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      try {
        // Ensure .paaw/ exists
        await paaw.init();

        // Gather project info for context
        let projectContext = `Project root: ${root}\n`;
        try {
          const pkg = JSON.parse(readSync(join(root, "package.json"), "utf-8"));
          projectContext += `Package: ${pkg.name || "unknown"}\nDependencies: ${Object.keys(pkg.dependencies || {}).join(", ")}\n`;
        } catch {}

        // Get file tree
        try {
          const treeOutput = await scanProjectFiles(root, 500);
          projectContext += `\nFile tree:\n${treeOutput}`;
        } catch {}

        // Get recent git log
        try {
          const gitLog = await runShellCmd("git log --oneline -20", root);
          projectContext += `\nRecent git log:\n${gitLog}`;
        } catch {}

        // Load prompt templates
        const promptsDir = join(PAAW_ROOT, "data", "prompts", "code-understanding");
        const aiSettingsDir = join(PAAW_ROOT, "data", "ai-settings", "coding");
        const loadPrompt = (filename) => {
          // Priority: ai-settings/coding/ > prompts/code-understanding/
          try { return readSync(resolve(aiSettingsDir, filename), "utf-8"); } catch {}
          try { return readSync(resolve(promptsDir, filename), "utf-8"); } catch { return ""; }
        };

        // Check project-level overrides in .paaw/prompts/code-understanding/
        const loadProjectPrompt = (filename) => {
          // Priority: .paaw/prompts/ > ai-settings/coding/ > prompts/code-understanding/
          const overridePath = join(root, ".paaw", "prompts", "code-understanding", filename);
          if (existsSync(overridePath)) {
            try { return readSync(overridePath, "utf-8"); } catch {}
          }
          return loadPrompt(filename);
        };

        // Accumulate context from previous steps
        let scanResult = "";
        let architectureResult = "";
        let apiSpecResult = "";
        let errorMappingResult = "";
        let decisionsResult = "";

        for (const step of steps) {
          sendEvent("step_start", { step: step.id, name: step.name });

          const promptTemplate = loadProjectPrompt(step.promptFile);
          if (!promptTemplate) {
            sendEvent("step_skip", { step: step.id, name: step.name, reason: "Prompt template not found" });
            continue;
          }

          // Build full prompt with accumulated context
          let fullPrompt = promptTemplate;
          fullPrompt += `\n\n--- PROJECT CONTEXT ---\n${projectContext}`;
          if (scanResult) fullPrompt += `\n\n--- SCAN RESULTS ---\n${scanResult}`;
          if (architectureResult && (step.id === "decisions" || step.id === "api-spec" || step.id === "standards" || step.id === "faq" || step.id === "overview" || step.id === "feature-map")) {
            const archLimit = step.id === "feature-map" ? 8000 : 3000;
            fullPrompt += `\n\n--- ARCHITECTURE ---\n${architectureResult.slice(0, archLimit)}`;
          }
          if (apiSpecResult && (step.id === "test-payload" || step.id === "faq" || step.id === "overview" || step.id === "feature-map")) {
            fullPrompt += `\n\n--- API SPEC ---\n${apiSpecResult}`;
          }
          if (errorMappingResult && (step.id === "faq" || step.id === "overview" || step.id === "feature-map")) {
            fullPrompt += `\n\n--- ERROR MAPPING ---\n${errorMappingResult}`;
          }
          if (decisionsResult && (step.id === "standards" || step.id === "faq" || step.id === "overview" || step.id === "feature-map")) {
            fullPrompt += `\n\n--- DECISIONS ---\n${decisionsResult.slice(0, 2000)}`;
          }

          // Tree-sitter source analysis for feature-map step
          if (step.id === "feature-map") {
            try {
              cuLog(step.id, "Running Tree-sitter source analysis...");
              const tsResult = await parseProject(root, PAAW_ROOT, { maxFiles: 500, maxBytes: 100_000 });
              cuLog(step.id, `Tree-sitter: ${tsResult.stats.parsedFiles}/${tsResult.stats.totalFiles} files parsed, ${tsResult.stats.errors} errors`);
              const condensed = formatCondensed(tsResult);
              if (condensed) {
                fullPrompt += `\n\n--- SOURCE ANALYSIS (Tree-sitter) ---\n${condensed}`;
              }
              const fullAnalysis = formatForAI(tsResult);
              await paaw.writeFile("features/tree-sitter-analysis.txt", fullAnalysis);
            } catch (tsErr) {
              cuLog(step.id, `Tree-sitter failed (non-fatal): ${tsErr.message}`);
            }
          }

          // Call LLM
          try {
            const result = await callProjectLLM({
              messages: [{ role: "user", content: fullPrompt }],
              temperature: 0.2,
              maxTokens: step.id === "feature-map" ? 16000 : 4000,
            }, { timeoutMs: 600_000 }); // 10 min per step in bulk mode

            const content = result.content || "";

            // Store results
            try {
              if (step.id === "scan") {
                scanResult = content;
                await paaw.writeFile("scan.json", content);
              } else if (step.id === "architecture") {
                architectureResult = content;
                await paaw.writeFile("ARCHITECTURE.md", content);
              } else if (step.id === "api-spec") {
                apiSpecResult = content;
                await paaw.writeFile("specs/api-contract.md", content);
              } else if (step.id === "error-mapping") {
                errorMappingResult = content;
                await paaw.writeFile("specs/error-codes.md", content);
                const runbookMatches = [...content.matchAll(/## Runbook[:\s]+(\d+).*?\n([\s\S]*?)(?=\n## Runbook|\n---|$)/g)];
                for (const rm of runbookMatches) {
                  await paaw.writeFile(`runbook/${rm[1]}.md`, `# Runbook: ${rm[1]}\n\n${rm[2].trim()}`);
                }
              } else if (step.id === "decisions") {
                decisionsResult = content;
                await paaw.writeFile("DECISIONS.md", content);
              } else if (step.id === "test-payload") {
                await paaw.writeFile("test-payloads/all-payloads.json", content);
                try {
                  const payloads = JSON.parse(content);
                  if (Array.isArray(payloads)) {
                    for (const p of payloads) {
                      const slug = (p.endpoint || p.name || "unknown").replace(/[^a-zA-Z0-9-]/g, "-");
                      await paaw.writeFile(`test-payloads/${slug}.json`, JSON.stringify(p, null, 2));
                    }
                  } else if (payloads.endpoint) {
                    const slug = payloads.endpoint.replace(/[^a-zA-Z0-9-]/g, "-");
                    await paaw.writeFile(`test-payloads/${slug}.json`, JSON.stringify(payloads, null, 2));
                  }
                } catch {}
              } else if (step.id === "standards") {
                await paaw.writeFile("standards/coding-style.md", content);
              } else if (step.id === "faq") {
                await paaw.writeFile("helpdesk/faq.md", content);
              } else if (step.id === "overview") {
                await paaw.writeFile("PROJECT.md", content);
              } else if (step.id === "feature-map") {
                // Parse AI output as JSON array and write to FEATURES.json
                let featureMapOk = false;
                try {
                  const cleanJson = content.replace(/^\s*```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();
                  if (!cleanJson) throw new Error("AI 回應為空，無法產生 Feature Map");
                  const features = JSON.parse(cleanJson);
                  if (Array.isArray(features)) {
                    const featuresWithIds = features.map((f, i) => ({
                      ...f,
                      id: `F-${String(i + 1).padStart(3, "0")}`,
                      issues: [],
                      aiUnderstanding: "",
                      aiUnderstandingAt: null,
                      documentation: "",
                      docsUpdatedAt: null,
                      createdAt: new Date().toISOString(),
                      updatedAt: new Date().toISOString(),
                    }));
                    const featuresDir = join(root, ".paaw", "features");
                    if (!existsSync(featuresDir)) await mkdir(featuresDir, { recursive: true });
                    await writeFile(join(featuresDir, "FEATURES.json"), JSON.stringify({ features: featuresWithIds, updatedAt: new Date().toISOString() }, null, 2), "utf-8");
                    // Generate file→features reverse mapping
                    const fileFeatureMap = {};
                    for (const feat of featuresWithIds) {
                      const allFiles = [...(feat.codeFiles || []), ...(feat.tests || []), ...(feat.runbooks || [])];
                      for (const f of allFiles) {
                        const norm = f.replace(/\\/g, "/");
                        if (!fileFeatureMap[norm]) fileFeatureMap[norm] = [];
                        fileFeatureMap[norm].push({ id: feat.id, name: feat.name, tags: feat.tags || [] });
                      }
                      for (const api of (feat.apis || [])) {
                        if (api.file) {
                          const norm = api.file.replace(/\\/g, "/");
                          if (!fileFeatureMap[norm]) fileFeatureMap[norm] = [];
                          if (!fileFeatureMap[norm].some(f => f.id === feat.id)) {
                            fileFeatureMap[norm].push({ id: feat.id, name: feat.name, tags: feat.tags || [] });
                          }
                        }
                      }
                    }
                    await writeFile(join(featuresDir, "FILE-FEATURES.json"), JSON.stringify({ files: fileFeatureMap, updatedAt: new Date().toISOString() }, null, 2), "utf-8");
                    featureMapOk = true;
                    cuLog(step.id, `[bulk] Saved ${featuresWithIds.length} features + ${Object.keys(fileFeatureMap).length} file→feature mappings`);
                  }
                } catch (parseErr) {
                  cuLog(step.id, `[bulk] Failed to parse feature JSON: ${parseErr.message}`);
                  // Try recovery: find last complete object
                  try {
                    const cleanJson = content.replace(/^\s*```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();
                    if (!cleanJson) throw new Error("empty content — cannot recover");
                    let lastComplete = 0, braceCount = 0, inStr = false, esc = false;
                    for (let i = 0; i < cleanJson.length; i++) {
                      const c = cleanJson[i];
                      if (esc) { esc = false; continue; }
                      if (c === '\\') { esc = true; continue; }
                      if (c === '"') { inStr = !inStr; continue; }
                      if (inStr) continue;
                      if (c === '{') braceCount++;
                      if (c === '}') { braceCount--; if (braceCount === 0) lastComplete = i; }
                    }
                    if (lastComplete === 0) throw new Error("no complete JSON object found");
                    const recovered = cleanJson.substring(0, lastComplete + 1).trim() + '\n]';
                    const feats = JSON.parse(recovered);
                    if (Array.isArray(feats) && feats.length > 0) {
                      const featuresWithIds = feats.map((f, i) => ({ ...f, id: `F-${String(i+1).padStart(3,"0")}`, issues: [], aiUnderstanding: "", aiUnderstandingAt: null, documentation: "", docsUpdatedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
                      const featuresDir = join(root, ".paaw", "features");
                      if (!existsSync(featuresDir)) await mkdir(featuresDir, { recursive: true });
                      await writeFile(join(featuresDir, "FEATURES.json"), JSON.stringify({ features: featuresWithIds, updatedAt: new Date().toISOString() }, null, 2), "utf-8");
                      // Generate file→features reverse mapping
                      const fileFeatureMap = {};
                      for (const feat of featuresWithIds) {
                        const allFiles = [...(feat.codeFiles || []), ...(feat.tests || []), ...(feat.runbooks || [])];
                        for (const f of allFiles) {
                          const norm = f.replace(/\\/g, "/");
                          if (!fileFeatureMap[norm]) fileFeatureMap[norm] = [];
                          fileFeatureMap[norm].push({ id: feat.id, name: feat.name, tags: feat.tags || [] });
                        }
                      }
                      await writeFile(join(featuresDir, "FILE-FEATURES.json"), JSON.stringify({ files: fileFeatureMap, updatedAt: new Date().toISOString() }, null, 2), "utf-8");
                      cuLog(step.id, `[bulk] Recovery: saved ${featuresWithIds.length} features from truncated JSON`);
                      featureMapOk = true;
                    } else throw new Error("recovered array is empty");
                  } catch (recoverErr) {
                    cuLog(step.id, `[bulk] Recovery also failed: ${recoverErr.message}`);
                    await paaw.writeFile("features/raw-feature-map.txt", content);
                    failedSteps.push({ step: step.id, name: step.name, error: `Feature Map 產生失敗：${parseErr.message}` });
                  }
                }
                if (!featureMapOk) {
                  // Feature Map failed — send step_error instead of step_done
                  sendEvent("step_error", { step: step.id, name: step.name, error: `Feature Map 產生失敗：AI 回應無法解析為 JSON。已儲存原始內容到 raw-feature-map.txt，請重新執行此步驟。` });
                  // Skip step_done for this step
                  continue;
                }
              }
              cuLog(step.id, `[bulk] wrote file OK (${content.length} chars)`);
            } catch (writeErr) {
              cuLog(step.id, `[bulk] FAILED to write: ${writeErr.message}`);
            }

            sendEvent("step_done", {
              step: step.id,
              name: step.name,
              size: content.length,
              preview: content.slice(0, 200),
            });
          } catch (err) {
            sendEvent("step_error", { step: step.id, name: step.name, error: err.message });
          }
        }

        sendEvent("done", { message: "Code Understanding complete" });
      } catch (err) {
        sendEvent("error", { error: err.message });
      }

      res.end();
      return true;
    }

// ── Domain AI — specialized AI per area ──

    // POST /api/coding-project/domain-ai — run a domain AI
    if (url.startsWith("/api/coding-project/domain-ai") && method === "POST") {
      const { domain, prompt, history } = JSON.parse(await readBody(req));
      const validDomains = ["spec", "test", "bug", "docs", "maintain"];
      if (!validDomains.includes(domain)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `Invalid domain: ${domain}. Valid: ${validDomains.join(", ")}` }));
        return true;
      }

      // SSE stream
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });

      const sendEvent = (event, data) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      try {
        // Load domain system prompt
        const promptsBase = join(PAAW_ROOT, "data", "prompts");
        const domainPromptDir = join(promptsBase, `${domain}-ai`);
        const systemPromptFile = resolve(promptsBase, "domain-ai-system.md");
        let systemPrompt = "";
        try { systemPrompt = readSync(systemPromptFile, "utf-8"); } catch {}

        // Load all domain prompts
        let domainContext = "";
        try {
          const domainFiles = await readdir(domainPromptDir);
          for (const f of domainFiles.filter(f => f.endsWith(".md")).sort()) {
            domainContext += `\n--- ${f} ---\n${readSync(resolve(domainPromptDir, f), "utf-8")}`;
          }
        } catch {}

        // Check project-level overrides
        const projectPromptDir = join(root, ".paaw", "prompts", `${domain}-ai`);
        if (existsSync(projectPromptDir)) {
          try {
            const pFiles = await readdir(projectPromptDir);
            for (const f of pFiles.filter(f => f.endsWith(".md")).sort()) {
              domainContext += `\n--- PROJECT OVERRIDE: ${f} ---\n${readSync(resolve(projectPromptDir, f), "utf-8")}`;
            }
          } catch {}
        }

        // Load relevant .paaw/ context based on domain
        let paawContext = "";
        const domainPaawFiles = {
          spec: ["specs/api-contract.md", "specs/error-codes.md", "specs/node-contract.md", "specs/flow-spec.md"],
          test: ["specs/api-contract.md", "test-payloads/all-payloads.json"],
          bug: ["specs/error-codes.md", "DECISIONS.md"],
          docs: ["PROJECT.md", "helpdesk/faq.md", "CHANGELOG.md"],
          maintain: ["CODING-STANDARDS.md", "DECISIONS.md"],
        };
        for (const f of domainPaawFiles[domain] || []) {
          const content = await paaw.readFile(f);
          if (content) paawContext += `\n=== ${f} ===\n${content.slice(0, 3000)}\n`;
        }

        // Also load standards dir for maintain
        if (domain === "maintain") {
          const stdFiles = await paaw.listStandards();
          for (const sf of stdFiles) {
            const c = await paaw.readStandard(sf.name);
            if (c) paawContext += `\n=== standards/${sf.name} ===\n${c.slice(0, 1500)}\n`;
          }
        }

        // Load runbooks for bug
        if (domain === "bug") {
          const rbDir = join(paaw.paawDir, "runbook");
          if (existsSync(rbDir)) {
            try {
              const rbFiles = await readdir(rbDir);
              for (const rf of rbFiles.filter(f => f.endsWith(".md")).slice(0, 10)) {
                const c = await readFile(join(rbDir, rf), "utf-8");
                paawContext += `\n=== runbook/${rf} ===\n${c.slice(0, 1000)}\n`;
              }
            } catch {}
          }
        }

        // Build full system prompt
        const fullSystemPrompt = `${systemPrompt}\n\n## Your Domain: ${domain.toUpperCase()}\n${domainContext}\n\n## Project Knowledge\n${paawContext}`;

        // Build messages
        const messages = [{ role: "system", content: fullSystemPrompt }];
        // Add history
        if (Array.isArray(history)) {
          for (const m of history.slice(-10)) {
            messages.push({ role: m.role, content: m.content });
          }
        }
        messages.push({ role: "user", content: prompt });

        // Call LLM
        const result = await callProjectLLM({
          messages,
          temperature: 0.3,
          maxTokens: 4000,
        });

        sendEvent("done", { content: result.content || "" });
      } catch (err) {
        sendEvent("error", { error: err.message });
      }
      res.end();
      return true;
    }

    // GET /api/coding-project/status — Code Status Dashboard scores
    if (url.startsWith("/api/coding-project/status") && method === "GET") {
      try {
        const scores = await paaw.computeStatus();
        if (!scores) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ initialized: false, scores: null }));
        } else {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ initialized: true, scores }));
        }
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return true;
    }

    // POST /api/coding-project/ai-fix — targeted fix for a specific area
    if (url.startsWith("/api/coding-project/ai-fix") && method === "POST") {
      const { area } = JSON.parse(await readBody(req));
      const areaPrompts = {
        spec: ["scan-project.md", "gen-api-spec.md", "gen-error-mapping.md"],
        test: ["scan-project.md", "gen-test-payload.md"],
        bug: ["gen-error-mapping.md"],
        docs: ["gen-faq.md", "gen-overview.md"],
        maintain: ["gen-standards.md"],
      };
      const prompts = areaPrompts[area] || [];
      if (prompts.length === 0) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `Unknown area: ${area}` }));
        return true;
      }

      // SSE stream
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });

      const sendEvent = (event, data) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      try {
        await paaw.init();

        let projectContext = `Project root: ${root}\n`;
        try {
          const pkg = JSON.parse(readSync(join(root, "package.json"), "utf-8"));
          projectContext += `Package: ${pkg.name || "unknown"}\n`;
        } catch {}
        try {
          const treeOutput = await scanProjectFiles(root, 500);
          projectContext += `\nFile tree:\n${treeOutput}`;
        } catch {}

        const promptsDir = join(PAAW_ROOT, "data", "prompts", "code-understanding");
        const aiSettingsDir = join(PAAW_ROOT, "data", "ai-settings", "coding");
        const loadPrompt = (filename) => {
          const overridePath = join(root, ".paaw", "prompts", "code-understanding", filename);
          if (existsSync(overridePath)) {
            try { return readSync(overridePath, "utf-8"); } catch {}
          }
          try { return readSync(resolve(aiSettingsDir, filename), "utf-8"); } catch {}
          try { return readSync(resolve(promptsDir, filename), "utf-8"); } catch { return ""; }
        };

        // Load existing .paaw context for the fix
        const existingSpec = await paaw.readFile("specs/api-contract.md");
        const existingErrors = await paaw.readFile("specs/error-codes.md");

        for (const pf of prompts) {
          const stepName = pf.replace(/\.md$/, "");
          sendEvent("step_start", { step: stepName, name: `🔧 Fixing ${area}: ${stepName}` });

          const promptTemplate = loadPrompt(pf);
          if (!promptTemplate) {
            sendEvent("step_skip", { step: stepName, reason: "Prompt not found" });
            continue;
          }

          let fullPrompt = promptTemplate + `\n\n--- PROJECT CONTEXT ---\n${projectContext}`;
          if (existingSpec) fullPrompt += `\n\n--- EXISTING API SPEC ---\n${existingSpec}`;
          if (existingErrors) fullPrompt += `\n\n--- EXISTING ERROR MAPPING ---\n${existingErrors}`;
          fullPrompt += `\n\n--- INSTRUCTION ---\nOnly fill in gaps. Do not regenerate content that already exists and is correct.`;

          try {
            const result = await callProjectLLM({
              messages: [{ role: "user", content: fullPrompt }],
              temperature: 0.2,
              maxTokens: 4000,
            });
            const content = result.content || "";

            // Save based on prompt type
            if (pf.includes("api-spec")) await paaw.writeFile("specs/api-contract.md", content);
            else if (pf.includes("error-mapping")) {
              await paaw.writeFile("specs/error-codes.md", content);
              const runbookMatches = [...content.matchAll(/## Runbook[:\s]+(\d+).*?\n([\s\S]*?)(?=\n## Runbook|\n---|$)/g)];
              for (const rm of runbookMatches) {
                await paaw.writeFile(`runbook/${rm[1]}.md`, `# Runbook: ${rm[1]}\n\n${rm[2].trim()}`);
              }
            } else if (pf.includes("test-payload")) await paaw.writeFile("test-payloads/all-payloads.json", content);
            else if (pf.includes("standards")) await paaw.writeFile("standards/coding-style.md", content);
            else if (pf.includes("faq")) await paaw.writeFile("helpdesk/faq.md", content);
            else if (pf.includes("overview")) await paaw.writeFile("PROJECT.md", content);
            else if (pf.includes("scan")) { /* scan result used as context only */ }

            sendEvent("step_done", { step: stepName, size: content.length, preview: content.slice(0, 200) });
          } catch (err) {
            sendEvent("step_error", { step: stepName, error: err.message });
          }
        }

        // Recompute scores after fix
        const newScores = await paaw.computeStatus();
        sendEvent("done", { message: `${area} fix complete`, scores: newScores });
      } catch (err) {
        sendEvent("error", { error: err.message });
      }
      res.end();
      return true;
    }

    // GET /api/coding-project/prompts — list all AI Initial prompts
    if (url.startsWith("/api/coding-project/prompts") && method === "GET" && !url.includes("/prompts/")) {
      const promptsDir = join(PAAW_ROOT, "data", "prompts", "code-understanding");
      const projectPromptsDir = join(root, ".paaw", "prompts", "code-understanding");
      try {
        const files = existsSync(promptsDir) ? await readdir(promptsDir) : [];
        const prompts = [];
        for (const f of files.filter(f => f.endsWith(".md")).sort()) {
          const content = readSync(resolve(promptsDir, f), "utf-8");
          const hasOverride = existsSync(resolve(projectPromptsDir, f));
          let overrideContent = null;
          if (hasOverride) {
            try { overrideContent = readSync(resolve(projectPromptsDir, f), "utf-8"); } catch {}
          }
          prompts.push({
            filename: f,
            name: f.replace(/\.md$/, ""),
            defaultContent: content,
            customContent: overrideContent,
            activeContent: overrideContent || content,
            hasOverride,
            size: (overrideContent || content).length,
          });
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(prompts));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return true;
    }

    // GET /api/coding-project/prompts/:filename — read specific prompt
    if (url.match(/\/api\/coding-project\/prompts\/[\w-]+\.md$/) && method === "GET") {
      const filename = url.split("/prompts/").pop();
      const projectPromptsDir = join(root, ".paaw", "prompts", "code-understanding");
      const projectFile = resolve(projectPromptsDir, filename);
      if (existsSync(projectFile)) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ filename, content: readSync(projectFile, "utf-8"), source: "project" }));
      } else {
        const defaultDir = join(PAAW_ROOT, "data", "prompts", "code-understanding");
        const defaultFile = resolve(defaultDir, filename);
        if (existsSync(defaultFile)) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ filename, content: readSync(defaultFile, "utf-8"), source: "default" }));
        } else {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Prompt not found" }));
        }
      }
      return true;
    }

    // PUT /api/coding-project/prompts/:filename — save custom prompt
    if (url.match(/\/api\/coding-project\/prompts\/[\w-]+\.md$/) && method === "PUT") {
      const filename = url.split("/prompts/").pop();
      const { content } = JSON.parse(await readBody(req));
      if (!content) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing content" }));
        return true;
      }
      const projectPromptsDir = join(root, ".paaw", "prompts", "code-understanding");
      await mkdir(projectPromptsDir, { recursive: true });
      await writeFile(resolve(projectPromptsDir, filename), content, "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, filename, source: "project" }));
      return true;
    }

    // DELETE /api/coding-project/prompts/:filename — remove custom prompt (revert to default)
    if (url.match(/\/api\/coding-project\/prompts\/[\w-]+\.md$/) && method === "DELETE") {
      const filename = url.split("/prompts/").pop();
      const projectPromptsDir = join(root, ".paaw", "prompts", "code-understanding");
      const projectFile = resolve(projectPromptsDir, filename);
      if (existsSync(projectFile)) {
        try { await unlink(projectFile); } catch {}
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, filename, reverted: true }));
      return true;
    }

// ── Recent projects (multi-project) ──

    // GET /api/coding-project/recent — list recently opened projects
    if (url.startsWith("/api/coding-project/recent") && method === "GET") {
      const recentPath = join(PAAW_ROOT, "data", "config", "recent-projects.json");
      let recent = [];
      try {
        if (existsSync(recentPath)) recent = JSON.parse(readSync(recentPath, "utf-8"));
      } catch {}
      // Normalize paths for frontend
      recent = recent.map(r => ({ ...r, path: norm(r.path) }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(recent));
      return true;
    }

    // DELETE /api/coding-project/recent — remove a project from recent list
    if (url.startsWith("/api/coding-project/recent") && method === "DELETE") {
      const params = new URL(req.url, "http://localhost").searchParams;
      const removePath = params.get("path");
      const recentPath = join(PAAW_ROOT, "data", "config", "recent-projects.json");
      let recent = [];
      try {
        if (existsSync(recentPath)) recent = JSON.parse(readSync(recentPath, "utf-8"));
      } catch {}
      if (removePath) {
        recent = recent.filter(r => norm(r.path) !== removePath);
        await mkdir(dirname(recentPath), { recursive: true });
        await writeFile(recentPath, JSON.stringify(recent, null, 2), "utf-8");
      }
      // Normalize paths for frontend
      recent = recent.map(r => ({ ...r, path: norm(r.path) }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(recent));
      return true;
    }

    // POST /api/coding-project/recent — add/update recent project
    if (url.startsWith("/api/coding-project/recent") && method === "POST") {
      const body = JSON.parse(await readBody(req) || "{}");
      const recentPath = join(PAAW_ROOT, "data", "config", "recent-projects.json");
      let recent = [];
      try {
        if (existsSync(recentPath)) recent = JSON.parse(readSync(recentPath, "utf-8"));
      } catch {}

      // Add or update
      const path = norm(body.path || root);
      const name = body.name || path.split(/[\\/]/).pop();
      recent = recent.filter(r => r.path !== path);
      recent.unshift({ path, name, lastOpened: new Date().toISOString(), hasPaaw: existsSync(join(path, ".paaw")) });
      recent = recent.slice(0, 20); // keep last 20

      await mkdir(dirname(recentPath), { recursive: true });
      await writeFile(recentPath, JSON.stringify(recent, null, 2), "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(recent));
      return true;
    }

  } catch (err) {
    console.error("[project route] error:", err.message);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
    return true;
  }

  return false;
}

// ── Read request body ──

// ── readBody imported from shared.mjs ──

// ── Generate Standards from Codebase ──

async function generateStandardsFromCodebase(projectRoot) {
  // 1. Gather codebase info
  const samples = [];
  const root = projectRoot;

  // Read package.json
  try {
    const pkg = JSON.parse(readSync(join(root, "package.json"), "utf-8"));
    samples.push(`package.json scripts: ${JSON.stringify(pkg.scripts || {})}`);
    samples.push(`dependencies: ${Object.keys(pkg.dependencies || {}).join(", ")}`);
    samples.push(`devDependencies: ${Object.keys(pkg.devDependencies || {}).join(", ")}`);
  } catch {}

  // Read a few source files as samples
  const sourcePatterns = [
    "packages/server/src/lib/*.mjs",
    "packages/ui/src/pages/*.tsx",
    "packages/ui/src/components/*.tsx",
  ];

  for (const pattern of sourcePatterns) {
    try {
      const { glob } = await import("fs/promises");
      // Use readdir as fallback
      const dir = join(root, pattern.replace(/\/[^/]+$/, ""));
      const ext = pattern.match(/\*\.(.+)$/)?.[1] || "mjs";
      if (existsSync(dir)) {
        const files = await readdir(dir);
        const matching = files.filter(f => f.endsWith(`.${ext}`)).slice(0, 3);
        for (const f of matching) {
          const content = readSync(join(dir, f), "utf-8");
          samples.push(`--- ${f} (first 600 chars) ---\n${content.slice(0, 600)}`);
        }
      }
    } catch {}
  }

  if (samples.length === 0) return null;

  // 2. Build prompt
  const prompt = `Analyze the following codebase samples and generate a comprehensive Coding Standards document in Markdown format.
Focus on:
1. File naming conventions used
2. Code style (indentation, quotes, semicolons)
3. Error handling patterns
4. Export patterns (ESM vs CJS)
5. Framework-specific conventions (React, Node.js)
6. Any existing patterns that should be standardized

Codebase samples:

${samples.join("\n\n")}

Output ONLY the markdown document, starting with # Coding Standards (Auto-Generated).`;

  // 3. Call LLM
  try {
    const result = await callProjectLLM({
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      maxTokens: 2000,
    });
    return result.content || null;
  } catch (err) {
    console.error("[project route] generate-standards error:", err.message);
    return null;
  }
}

// ── Shell helper ──

function runShellCmd(command, cwd, timeoutMs = 10_000) {
  return new Promise((resolve) => {
    execCb(command, { cwd, timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024, shell: true,
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", TERM: "dumb" }
    }, (err, stdout, stderr) => {
      resolve((stdout || "") + (stderr ? "\n" + stderr : ""));
    });
  });
}

// ── Cross-platform file tree scan (Windows has no Unix 'find') ──
function scanProjectFiles(cwd, maxFiles = 200) {
  const isWin = process.platform === "win32";
  const cmd = isWin
    ? `node -e "const{readdirSync:r,statSync:s}=require('fs');const{join:j}=require('path');function walk(d,a){for(const e of r(d)){const p=j(d,e);try{if(s(p).isDirectory()){if(!e.includes('node_modules')&&!e.includes('dist')&&!e.startsWith('.'))walk(p,a)}else if(/\.(ts|tsx|mjs|js|jsx|json|md)$/.test(e))a.push(p.replace(/\\\\/g,'/'))}}catch{}}const f=[];walk('.',f);console.log(f.slice(0,${maxFiles}).join('\\n'))"`
    : "find . -type f -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/.paaw/*' -not -path '*/dist/*' -not -name '*.map' | head -" + maxFiles;
  return runShellCmd(cmd, cwd, 15_000);
}

// ── Collect Project Health ──

async function collectProjectHealth(root, paaw) {
  const health = {
    paawCompleteness: { initialized: paaw.exists, files: [], score: 0 },
    git: { branch: "", uncommitted: 0 },
    codeStats: { totalFiles: 0, totalLines: 0, languages: [] },
    sessions: { total: 0, recent: 0, successRate: 0 },
    dependencies: undefined,
  };

  // ── .paaw/ completeness ──
  const expectedFiles = ["PROJECT.md", "ARCHITECTURE.md", "DECISIONS.md", "CHANGELOG.md", "CODING-STANDARDS.md"];
  let existCount = 0;
  for (const f of expectedFiles) {
    const content = await paaw.readFile(f);
    const exists = content !== null;
    if (exists) existCount++;
    health.paawCompleteness.files.push({ name: f, exists, size: exists ? content.length : undefined });
  }
  // Check subdirs
  for (const d of ["sessions", "standards"]) {
    const dirPath = join(paaw.paawDir, d);
    const exists = existsSync(dirPath);
    if (exists) existCount++;
    health.paawCompleteness.files.push({ name: d + "/", exists });
  }
  health.paawCompleteness.score = Math.round((existCount / (expectedFiles.length + 2)) * 100);

  // ── Git health ──
  try {
    const branch = (await runShellCmd("git rev-parse --abbrev-ref HEAD", root, 3000)).trim();
    const status = await runShellCmd("git status --porcelain", root, 5000);
    const uncommitted = status.trim().split("\n").filter(Boolean).length;
    const logLine = (await runShellCmd("git log -1 --oneline --format=%h___%s___%cr", root, 3000)).trim();
    const remote = (await runShellCmd("git remote get-url origin", root, 3000)).trim();

    const [hash, ...rest] = logLine.split("___");
    const subject = rest[0] || "";
    const when = rest[1] || "";

    health.git = {
      branch,
      uncommitted,
      lastCommit: subject ? `${hash} ${subject}` : undefined,
      lastCommitDate: when || undefined,
      remote: remote || undefined,
    };
  } catch {}

  // ── Code stats ──
  try {
    const gitFiles = (await runShellCmd("git ls-files", root, 5000)).trim().split("\n").filter(Boolean);
    health.codeStats.totalFiles = gitFiles.length;

    // Count lines and languages
    const langCount = {};
    let totalLines = 0;
    const extMap = { ".js": "JavaScript", ".mjs": "JavaScript", ".ts": "TypeScript", ".tsx": "TypeScript", ".jsx": "JavaScript", ".css": "CSS", ".html": "HTML", ".json": "JSON", ".md": "Markdown", ".py": "Python", ".go": "Go", ".rs": "Rust", ".java": "Java", ".c": "C", ".cpp": "C++" };

    // Sample up to 500 files for performance
    const sample = gitFiles.slice(0, 500);
    for (const f of sample) {
      const ext = "." + (f.split(".").pop() || "");
      const lang = extMap[ext];
      if (lang) {
        langCount[lang] = (langCount[lang] || 0) + 1;
        try {
          const content = readSync(join(root, f), "utf-8");
          totalLines += content.split("\n").length;
        } catch {}
      } else if (!ext.includes("/")) {
        langCount[ext] = (langCount[ext] || 0) + 1;
      }
    }

    health.codeStats.totalLines = totalLines;

    // Language percentages
    const totalLangFiles = Object.values(langCount).reduce((a, b) => a + b, 0);
    health.codeStats.languages = Object.entries(langCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([lang, count]) => ({ lang, files: count, percent: Math.round((count / totalLangFiles) * 100) }));
  } catch {}

  // ── AI Sessions ──
  try {
    const sessions = await paaw.listSessions();
    health.sessions.total = sessions.length;
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    health.sessions.recent = sessions.filter(s => new Date(s.modified).getTime() > sevenDaysAgo).length;

    // Calculate success rate from session content
    let successCount = 0;
    let checked = 0;
    for (const s of sessions.slice(0, 20)) {
      try {
        const content = await paaw.readSession(s.filename);
        if (content) {
          checked++;
          if (content.includes("✅ 成功")) successCount++;
        }
      } catch {}
    }
    health.sessions.successRate = checked > 0 ? Math.round((successCount / checked) * 100) : 0;
  } catch {}

  // ── Dependencies ──
  try {
    const pkgPath = join(root, "package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readSync(pkgPath, "utf-8"));
      const total = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).length;
      health.dependencies = { total };
    }
  } catch {}

  return health;
}
