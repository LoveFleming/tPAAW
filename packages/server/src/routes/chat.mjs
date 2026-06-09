/**
 * Chat routes — CRUD + SSE streaming with memory + tools
 *
 * All chat functionality in one modular file:
 * - CRUD for chat sessions (/api/paaw/chats)
 * - Streaming chat completion (/api/paaw/chat)
 * - Loads user profile, MEMORY.md, tools, app instructions
 */
import { readdir, readFile, writeFile, mkdir, unlink } from "fs/promises";
import { readFileSync } from "fs";
import { resolve, join } from "path";

// ── Paths ──
const PAAW_ROOT = resolve(__dirname, "../../../../");
const PAAW_DATA_DIR = resolve(PAAW_ROOT, "data");
const PAAW_USER_FILE = resolve(PAAW_DATA_DIR, "user.json");
const PAAW_CHAT_DIR = resolve(PAAW_DATA_DIR, "chats");
const APPS_ROOT = resolve(PAAW_ROOT, "data/apps");
const SYSTEM_DIR = resolve(PAAW_ROOT, "data/system");

// ── Helpers ──
function json(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function urlPath(req) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  return url.pathname;
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

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
  // Chat Completion (SSE streaming + tools)
  // ════════════════════════════════════════

  // POST /api/paaw/chat
  if (req.method === "POST" && path === "/api/paaw/chat") {
    try {
      const body = JSON.parse(await readBody(req));
      const { messages, model: requestedModel, provider: requestedProvider } = body;

      // ── Resolve provider ──
      const config = JSON.parse(await readFile(resolve(PAAW_DATA_DIR, "config/providers.json"), "utf-8"));
      const providerId = requestedProvider || config.active;
      const provider = config.providers[providerId];
      if (!provider) {
        json(res, { error: `Unknown provider: ${providerId}` }, 400);
        return true;
      }
      if (!provider.apiKey || provider.apiKey === "na") {
        json(res, { error: `No API key configured for provider: ${providerId}` }, 400);
        return true;
      }

      const model = requestedModel || config.defaultModel || "glm-5.1";
      const baseURL = provider.baseURL.replace(/\/+$/, "");
      const apiUrl = `${baseURL}/chat/completions`;

      // ── Load user profile ──
      const userProfile = (() => {
        try { return JSON.parse(readFileSync(PAAW_USER_FILE, "utf-8")); } catch { return null; }
      })();

      // ── Load workspaces ──
      const workspaces = (() => {
        try {
          const ws = JSON.parse(readFileSync(resolve(PAAW_DATA_DIR, "workspaces.json"), "utf-8"));
          return ws.directories || [];
        } catch { return []; }
      })();
      const workspaceInfo = workspaces.length > 0
        ? `\n\n使用者的 Workspace 目錄：\n${workspaces.map(d => `- ${d}`).join("\n")}`
        : "";

      const assistantName = userProfile?.assistantName || "林語晴";

      // ── Load MEMORY.md ──
      let memoryContent = "";
      try {
        memoryContent = await readFile(resolve(PAAW_DATA_DIR, "MEMORY.md"), "utf-8");
      } catch {}

      // ── Load tools ──
      const { getToolsAndHandlers, invalidateCache } = await import("../tools/index.mjs");
      const { tools: toolDefinitions, handlers: toolHandlers, appInstructions } = await getToolsAndHandlers();

      // ── Load recent chat history ──
      let recentChatSummary = "";
      try {
        const chatFiles = await readdir(PAAW_CHAT_DIR);
        const sorted = chatFiles.filter(f => f.endsWith(".json")).sort().reverse();
        const recentChats = [];
        for (const f of sorted.slice(0, 5)) {
          try {
            const chat = JSON.parse(await readFile(resolve(PAAW_CHAT_DIR, f), "utf-8"));
            if (chat.messages?.length > 0) {
              const lastMsgs = chat.messages.slice(-4);
              const summary = lastMsgs.map(m => `${m.role === "user" ? "👤" : "🤖"} ${m.content.slice(0, 100)}`).join("\n");
              recentChats.push(`### ${chat.title}\n${summary}`);
            }
          } catch {}
        }
        if (recentChats.length > 0) {
          recentChatSummary = `\n=== 最近對話摘要 ===\n以下是你和使用者最近的對話，幫助你延續記憶。不要重複提及這些內容，除非使用者問起。\n\n${recentChats.join("\n\n")}`;
        }
      } catch {}

      // ── Load app builder rules ──
      let appBuilderRules = "";
      try {
        appBuilderRules = await readFile(resolve(PAAW_ROOT, "data/config/app-builder-rules.md"), "utf-8");
      } catch {}

      // ── Build system prompt ──
      const systemPrompt = `你是${assistantName}，一個友善、聰明的個人 AI 助理。大家都叫你 Sunny。你不只能聊天，還能幫使用者做事。你有工具可以操作各種 App。當使用者提出需要操作的請求時，使用對應的工具來完成。

回答時使用繁體中文，技術術語保留英文。語氣親切專業，像一位值得信賴的同事。

=== 使用者資訊 ===
- 名字：${userProfile?.name || "未知"}
- 介紹：${userProfile?.intro || ""}
- 偏好風格：${userProfile?.style || "casual"}${workspaceInfo}

=== 你的長期記憶 (MEMORY.md) ===
每次對話都會載入這份記憶。如果使用者說「記住」「幫我記」，使用 memory_add 工具更新。
${memoryContent || "(記憶是空白的)"}

=== 可用的 App ===
${appInstructions}

=== App 建構規則 ===
當使用者想建新 App 或修改 App 時，遵循以下規則：
${appBuilderRules || "(尚未設定 App 建構規則)"}

=== 回覆規則 ===
- 用中文回覆，風格自然友善
- 使用者問「我有什麼 App」→ 用 app_list 工具查詢，不要猜
- 使用者要求做事時，先檢查有沒有對應的 App，用 App 的工具完成
- 如果使用者說的話包含某個 App 的觸發關鍵字（如「幫我翻譯」「translate」→ translate_exec），直接呼叫該 App 的工具
- 主動運用記憶中的資訊（偏好、過去的決策、人際關係）
- 如果學到新東西（偏好、決策、重要資訊），主動用 memory_add 記下來
- 使用者想建新 App 時，遵循 App 建構規則，用 app_create 幫他建立
- Workspace 是檔案目錄，App 是資料工具，兩者不同
- 不確定的事情就用工具查，不要用猜的
- 使用 Markdown 格式${recentChatSummary}`;

      // ── SSE response ──
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });

      const apiHeaders = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.apiKey}`,
        ...(providerId === "openrouter" ? { "HTTP-Referer": "https://paaw.ai", "X-Title": "PAAW" } : {}),
      };

      const apiMessages = [
        { role: "system", content: systemPrompt },
        ...(messages || [])
      ];

      // ── Tool calling loop (max 5 rounds) ──
      const MAX_TOOL_ROUNDS = 5;
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const requestPayload = {
          model,
          messages: apiMessages,
          max_tokens: 4096,
          stream: true,
          tools: toolDefinitions,
          tool_choice: "auto",
        };

        const apiResp = await fetch(apiUrl, {
          method: "POST",
          headers: apiHeaders,
          body: JSON.stringify(requestPayload),
        });

        if (!apiResp.ok) {
          const errText = await apiResp.text();
          res.write(`data: ${JSON.stringify({ error: true, message: `API error ${apiResp.status}: ${errText.slice(0, 200)}` })}\n\n`);
          res.end();
          return true;
        }

        const reader = apiResp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let fullContent = "";
        let toolCalls = [];
        let currentToolCall = null;
        let finishReason = null;

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || !trimmed.startsWith("data: ")) continue;
              const data = trimmed.slice(6);
              if (data === "[DONE]") continue;
              try {
                const parsed = JSON.parse(data);
                const choice = parsed.choices?.[0];
                if (!choice) continue;
                if (choice.finish_reason) finishReason = choice.finish_reason;
                const delta = choice.delta?.content;
                if (delta) {
                  fullContent += delta;
                  res.write(`data: ${JSON.stringify({ content: delta })}\n\n`);
                }
                const tcDeltas = choice.delta?.tool_calls;
                if (tcDeltas) {
                  for (const tc of tcDeltas) {
                    if (tc.id) {
                      currentToolCall = { id: tc.id, name: tc.function?.name || "", arguments: tc.function?.arguments || "" };
                      toolCalls.push(currentToolCall);
                    } else if (currentToolCall && tc.function?.arguments) {
                      currentToolCall.arguments += tc.function.arguments;
                    }
                  }
                }
              } catch {}
            }
          }
        } catch (err) {
          console.error("[chat] Stream error:", err.message);
        }

        // No tool calls or not finished with tools — done
        if (toolCalls.length === 0 || finishReason !== "tool_calls") {
          break;
        }

        // ── Execute tool calls ──
        apiMessages.push({
          role: "assistant",
          content: fullContent || null,
          tool_calls: toolCalls.map(tc => ({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: tc.arguments }
          }))
        });

        for (const tc of toolCalls) {
          let args = {};
          try { args = JSON.parse(tc.arguments); } catch { args = { raw: tc.arguments }; }
          res.write(`data: ${JSON.stringify({ tool_call: { name: tc.name, args, status: "executing" } })}\n\n`);

          let result;
          try {
            const handler = toolHandlers[tc.name];
            result = handler ? await handler(args) : { text: `未知工具: ${tc.name}`, error: true };
          } catch (err) {
            result = { text: `工具執行錯誤: ${err.message}`, error: true };
          }

          res.write(`data: ${JSON.stringify({ tool_result: { name: tc.name, result } })}\n\n`);
          if (tc.name === "app_create" || tc.name === "app_edit") invalidateCache();
          apiMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: JSON.stringify(result)
          });
        }
      }

      res.write("data: [DONE]\n\n");
      res.end();
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

  return false;
}
