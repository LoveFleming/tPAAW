/**
 * Chat routes — CRUD + SSE streaming
 */
import { readdir, readFile, writeFile, mkdir, unlink } from "fs/promises";
import { join } from "path";
import { PATHS, readBody, json, urlPath } from "./context.mjs";

export default async function chatRoutes(req, res) {
  const path = urlPath(req);

  // GET /api/paaw/chats
  if (req.method === "GET" && path === "/api/paaw/chats") {
    try {
      await mkdir(PATHS.CHAT_DIR, { recursive: true });
      const files = await readdir(PATHS.CHAT_DIR);
      const chats = [];
      for (const f of files.filter(f => f.endsWith(".json"))) {
        try { chats.push(JSON.parse(await readFile(join(PATHS.CHAT_DIR, f), "utf-8"))); } catch {}
      }
      chats.sort((a, b) => (b.updatedAt || b.createdAt || "").localeCompare(a.updatedAt || a.createdAt || ""));
      json(res, chats);
    } catch (err) { json(res, { error: err.message }, 500); }
    return true;
  }

  // GET /api/paaw/chats/:id
  const getMatch = path.match(/^\/api\/paaw\/chats\/([\w.-]+)$/);
  if (req.method === "GET" && getMatch) {
    try {
      const chat = JSON.parse(await readFile(join(PATHS.CHAT_DIR, `${getMatch[1]}.json`), "utf-8"));
      json(res, chat);
    } catch { json(res, { error: "Not found" }, 404); }
    return true;
  }

  // POST /api/paaw/chats — create
  if (req.method === "POST" && path === "/api/paaw/chats") {
    try {
      const chat = JSON.parse(await readBody(req));
      await mkdir(PATHS.CHAT_DIR, { recursive: true });
      await writeFile(join(PATHS.CHAT_DIR, `${chat.id}.json`), JSON.stringify(chat, null, 2), "utf-8");
      json(res, { ok: true });
    } catch (err) { json(res, { error: err.message }, 500); }
    return true;
  }

  // PUT /api/paaw/chats/:id
  const putMatch = path.match(/^\/api\/paaw\/chats\/([\w.-]+)$/);
  if (req.method === "PUT" && putMatch) {
    try {
      const data = JSON.parse(await readBody(req));
      await mkdir(PATHS.CHAT_DIR, { recursive: true });
      const filePath = join(PATHS.CHAT_DIR, `${putMatch[1]}.json`);
      let chat;
      try { chat = JSON.parse(await readFile(filePath, "utf-8")); } catch { chat = { id: putMatch[1] }; }
      if (data.messages) chat.messages = data.messages;
      if (data.title) chat.title = data.title;
      chat.updatedAt = new Date().toISOString();
      await writeFile(filePath, JSON.stringify(chat, null, 2), "utf-8");
      json(res, { ok: true });
    } catch (err) { json(res, { error: err.message }, 500); }
    return true;
  }

  // DELETE /api/paaw/chats/:id
  const delMatch = path.match(/^\/api\/paaw\/chats\/([\w.-]+)$/);
  if (req.method === "DELETE" && delMatch) {
    try {
      await unlink(join(PATHS.CHAT_DIR, `${delMatch[1]}.json`));
      json(res, { ok: true });
    } catch { json(res, { error: "Not found" }, 404); }
    return true;
  }

  // POST /api/paaw/chat — streaming chat with tools
  if (req.method === "POST" && path === "/api/paaw/chat") {
    try {
      const { messages, model, provider } = JSON.parse(await readBody(req));

      // Load provider config
      let providerConfig = null;
      try {
        const config = JSON.parse(await readFile(join(PATHS.CONFIG_ROOT, "providers.json"), "utf-8"));
        // providers can be an object (keyed by id) or an array
        const providers = config.providers;
        if (provider && providers) {
          if (Array.isArray(providers)) {
            providerConfig = providers.find(p => p.id === provider);
          } else {
            providerConfig = providers[provider];
          }
        }
        if (!providerConfig && providers) {
          if (Array.isArray(providers)) {
            providerConfig = providers[0];
          } else {
            const activeId = config.active || Object.keys(providers)[0];
            providerConfig = providers[activeId];
          }
        }
      } catch {}

      console.log("[chat] provider=", provider, "active=", config.active, "resolved=", providerConfig ? Object.keys(providerConfig) : null);
      const apiKey = providerConfig?.apiKey || process.env.OPENAI_API_KEY || "";
      const chatModel = model || providerConfig?.models?.[0]?.id || process.env.PAAW_MODEL || "gpt-4o-mini";
      const baseUrl = providerConfig?.baseURL || providerConfig?.baseUrl || "https://api.openai.com/v1";
      console.log("[chat] apiKey=", apiKey ? `${apiKey.slice(0, 8)}...` : "(empty)", "model=", chatModel, "baseUrl=", baseUrl);

      if (!apiKey || apiKey === "na") {
        console.error("[chat] No API key. providerConfig=", JSON.stringify(providerConfig, null, 2));
        json(res, { error: "No API key configured for provider", debug: { provider, active: config.active, resolved: !!providerConfig, providerKeys: providerConfig ? Object.keys(providerConfig) : [] } }, 400);
        return true;
      }

      // Load tools
      let tools = [];
      try {
        const { getToolsAndHandlers } = await import("../tools/index.mjs");
        const t = await getToolsAndHandlers();
        tools = t.tools || [];
      } catch {}

      // Load system prompt
      const { readSystemPrompt } = await import("./context.mjs");
      const systemPrompt = await readSystemPrompt("global");

      const chatMessages = [];
      if (systemPrompt) chatMessages.push({ role: "system", content: systemPrompt });
      chatMessages.push(...(messages || []));

      // Stream response
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const llmRes = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: chatModel, messages: chatMessages, stream: true, tools: tools.length > 0 ? tools : undefined }),
      });

      if (!llmRes.ok) {
        const errText = await llmRes.text();
        res.write(`data: ${JSON.stringify({ error: true, message: errText.slice(0, 200) })}\n\n`);
        res.end();
        return true;
      }

      const reader = llmRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data === "[DONE]") { res.write("data: [DONE]\n\n"); continue; }
            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta;
              if (delta?.content) res.write(`data: ${JSON.stringify({ content: delta.content })}\n\n`);
              if (delta?.tool_calls) res.write(`data: ${JSON.stringify({ tool_call: delta.tool_calls[0] })}\n\n`);
            } catch {}
          }
        }
      }
      res.write("data: [DONE]\n\n");
      res.end();
    } catch (err) {
      if (!res.headersSent) json(res, { error: err.message }, 500);
      else { res.write(`data: ${JSON.stringify({ error: true, message: err.message })}\n\n`); res.end(); }
    }
    return true;
  }

  return false;
}
