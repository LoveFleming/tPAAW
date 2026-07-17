/**
 * Chat routes — CRUD + SSE streaming with Context Engine
 */
import { readdir, readFile, writeFile, mkdir, unlink } from "fs/promises";
import { resolve } from "path";
import { PATHS, readBody, json, urlPath } from "./context.mjs";
import { resolveDefaultModel } from "../lib/llm-utils.mjs";

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
    let heartbeatTimer = null;
    try {
      const body = JSON.parse(await readBody(req));
      const { messages, model: requestedModel, provider: requestedProvider, contextTarget, systemPrompt: clientSystemPrompt } = body;

      // ── Resolve provider ──
      const providerConfig = JSON.parse(await readFile(resolve(PAAW_DATA_DIR, "config/providers.json"), "utf-8"));

      // Parse model ID — may be "providerId/modelId" or "providerId/nested/model"
      let resolvedProviderId = requestedProvider || providerConfig.active;
      let model = requestedModel || resolveDefaultModel(providerConfig);
      if (model.includes("/")) {
        const idx = model.indexOf("/");
        const modelProviderHint = model.slice(0, idx);
        model = model.slice(idx + 1);
        // Only use model's provider hint if client did NOT explicitly specify a provider
        if (!requestedProvider) {
          resolvedProviderId = modelProviderHint;
        }
      }
      const resolvedProvider = providerConfig.providers[resolvedProviderId];
      if (!resolvedProvider) {
        json(res, { error: `Unknown provider: ${resolvedProviderId}` }, 400);
        return true;
      }
      if (!resolvedProvider.apiKey || resolvedProvider.apiKey === "na") {
        json(res, { error: `No API key configured for provider: ${resolvedProviderId}` }, 400);
        return true;
      }

      // ── Context Engine: use client-specified target or default to chat ──
      const { contextEngine } = await import("../context-engine.mjs");
      const ctx = await contextEngine.build({ target: contextTarget || "chat" });
      // Allow client to override system prompt entirely
      if (clientSystemPrompt) ctx.systemPrompt = clientSystemPrompt;

      // ── SSE headers ──
      const chatReqId = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      console.log(`[${chatReqId}] === Chat request start === provider=${resolvedProviderId} model=${model} msgs=${messages?.length}`);

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders();
      if (res.socket?.setNoDelay) res.socket.setNoDelay(true);
      console.log(`[${chatReqId}] SSE headers sent, socket=${res.socket?.remoteAddress}:${res.socket?.remotePort}`);

      // Heartbeat：每 3 秒送 SSE 註解，保持連線 + 強制 flush TCP buffer
      heartbeatTimer = setInterval(() => {
        try {
          res.write(': heartbeat\n\n');
          if (typeof res.flush === 'function') res.flush();
          // 強制 flush socket
          if (res.socket?.write) res.socket.write('');
        } catch {}
      }, 3000);

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
        cwd: rootPath,
        provider: {
          id: resolvedProviderId,
          baseURL: resolvedProvider.baseURL,
          apiKey: resolvedProvider.apiKey,
          defaultModel: model,
          extraHeaders: resolvedProviderId === 'openrouter'
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
        agentId: 'assistant',
        caller: 'chat',
      })

      // ── 執行 ReAct loop，stream 給前端 ──
      let fullText = ''
      let toolsUsed = []
      let chunkCount = 0
      const streamStart = Date.now()

      console.log(`[${chatReqId}] ToolEngine.run() starting...`);

      let sseEnded = false;

      for await (const chunk of engine.run(ctx.systemPrompt, messages || [], model)) {
        if (sseEnded) break; // 防止 done/error 之後又收到 chunk
        chunkCount++
        const elapsed = Date.now() - streamStart
        switch (chunk.type) {
          case 'text':
            fullText += chunk.delta
            res.write(`data: ${JSON.stringify({ content: chunk.delta })}\n\n`)
            if (typeof res.flush === 'function') res.flush()
            if (chunkCount <= 5 || chunkCount % 20 === 0) console.log(`[${chatReqId}] text chunk #${chunkCount} ${elapsed}ms len=${chunk.delta.length}`)
            break

          case 'tool_start':
            toolsUsed.push(chunk.name)
            res.write(`data: ${JSON.stringify({ tool_call: { name: chunk.name, args: chunk.args, status: 'executing' } })}\n\n`)
            if (typeof res.flush === 'function') res.flush()
            console.log(`[${chatReqId}] tool_start: ${chunk.name} ${elapsed}ms`)
            break

          case 'tool_end':
            res.write(`data: ${JSON.stringify({ tool_result: { name: chunk.name, result: chunk.result } })}\n\n`)
            if (typeof res.flush === 'function') res.flush()
            console.log(`[${chatReqId}] tool_end: ${chunk.name} error=${!!chunk.result?.error} ${elapsed}ms`)
            break

          case 'done':
            res.write('data: [DONE]\n\n')
            if (typeof res.flush === 'function') res.flush()
            res.end()
            sseEnded = true
            console.log(`[${chatReqId}] DONE ${elapsed}ms chunks=${chunkCount} tools=${toolsUsed.join(',')} textLen=${fullText.length}`)
            break

          case 'error':
            res.write(`data: ${JSON.stringify({ error: true, message: chunk.message })}\n\n`)
            if (typeof res.flush === 'function') res.flush()
            res.end()
            sseEnded = true
            console.log(`[${chatReqId}] ERROR: ${chunk.message} ${elapsed}ms`)
            break
        }
      }

      console.log(`[${chatReqId}] === Stream ended === ${Date.now() - streamStart}ms total, ${chunkCount} chunks`);

      // 清掉 heartbeat
      clearInterval(heartbeatTimer);

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
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      console.error("[chat] Error:", err.message, "\nStack:", err.stack);
      if (!res.headersSent) {
        json(res, { error: err.message }, 500);
      } else {
        res.write(`data: ${JSON.stringify({ error: true, message: err.message })}\n\n`);
        if (typeof res.flush === 'function') res.flush();
        res.end();
      }
    }
    return true;
  }

  // ════════════════════════════════════════
  // System Prompt API（讀取/更新提示詞檔案）
  // ════════════════════════════════════════

  const CHAT_AI_DIR = resolve(PAAW_DATA_DIR, "ai-settings/chat");
  const PROMPT_FILES = ["identity.md", "tool-rules.md", "system-prompt.md", "guardrails.md", "reply-rules.md"];

  // Helper: read from ai-settings/chat/
  async function readPromptFile(file) {
    try { return await readFile(resolve(CHAT_AI_DIR, file), "utf-8"); }
    catch { return null; }
  }
  async function writePromptFile(file, content) {
    await mkdir(CHAT_AI_DIR, { recursive: true });
    await writeFile(resolve(CHAT_AI_DIR, file), content, "utf-8");
  }

  // GET /api/system-prompts — 列出所有提示詞檔案（向下相容）
  if (req.method === "GET" && path === "/api/system-prompts") {
    const result = {};
    for (const file of PROMPT_FILES) {
      result[file] = await readPromptFile(file);
    }
    json(res, result);
    return true;
  }

  // GET /api/system-prompts/:file — 讀取單一提示詞檔案（向下相容）
  const promptMatch = path.match(/^\/api\/system-prompts\/([\w-]+\.md)$/);
  if (req.method === "GET" && promptMatch) {
    const file = promptMatch[1];
    if (!PROMPT_FILES.includes(file)) {
      json(res, { error: "Unknown prompt file" }, 400);
      return true;
    }
    const content = await readPromptFile(file);
    json(res, content !== null ? { file, content } : { file, content: null, error: "File not found" }, content !== null ? 200 : 404);
    return true;
  }

  // PUT /api/system-prompts/:file — 更新提示詞檔案（向下相容）
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
      await writePromptFile(file, body.content);
      console.log(`[Chat] Updated system prompt: ${file}`);
      json(res, { file, saved: true });
    } catch (err) {
      json(res, { error: err.message }, 500);
    }
    return true;
  }

  return false;
}
