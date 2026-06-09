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

      // ── Context Engine: unified context assembly ──
      const { contextEngine } = await import("../context-engine.mjs");
      const ctx = await contextEngine.build({ target: "chat" });

      // ── Load tools ──
      const { getToolsAndHandlers, invalidateCache } = await import("../tools/index.mjs");
      const { tools: toolDefinitions, handlers: toolHandlers } = await getToolsAndHandlers();

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
        { role: "system", content: ctx.systemPrompt },
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
