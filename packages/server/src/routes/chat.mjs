/**
 * Chat routes — CRUD + SSE streaming with Context Engine
 */
import { readdir, readFile, writeFile, mkdir, unlink } from "fs/promises";
import { resolve } from "path";
import { PATHS, readBody, json, urlPath } from "./context.mjs";

// ── Paths (reuse from context.mjs) ──
const PAAW_ROOT = PATHS.PAAW_ROOT;
const PAAW_DATA_DIR = resolve(PAAW_ROOT, "data");
const PAAW_USER_FILE = resolve(PAAW_DATA_DIR, "user.json");
const PAAW_CHAT_DIR = resolve(PAAW_DATA_DIR, "chats");
const APPS_ROOT = resolve(PAAW_ROOT, "data/apps");

// Ensure dirs exist
await mkdir(PAAW_CHAT_DIR, { recursive: true });

// ── Route handler ──
export default async function chatRoutes(req, res) {
  const path = urlPath(req);

  // ════════════════════════════════════════
  // Chat Session CRUD
  // ════════════════════════════════════════

  // GET /api/paaw/chats — list all chat sessions
  if (req.method === "GET" && path === "/api/paaw/chats") {
    try {
      const files = await readdir(PAAW_CHAT_DIR);
      const chats = [];
      for (const f of files.filter(f => f.endsWith(".json")).sort().reverse()) {
        try {
          const raw = JSON.parse(await readFile(resolve(PAAW_CHAT_DIR, f), "utf-8"));
          chats.push({ id: raw.id, title: raw.title || "新對話", messages: raw.messages || [], createdAt: raw.createdAt, updatedAt: raw.updatedAt });
        } catch {}
      }
      json(res, chats);
    } catch {
      json(res, []);
    }
    return true;
  }

  // GET /api/paaw/chats/:id — get single chat
  if (req.method === "GET" && path.startsWith("/api/paaw/chats/")) {
    const chatId = path.split("/").pop().replace(".json", "");
    try {
      const data = JSON.parse(await readFile(resolve(PAAW_CHAT_DIR, `${chatId}.json`), "utf-8"));
      json(res, data);
    } catch {
      json(res, { error: "Not found" }, 404);
    }
    return true;
  }

  // POST /api/paaw/chats — create new chat
  if (req.method === "POST" && path === "/api/paaw/chats") {
    const body = JSON.parse(await readBody(req));
    const chatId = body.id || `chat_${Date.now()}`;
    const chatData = { id: chatId, title: body.title || "新對話", messages: body.messages || [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await writeFile(resolve(PAAW_CHAT_DIR, `${chatId}.json`), JSON.stringify(chatData, null, 2), "utf-8");
    json(res, chatData);
    return true;
  }

  // PUT /api/paaw/chats/:id — update chat
  if (req.method === "PUT" && path.startsWith("/api/paaw/chats/")) {
    const chatId = path.split("/").pop().replace(".json", "");
    const filePath = resolve(PAAW_CHAT_DIR, `${chatId}.json`);
    let existing;
    try {
      existing = JSON.parse(await readFile(filePath, "utf-8"));
    } catch {
      existing = { id: chatId, title: "新對話", messages: [], createdAt: new Date().toISOString() };
    }
    const body = JSON.parse(await readBody(req));
    const updated = { ...existing, ...body, updatedAt: new Date().toISOString() };
    await writeFile(filePath, JSON.stringify(updated, null, 2), "utf-8");
    json(res, updated);
    return true;
  }

  // DELETE /api/paaw/chats/:id
  if (req.method === "DELETE" && path.startsWith("/api/paaw/chats/")) {
    const chatId = path.split("/").pop().replace(".json", "");
    try { await unlink(resolve(PAAW_CHAT_DIR, `${chatId}.json`)); } catch {}
    json(res, { ok: true });
    return true;
  }

  // ════════════════════════════════════════
  // Chat Completion (SSE streaming + Tool Engine)
  // ════════════════════════════════════════
  //
  // 主要邏輯委派給 Tool Engine（lib/tool-engine/），
  // Chat Route 只負責：
  //   1. 載入 provider config
  //   2. 載入 context（system prompt）
  //   3. 把 tools/index.mjs 的 handlers → ToolExecutor 格式
  //   4. 建立 ToolEngine，stream 結果給前端
  //   5. 記錄 distill 資料

  // POST /api/paaw/chat
  if (req.method === "POST" && path === "/api/paaw/chat") {
    try {
      const body = JSON.parse(await readBody(req));
      const { messages, model: requestedModel, provider: requestedProvider } = body;

      // ── Resolve provider ──
      const providerConfig = JSON.parse(await readFile(resolve(PAAW_DATA_DIR, "config/providers.json"), "utf-8"));
      const providerId = requestedProvider || providerConfig.active;
      const provider = providerConfig.providers[providerId];
      if (!provider) {
        json(res, { error: `Unknown provider: ${providerId}` }, 400);
        return true;
      }
      if (!provider.apiKey || provider.apiKey === "na") {
        json(res, { error: `No API key configured for provider: ${providerId}` }, 400);
        return true;
      }

      const model = requestedModel || providerConfig.defaultModel || "glm-5.1";

      // ── Context Engine: unified context assembly ──
      const { contextEngine } = await import("../context-engine.mjs");
      const ctx = await contextEngine.build({ target: "chat" });

      // ── SSE headers ──
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });

      // ── Load tool handlers & convert to executors ──
      const { getToolsAndHandlers, invalidateCache } = await import("../tools/index.mjs");
      const { tools: toolDefinitions, handlers: toolHandlers } = await getToolsAndHandlers();

      // 把 toolHandlers 轉成 ToolEngine 的 executor 格式
      const executors = Object.entries(toolHandlers).map(([name, handler]) => ({
        name,
        description: toolDefinitions.find(t => t.function.name === name)?.function?.description || name,
        parameters: toolDefinitions.find(t => t.function.name === name)?.function?.parameters || { type: 'object', properties: {} },
        execute: async (args) => {
          const result = await handler(args);
          // 有些 tool 需要 cache invalidation
          if (name === 'app_create' || name === 'app_edit') invalidateCache();
          return result
        },
      }))

      // ── 建立 Tool Engine（含 Security Kernel）──
      const { ToolEngine } = await import("../lib/tool-engine/index.mjs")
      const engine = new ToolEngine({
        provider: {
          id: providerId,
          baseURL: provider.baseURL,
          apiKey: provider.apiKey,
          defaultModel: model,
          extraHeaders: providerId === 'openrouter'
            ? { 'HTTP-Referer': 'https://paaw.ai', 'X-Title': 'PAAW' }
            : undefined,
        },
        executors,
        maxToolRounds: 5,
        // 啟用 Security Kernel
        security: {
          approval: { mode: process.env.NODE_ENV === 'development' ? 'auto' : 'always' },
          audit: { enabled: true },
        },
        sessionKey: req.headers['x-session-key'] || 'chat',
        agentId: 'default',
      })

      // ── 執行 ReAct loop，stream 給前端 ──
      let fullText = ''
      let toolsUsed = []

      for await (const chunk of engine.run(ctx.systemPrompt, messages || [], model)) {
        switch (chunk.type) {
          case 'text':
            fullText += chunk.delta
            res.write(`data: ${JSON.stringify({ content: chunk.delta })}\n\n`)
            break

          case 'tool_start':
            toolsUsed.push(chunk.name)
            res.write(`data: ${JSON.stringify({ tool_call: { name: chunk.name, args: chunk.args, status: 'executing' } })}\n\n`)
            break

          case 'tool_end':
            res.write(`data: ${JSON.stringify({ tool_result: { name: chunk.name, result: chunk.result } })}\n\n`)
            break

          case 'done':
            res.write('data: [DONE]\n\n')
            res.end()
            break

          case 'error':
            res.write(`data: ${JSON.stringify({ error: true, message: chunk.message })}\n\n`)
            res.end()
            break
        }
      }

      // ── Log AI interaction for distillation ──
      try {
        const { recordChatInteraction } = await import("./distill.mjs");
        const userMsgs = (messages || []).filter(m => m.role === "user");
        const lastUser = userMsgs.length > 0 ? userMsgs[userMsgs.length - 1].content : "";
        recordChatInteraction({
          user: typeof lastUser === "string" ? lastUser.slice(0, 1000) : JSON.stringify(lastUser).slice(0, 1000),
          assistant: fullText.slice(0, 3000),
          model,
          provider: providerId,
          tools: toolsUsed,
        });
      } catch {}
    } catch (err) {
      console.error("[chat] Error:", err.message);
      if (!res.headersSent) {
        json(res, { error: err.message }, 500);
      } else {
        res.write(`data: ${JSON.stringify({ error: true, message: err.message })}\n\n`);
        res.end();
      }
    }
    return true;
  }

  // ════════════════════════════════════════
  // System Prompt API（讀取/更新提示詞檔案）
  // ════════════════════════════════════════

  const SYSTEM_DIR = resolve(PAAW_DATA_DIR, "system");
  const CONTEXTS_CHAT_DIR = resolve(PAAW_DATA_DIR, "contexts", "chat");
  const PROMPT_FILES = ["identity.md", "tool-rules.md", "system-prompt.md", "guardrails.md", "reply-rules.md"];

  // GET /api/system-prompts — 列出所有提示詞檔案
  // 優先讀 contexts/chat/，fallback 到 system/
  if (req.method === "GET" && path === "/api/system-prompts") {
    const result = {};
    for (const file of PROMPT_FILES) {
      let filePath = resolve(CONTEXTS_CHAT_DIR, file);
      let content = null;
      try { content = await readFile(filePath, "utf-8"); }
      catch {
        filePath = resolve(SYSTEM_DIR, file);
        try { content = await readFile(filePath, "utf-8"); } catch {}
      }
      result[file] = content;
      try {
        result[file] = await readFile(filePath, "utf-8");
      } catch {
        result[file] = null;
      }
    }
    json(res, result);
    return true;
  }

  // GET /api/system-prompts/:file — 讀取單一提示詞檔案
  const promptMatch = path.match(/^\/api\/system-prompts\/([\w-]+\.md)$/);
  if (req.method === "GET" && promptMatch) {
    const file = promptMatch[1];
    if (!PROMPT_FILES.includes(file)) {
      json(res, { error: "Unknown prompt file" }, 400);
      return true;
    }
    let filePath = resolve(CONTEXTS_CHAT_DIR, file);
    try {
      const content = await readFile(filePath, "utf-8");
      json(res, { file, content, source: "contexts" });
    } catch {
      filePath = resolve(SYSTEM_DIR, file);
      try {
        const content = await readFile(filePath, "utf-8");
        json(res, { file, content, source: "system" });
      } catch {
        json(res, { file, content: null, error: "File not found" }, 404);
      }
    }
    return true;
  }

  // PUT /api/system-prompts/:file — 更新提示詞檔案（寫入 contexts/chat/）
  const promptPutMatch = path.match(/^\/api\/system-prompts\/([\w-]+\.md)$/);
  if (req.method === "PUT" && promptPutMatch) {
    const file = promptPutMatch[1];
    if (!PROMPT_FILES.includes(file)) {
      json(res, { error: "Unknown prompt file" }, 400);
      return true;
    }
    try {
      const body = JSON.parse(await readBody(req));
      if (typeof body.content !== "string") {
        json(res, { error: "content must be a string" }, 400);
        return true;
      }
      // Write to contexts/chat/（新位置）
      await mkdir(CONTEXTS_CHAT_DIR, { recursive: true });
      await writeFile(resolve(CONTEXTS_CHAT_DIR, file), body.content, "utf-8");
      console.log(`[Chat] Updated system prompt (contexts/chat/): ${file}`);
      json(res, { file, saved: true, location: "contexts/chat" });
    } catch (err) {
      json(res, { error: err.message }, 500);
    }
    return true;
  }

  return false;
}
