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

import { readdir, readFile, writeFile, mkdir, unlink } from "fs/promises";
import { existsSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PAAW_ROOT = resolve(__dirname, "../../../..");
const DATA_DIR = resolve(PAAW_ROOT, "data");
const TASKS_DIR = resolve(DATA_DIR, "a2a-tasks");
const CONFIG_DIR = resolve(DATA_DIR, "config");

await mkdir(TASKS_DIR, { recursive: true });

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

// ── Task Storage ──

async function saveTask(task) {
  await writeFile(resolve(TASKS_DIR, `${task.id}.json`), JSON.stringify(task, null, 2));
  return task;
}

async function getTask(taskId) {
  try {
    return JSON.parse(await readFile(resolve(TASKS_DIR, `${taskId}.json`), "utf-8"));
  } catch {
    return null;
  }
}

async function listTasks() {
  try {
    const files = await readdir(TASKS_DIR);
    const tasks = [];
    for (const f of files.filter(f => f.endsWith(".json")).sort().reverse()) {
      try { tasks.push(JSON.parse(await readFile(resolve(TASKS_DIR, f), "utf-8"))); } catch {}
    }
    return tasks;
  } catch {
    return [];
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
    history: [{ role: "user", parts: [{ type: "text", text: extractText(message) }] }],
    artifacts: [],
    metadata: {},
  };
}

function extractText(message) {
  if (!message?.parts) return "";
  return message.parts
    .filter(p => p.type === "text")
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
    protocolVersion: "1.0.0",
    name: "PAAW Agent",
    description: "Personal AI Assistant Workspace — A2A-enabled agent that can execute skills, manage data apps, and collaborate with other agents.",
    url: `${baseUrl}/a2a`,
    version: "1.0.0",
    capabilities: {
      streaming: true,
      pushNotifications: false,
      stateTransition: true,
    },
    defaultInputModes: ["text"],
    defaultOutputModes: ["text"],
    skills: [
      {
        id: "paaw-chat",
        name: "PAAW Chat",
        description: "General AI assistant — can chat, answer questions, and execute PAAW skills/apps",
        tags: ["chat", "assistant", "general"],
        inputModes: ["text"],
        outputModes: ["text"],
      },
      {
        id: "paaw-skill-exec",
        name: "Skill Executor",
        description: "Execute any registered PAAW skill via natural language",
        tags: ["skill", "execution"],
        inputModes: ["text"],
        outputModes: ["text"],
      },
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
  const { ToolEngine } = await import("../lib/tool-engine/index.mjs");
  const { getToolsAndHandlers } = await import("../tools/index.mjs");

  // Load provider config
  const providerConfig = JSON.parse(await readFile(resolve(CONFIG_DIR, "providers.json"), "utf-8"));
  const providerId = providerConfig.active;
  const provider = providerConfig.providers[providerId];
  if (!provider?.apiKey || provider.apiKey === "na") {
    throw new Error(`No API key for provider: ${providerId}`);
  }
  const model = providerConfig.defaultModel || "glm-5.1";

  // Build context (reuse chat context)
  const ctx = await contextEngine.build({ target: "chat" });

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
  if (req.method === "GET" && path === "/.well-known/agent.json") {
    sendJSON(res, 200, getAgentCard(req));
    return true;
  }

  // ════════════════════════════════════════
  // POST /a2a — JSON-RPC 2.0 endpoint
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

        // Create task
        const task = makeTask({ message, contextId: params?.contextId });
        task.status = { state: "working", timestamp: new Date().toISOString() };
        await saveTask(task);

        console.log(`[A2A] message/send task=${task.id} text="${userText.slice(0, 80)}..."`);

        // Run agent synchronously
        const result = await runAgentLoop({ message });

        // Update task
        task.status = { state: "completed", timestamp: new Date().toISOString() };
        task.history.push({ role: "agent", parts: [{ type: "text", text: result.text }] });
        task.artifacts = [{
          artifactId: `art-${Date.now()}`,
          name: "Response",
          parts: [{ type: "text", text: result.text }],
        }];
        task.metadata = { toolsUsed: result.toolsUsed, model: "paaw-default" };
        await saveTask(task);

        console.log(`[A2A] task=${task.id} completed tools=${result.toolsUsed.join(",")}`);

        sendJSON(res, 200, {
          jsonrpc: "2.0",
          result: task,
          id,
        });
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
        const task = makeTask({ message, contextId: params?.contextId });
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
                    parts: [{ type: "text", text: chunk.delta }],
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
                    message: { role: "agent", parts: [{ type: "text", text: `🔧 ${chunk.name}(...)` }] },
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
        task.history.push({ role: "agent", parts: [{ type: "text", text: result.text }] });
        task.artifacts = [{
          artifactId: `art-final-${Date.now()}`,
          name: "Response",
          parts: [{ type: "text", text: result.text }],
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
