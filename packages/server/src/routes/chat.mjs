/**
 * Chat routes — CRUD + SSE streaming with Context Engine
 */
import { readdir, readFile, writeFile, mkdir, unlink } from "fs/promises";
import { resolve } from "path";
import { PATHS, readBody, json, urlPath } from "./context.mjs";
import { resolveDefaultModel } from "../lib/llm-utils.mjs";
import { DATA_HOME } from "../data-home.mjs";
import { hasImages } from "../lib/vision-content.mjs";
import { uploadsDir } from "./uploads.mjs";
import { readFile as _readFile } from "fs/promises";
import { join as _join, basename as _basename } from "path";

/**
 * 訊含圖處理（2026-08-30 Vision Phase 2）：
 * UI 送來的 user message 帶 images: ["uploads/xxx.jpg"]（路徑引用，不存 base64）
 * 送 LLM 前讀檔轉 data URI，組成 OpenAI vision content array
 */
async function buildVisionMessages(messages) {
  const out = [];
  let imageCount = 0;
  for (const m of messages || []) {
    const imgs = Array.isArray(m.images) ? m.images.slice(0, 4) : [];
    if (imgs.length === 0 || m.role !== "user") { out.push(m); continue; }
    const content = [{ type: "text", text: String(m.content || "") }];
    for (const rel of imgs) {
      try {
        const name = _basename(String(rel)); // 防穿越：只取檔名
        const buf = await _readFile(_join(uploadsDir(), name));
        const ext = name.toLowerCase().endsWith(".png") ? "png" : name.toLowerCase().endsWith(".webp") ? "webp" : name.toLowerCase().endsWith(".gif") ? "gif" : "jpeg";
        content.push({ type: "image_url", image_url: { url: `data:image/${ext};base64,${buf.toString("base64")}` } });
        imageCount++;
      } catch (e) { console.warn(`[chat] image load fail: ${rel} — ${e.message}`); }
    }
    out.push({ role: m.role, content: content.length > 1 ? content : String(m.content || ""), images: m.images });
  }
  return { messages: out, imageCount };
}

