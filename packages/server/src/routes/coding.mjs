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
 *   GET    /api/coding-project/security-scan?path=...   — Run Semgrep security scan
 *   GET    /api/coding-project/security-scan/results?path=... — Load last scan results
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

import { readFile, writeFile, readdir, mkdir, unlink, appendFile, stat as fsStat } from "fs/promises";
import { existsSync, readFileSync as readSync, readdirSync, statSync } from "fs";
import { resolve, join, dirname } from "path";
import { fileURLToPath } from "url";
import { exec as execCb } from "child_process";
import { shellExec, IS_WIN } from "../lib/shell-exec.mjs";
import { createPaawProject } from "../lib/paaw-project.mjs";
import { callLLMWithRetry } from "../lib/llm-utils.mjs";
import { normalizePath, readBody } from "./shared.mjs";
import { sanitizeId, sendPathTraversalError } from "../lib/coding-security.mjs";
import { parseProject, formatForAI, formatCondensed } from "../lib/tree-sitter-parser.mjs";
import { runSemgrep } from "../lib/semgrep-runner.mjs";
import { buildCodeIntelligence, buildContextPackage } from "../lib/code-intelligence.mjs";
import { buildTestIntelligence } from "../lib/test-intelligence.mjs";
import { buildChangeIntelligence } from "../lib/change-intelligence.mjs";
import { rescanMechanicalLayer } from "../lib/cu-mechanical.mjs";

// ── PAAW root directory (cross-platform safe) ──
// fileURLToPath handles Windows drive-letter URLs correctly,
// unlike new URL(import.meta.url).pathname which adds a leading /
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PAAW_ROOT = resolve(__dirname, "..", "..", "..", "..");

// ── CU lifecycle raw materials — 輕量掃 source file 數（純 node fs，跨平台，不碰 node_modules）──
// 用途：判斷「代碼尚少（no-code）」— 剛建立/剛 import 的專案 code 還沒成形，
// Code Understanding 沒東西可分析，UI 不該催
const CU_SOURCE_EXTS = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".py", ".go", ".java", ".rs", ".vue", ".svelte"]);
const CU_SKIP_DIRS = new Set(["node_modules", ".git", ".paaw", "dist", "build", "coverage", ".next", "vendor", "target", "out", ".cache"]);
function countSourceFiles(root) {
  let count = 0;
  let lastModifiedMs = 0; // 最新 source mtime — staleness 基準
  let visited = 0;
  const stack = [root];
  while (stack.length > 0 && visited < 2000) {
    const dir = stack.pop();
    visited++;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue; // 隱藏目錄（.git/.paaw/.next…）全部跳過
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (CU_SKIP_DIRS.has(e.name)) continue;
        stack.push(full);
      } else {
        const dot = e.name.lastIndexOf(".");
        if (dot > 0 && CU_SOURCE_EXTS.has(e.name.slice(dot).toLowerCase())) {
          count++;
          try { const st = statSync(full); if (st.mtimeMs > lastModifiedMs) lastModifiedMs = st.mtimeMs; } catch {}
        }
      }
    }
  }
  return { count, lastModifiedMs };
}

// ── CU staleness — 智能層知識過期偵測（純 mtime 比對，免 token）──
// step 產出檔比 code 最新 mtime 舊 → 過期（快照是舊地圖）
// 與 UI CU_STEPS 的 file 對應（保持同步）
const CU_STEP_FILES = {
  scan: "scan.json",
  architecture: "ARCHITECTURE.md",
  "feature-map": "features/FEATURES.json",
  "api-spec": "specs/api-contract.md",
  "code-intelligence": "code-intelligence/summary.json",
  "test-intelligence": "code-intelligence/test-intelligence.json",
  "error-mapping": "specs/error-codes.md",
  "security-scan": "security/scan-results.json",
  standards: "standards/coding-style.md",
  overview: "PROJECT.md",
  "change-intelligence": "changes/change-intelligence.json",
};
const CU_MECHANICAL_STEPS = new Set(["code-intelligence", "test-intelligence", "change-intelligence"]);
const STALE_TOLERANCE_MS = 2000; // 同步競態容差
function computeCuStaleness(root, steps, codeLastModifiedMs) {
  const staleSteps = [];
  for (const [id, rel] of Object.entries(CU_STEP_FILES)) {
    if (steps[id]?.status !== "done") continue; // 沒跑過的叫 pending 不叫過期
    try {
      const st = statSync(join(root, ".paaw", rel));
      if (codeLastModifiedMs > st.mtimeMs + STALE_TOLERANCE_MS) {
        staleSteps.push({ id, mechanical: CU_MECHANICAL_STEPS.has(id) });
      }
    } catch {}
  }
  return staleSteps;
}

// Debug logger for Code Understanding — writes to .paaw/cu-debug.log
import { appendFileSync, existsSync as existsSyncSync } from "fs";
function cuLog(step, msg) {
  const line = `[${new Date().toISOString()}] [CU] step=${step} ${msg}\n`;
  console.log(line.trim());
  try { appendFileSync(join(PAAW_ROOT, ".paaw", "cu-debug.log"), line); } catch {}
}

// Shared agent rules
import { AGENT_RULES } from "../lib/agent-rules.mjs";
import { SECURITY_RULES } from "../lib/security-rules.mjs";
import { resolveDefaultModel } from "../lib/llm-utils.mjs";

// ── Running agent tracking (for busy check + interrupt) ──
import { runningCodingAgents } from "../lib/running-agents.mjs";

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

  // Resolve maxTokens: caller override > model config in providers.json > 16384
  const modelConfig = (provider.models || []).find(m => m.id === model);
  const defaultMaxTokens = modelConfig?.maxTokens || providerConfig.defaultMaxTokens || 16384;
  const maxTokens = body.maxTokens ?? defaultMaxTokens;

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
    max_tokens: maxTokens,
  };
  return callLLMWithRetry(apiUrl, headers, reqBody, {
    maxRetries: opts.maxRetries ?? 3,
    timeoutMs: opts.timeoutMs ?? 300_000,
    validateContent: true,
    sanitize: true,
    caller: opts.caller || "coding",
    agentId: opts.agentId || "coding",
    fallbacks: opts.fallbacks || [],
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
  const isWin = process.platform === "win32";

  // All routes start with /api/coding-project
  if (!url.startsWith("/api/coding-project") && !url.startsWith("/api/coding-crew")) return false;

  const projectPath = q.path;

  // ── GET /api/coding-crew/:crewId — Load crew definition (no project required) ──
  // Exclude /running and /interrupt which are separate API endpoints
  const crewMatch = url.match(/^\/api\/coding-crew\/([^/?]+)$/);
  if (crewMatch && method === "GET" && !['running', 'interrupt', 'dispatch', 'chat', 'conversations', 'context-window'].includes(crewMatch[1])) {
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

    // Resolve project root from cwd (the coding project being worked on)
    const projRoot = cwd ? resolve(cwd) : resolve(projectPath || PAAW_ROOT);

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
      const actionLogText = (await listActionLog({ cwd: projRoot, limit: 10 })).text;
      const agentMemoryText = await loadAgentMemory(agent.agentId, projRoot);
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
            // Cap at 50 files to keep prompt lean — rest are accessible via project_info
            const cappedFiles = sortedFiles.slice(0, 50);
            const fileLines = cappedFiles.map(f => `- ${f} → ${fileMap[f].join(", ")}`).join("\n");
            const moreHint = sortedFiles.length > 50 ? ` (${sortedFiles.length - 50} more — use project_info(category=features) to see all)` : "";
            extraContext.push(`\n## Feature Map (${feats.length} features)\nUse project_info(category=feature_detail, id=...) for full detail.\n${fLines}\n\n## File → Feature Index (${cappedFiles.length} files${moreHint})\n${fileLines}`);
          }
        } catch {}
      }

      // Inject Code Intelligence SUMMARY (not full 200-file dump — too fat)
      const ciFile = join(projRoot, ".paaw", "code-intelligence", "code-intelligence.json");
      if (existsSync(ciFile)) {
        try {
          const ci = JSON.parse(readSync(ciFile, "utf-8"));
          if (ci.files?.length) {
            // Summary: top-level dirs + file count + key entry points
            const dirCount = {};
            const keyFiles = [];
            for (const f of ci.files) {
              const dir = (f.path || "").split("/").slice(0, 2).join("/");
              dirCount[dir] = (dirCount[dir] || 0) + 1;
              // Key files: have many exports or are index/main entry points
              if ((f.exports?.length || 0) > 3 || /index\.|main\.|app\./i.test(f.path)) {
                keyFiles.push(`- ${f.path} (exports: ${(f.exports || []).slice(0, 5).join(", ")})`);
              }
            }
            const dirLines = Object.entries(dirCount).sort((a,b) => b[1] - a[1]).map(([d, c]) => `  ${d}/ (${c} files)`).join("\n");
            const keyLines = keyFiles.slice(0, 20).join("\n");
            extraContext.push(`\n## Code Intelligence (${ci.files.length} files)\nDirectories:\n${dirLines}\nKey files:\n${keyLines}\n(用 read_file 查完整 exports/imports，或 grep 搜尋 symbol)`);
          }
        } catch {}
      }

      // Inject Security scan summary (last scan)
      const secFile = join(projRoot, ".paaw", "security", "scan-results.json");
      if (existsSync(secFile)) {
        try {
          const sec = JSON.parse(readSync(secFile, "utf-8"));
          if (sec.stats?.total > 0) {
            extraContext.push(`\n## Security Scan Summary (${sec.stats.total} findings, scanned ${sec.scannedAt || 'unknown'})\nBy severity: ${JSON.stringify(sec.stats.bySeverity)}\nBy category: ${JSON.stringify(sec.stats.byCategory)}`);
          }
        } catch {}
      }
      extraContext.push(AGENT_RULES);
      extraContext.push(SECURITY_RULES);
      const fullSystemPrompt = systemPrompt + extraContext.join("");

      // Build messages array with conversation history
      const messages = [];
      if (fullSystemPrompt) messages.push({ role: "system", content: fullSystemPrompt });

      // Inject conversation history — clean then let trimMessagesToFit handle context window
      if (conversationHistory && Array.isArray(conversationHistory) && conversationHistory.length > 0) {
        // Filter: only user/assistant, skip thinking bubbles, include tool call context
        const cleanHistory = conversationHistory
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

        for (const m of cleanHistory) {
          messages.push({ role: m.role, content: m.content });
        }
      }

      // Add current user message
      messages.push({ role: "user", content: message });

      // ── Apply context window trimming (aligned with A2A agent loop: 262K budget) ──
      const { trimMessagesToFit } = await import("../lib/paaw-agent-loop.mjs");
      const finalMessages = trimMessagesToFit(messages);

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
          totalMessages: finalMessages.length,
          messagesSummary: finalMessages.map(m => ({ role: m.role, contentLength: m.content?.length || 0, preview: (m.content || "").slice(0, 120) })),
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
      // Register running agent for busy check + interrupt support
      const chatAbort = new AbortController();
      runningCodingAgents.set(agent.agentId, { abortController: chatAbort, res, startedAt: Date.now(), source: "chat" });
      const cleanupChatAgent = () => { runningCodingAgents.delete(agent.agentId); };
      res.on("close", cleanupChatAgent);

      await runAgentLoopStream({
        prompt: "", // handled by messages array
        systemPrompt: "", // handled by messages array
        messages: finalMessages, // trimmed with 262K budget, same as A2A
        model: model || undefined,
        cwd: cwd || undefined,
        maxTurns: agent.maxTurns,
        timeout: 0, // no timeout — complex tasks may take arbitrarily long
        rootDir: projRoot,
        agentId: agent.agentId,
        abortSignal: chatAbort.signal,
      }, res);
      cleanupChatAgent();

      if (!res.writableEnded) res.end();
      console.log(`[CodingCrew:chat] ${agent.agentId} stream completed`);
    } catch (err) {
      console.error(`[CodingCrew:chat] error:`, err);
      if (res.headersSent && !res.writableEnded) {
        try { res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`); res.end(); } catch {}
      } else if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    }
    return true;
  }

  // ── POST /api/coding-crew/dispatch — EM dispatch: trigger another agent to run a task ──
  if (url === "/api/coding-crew/dispatch" && method === "POST") {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return true;
    }
    const { agentId, task, cwd, model, priority = "medium", taskId, subTaskId, taskTimeout, _chainParentId, _chainSubTaskIds, _chainCurrentIndex } = body;
    if (!agentId || !task) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing agentId or task" }));
      return true;
    }

    const projRoot = cwd ? resolve(cwd) : resolve(projectPath || PAAW_ROOT);

    // Resolve crew config for the target agent
    const agentMap = {
      architect: "coding.architect",
      developer: "coding.developer",
      tester: "coding.tester",
      "doc-writer": "coding.doc-writer",
      qa: "coding.qa",
      helpdesk: "coding.helpdesk",
    };
    const crewId = agentMap[agentId] || agentId;
    const crewFile = join(PAAW_ROOT, "data", "crews", `${crewId}.json`);
    if (!existsSync(crewFile)) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Agent '${agentId}' not found` }));
      return true;
    }

    try {
      const crewDef = JSON.parse(readSync(crewFile, "utf-8"));
      const systemPrompt = crewDef.rolePrompt || "";

      // Build context same as chat endpoint (feature map, code intel, action log, agent memory)
      const extraContext = [];

      // Load context helpers
      const { listActionLog, loadAgentMemory } = await import("../lib/action-log.mjs");
      const loadProviderConfig = (await import("../context-engine.mjs")).loadProviderConfig;

      // Feature map
      const fFile = join(projRoot, ".paaw", "features", "FEATURES.json");
      if (existsSync(fFile)) {
        try {
          const fData = JSON.parse(readSync(fFile, "utf-8"));
          const feats = fData.features || [];
          if (feats.length > 0) {
            const fLines = feats.map(f => {
              const p = [`- [${f.id}] ${f.name} (${f.status})`];
              const m = [];
              if (f.codeFiles?.length) m.push(`${f.codeFiles.length} code`);
              if (f.apis?.length) m.push(`${f.apis.length} APIs`);
              if (f.tests?.length) m.push(`${f.tests.length} tests`);
              if (m.length) p.push(`→ ${m.join(", ")}`);
              return p.join(" ");
            }).join("\n");
            extraContext.push(`\n## Feature Map (${feats.length} features, 用 project_info(category=feature_detail) 查 detail)\n${fLines}`);
          }
        } catch {}
      }

      // Code intelligence — summary only (not full file dump)
      const ciFile = join(projRoot, ".paaw", "code-intelligence", "code-intelligence.json");
      if (existsSync(ciFile)) {
        try {
          const ci = JSON.parse(readSync(ciFile, "utf-8"));
          if (ci.files?.length) {
            const dirCount = {};
            const keyFiles = [];
            for (const f of ci.files) {
              const dir = (f.path || "").split("/").slice(0, 2).join("/");
              dirCount[dir] = (dirCount[dir] || 0) + 1;
              if ((f.exports?.length || 0) > 3 || /index\.|main\.|app\./i.test(f.path)) {
                keyFiles.push(`- ${f.path} (exports: ${(f.exports || []).slice(0, 5).join(", ")})`);
              }
            }
            const dirLines = Object.entries(dirCount).sort((a,b) => b[1] - a[1]).map(([d, c]) => `  ${d}/ (${c} files)`).join("\n");
            const keyLines = keyFiles.slice(0, 20).join("\n");
            extraContext.push(`\n## Code Intelligence (${ci.files.length} files)\nDirectories:\n${dirLines}\nKey files:\n${keyLines}`);
          }
        } catch {}
      }

      // Action log
      const actionLog = await listActionLog(projRoot);
      if (actionLog.length > 0) {
        const recent = actionLog.slice(-10).map(e => `- [${e.agent}] ${e.action}${e.detail ? ": " + e.detail : ""} (${e.ts})`).join("\n");
        extraContext.push(`\n## Recent Action Log\n${recent}`);
      }

      // Agent memory
      const agentMemoryText = await loadAgentMemory(agentId, projRoot);
      if (agentMemoryText) extraContext.push(`\n## Your Long-term Memory\n${agentMemoryText}`);

      extraContext.push(AGENT_RULES);
      extraContext.push(SECURITY_RULES);
      const fullSystemPrompt = systemPrompt + extraContext.join("");

      const messages = [
        { role: "system", content: fullSystemPrompt },
        { role: "user", content: task },
      ];

      // Load provider config
      // Resolve LLM config (same as agent loop)
      const { resolveLLMConfig } = await import("../lib/paaw-agent-loop.mjs");
      const llm = resolveLLMConfig(projRoot, model);
      const useModel = llm.model;

      // Run the agent via runAgentLoopStream — it handles SSE and tool loop internally
      // Busy check — reject if agent is already running
      if (runningCodingAgents.has(agentId)) {
        const running = runningCodingAgents.get(agentId);
        const elapsed = Math.round((Date.now() - running.startedAt) / 1000);
        if (!res.headersSent) {
          res.writeHead(409, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: `Agent '${agentId}' is busy (running for ${elapsed}s, source: ${running.source})`, busy: true, agentId }));
        }
        return true;
      }

      const { runAgentLoopStream } = await import("../lib/paaw-agent-loop.mjs");
      // Register dispatched agent
      const dispatchAbort = new AbortController();
      runningCodingAgents.set(agentId, { abortController: dispatchAbort, res, startedAt: Date.now(), source: "dispatch" });
      const cleanupDispatch = () => { runningCodingAgents.delete(agentId); };
      res.on("close", cleanupDispatch);

      // Use task timeout if specified, otherwise 60 min safety net
      const effectiveTimeout = taskTimeout || 3600; // 60 min default

      await runAgentLoopStream({
        systemPrompt: fullSystemPrompt,
        messages,
        cwd: projRoot,
        agentId,
        model: useModel,
        maxTurns: 30,
        timeout: effectiveTimeout,
        abortSignal: dispatchAbort.signal,
      }, res);
      cleanupDispatch();

      // ── Post-dispatch: record result to task ──
      if (taskId) {
        try {
          const tasksDir = join(projRoot, ".paaw", "tasks");
          const tasksFile = join(tasksDir, "TASKS.json");
          if (existsSync(tasksFile)) {
            const allData = JSON.parse(readSync(tasksFile, "utf-8"));
            const allTasks = allData.tasks || [];
            const tIdx = allTasks.findIndex(t => t.id === taskId);
            if (tIdx >= 0) {
              if (!Array.isArray(allTasks[tIdx].notes)) allTasks[tIdx].notes = [];
              allTasks[tIdx].notes.push({
                by: agentId,
                at: new Date().toISOString(),
                content: `✅ Agent ${agentId} completed dispatched task`,
              });
              allTasks[tIdx].updatedAt = new Date().toISOString();
              allData.tasks = allTasks;
              const { writeFileSync } = await import("node:fs");
              writeFileSync(tasksFile, JSON.stringify(allData, null, 2), "utf-8");
            }
          }
        } catch (e) { console.error("post-dispatch task update error:", e.message); }
      }

      // ── Sub-task completion → auto-advance pipeline + chain dispatch ──
      if (subTaskId && taskId) {
        try {
          // Advance sub-task pipeline
          const advRes = await fetch(`http://localhost:${process.env.PORT || 3100}/api/coding-tasks/${encodeURIComponent(subTaskId)}/pipeline/advance?path=${encodeURIComponent(projRoot)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ phase: "implement", result: `Agent ${agentId} completed`, by: agentId }),
          });
          const advData = await advRes.json();
          if (!advData.ok) {
            console.error("sub-task advance failed:", advData.error);
          }
        } catch (e) { console.error("sub-task advance error:", e.message); }

        // ── Chain: use direct dispatch instead of HTTP self-call ──
        if (_chainParentId && Array.isArray(_chainSubTaskIds) && _chainCurrentIndex < _chainSubTaskIds.length - 1) {
          const nextIndex = _chainCurrentIndex + 1;
          const nextSubId = _chainSubTaskIds[nextIndex];
          try {
            const tasksFile = join(projRoot, ".paaw", "tasks", "TASKS.json");
            if (existsSync(tasksFile)) {
              const allData = JSON.parse(readSync(tasksFile, "utf-8"));
              const allTasks = allData.tasks || [];
              const nextSub = allTasks.find(t => t.id === nextSubId);
              if (nextSub && nextSub.assignee) {
                const { triggerHealthAgentDispatch } = await import("./coding-tasks.mjs");
                if (runningCodingAgents.has(nextSub.assignee)) {
                  if (!Array.isArray(nextSub.notes)) nextSub.notes = [];
                  nextSub.notes.push({ by: "system", at: new Date().toISOString(), content: `⏳ Agent ${nextSub.assignee} is busy — queued for later` });
                  nextSub.updatedAt = new Date().toISOString();
                  allData.tasks = allTasks;
                  writeFileSync(tasksFile, JSON.stringify(allData, null, 2), "utf-8");
                } else {
                  setImmediate(() => triggerHealthAgentDispatch({
                    projRoot,
                    subTask: nextSub,
                    chainParentId: _chainParentId,
                    chainSubTaskIds: _chainSubTaskIds,
                    chainCurrentIndex: nextIndex,
                  }));
                }
              }
            }
          } catch (e) { console.error("chain load error:", e.message); }
        }

        // ── Chain complete: mark parent done if all sub-tasks done ──
        if (_chainParentId && _chainCurrentIndex >= _chainSubTaskIds.length - 1) {
          try {
            const tasksFile = join(projRoot, ".paaw", "tasks", "TASKS.json");
            if (existsSync(tasksFile)) {
              const allData = JSON.parse(readSync(tasksFile, "utf-8"));
              const allTasks = allData.tasks || [];
              const parentIdx = allTasks.findIndex(t => t.id === _chainParentId);
              if (parentIdx >= 0) {
                const subIds = _chainSubTaskIds;
                const allDone = subIds.every(sid => {
                  const st = allTasks.find(t => t.id === sid);
                  return st && (st.status === "resolved" || st.pipeline?.commit?.status === "done");
                });
                if (allDone) {
                  allTasks[parentIdx].status = "resolved";
                  allTasks[parentIdx].resolvedAt = new Date().toISOString();
                  if (!Array.isArray(allTasks[parentIdx].notes)) allTasks[parentIdx].notes = [];
                  allTasks[parentIdx].notes.push({ by: "system", at: new Date().toISOString(), content: `✅ All ${subIds.length} sub-tasks completed — health fix done` });
                  allTasks[parentIdx].updatedAt = new Date().toISOString();
                  allData.tasks = allTasks;
                  writeFileSync(tasksFile, JSON.stringify(allData, null, 2), "utf-8");
                }
              }
            }
          } catch (e) { console.error("parent completion check error:", e.message); }
        }
      }

      return true;

    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      } else {
        try { res.write(`data: ${JSON.stringify({ type: "error", error: err.message })}\n\n`); res.end(); } catch {}
      }
      // Record timeout/error to task
      if (taskId) {
        try {
          const tasksDir = join(projRoot, ".paaw", "tasks");
          const tasksFile = join(tasksDir, "TASKS.json");
          if (existsSync(tasksFile)) {
            const allData = JSON.parse(readSync(tasksFile, "utf-8"));
            const allTasks = allData.tasks || [];
            const tIdx = allTasks.findIndex(t => t.id === taskId);
            if (tIdx >= 0) {
              if (!Array.isArray(allTasks[tIdx].notes)) allTasks[tIdx].notes = [];
              allTasks[tIdx].notes.push({
                by: agentId,
                at: new Date().toISOString(),
                content: `⚠️ Agent ${agentId} ended with error: ${err.message.slice(0, 200)}. Work may be partially done.`,
              });
              allTasks[tIdx].updatedAt = new Date().toISOString();
              allData.tasks = allTasks;
              const { writeFileSync } = await import("node:fs");
              writeFileSync(tasksFile, JSON.stringify(allData, null, 2), "utf-8");
            }
          }
        } catch (e) { console.error("post-dispatch error task update:", e.message); }
      }

      // ── Chain: even on error, dispatch next sub-task via direct call ──
      if (_chainParentId && Array.isArray(_chainSubTaskIds) && _chainCurrentIndex < _chainSubTaskIds.length - 1) {
        const nextIndex = _chainCurrentIndex + 1;
        const nextSubId = _chainSubTaskIds[nextIndex];
        try {
          const tasksFile = join(projRoot, ".paaw", "tasks", "TASKS.json");
          if (existsSync(tasksFile)) {
            const allData = JSON.parse(readSync(tasksFile, "utf-8"));
            const allTasks = allData.tasks || [];
            const nextSub = allTasks.find(t => t.id === nextSubId);
            if (nextSub && nextSub.assignee && !runningCodingAgents.has(nextSub.assignee)) {
              const { triggerHealthAgentDispatch } = await import("./coding-tasks.mjs");
              setImmediate(() => triggerHealthAgentDispatch({
                projRoot,
                subTask: nextSub,
                chainParentId: _chainParentId,
                chainSubTaskIds: _chainSubTaskIds,
                chainCurrentIndex: nextIndex,
              }));
            }
          }
        } catch (e2) { console.error("chain load on error:", e2.message); }
      }
    }
    return true;
  }

  // ── Crew Conversation Persistence ──
  // ── Conversation / Session APIs ──
  // New structure: .paaw/coding-memory/conversations/{agentId}/active.json + s-*.json history
  //
  // GET    /api/coding-crew/conversations?cwd=...                              — List all agents with conversations
  // GET    /api/coding-crew/conversations/:crewId?cwd=...                     — Load active conversation
  // POST   /api/coding-crew/conversations/:crewId?cwd=...                     — Save active conversation
  // DELETE /api/coding-crew/conversations/:crewId?cwd=...                     — Clear active conversation
  // POST   /api/coding-crew/conversations/:crewId/new-session?cwd=...         — Archive active + start new (like /new)
  // GET    /api/coding-crew/conversations/:crewId/sessions?cwd=...            — List all sessions (active + history)
  // GET    /api/coding-crew/conversations/:crewId/sessions/:sessionId?cwd=... — Load specific session
  // DELETE /api/coding-crew/conversations/:crewId/sessions/:sessionId?cwd=... — Delete a session
  // POST   /api/coding-crew/conversations/:crewId/switch/:sessionId?cwd=...  — Switch to a history session

  // Helper: resolve conversation paths for an agent
  function getConvPaths(cwd, crewId) {
    const agentDir = join(cwd, ".paaw", "coding-memory", "conversations", crewId);
    return {
      agentDir,
      activeFile: join(agentDir, "active.json"),
    };
  }

  // ── Security: validate crewId / sessionId against path traversal ──
  // sanitizeId / sendPathTraversalError now come from ../lib/coding-security.mjs

  // Helper: read conversation from file (handles both old flat + new dir format)
  async function readConvFile(filePath) {
    if (!existsSync(filePath)) return { messages: [], _meta: {} };
    try {
      const data = JSON.parse(readSync(filePath, "utf-8"));
      if (Array.isArray(data)) return { messages: data, _meta: {} };
      return { messages: data.messages || [], _meta: data._meta || {} };
    } catch {
      return { messages: [], _meta: {} };
    }
  }

  // ── Migrate old flat files → new directory structure ──
  async function migrateFlatConversations(cwd) {
    const convDir = join(cwd, ".paaw", "coding-memory", "conversations");
    if (!existsSync(convDir)) return;
    const entries = await readdir(convDir);
    for (const entry of entries) {
      const entryPath = join(convDir, entry);
      const stat = await import("fs").then(fs => fs.statSync(entryPath));
      // If it's a .json file (old flat format), move to {agentId}/active.json
      if (entry.endsWith(".json") && stat.isFile()) {
        const agentId = entry.replace(".json", "");
        const agentDir = join(convDir, agentId);
        const newFile = join(agentDir, "active.json");
        if (!existsSync(agentDir)) await mkdir(agentDir, { recursive: true });
        if (!existsSync(newFile)) {
          const { rename } = await import("fs/promises");
          await rename(entryPath, newFile);
          console.log(`[conv-migrate] ${entry} → ${agentId}/active.json`);
        } else {
          await unlink(entryPath); // new file already exists, remove old
        }
      }
      // If it's old .archive directory, move each archive .json to parent as s-*.json
      if (entry.endsWith(".archive") && stat.isDirectory()) {
        const agentId = entry.replace(".archive", "");
        const agentDir = join(convDir, agentId);
        if (!existsSync(agentDir)) await mkdir(agentDir, { recursive: true });
        try {
          const archiveFiles = await readdir(entryPath);
          for (const af of archiveFiles.filter(f => f.endsWith(".json"))) {
            const src = join(entryPath, af);
            const data = JSON.parse(readSync(src, "utf-8"));
            const archivedAt = data._meta?.archivedAt || new Date().toISOString();
            const tsStr = archivedAt.replace(/[:.]/g, "-").slice(0, 19);
            const dest = join(agentDir, `s-${tsStr}.json`);
            if (!existsSync(dest)) {
              const { rename } = await import("fs/promises");
              await rename(src, dest);
            } else {
              await unlink(src);
            }
          }
          // Remove empty .archive directory
          const { rmdir } = await import("fs/promises");
          try { await rmdir(entryPath); } catch {} // not empty = ok
        } catch (e) {
          console.error(`[conv-migrate] Failed to migrate archive ${entry}:`, e.message);
        }
      }
    }
  }

  // Run migration on first request
  await migrateFlatConversations(q.cwd || PAAW_ROOT);

  // GET /api/coding-crew/conversations?cwd=... — list all agents with conversations
  if (url === "/api/coding-crew/conversations" && method === "GET") {
    const cwd = q.cwd || PAAW_ROOT;
    const convDir = join(cwd, ".paaw", "coding-memory", "conversations");
    try {
      if (!existsSync(convDir)) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ conversations: [] }));
        return true;
      }
      const entries = await readdir(convDir);
      const conversations = [];
      for (const entry of entries) {
        const entryPath = join(convDir, entry);
        try {
          const stat = await import("fs").then(fs => fs.statSync(entryPath));
          if (!stat.isDirectory()) continue;
          const activePath = join(entryPath, "active.json");
          const data = await readConvFile(activePath);
          const sessions = (await readdir(entryPath)).filter(f => f.startsWith("s-") && f.endsWith(".json"));
          conversations.push({
            crewId: entry,
            messageCount: data.messages.length,
            lastUpdated: data._meta?.lastUpdated || null,
            preview: data.messages.slice(-1)[0]?.content?.slice(0, 100) || "",
            sessionCount: sessions.length + (data.messages.length > 0 ? 1 : 0),
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

  // GET /api/coding-crew/conversations/:crewId?cwd=... — load active conversation
  const convLoadMatch = url.match(/^\/api\/coding-crew\/conversations\/([^/?]+)(?:\?.*)?$/);
  if (convLoadMatch && method === "GET") {
    let crewId;
    try {
      crewId = sanitizeId(decodeURIComponent(convLoadMatch[1]));
    } catch (err) {
      return sendPathTraversalError(res, err);
    }
    const cwd = q.cwd || PAAW_ROOT;
    const { activeFile } = getConvPaths(cwd, crewId);
    try {
      const data = await readConvFile(activeFile);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ messages: data.messages, crewId }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // POST /api/coding-crew/conversations/:crewId?cwd=... — save active conversation
  if (convLoadMatch && method === "POST") {
    let crewId;
    try {
      crewId = sanitizeId(decodeURIComponent(convLoadMatch[1]));
    } catch (err) {
      return sendPathTraversalError(res, err);
    }
    const cwd = q.cwd || PAAW_ROOT;
    const { agentDir, activeFile } = getConvPaths(cwd, crewId);
    let body;
    try { body = JSON.parse(await readBody(req)); } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return true;
    }
    try {
      await mkdir(agentDir, { recursive: true });
      const payload = {
        _meta: {
          crewId,
          lastUpdated: new Date().toISOString(),
          messageCount: (body.messages || []).length,
        },
        messages: body.messages || [],
      };
      await writeFile(activeFile, JSON.stringify(payload, null, 2), "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, crewId, messageCount: payload.messages.length }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // DELETE /api/coding-crew/conversations/:crewId?cwd=... — clear active conversation
  if (convLoadMatch && method === "DELETE") {
    let crewId;
    try {
      crewId = sanitizeId(decodeURIComponent(convLoadMatch[1]));
    } catch (err) {
      return sendPathTraversalError(res, err);
    }
    const cwd = q.cwd || PAAW_ROOT;
    const { activeFile } = getConvPaths(cwd, crewId);
    try {
      if (existsSync(activeFile)) { await unlink(activeFile); }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, crewId }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // POST /api/coding-crew/conversations/:crewId/new-session?cwd=... — archive active + start new (like /new)
  const newSessionMatch = url.match(/^\/api\/coding-crew\/conversations\/([^/]+)\/new-session(?:\?.*)?$/);
  if (newSessionMatch && method === "POST") {
    let crewId;
    try {
      crewId = sanitizeId(decodeURIComponent(newSessionMatch[1]));
    } catch (err) {
      return sendPathTraversalError(res, err);
    }
    const cwd = q.cwd || PAAW_ROOT;
    const { agentDir, activeFile } = getConvPaths(cwd, crewId);
    try {
      const data = await readConvFile(activeFile);
      if (data.messages.length === 0) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, crewId, archived: false, message: "Empty conversation" }));
        return true;
      }
      // Move active.json → s-{timestamp}.json
      const ts = new Date();
      const tsStr = ts.toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const firstUser = data.messages.find(m => m.role === "user");
      const preview = firstUser ? firstUser.content.slice(0, 40).replace(/[^\w\u4e00-\u9fff -]/g, "").trim() : "conversation";
      const sessionFile = join(agentDir, `s-${tsStr}.json`);
      // Update meta before saving as session
      data._meta.archivedAt = ts.toISOString();
      data._meta.title = firstUser ? firstUser.content.slice(0, 60) : "對話";
      data._meta.sessionId = `s-${tsStr}`;
      await writeFile(sessionFile, JSON.stringify(data, null, 2), "utf-8");
      // Clear active
      await unlink(activeFile);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, crewId, archived: true, sessionId: `s-${tsStr}`, messageCount: data.messages.length }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // GET /api/coding-crew/conversations/:crewId/sessions?cwd=... — list all sessions
  const sessionsListMatch = url.match(/^\/api\/coding-crew\/conversations\/([^/]+)\/sessions(?:\?.*)?$/);
  if (sessionsListMatch && method === "GET") {
    let crewId;
    try {
      crewId = sanitizeId(decodeURIComponent(sessionsListMatch[1]));
    } catch (err) {
      return sendPathTraversalError(res, err);
    }
    const cwd = q.cwd || PAAW_ROOT;
    const { agentDir, activeFile } = getConvPaths(cwd, crewId);
    try {
      const sessions = [];
      // Active session
      const activeData = await readConvFile(activeFile);
      if (activeData.messages.length > 0) {
        sessions.push({
          sessionId: "active",
          title: activeData._meta?.title || activeData.messages.find(m => m.role === "user")?.content.slice(0, 60) || "目前對話",
          messageCount: activeData.messages.length,
          lastUpdated: activeData._meta?.lastUpdated || null,
          isActive: true,
        });
      }
      // History sessions
      if (existsSync(agentDir)) {
        const files = await readdir(agentDir);
        for (const f of files.filter(f => f.startsWith("s-") && f.endsWith(".json")).sort().reverse()) {
          try {
            const data = JSON.parse(readSync(join(agentDir, f), "utf-8"));
            sessions.push({
              sessionId: f.replace(".json", ""),
              title: data._meta?.title || data.messages?.find(m => m.role === "user")?.content?.slice(0, 60) || "對話",
              messageCount: data._meta?.messageCount || data.messages?.length || 0,
              lastUpdated: data._meta?.archivedAt || data._meta?.lastUpdated || null,
              isActive: false,
            });
          } catch {}
        }
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ sessions }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // GET /api/coding-crew/conversations/:crewId/sessions/:sessionId?cwd=... — load specific session
  const sessionLoadMatch = url.match(/^\/api\/coding-crew\/conversations\/([^/]+)\/sessions\/([^?]+)/);
  if (sessionLoadMatch && method === "GET") {
    let crewId;
    try {
      crewId = sanitizeId(decodeURIComponent(sessionLoadMatch[1]));
    } catch (err) {
      return sendPathTraversalError(res, err);
    }
    let sessionId;
    try {
      sessionId = sanitizeId(decodeURIComponent(sessionLoadMatch[2]));
    } catch (err) {
      return sendPathTraversalError(res, err);
    }
    const cwd = q.cwd || PAAW_ROOT;
    const { agentDir, activeFile } = getConvPaths(cwd, crewId);
    try {
      const filePath = sessionId === "active" ? activeFile : join(agentDir, `${sessionId}.json`);
      const data = await readConvFile(filePath);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ messages: data.messages, meta: data._meta, crewId, sessionId }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // DELETE /api/coding-crew/conversations/:crewId/sessions/:sessionId?cwd=... — delete a history session
  if (sessionLoadMatch && method === "DELETE") {
    let crewId;
    try {
      crewId = sanitizeId(decodeURIComponent(sessionLoadMatch[1]));
    } catch (err) {
      return sendPathTraversalError(res, err);
    }
    let sessionId;
    try {
      sessionId = sanitizeId(decodeURIComponent(sessionLoadMatch[2]));
    } catch (err) {
      return sendPathTraversalError(res, err);
    }
    const cwd = q.cwd || PAAW_ROOT;
    const { agentDir } = getConvPaths(cwd, crewId);
    try {
      if (sessionId === "active") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Cannot delete active session, use DELETE /conversations/:crewId" }));
        return true;
      }
      const filePath = join(agentDir, `${sessionId}.json`);
      if (existsSync(filePath)) { await unlink(filePath); }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, crewId, sessionId }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // POST /api/coding-crew/conversations/:crewId/switch/:sessionId?cwd=... — switch to a history session
  const switchSessionMatch = url.match(/^\/api\/coding-crew\/conversations\/([^/]+)\/switch\/([^?]+)/);
  if (switchSessionMatch && method === "POST") {
    let crewId;
    try {
      crewId = sanitizeId(decodeURIComponent(switchSessionMatch[1]));
    } catch (err) {
      return sendPathTraversalError(res, err);
    }
    let sessionId;
    try {
      sessionId = sanitizeId(decodeURIComponent(switchSessionMatch[2]));
    } catch (err) {
      return sendPathTraversalError(res, err);
    }
    const cwd = q.cwd || PAAW_ROOT;
    const { agentDir, activeFile } = getConvPaths(cwd, crewId);
    try {
      if (sessionId === "active") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, message: "Already on active session" }));
        return true;
      }
      // Archive current active if it has messages
      const activeData = await readConvFile(activeFile);
      if (activeData.messages.length > 0) {
        const ts = new Date();
        const tsStr = ts.toISOString().replace(/[:.]/g, "-").slice(0, 19);
        activeData._meta.archivedAt = ts.toISOString();
        activeData._meta.sessionId = `s-${tsStr}`;
        const archiveFile = join(agentDir, `s-${tsStr}.json`);
        await writeFile(archiveFile, JSON.stringify(activeData, null, 2), "utf-8");
        await unlink(activeFile);
      }
      // Load target session → make it active
      const srcFile = join(agentDir, `${sessionId}.json`);
      const srcData = await readConvFile(srcFile);
      // Write as active
      srcData._meta.lastUpdated = new Date().toISOString();
      delete srcData._meta.archivedAt;
      srcData._meta.sessionId = "active";
      await writeFile(activeFile, JSON.stringify(srcData, null, 2), "utf-8");
      // Remove old session file
      await unlink(srcFile);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, crewId, switchedTo: "active", messageCount: srcData.messages.length }));
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

  // ── POST /api/coding-crew/em-plan — EM Plan only (no execute) ──
  if (url === "/api/coding-crew/em-plan" && method === "POST") {
    const body = await new Promise((ok, fail) => { let d = ""; req.on("data", c => d += c); req.on("end", () => ok(d)); req.on("error", fail); });
    const { cwd, since, model } = JSON.parse(body || "{}");
    const rootDir = cwd || projectPath || PAAW_ROOT;

    let nsConfig = null;
    try {
      const nsConfigPath = join(rootDir, ".paaw", "auto-dispatch", "config.json");
      if (existsSync(nsConfigPath)) nsConfig = JSON.parse(readSync(nsConfigPath, "utf-8"));
    } catch {}
    const modelOverride = model || nsConfig?.model?.primary || undefined;
    const fallbackModels = nsConfig?.model?.fallbacks || [];

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
      if (res.writableEnded || res.destroyed) return;
      try {
        res.write(`event: ${type}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch {}
    };

    try {
      const { planEMSession } = await import("../lib/auto-dispatch-manager.mjs");
      sendSSE("start", { message: "🎖️ EM 規劃啟動", ts: new Date().toISOString() });
      const { workList, situationReport } = await planEMSession({ rootDir, sendSSE, since, modelOverride, fallbackModels });
      sendSSE("plan_ready", { workList, situationReport });
    } catch (err) {
      console.error("[EM-Plan] error:", err);
      sendSSE("error", { message: `❌ EM 規劃失敗：${err.message}`, isError: true });
    }
    if (!res.writableEnded) res.end();
    return true;
  }

  // ── POST /api/coding-crew/em-execute — EM Execute with confirmed workList ──
  if (url === "/api/coding-crew/em-execute" && method === "POST") {
    const body = await new Promise((ok, fail) => { let d = ""; req.on("data", c => d += c); req.on("end", () => ok(d)); req.on("error", fail); });
    const { cwd, workList, situationReport, model } = JSON.parse(body || "{}");
    const rootDir = cwd || projectPath || PAAW_ROOT;

    let nsConfig = null;
    try {
      const nsConfigPath = join(rootDir, ".paaw", "auto-dispatch", "config.json");
      if (existsSync(nsConfigPath)) nsConfig = JSON.parse(readSync(nsConfigPath, "utf-8"));
    } catch {}
    const modelOverride = model || nsConfig?.model?.primary || undefined;
    const fallbackModels = nsConfig?.model?.fallbacks || [];

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
      if (res.writableEnded || res.destroyed) return;
      try {
        res.write(`event: ${type}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch {}
    };

    try {
      const { executeEMSession } = await import("../lib/auto-dispatch-manager.mjs");
      sendSSE("start", { message: "🎖️ EM 開始執行", ts: new Date().toISOString() });
      const { report, results } = await executeEMSession({ rootDir, workList, situationReport, modelOverride, fallbackModels, sendSSE, projectPhase: nsConfig?.projectPhase || 'bootstrap' });
      sendSSE("complete", { workList, results, report });
    } catch (err) {
      console.error("[EM-Execute] error:", err);
      sendSSE("error", { message: `❌ EM 執行失敗：${err.message}`, isError: true });
    }
    if (!res.writableEnded) res.end();
    return true;
  }

  // ── POST /api/coding-crew/interrupt — Terminate a running agent ──
  // Must be BEFORE projectPath check — interrupt doesn't need a project path
  if (url === "/api/coding-crew/interrupt" && method === "POST") {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { body = {}; }
    const { agentId: aid } = body;
    if (!aid) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: false, error: "Missing agentId" })); return true; }

    const running = runningCodingAgents.get(aid);
    if (!running) {
      // Also check A2A running streams
      let a2aRunning = null;
      try {
        const { runningStreams: a2aStreams } = await import("./a2a.mjs");
        a2aRunning = a2aStreams?.get(aid);
        if (a2aRunning) {
          a2aRunning.abortController.abort();
          try { if (!a2aRunning.res.writableEnded) { a2aRunning.res.write("event: interrupted\ndata: " + JSON.stringify({ message: "Interrupted by user", agentId: aid }) + "\n\n"); a2aRunning.res.end(); } } catch {}
          a2aStreams.delete(aid);
        }
      } catch {}
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, message: `No coding agent '${aid}' running${a2aRunning ? " (interrupted via A2A)" : ""}` }));
      return true;
    }
    running.abortController.abort();
    try {
      if (!running.res.writableEnded) {
        running.res.write("event: interrupted\ndata: " + JSON.stringify({ message: "Agent terminated by user", agentId: aid }) + "\n\n");
        running.res.end();
      }
    } catch {}
    runningCodingAgents.delete(aid);
    console.log(`[CodingCrew] Interrupted agent '${aid}'`);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, message: `Agent '${aid}' terminated` }));
    return true;
  }

  // ── GET /api/coding-crew/running — List running agents ──
  // Must be BEFORE projectPath check
  if (url === "/api/coding-crew/running" && method === "GET") {
    const agents = [];
    for (const [id, info] of runningCodingAgents.entries()) {
      agents.push({ agentId: id, source: info.source, startedAt: info.startedAt, elapsed: Math.round((Date.now() - info.startedAt) / 1000) });
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, agents }));
    return true;
  }

  // ════════════════════════════════════════════════════════
  // ── Per-Project Crew Management (Phase 1: Data Layer) ──
  // ════════════════════════════════════════════════════════

  // ── GET /api/coding-project/skills — List all available skills for SkillPicker ──
  if (url.startsWith("/api/coding-project/skills") && req.method === "GET") {
    try {
      const { readdirSync, readFileSync: rf, existsSync: exists } = await import("fs");
      const { join, resolve: resv } = await import("path");
      const skillsRoot = resv(PAAW_ROOT, "data", "skills");
      const skills = [];

      // Scan physical-skill and input-prompt dirs
      const scanDirs = [
        { dir: join(skillsRoot, "physical-skill"), kind: "physical" },
        { dir: join(skillsRoot, "input-prompt"), kind: "input-prompt" },
      ];
      const seen = new Set();
      for (const { dir, kind } of scanDirs) {
        if (!exists(dir)) continue;
        let dirs;
        try { dirs = readdirSync(dir); } catch { continue; }
        for (const d of dirs) {
          if (seen.has(d)) continue;
          let name = d, description = "", category = "";
          // Try SKILL.md
          const skillMd = join(dir, d, "SKILL.md");
          const inputsJson = join(dir, d, "inputs.json");
          try {
            const raw = rf(skillMd, "utf-8");
            const nm = raw.match(/^name:\s*(.+)$/m);
            const ds = raw.match(/^description:\s*(.+)$/m);
            const ct = raw.match(/^category:\s*(.+)$/m);
            if (nm) name = nm[1].trim();
            if (ds) description = ds[1].trim();
            if (ct) category = ct[1].trim();
            seen.add(d);
          } catch {
            try {
              const ij = JSON.parse(rf(inputsJson, "utf-8"));
              name = ij.name || d;
              description = ij.description || "";
              seen.add(d);
            } catch {}
          }
          skills.push({ id: d, name, description, category, kind });
        }
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ skills }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // ── Agent Memory endpoints ──
  // GET /api/coding-project/agent-memory?path=...&agentId=coding.architect
  if (url.startsWith("/api/coding-project/agent-memory") && req.method === "GET") {
    try {
      const projectDir = q.path || "";
      const agentId = q.agentId || "";
      if (!projectDir || !agentId) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "path and agentId required" }));
        return true;
      }
      const { loadAgentMemory } = await import("../lib/action-log.mjs");
      const content = await loadAgentMemory(agentId, projectDir, 999999);
      // Get file stats — check both full and short form filenames
      const shortId = agentId.replace(/^(coding\.|custom\.)/, "");
      const memPaths = [
        join(projectDir, ".paaw", "agent-memory", `${agentId}.md`),
        join(projectDir, ".paaw", "agent-memory", `${shortId}.md`),
      ];
      let updatedAt = null, size = 0;
      for (const mp of memPaths) {
        try { const stat = await fsStat(mp); updatedAt = stat.mtime; size = stat.size; break; } catch {}
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ agentId, content, updatedAt, size }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // PUT /api/coding-project/agent-memory — Save agent memory
  if (url.startsWith("/api/coding-project/agent-memory") && req.method === "PUT") {
    try {
      const body = JSON.parse(await readBody(req) || "{}");
      const { path: projectDir, agentId, content } = body;
      if (!projectDir || !agentId) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "path and agentId required" }));
        return true;
      }
      const { saveAgentMemory } = await import("../lib/action-log.mjs");
      await saveAgentMemory(agentId, content, projectDir);
      const memPath = join(projectDir, ".paaw", "agent-memory", `${agentId}.md`);
      let updatedAt = null, size = 0;
      try { const stat = await fsStat(memPath); updatedAt = stat.mtime; size = stat.size; } catch {}
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, agentId, updatedAt, size }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // DELETE /api/coding-project/agent-memory — Clear agent memory
  if (url.startsWith("/api/coding-project/agent-memory") && req.method === "DELETE") {
    try {
      const projectDir = q.path || "";
      const agentId = q.agentId || "";
      if (!projectDir || !agentId) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "path and agentId required" }));
        return true;
      }
      const shortId = agentId.replace(/^(coding\.|custom\.)/, "");
      const memPaths = [
        join(projectDir, ".paaw", "agent-memory", `${agentId}.md`),
        join(projectDir, ".paaw", "agent-memory", `${shortId}.md`),
      ];
      for (const mp of memPaths) {
        try { await unlink(mp); } catch {}
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, agentId }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // ── Crew Export/Import endpoints ──
  // GET /api/coding-project/crew-export?path=...
  if (url.startsWith("/api/coding-project/crew-export") && req.method === "GET") {
    try {
      const projectDir = q.path || "";
      if (!projectDir) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "path required" }));
        return true;
      }
      const { readProjectCrew, readProjectSkills } = await import("../lib/project-crew.mjs");
      const { agents, config } = readProjectCrew(projectDir);
      const skillBindings = {};
      for (const a of agents) {
        const skills = readProjectSkills(projectDir, a.id);
        if (skills.length > 0) skillBindings[a.id] = skills.map(s => s.id);
      }
      // Read all agent memories
      const memDir = join(projectDir, ".paaw", "agent-memory");
      const memories = {};
      try {
        const memFiles = await readdir(memDir);
        for (const f of memFiles) {
          if (f.endsWith(".md")) {
            const agentId = f.replace(/\.md$/, "");
            memories[agentId] = await readFile(join(memDir, f), "utf-8");
          }
        }
      } catch {}
      const exportData = {
        version: 1,
        exportedAt: new Date().toISOString(),
        agents: agents.map(({ _source, _clonedAt, _updatedAt, _createdAt, _resetAt, ...rest }) => rest),
        config,
        skillBindings,
        memories,
      };
      res.writeHead(200, { "Content-Type": "application/json", "Content-Disposition": "attachment; filename=crew-export.json" });
      res.end(JSON.stringify(exportData, null, 2));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // POST /api/coding-project/crew-import — Import crew config
  if (url.startsWith("/api/coding-project/crew-import") && req.method === "POST") {
    try {
      const body = JSON.parse(await readBody(req) || "{}");
      const { path: projectDir, data } = body;
      if (!projectDir || !data) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "path and data required" }));
        return true;
      }
      const { initProjectCrew, updateProjectAgent, updateAgentModel, updateAgentSkills } = await import("../lib/project-crew.mjs");
      const { saveAgentMemory } = await import("../lib/action-log.mjs");
      // Initialize crew structure
      initProjectCrew(projectDir);
      let imported = 0, skipped = 0;
      // Import agents (only non-default fields are patched)
      if (data.agents) {
        for (const agent of data.agents) {
          try {
            // Only patch fields that differ from defaults
            const patch = {};
            const skipKeys = new Set(["id", "_source", "_clonedAt", "_updatedAt", "_createdAt", "_resetAt"]);
            for (const [k, v] of Object.entries(agent)) {
              if (!skipKeys.has(k) && v !== undefined) patch[k] = v;
            }
            if (Object.keys(patch).length > 0) {
              updateProjectAgent(projectDir, agent.id, patch);
              imported++;
            } else {
              skipped++;
            }
          } catch { skipped++; }
        }
      }
      // Import models
      if (data.config?.models) {
        for (const [agentId, modelCfg] of Object.entries(data.config.models)) {
          try { updateAgentModel(projectDir, agentId, modelCfg); } catch {}
        }
      }
      // Import skill bindings
      if (data.skillBindings) {
        for (const [agentId, skills] of Object.entries(data.skillBindings)) {
          try { updateAgentSkills(projectDir, agentId, skills); } catch {}
        }
      }
      // Import memories
      if (data.memories) {
        for (const [agentId, content] of Object.entries(data.memories)) {
          try { await saveAgentMemory(agentId, content, projectDir); } catch {}
        }
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, imported, skipped }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // These must come before the generic /create route
  if (url.startsWith("/api/coding-project/crew")) {
    const { initProjectCrew, readProjectCrew, readProjectAgent, updateProjectAgent, createCustomAgent, deleteCustomAgent, resetProjectAgent, updateAgentModel, updateAgentSkills } = await import("../lib/project-crew.mjs");
    const crewUrl = url.replace(/^\/api\/coding-project\/crew/, "") || "/";
    const crewPathParts = crewUrl.replace(/^\//, "").split("/");
    const agentIdParam = crewPathParts[0] ? decodeURIComponent(crewPathParts[0]) : null;
    const cwd = q.path || projectPath || PAAW_ROOT;
    const projectDir = resolve(cwd);
    const isSub = crewPathParts.length > 1; // /crew/:agentId/reset|model|skills
    const subAction = isSub ? crewPathParts[1] : null;

    // POST /api/coding-project/crew/init — Initialize project crew from global templates
    if (crewUrl === "/init" && method === "POST") {
      const body = JSON.parse(await readBody(req) || "{}");
      try {
        const result = initProjectCrew(projectDir, { force: body.force || false });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return true;
    }

    // GET /api/coding-project/crew — List all agents (merged global + project + custom)
    if ((method === "GET") && !agentIdParam) {
      try {
        const result = readProjectCrew(projectDir);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return true;
    }

    // POST /api/coding-project/crew — Create new custom agent
    if (method === "POST" && !agentIdParam) {
      const body = JSON.parse(await readBody(req) || "{}");
      try {
        const created = createCustomAgent(projectDir, body);
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify(created));
      } catch (err) {
        res.writeHead(err.message.includes("exists") || err.message.includes("must start") ? 400 : 500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return true;
    }

    // Routes with :agentId
    if (agentIdParam) {
      // POST /api/coding-project/crew/:agentId/reset — Reset to global default
      if (subAction === "reset" && method === "POST") {
        try {
          const result = resetProjectAgent(projectDir, agentIdParam);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(err.message.includes("No global") ? 404 : 500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        }
        return true;
      }

      // PATCH /api/coding-project/crew/:agentId/model — Update per-agent model
      if (subAction === "model" && method === "PATCH") {
        const body = JSON.parse(await readBody(req) || "{}");
        try {
          const result = updateAgentModel(projectDir, agentIdParam, body);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        }
        return true;
      }

      // PUT /api/coding-project/crew/:agentId/skills — Update skill bindings
      if (subAction === "skills" && (method === "PUT" || method === "POST")) {
        const body = JSON.parse(await readBody(req) || "{}");
        try {
          const result = updateAgentSkills(projectDir, agentIdParam, body.skills || body.skillIds || []);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        }
        return true;
      }

      // GET /api/coding-project/crew/:agentId — Read single agent
      if (method === "GET" && !subAction) {
        try {
          const agent = readProjectAgent(projectDir, agentIdParam);
          if (!agent) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: `Agent not found: ${agentIdParam}` }));
          } else {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(agent));
          }
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        }
        return true;
      }

      // PATCH /api/coding-project/crew/:agentId — Update agent
      if (method === "PATCH" && !subAction) {
        const body = JSON.parse(await readBody(req) || "{}");
        try {
          const updated = updateProjectAgent(projectDir, agentIdParam, body);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(updated));
        } catch (err) {
          res.writeHead(err.message.includes("not found") ? 404 : 500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        }
        return true;
      }

      // DELETE /api/coding-project/crew/:agentId — Delete custom agent
      if (method === "DELETE" && !subAction) {
        try {
          const result = deleteCustomAgent(projectDir, agentIdParam);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(err.message.includes("Only custom") || err.message.includes("not found") ? 400 : 500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        }
        return true;
      }
    }
  }

  // ── POST /api/coding-project/create — does NOT need ?path= (project doesn't exist yet) ──
  if (url.startsWith("/api/coding-project/create") && method === "POST") {
    const norm = normalizePath;
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

  // ── Recent projects (multi-project) — global routes, do NOT need ?path= ──
  // Must sit BEFORE the `if (!projectPath)` guard below (2026-08-15 fix:
  // they lived inside the guarded try-block and always returned 400)
  if (url.startsWith("/api/coding-project/recent")) {
    const recentPath = join(PAAW_ROOT, "data", "config", "recent-projects.json");
    const loadRecent = () => {
      try {
        if (existsSync(recentPath)) return JSON.parse(readSync(recentPath, "utf-8"));
      } catch {}
      return [];
    };

    // GET — list recently opened projects
    if (method === "GET") {
      const recent = loadRecent().map(r => ({ ...r, path: normalizePath(r.path) }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(recent));
      return true;
    }

    // DELETE — remove a project from recent list
    if (method === "DELETE") {
      const removePath = new URL(req.url, "http://localhost").searchParams.get("path");
      let recent = loadRecent();
      if (removePath) {
        recent = recent.filter(r => normalizePath(r.path) !== normalizePath(removePath));
        await mkdir(dirname(recentPath), { recursive: true });
        await writeFile(recentPath, JSON.stringify(recent, null, 2), "utf-8");
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(recent.map(r => ({ ...r, path: normalizePath(r.path) }))));
      return true;
    }

    // POST — add/update recent project
    if (method === "POST") {
      const body = JSON.parse(await readBody(req) || "{}");
      const path = normalizePath(body.path || "");
      if (path) {
        let recent = loadRecent();
        const name = body.name || path.split(/[\\/]/).pop();
        recent = recent.filter(r => normalizePath(r.path) !== path);
        recent.unshift({ path, name, lastOpened: new Date().toISOString(), hasPaaw: existsSync(join(path, ".paaw")) });
        recent = recent.slice(0, 20); // keep last 20
        await mkdir(dirname(recentPath), { recursive: true });
        await writeFile(recentPath, JSON.stringify(recent, null, 2), "utf-8");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(recent));
      } else {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing path in body" }));
      }
      return true;
    }
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

    // ── GET /api/coding-project/security-scan/results ──
    // Load last scan results (without re-running) — MUST check before the scan endpoint
    if (url.startsWith("/api/coding-project/security-scan/results") && method === "GET") {
      const resultsFile = join(root, ".paaw", "security", "scan-results.json");
      if (!existsSync(resultsFile)) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "No scan results found. Run a scan first." }));
        return true;
      }
      try {
        const data = await readFile(resultsFile, "utf-8");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(data);
      } catch {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Failed to read scan results" }));
      }
      return true;
    }

    // ── GET /api/coding-project/security-scan ──
    // Run Semgrep scan directly — just run it, show install instructions if it fails
    if (url.startsWith("/api/coding-project/security-scan") && !url.includes("/results") && method === "GET") {
      try {
        const scanResult = await runSemgrep(root, { timeoutMs: 1_800_000 });
        // Save to .paaw/security/
        const secDir = join(root, ".paaw", "security");
        if (!existsSync(secDir)) await mkdir(secDir, { recursive: true });
        await writeFile(join(secDir, "scan-results.json"), JSON.stringify(scanResult, null, 2), "utf-8");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(scanResult));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return true;
    }

    // ── GET /api/coding-project/test-intelligence ──
    if (url.startsWith("/api/coding-project/test-intelligence") && method === "GET") {
      try {
        const { summary } = await buildTestIntelligence(root, PAAW_ROOT);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(summary));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return true;
    }

    // ── GET /api/coding-project/change-intelligence ──
    if (url.startsWith("/api/coding-project/change-intelligence") && method === "GET") {
      try {
        const { summary } = await buildChangeIntelligence(root, { days: 30, maxCommits: 50 });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(summary));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return true;
    }

    // ── GET /api/coding-project/code-intelligence ──
    // Build and return full code intelligence (call graph, dependency graph, etc.)
    if (url.startsWith("/api/coding-project/code-intelligence") && method === "GET") {
      try {
        const { summary } = await buildCodeIntelligence(root, PAAW_ROOT);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(summary));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return true;
    }

    // ── GET /api/coding-project/code-intelligence/context-package ──
    // Build a Code Context Package for a specific query (file, function, route, feature)
    if (url.startsWith("/api/coding-project/code-intelligence/context-package") && method === "GET") {
      try {
        const queryParams = new URLSearchParams(url.split("?")[1] || "");
        const query = {};
        if (queryParams.get("file")) query.filePath = queryParams.get("file");
        if (queryParams.get("function")) query.functionName = queryParams.get("function");
        if (queryParams.get("route")) query.routePath = queryParams.get("route");
        if (queryParams.get("feature")) query.featureName = queryParams.get("feature");
        const contextPkg = await buildContextPackage(root, PAAW_ROOT, query);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(contextPkg));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return true;
    }

    // ── GET /api/coding-project/code-intelligence/:type ──
    // Load a specific intelligence file (call-graph, dependency-graph, etc.)
    const ciMatch = url.match(/^\/api\/coding-project\/code-intelligence\/([a-z-]+)\??/);
    if (ciMatch && method === "GET") {
      const ciType = ciMatch[1];
      const validTypes = ["call-graph", "api-function-map", "dependency-graph", "test-code-map", "symbol-index", "file-map", "summary"];
      if (validTypes.includes(ciType)) {
        const ciFile = join(root, ".paaw", "code-intelligence", `${ciType}.json`);
        if (!existsSync(ciFile)) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `${ciType}.json not found. Run code intelligence first.` }));
          return true;
        }
        try {
          const data = await readFile(ciFile, "utf-8");
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(data);
        } catch {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `Failed to read ${ciType}.json` }));
        }
        return true;
      }
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
      const cuModelOverride = body.model || null;

      const ALL_STEPS = [
        { id: "scan", name: "🔍 掃描專案結構", promptFile: "scan-project.md" },
        { id: "architecture", name: "📐 產出 Architecture Map", promptFile: "gen-architecture.md" },
        { id: "feature-map", name: "🗺️ 產出 Feature Map", promptFile: "gen-feature-map.md" },
        { id: "api-spec", name: "📡 產出 API Contract", promptFile: "gen-api-spec.md" },
        { id: "code-intelligence", name: "🧠 Code Intelligence", promptFile: null },
        { id: "test-intelligence", name: "🧪 Test Intelligence", promptFile: null },
        { id: "error-mapping", name: "🐛 產出 Error Map + Runbooks", promptFile: "gen-error-mapping.md" },
        { id: "security-scan", name: "🔒 安全掃描 (Semgrep)", promptFile: null },
        { id: "standards", name: "🏛️ 產出 Coding Standards", promptFile: "gen-standards.md" },
        { id: "overview", name: "📊 產出 PROJECT.md", promptFile: "gen-overview.md" },
        { id: "change-intelligence", name: "🔄 Change Intelligence", promptFile: null },
        // Optional steps (available but not in default bulk flow)
        { id: "decisions", name: "📋 產出 Decision Records (ADR)", promptFile: "gen-decisions.md" },
        { id: "test-payload", name: "🧪 產出 Test Payloads", promptFile: "gen-test-payload.md" },
        { id: "faq", name: "🤖 產出 HelpDesk FAQ", promptFile: "gen-faq.md" },
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
      const sendEvent = (event, data) => { if (res.writableEnded || res.destroyed) return; try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {} };

      try {
        await paaw.init();

        // Gather project context
        let projectContext = `Project root: ${root}\n`;
        try {
          const pkg = JSON.parse(readSync(join(root, "package.json"), "utf-8"));
          projectContext += `Package: ${pkg.name || "unknown"}\nDependencies: ${Object.keys(pkg.dependencies || {}).join(", ")}\n`;
        } catch {}
        try {
          const treeOutput = await scanProjectFiles(root);
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

        // Special handling: security-scan runs Semgrep (no LLM needed)
        if (step.id === "security-scan") {
          try {
            cuLog(step.id, "Running Semgrep scan...");
            const scanResult = await runSemgrep(root, { timeoutMs: 1_800_000 });
            if (scanResult.error && scanResult.findings.length === 0) {
              sendEvent("step_error", { step: step.id, name: step.name, error: scanResult.error });
              sendEvent("done", { message: "Semgrep scan failed" });
              if (!res.writableEnded) res.end();
              return true;
            }
            // Save results
            const secDir = join(root, ".paaw", "security");
            if (!existsSync(secDir)) await mkdir(secDir, { recursive: true });
            await writeFile(join(secDir, "scan-results.json"), JSON.stringify(scanResult, null, 2), "utf-8");
            cuLog(step.id, `Semgrep done: ${scanResult.stats.total} findings, ${scanResult.stats.filesAffected || 0} files affected`);
            sendEvent("step_done", {
              step: step.id,
              name: step.name,
              summary: `${scanResult.stats.total} findings (${JSON.stringify(scanResult.stats.bySeverity)})`,
              stats: scanResult.stats,
              findings: (scanResult.findings || []).map(f => ({
                id: f.id,
                severity: f.severity,
                file: f.file,
                line: f.line,
                message: f.message,
                snippet: f.snippet,
                fix: f.fix,
                category: f.category,
              })),
            });
            try { await paaw.setCuStepStatus(step.id, "done", { summary: `${scanResult.stats.total} findings` }); } catch {}
          } catch (err) {
            cuLog(step.id, `Semgrep failed: ${err.message}`);
            sendEvent("step_error", { step: step.id, name: step.name, error: err.message });
            sendEvent("done", { message: "Security scan failed" });
            if (!res.writableEnded) res.end();
            return true;
          }
          sendEvent("done", { message: "Security scan complete" });
          if (!res.writableEnded) res.end();
          return true;
        }

        // Special handling: code-intelligence runs Tree-sitter analysis (no LLM needed)
        if (step.id === "code-intelligence") {
          try {
            cuLog(step.id, "Building code intelligence (call graph, dependency graph, etc.)...");
            const { summary } = await buildCodeIntelligence(root, PAAW_ROOT);
            cuLog(step.id, `Code intelligence done: ${summary.callGraph.totalFunctions} functions, ${summary.callGraph.totalCalls} calls, ${summary.dependencyGraph.totalEdges} dependencies`);
            sendEvent("step_done", {
              step: step.id,
              name: step.name,
              summary: `${summary.callGraph.totalFunctions} functions, ${summary.callGraph.totalCalls} calls, ${summary.symbolIndex.total} symbols`,
              stats: summary,
              codeIntelligenceSummary: {
                totalFunctions: summary.callGraph?.totalFunctions || 0,
                totalCalls: summary.callGraph?.totalCalls || 0,
                totalDependencies: summary.dependencyGraph?.totalEdges || 0,
                totalSymbols: summary.symbolIndex?.total || 0,
                topFunctions: (summary.callGraph?.topFunctions || []).slice(0, 20).map((f) => `${f.name} (${f.file}:${f.line}, called ${f.callCount}x)`),
                topDependencies: (summary.dependencyGraph?.topEdges || []).slice(0, 15).map((e) => `${e.from} → ${e.to}`),
              },
            });
            try { await paaw.setCuStepStatus(step.id, "done", { summary: `${summary.callGraph.totalFunctions} functions` }); } catch {}
          } catch (err) {
            cuLog(step.id, `Code intelligence failed: ${err.message}`);
            sendEvent("step_error", { step: step.id, name: step.name, error: err.message });
          }
          sendEvent("done", { message: "Code intelligence complete" });
          res.end();
          return true;
        }

        // Special handling: test-intelligence runs static analysis (no LLM needed)
        if (step.id === "test-intelligence") {
          try {
            cuLog(step.id, "Building test intelligence...");
            const { summary } = await buildTestIntelligence(root, PAAW_ROOT);
            cuLog(step.id, `Test intelligence done: ${summary.totalTestFiles} tests, ${summary.coverageRate} coverage`);
            sendEvent("step_done", {
              step: step.id,
              name: step.name,
              summary: `${summary.totalTestFiles} tests, ${summary.coverageRate} coverage`,
              stats: summary,
              testIntelligenceSummary: {
                totalTestFiles: summary.totalTestFiles || 0,
                coverageRate: summary.coverageRate || "N/A",
                untestedFiles: (summary.untestedFiles || []).slice(0, 20),
                lowCoverageFiles: (summary.lowCoverageFiles || []).slice(0, 15).map((f) => `${f.file} (${f.coverage || "0%"})`),
              },
            });
            try { await paaw.setCuStepStatus(step.id, "done", { summary: `${summary.totalTestFiles} tests` }); } catch {}
          } catch (err) {
            cuLog(step.id, `Test intelligence failed: ${err.message}`);
            sendEvent("step_error", { step: step.id, name: step.name, error: err.message });
          }
          sendEvent("done", { message: "Test intelligence complete" });
          res.end();
          return true;
        }

        // Special handling: change-intelligence runs git log analysis (no LLM needed)
        if (step.id === "change-intelligence") {
          try {
            cuLog(step.id, "Building change intelligence...");
            const { summary } = await buildChangeIntelligence(root, { days: 30, maxCommits: 50 });
            cuLog(step.id, `Change intelligence done: ${summary.totalCommits} commits, ${summary.totalFilesChanged} files changed`);
            sendEvent("step_done", {
              step: step.id,
              name: step.name,
              summary: `${summary.totalCommits} commits, ${summary.totalFilesChanged} files, ${summary.highImpactChanges} high-impact`,
              stats: summary,
            });
            try { await paaw.setCuStepStatus(step.id, "done", { summary: `${summary.totalCommits} commits` }); } catch {}
          } catch (err) {
            cuLog(step.id, `Change intelligence failed: ${err.message}`);
            sendEvent("step_error", { step: step.id, name: step.name, error: err.message });
          }
          sendEvent("done", { message: "Change intelligence complete" });
          res.end();
          return true;
        }

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
            model: cuModelOverride || undefined,
            messages: [{ role: "user", content: fullPrompt }],
            temperature: 0.2,
            maxTokens: 16000,
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
              // Extract api-examples from ```json-examples block
              const examplesMatch = content.match(/```json-examples\s*\n([\s\S]*?)\n```/);
              if (examplesMatch) {
                try {
                  const examples = JSON.parse(examplesMatch[1].trim());
                  if (Array.isArray(examples)) {
                    await paaw.writeFile("code-intelligence/api-examples.json", JSON.stringify(examples, null, 2));
                    cuLog(step.id, `Saved ${examples.length} API examples`);
                  }
                } catch (e) {
                  cuLog(step.id, `Failed to parse api-examples: ${e.message}`);
                }
              }
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
          try { await paaw.setCuStepStatus(step.id, "done", { size: content.length }); } catch {}
        } catch (err) {
          sendEvent("step_error", { step: step.id, name: step.name, error: err.message });
          try { await paaw.setCuStepStatus(step.id, "error", { error: err.message }); } catch {}
        }
        // If this was the feature-map step, run L3 validation
        if (stepId === "feature-map") {
          try {
            const { runFullValidation } = await import("../lib/feature-map-validator.mjs");
            const validation = await runFullValidation(root, { skipUnderstanding: true });
            if (validation.ok) {
              const s = validation.summary;
              sendEvent("info", { message: `L3 validation: ${s.mappingErrors} errors, ${s.coveragePct}% coverage, ${s.orphanFiles} orphans` });
            }
          } catch {}
        }
        sendEvent("done", { message: "Step complete" });
      } catch (err) {
        sendEvent("error", { error: err.message });
      }
      res.end();
      return true;
    }

    // POST /api/coding-project/ai-initial (Code Understanding)
    // ?force=1 to re-run all steps even if already done
    if (url.startsWith("/api/coding-project/ai-initial") && method === "POST") {
      const forceRerun = q.force === "1" || q.force === "true";
      const steps = [
        { id: "scan", name: "🔍 掃描專案結構", promptFile: "scan-project.md" },
        { id: "architecture", name: "📐 產出 Architecture Map", promptFile: "gen-architecture.md" },
        { id: "feature-map", name: "🗺️ 產出 Feature Map", promptFile: "gen-feature-map.md" },
        { id: "api-spec", name: "📡 產出 API Contract", promptFile: "gen-api-spec.md" },
        { id: "code-intelligence", name: "🧠 Code Intelligence", promptFile: null },
        { id: "test-intelligence", name: "🧪 Test Intelligence", promptFile: null },
        { id: "error-mapping", name: "🐛 產出 Error Map + Runbooks", promptFile: "gen-error-mapping.md" },
        { id: "security-scan", name: "🔒 安全掃描 (Semgrep)", promptFile: null },
        { id: "standards", name: "🏛️ 產出 Coding Standards", promptFile: "gen-standards.md" },
        { id: "overview", name: "📊 產出 PROJECT.md", promptFile: "gen-overview.md" },
        { id: "change-intelligence", name: "🔄 Change Intelligence", promptFile: null },
      ];

      // SSE stream — send progress as each step completes
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });

      const sendEvent = (event, data) => {
        if (res.writableEnded || res.destroyed) return;
        try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {}
      };

      try {
        // Ensure .paaw/ exists
        await paaw.init();

        // Read model override from request body
        let cuModelOverride = null;
        try { const cuBody = JSON.parse(await readBody(req) || "{}"); cuModelOverride = cuBody.model || null; } catch {}

        // Gather project info for context
        let projectContext = `Project root: ${root}\n`;
        try {
          const pkg = JSON.parse(readSync(join(root, "package.json"), "utf-8"));
          projectContext += `Package: ${pkg.name || "unknown"}\nDependencies: ${Object.keys(pkg.dependencies || {}).join(", ")}\n`;
        } catch {}

        // Get file tree
        try {
          const treeOutput = await scanProjectFiles(root);
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

        // ── Check which steps are already done — skip them ──
        const cuStatus = await paaw.getCuStatus();
        const cuSteps = cuStatus.steps || {};

        // Accumulate context from previous steps
        let scanResult = "";
        let architectureResult = "";
        let apiSpecResult = "";
        let errorMappingResult = "";
        let decisionsResult = "";

        for (const step of steps) {
          // ── Skip if this step was already done (unless force rerun) ──
          if (!forceRerun && cuSteps[step.id]?.status === "done") {
            cuLog(step.id, `Skipping — already done`);
            sendEvent("step_skip", { step: step.id, name: step.name, reason: "Already done" });
            continue;
          }

          sendEvent("step_start", { step: step.id, name: step.name });

          // Special handling: security-scan runs Semgrep (no LLM needed)
          if (step.id === "security-scan") {
            try {
              cuLog(step.id, "[bulk] Running Semgrep scan...");
              const scanResult = await runSemgrep(root, { timeoutMs: 1_800_000 });
              if (scanResult.error && scanResult.findings.length === 0) {
                sendEvent("step_skip", { step: step.id, name: step.name, reason: scanResult.error.split('\n')[0] });
                continue;
              }
              const secDir = join(root, ".paaw", "security");
              if (!existsSync(secDir)) await mkdir(secDir, { recursive: true });
              await writeFile(join(secDir, "scan-results.json"), JSON.stringify(scanResult, null, 2), "utf-8");
              cuLog(step.id, `[bulk] Semgrep done: ${scanResult.stats.total} findings`);
              sendEvent("step_done", { step: step.id, name: step.name, summary: `${scanResult.stats.total} findings`, stats: scanResult.stats });
              try { await paaw.setCuStepStatus(step.id, "done", { summary: `${scanResult.stats.total} findings` }); } catch {}
            } catch (err) {
              cuLog(step.id, `[bulk] Semgrep failed: ${err.message}`);
              sendEvent("step_error", { step: step.id, name: step.name, error: err.message });
              try { await paaw.setCuStepStatus(step.id, "error", { error: err.message }); } catch {}
            }
            continue;
          }

          // Special handling: code-intelligence runs Tree-sitter analysis (no LLM needed)
          if (step.id === "code-intelligence") {
            try {
              cuLog(step.id, "[bulk] Building code intelligence...");
              const { summary } = await buildCodeIntelligence(root, PAAW_ROOT);
              cuLog(step.id, `[bulk] Code intelligence done: ${summary.callGraph.totalFunctions} functions, ${summary.callGraph.totalCalls} calls`);
              sendEvent("step_done", { step: step.id, name: step.name, summary: `${summary.callGraph.totalFunctions} functions, ${summary.symbolIndex.total} symbols`, stats: summary });
              try { await paaw.setCuStepStatus(step.id, "done", { summary: `${summary.callGraph.totalFunctions} functions` }); } catch {}
            } catch (err) {
              cuLog(step.id, `[bulk] Code intelligence failed: ${err.message}`);
              sendEvent("step_error", { step: step.id, name: step.name, error: err.message });
              try { await paaw.setCuStepStatus(step.id, "error", { error: err.message }); } catch {}
            }
            continue;
          }

          // Special handling: test-intelligence (no LLM)
          if (step.id === "test-intelligence") {
            try {
              cuLog(step.id, "[bulk] Building test intelligence...");
              const { summary } = await buildTestIntelligence(root, PAAW_ROOT);
              cuLog(step.id, `[bulk] Test intelligence: ${summary.totalTestFiles} tests, ${summary.coverageRate} coverage`);
              sendEvent("step_done", { step: step.id, name: step.name, summary: `${summary.totalTestFiles} tests, ${summary.coverageRate} coverage`, stats: summary });
              try { await paaw.setCuStepStatus(step.id, "done", { summary: `${summary.totalTestFiles} tests` }); } catch {}
            } catch (err) {
              cuLog(step.id, `[bulk] Test intelligence failed: ${err.message}`);
              sendEvent("step_error", { step: step.id, name: step.name, error: err.message });
              try { await paaw.setCuStepStatus(step.id, "error", { error: err.message }); } catch {}
            }
            continue;
          }

          // Special handling: change-intelligence (no LLM)
          if (step.id === "change-intelligence") {
            try {
              cuLog(step.id, "[bulk] Building change intelligence...");
              const { summary } = await buildChangeIntelligence(root, { days: 30, maxCommits: 50 });
              cuLog(step.id, `[bulk] Change intelligence: ${summary.totalCommits} commits, ${summary.totalFilesChanged} files`);
              sendEvent("step_done", { step: step.id, name: step.name, summary: `${summary.totalCommits} commits, ${summary.totalFilesChanged} files`, stats: summary });
              try { await paaw.setCuStepStatus(step.id, "done", { summary: `${summary.totalCommits} commits` }); } catch {}
            } catch (err) {
              cuLog(step.id, `[bulk] Change intelligence failed: ${err.message}`);
              sendEvent("step_error", { step: step.id, name: step.name, error: err.message });
              try { await paaw.setCuStepStatus(step.id, "error", { error: err.message }); } catch {}
            }
            continue;
          }

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
              model: cuModelOverride || undefined,
              messages: [{ role: "user", content: fullPrompt }],
              temperature: 0.2,
              maxTokens: 16000,
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
            try { await paaw.setCuStepStatus(step.id, "done", { size: content.length }); } catch {}
          } catch (err) {
            sendEvent("step_error", { step: step.id, name: step.name, error: err.message });
            try { await paaw.setCuStepStatus(step.id, "error", { error: err.message }); } catch {}
          }
        }

        // ── L3 Validation after all steps complete ──
        sendEvent("step_start", { step: "validate", name: "🔍 L3 驗證 Feature Map" });
        try {
          const { runFullValidation } = await import("../lib/feature-map-validator.mjs");
          const validation = await runFullValidation(root, { skipUnderstanding: true });
          if (validation.ok) {
            const s = validation.summary;
            sendEvent("step_done", {
              step: "validate",
              name: "🔍 L3 驗證 Feature Map",
              summary: `${s.mappingErrors} errors, ${s.coveragePct}% coverage, ${s.orphanFiles} orphans`,
              validation: s,
            });
            if (s.mappingErrors > 0) {
              sendEvent("warning", { message: `Feature Map 有 ${s.mappingErrors} 個錯誤（檔案不存在），建議重新執行 Feature Map 步驟` });
            }
          } else {
            sendEvent("step_done", { step: "validate", name: "🔍 L3 驗證", summary: validation.error || "Skipped" });
          }
        } catch (err) {
          sendEvent("step_done", { step: "validate", name: "🔍 L3 驗證", summary: `Skipped: ${err.message}` });
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
      const { domain, prompt, history, model: modelOverride } = JSON.parse(await readBody(req));
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
        if (res.writableEnded || res.destroyed) return;
        try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {}
      };

      try {
        // Load domain system prompt
        // Priority: .paaw/prompts/{domain}-ai/ → ai-settings/domain-ai/{domain}/ → prompts/{domain}-ai/
        const aiSettingsBase = join(PAAW_ROOT, "data", "ai-settings", "domain-ai");
        const legacyPromptsBase = join(PAAW_ROOT, "data", "prompts");
        const domainPromptDir = join(legacyPromptsBase, `${domain}-ai`);
        const aiSettingsDomainDir = join(aiSettingsBase, domain);
        const systemPromptFile = resolve(aiSettingsBase, "system-prompt.md");
        const legacySystemPromptFile = resolve(legacyPromptsBase, "domain-ai-system.md");
        let systemPrompt = "";
        try { systemPrompt = readSync(systemPromptFile, "utf-8"); } catch {
          try { systemPrompt = readSync(legacySystemPromptFile, "utf-8"); } catch {}
        }

        // Load all domain prompts (from ai-settings first, then legacy prompts/)
        let domainContext = "";
        const loadedFiles = new Set();
        try {
          const aiFiles = await readdir(aiSettingsDomainDir);
          for (const f of aiFiles.filter(f => f.endsWith(".md")).sort()) {
            loadedFiles.add(f);
            domainContext += `\n--- ${f} ---\n${readSync(resolve(aiSettingsDomainDir, f), "utf-8")}`;
          }
        } catch {}
        try {
          const domainFiles = await readdir(domainPromptDir);
          for (const f of domainFiles.filter(f => f.endsWith(".md")).sort()) {
            if (!loadedFiles.has(f)) {
              domainContext += `\n--- ${f} ---\n${readSync(resolve(domainPromptDir, f), "utf-8")}`;
            }
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
          model: modelOverride || undefined,
          messages,
          temperature: 0.3,
          maxTokens: 16000,
        });

        sendEvent("done", { content: result.content || "" });
      } catch (err) {
        sendEvent("error", { error: err.message });
      }
      res.end();
      return true;
    }

    // GET /api/coding-project/cu-status — CU step statuses
    if (url.startsWith("/api/coding-project/cu-status") && method === "GET") {
      try {
        const cuStatus = await paaw.getCuStatus();
        const steps = cuStatus.steps || {};
        const doneCount = Object.values(steps).filter(s => s?.status === "done").length;
        const errorCount = Object.values(steps).filter(s => s?.status === "error").length;
        const { count: sourceFiles, lastModifiedMs } = countSourceFiles(root);
        const staleSteps = computeCuStaleness(root, steps, lastModifiedMs);
        res.writeHead(200, { "Content-Type": "application/json" });
        // CU lifecycle 原料：前端據此算 phase（missing/no-code/ready/partial/done/stale）
        res.end(JSON.stringify({
          ...cuStatus,
          hasPaaw: existsSync(join(root, ".paaw")),
          sourceFiles,
          doneCount,
          errorCount,
          codeLastModified: lastModifiedMs > 0 ? new Date(lastModifiedMs).toISOString() : null,
          staleSteps,
          staleCount: staleSteps.length,
        }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return true;
    }

    // POST /api/coding-project/cu-rescan-mechanical — 手動重掃機械層（免 token 秒級）
    // 智能層（LLM 生成的文檔）永遠不在此自動重跑 — 過期時 UI 提醒人決定
    if (url.startsWith("/api/coding-project/cu-rescan-mechanical") && method === "POST") {
      try {
        await paaw.init(); // 確保 .paaw 存在（無 .paaw 時先建骨架）
        const result = await rescanMechanicalLayer(root, PAAW_ROOT);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return true;
    }

    // POST /api/coding-project/status/refresh — invalidate cache + recompute
    if (url.startsWith("/api/coding-project/status/refresh") && method === "POST") {
      try {
        const refreshRoot = projectPath ? resolve(projectPath) : PAAW_ROOT;
        const cacheFile = join(refreshRoot, ".paaw", "code-intelligence", "status-cache.json");
        if (existsSync(cacheFile)) {
          try { await import("fs/promises").then(m => m.unlink(cacheFile)); } catch {}
        }
        const paaw = createPaawProject(refreshRoot);
        const scores = await paaw.computeStatus();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, initialized: !!scores, scores }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
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
        if (res.writableEnded || res.destroyed) return;
        try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {}
      };

      try {
        await paaw.init();

        let projectContext = `Project root: ${root}\n`;
        try {
          const pkg = JSON.parse(readSync(join(root, "package.json"), "utf-8"));
          projectContext += `Package: ${pkg.name || "unknown"}\n`;
        } catch {}
        try {
          const treeOutput = await scanProjectFiles(root);
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
              maxTokens: 16000,
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
      maxTokens: 16000,
    });
    return result.content || null;
  } catch (err) {
    console.error("[project route] generate-standards error:", err.message);
    return null;
  }
}

// ── Shell helper ──

async function runShellCmd(command, cwd, timeoutMs = 10_000) {
  try {
    const { stdout, stderr } = await shellExec(command, {
      cwd, timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024,
    });
    return (stdout || "") + (stderr ? "\n" + stderr : "");
  } catch (e) {
    let output = e.stdout || "";
    if (e.stderr) output += (output ? "\n" : "") + e.stderr;
    return output;
  }
}

// ── Cross-platform file tree scan (Windows has no Unix 'find') ──
function scanProjectFiles(cwd, maxFiles = 0) {
  const isWin = process.platform === "win32";
  // Only scan source code files — no JSON/MD/data files
  // maxFiles=0 means no limit (scan all)
  const limitPart = maxFiles > 0 ? `.slice(0,${maxFiles})` : "";
  const headPart = maxFiles > 0 ? ` | head -${maxFiles}` : "";
  const winSlice = maxFiles > 0 ? `f.slice(0,${maxFiles})` : "f";
  const cmd = isWin
    ? `node -e "const{readdirSync:r,statSync:s}=require('fs');const{join:j}=require('path');function walk(d,a){for(const e of r(d)){const p=j(d,e);try{if(s(p).isDirectory()){if(!e.includes('node_modules')&&!e.includes('dist')&&!e.includes('build')&&!e.includes('coverage')&&!e.startsWith('.'))walk(p,a)}else if(/\.(ts|tsx|mjs|js|cjs|jsx|py|java|go|rb|php)$/.test(e))a.push(p.replace(/\\\\/g,'/'))}}catch{}}const f=[];walk('.',f);console.log(${winSlice}.join('\\n'))"`
    : "find . -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.mjs' -o -name '*.js' -o -name '*.cjs' -o -name '*.jsx' -o -name '*.py' -o -name '*.java' -o -name '*.go' -o -name '*.rb' -o -name '*.php' \) -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/.paaw/*' -not -path '*/dist/*' -not -path '*/build/*' -not -path '*/coverage/*' -not -path '*/data/semgrep-rules/*'" + headPart;
  return runShellCmd(cmd, cwd, 30_000);
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

  // ── .paaw/ completeness with fix plans ──
  const expectedFiles = ["PROJECT.md", "ARCHITECTURE.md", "DECISIONS.md", "CHANGELOG.md", "CODING-STANDARDS.md"];
  // Fix plans for each missing file
  const fixPlans = {
    "PROJECT.md": { steps: [{ agent: "architect", task: "建立 .paaw/PROJECT.md，分析專案結構，撰寫專案概述、技術棧、目標使用者等" }], estimatedMinutes: 60 },
    "ARCHITECTURE.md": { steps: [{ agent: "architect", task: "建立 .paaw/ARCHITECTURE.md，分析專案目錄結構、模組依賴、資料流，畫出架構圖" }], estimatedMinutes: 60 },
    "DECISIONS.md": { steps: [{ agent: "doc-writer", task: "建立 .paaw/DECISIONS.md，根據現有程式碼和架構推導技術決策，記錄 ADR (Architecture Decision Records)" }], estimatedMinutes: 60 },
    "CHANGELOG.md": { steps: [{ agent: "doc-writer", task: "建立 .paaw/CHANGELOG.md，從 git log 推導版本歷史和重要變更" }], estimatedMinutes: 60 },
    "CODING-STANDARDS.md": { steps: [{ agent: "architect", task: "建立 .paaw/CODING-STANDARDS.md，分析現有程式碼風格，整理命名規規範、檔案結構、錯誤處理規則" }], estimatedMinutes: 60 },
  };
  const fixHints = {
    "PROJECT.md": "No project overview",
    "ARCHITECTURE.md": "No architecture map",
    "DECISIONS.md": "No ADRs",
    "CHANGELOG.md": "No changelog",
    "CODING-STANDARDS.md": "No coding standards",
    "sessions/": "No session history",
    "standards/": "No standards dir",
  };
  let existCount = 0;
  for (const f of expectedFiles) {
    const content = await paaw.readFile(f);
    const exists = content !== null;
    if (exists) existCount++;
    health.paawCompleteness.files.push({
      name: f,
      exists,
      size: exists ? content.length : undefined,
      hint: !exists ? (fixHints[f] || `Missing ${f}`) : undefined,
      fixPlan: !exists ? (fixPlans[f] || { steps: [{ agent: "developer", task: `建立 .paaw/${f}` }], estimatedMinutes: 60 }) : undefined,
    });
  }
  // Check subdirs
  const dirFixPlans = {
    "sessions/": { steps: [{ agent: "developer", task: "建立 .paaw/sessions/ 目錄，確保 AI session 歷史可以儲存" }], estimatedMinutes: 60 },
    "standards/": { steps: [{ agent: "architect", task: "建立 .paaw/standards/ 目錄和基本標準文件" }], estimatedMinutes: 60 },
  };
  for (const d of ["sessions", "standards"]) {
    const dirPath = join(paaw.paawDir, d);
    const exists = existsSync(dirPath);
    if (exists) existCount++;
    const name = d + "/";
    health.paawCompleteness.files.push({
      name,
      exists,
      hint: !exists ? (fixHints[name] || `Missing ${name}`) : undefined,
      fixPlan: !exists ? (dirFixPlans[name] || { steps: [{ agent: "developer", task: `建立 .paaw/${name}` }], estimatedMinutes: 60 }) : undefined,
    });
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

  // ── Fix items (actionable health issues with fixPlan) ──
  const fixItems = [];
  const fixId = (cat, name) => `health-${cat}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  // Missing .paaw/ docs → docWriter
  for (const f of health.paawCompleteness.files) {
    if (!f.exists && !f.name.endsWith("/")) {
      fixItems.push({
        id: fixId("paaw", f.name),
        severity: "medium",
        category: "documentation",
        title: `缺少 .paaw/${f.name}`,
        description: `${f.name} 是重要的專案知識文件，建議補齊`,
        fixPlan: {
          steps: [
            { agent: "doc-writer", task: `建立 .paaw/${f.name}，內容根據現有專案程式碼和架構推導` },
          ],
          estimatedMinutes: 60,
        },
      });
    }
  }

  // Missing .paaw/ subdirs
  for (const f of health.paawCompleteness.files) {
    if (!f.exists && f.name.endsWith("/")) {
      fixItems.push({
        id: fixId("paaw", f.name),
        severity: "low",
        category: "structure",
        title: `缺少 .paaw/${f.name} 目錄`,
        description: `建議建立 ${f.name} 目錄以組織專案知識`,
        fixPlan: {
          steps: [
            { agent: "doc-writer", task: `建立 .paaw/${f.name} 目錄及基本內容` },
          ],
          estimatedMinutes: 60,
        },
      });
    }
  }

  // Git: uncommitted changes → commit
  if (health.git.uncommitted > 5) {
    fixItems.push({
      id: fixId("git", "uncommitted"),
      severity: "medium",
      category: "git",
      title: `${health.git.uncommitted} 個未提交的變更`,
      description: "工作目錄有大量未提交變更，建議整理後提交",
      fixPlan: {
        steps: [
          { agent: "developer", task: "整理 uncommitted 變更，分組 stage + 準備 commit message（只 git add，不 commit）" },
        ],
        estimatedMinutes: 60,
      },
    });
  }

  // Git: no remote
  if (!health.git.remote) {
    fixItems.push({
      id: fixId("git", "no-remote"),
      severity: "high",
      category: "git",
      title: "沒有設定 Git Remote",
      description: "建議設定 remote origin 以便 push 和協作",
      fixPlan: {
        steps: [
          { agent: "developer", task: "幫使用者設定 git remote origin（詢問 repo URL）" },
        ],
        estimatedMinutes: 60,
      },
    });
  }

  // Low paaw score → comprehensive doc fix
  if (health.paawCompleteness.score < 50) {
    fixItems.push({
      id: fixId("paaw", "low-score"),
      severity: "high",
      category: "documentation",
      title: `.paaw/ 健康分數過低 (${health.paawCompleteness.score}/100)`,
      description: "知識文件嚴重不足，建議全面補齊",
      fixPlan: {
        steps: [
          { agent: "doc-writer", task: "建立 .paaw/PROJECT.md，描述專案目標和架構" },
          { agent: "doc-writer", task: "建立 .paaw/DECISIONS.md，記錄重要架構決策" },
          { agent: "doc-writer", task: "建立 .paaw/CODING-STANDARDS.md，記錄程式碼規範" },
        ],
        estimatedMinutes: 60,
      },
    });
  }

  health.fixItems = fixItems;

  return health;
}