// ── Paths (reuse from context.mjs) ──
const PAAW_ROOT = PATHS.PAAW_ROOT;
const PAAW_DATA_DIR = resolve(DATA_HOME);
const PAAW_USER_FILE = resolve(PAAW_DATA_DIR, "user.json");
const PAAW_CHAT_DIR = resolve(PAAW_DATA_DIR, "chats");
const APPS_ROOT = resolve(DATA_HOME, "apps");

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
      const { messages: rawMessages, model: requestedModel, provider: requestedProvider, contextTarget, systemPrompt: clientSystemPrompt } = body;

      // ── Vision Phase 2（2026-08-30）：images 路徑 → vision content array ──
      const { messages: visionMessages, imageCount } = await buildVisionMessages(rawMessages);
      const messages = visionMessages;

      // ── Resolve provider ──
      const providerConfig = JSON.parse(await readFile(resolve(PAAW_DATA_DIR, "config/providers.json"), "utf-8"));

      // Parse model ID — may be "providerId/modelId" or "providerId/nested/model"
      let resolvedProviderId = requestedProvider || providerConfig.active;
      let model = requestedModel || resolveDefaultModel(providerConfig);
      if (model.includes("/")) {
        const idx = model.indexOf("/");
        const modelProviderHint = model.slice(0, idx);
        // Only split if the hint is a known provider; otherwise keep full model ID
        // (e.g. "deepseek/deepseek-v4-flash" is an OpenRouter model, not provider "deepseek")
        if (!requestedProvider && providerConfig.providers[modelProviderHint]) {
          model = model.slice(idx + 1);
          resolvedProviderId = modelProviderHint;
        }
      }
      let resolvedProvider = providerConfig.providers[resolvedProviderId];
      if (!resolvedProvider) {
        json(res, { error: `Unknown provider: ${resolvedProviderId}` }, 400);
        return true;
      }
      if (!resolvedProvider.apiKey || resolvedProvider.apiKey === "na") {
        json(res, { error: `No API key configured for provider: ${resolvedProviderId}` }, 400);
        return true;
      }

      // ── Vision 路由（2026-08-30 Phase 2）：訊含圖 → 自動切 visionModel ──
      // 設計：providers.json 頂層 visionModel（"providerId/modelId"）；沒設或不支援就不切
      let extraBody = null;
      if (imageCount > 0 && hasImages(messages)) {
        const vm = String(providerConfig.visionModel || "");
        if (vm.includes("/")) {
          const vi = vm.indexOf("/");
          const vp = providerConfig.providers[vm.slice(0, vi)];
          const vModelId = vm.slice(vi + 1);
          if (vp?.apiKey && vp.apiKey !== "na") {
            resolvedProviderId = vm.slice(0, vi);
            resolvedProvider = vp;
            model = vModelId;
            // vision 分析關思考 + 提高輸出額度（thinking 燒光 max_tokens 實證教訓 2026-08-30）
            extraBody = { max_tokens: 8192, ...(resolvedProviderId === "zai" ? { thinking: { type: "disabled" } } : {}) };
            console.log(`[chat] 👁 vision routing: ${imageCount} image(s) → ${vm}`);
          } else {
            console.warn(`[chat] ⚠️ visionModel "${vm}" provider 沒 key — 走原 model（圖會被佔位保護換掉）`);
          }
        }
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

      // Chat 專用 blocklist — 這些 tool 只在 Coding IDE 用，聊天助理不該看到
      const CHAT_BLOCKED_TOOLS = new Set([
        "dispatch_agent",     // 派工給 coding agents
        "record_decision",    // ADR 架構決策記錄
        "docs",               // .paaw 文件管理
        "cu_refresh",         // Code Understanding 刷新
        "action_log_add",     // 動作日誌
        "action_log_list",    // 動作日誌
        "project_info",       // 專案資訊（coding）
        "project_edit",       // 專案編輯（coding）
        "project_status",     // 專案狀態
        "project_update_task", // 專案任務更新
        "browser_test",       // 瀏覽器測試
        "browser_navigate",   // 內建瀏覽器（僅 coding app）
        "browser_read",
        "browser_screenshot",
        "browser_click",
        "browser_type",
        "glob",               // 檔案搜尋
        "grep",               // 文字搜尋
        "diff",               // 檔案差異
        "git",                // Git 操作
        "read_file",          // 讀檔
        "write_file",         // 寫檔
        "edit_file",          // 改檔
        "bash",               // Shell 指令
      ]);

      const executors = Object.entries(toolHandlers)
        .filter(([name]) => !CHAT_BLOCKED_TOOLS.has(name))
        .map(([name, handler]) => ({
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
        cwd: PAAW_ROOT,
        provider: {
          id: resolvedProviderId,
          baseURL: resolvedProvider.baseURL,
          apiKey: resolvedProvider.apiKey,
          defaultModel: model,
          extraHeaders: resolvedProviderId === 'openrouter'
            ? { 'HTTP-Referer': 'https://paaw.ai', 'X-Title': 'PAAW' }
            : undefined,
          extraBody, // Vision 路由時帶 thinking disabled + 8192 額度（provider.mjs 合併）
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

      // Inject shared registry tools — then remove coding-only tools
      const { injectRegistryTools } = await import("../lib/tool-registry-init.mjs");
      injectRegistryTools(engine, { cwd: PAAW_ROOT, rootDir: PAAW_ROOT, agentId: 'assistant' });
      // Remove coding-only tools so chat assistant doesn't see them
      for (const tn of CHAT_BLOCKED_TOOLS) {
        engine.unregisterTool(tn);
      }

      // ── 執行 ReAct loop，stream 給前端 ──
      let fullText = ''
      let toolsUsed = []
      let chunkCount = 0
      const streamStart = Date.now()

      console.log(`[${chatReqId}] ToolEngine.run() starting...`);

      let sseEnded = false;

      // ── Client 斷線偵測（2026-08-19：按「停止」後 server 必須停止思考，不能繼續燒 token）──
      let clientGone = false;
      res.on('close', () => { clientGone = true; });

      for await (const chunk of engine.run(ctx.systemPrompt, messages || [], model)) {
        if (sseEnded) break; // 防止 done/error 之後又收到 chunk
        if (clientGone) {
          console.log(`[${chatReqId}] Client disconnected — aborting agent loop (停止燒 token)`);
          break; // 使用者按了停止 — break 觸發 generator return()，取消後續 LLM 輪
        }
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

      // ── Log AI interaction for distillation（使用者中途停止不記錄半成品）──
      if (!clientGone) try {
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
