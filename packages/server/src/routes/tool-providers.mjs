/**
 * Tool Provider API — 外掛 Tool 的 CRUD + 測試 + 啟用/停用
 *
 * 提供：
 *   GET    /api/tools             — 列出所有 Tool Providers
 *   GET    /api/tools/:id         — 取得單一 Tool 詳情（含 config schema）
 *   POST   /api/tools             — 建立 Tool（手動或 AI 產生）
 *   PATCH  /api/tools/:id         — 更新 Tool 定義
 *   DELETE /api/tools/:id         — 刪除 Tool
 *   POST   /api/tools/:id/test    — 測試 Tool（傳入參數執行一次）
 *   POST   /api/tools/:id/toggle  — 啟用/停用 Tool
 *   PUT    /api/tools/:id/config  — 更新 config.json
 */

import { readdir, readFile, writeFile, mkdir, unlink, rm } from "fs/promises";
import { existsSync, readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import { toolRegistry } from "../lib/tool-registry.mjs";

const PAAW_ROOT = process.env.PAAW_ROOT || resolve(import.meta.dirname, "../../../../");
const TOOLS_DIR = resolve(PAAW_ROOT, "data/tools");

// Ensure dir
await mkdir(TOOLS_DIR, { recursive: true });

// ── Helpers ──

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf-8");
}

function normalizePath(p) {
  return p.replace(/\\/g, "/");
}

/** 掃描 data/tools/ 載入所有 tool provider 資訊 */
function scanToolProviders() {
  if (!existsSync(TOOLS_DIR)) return [];

  const results = [];
  const dirs = readdirSync(TOOLS_DIR, { withFileTypes: true });
  for (const entry of dirs) {
    if (!entry.isDirectory()) continue;
    const providerDir = resolve(TOOLS_DIR, entry.name);
    const toolFile = resolve(providerDir, "tool.json");
    if (!existsSync(toolFile)) continue;

    try {
      const toolDef = JSON.parse(readFileSync(toolFile, "utf-8"));
      const configFile = resolve(providerDir, "config.json");
      let config = {};
      let configFilled = false;
      if (existsSync(configFile)) {
        try {
          config = JSON.parse(readFileSync(configFile, "utf-8"));
          // Check if any secret values are filled (not placeholder)
          const configSchema = toolDef.config || {};
          const requiredKeys = Object.entries(configSchema).filter(([, v]) => v.required).map(([k]) => k);
          configFilled = requiredKeys.length === 0 || requiredKeys.every(k => config[k] && !config[k].startsWith("YOUR_"));
        } catch {}
      }

      // Check enabled state
      const enabled = toolDef.enabled !== false;

      results.push({
        id: entry.name,
        name: toolDef.name,
        description: toolDef.description || "",
        runner: toolDef.runner || "api",
        icon: toolDef.icon || "🔧",
        enabled,
        configFilled,
        parameters: toolDef.parameters || { type: "object", properties: {} },
        configSchema: toolDef.config || {},
        tags: toolDef.tags || [],
        dir: normalizePath(providerDir),
        createdAt: toolDef.createdAt,
        updatedAt: toolDef.updatedAt,
      });
    } catch (err) {
      console.error(`[ToolProvider API] Failed to read ${entry.name}:`, err.message);
    }
  }
  return results;
}

/** 載入 tool.json + config.json 完整資料 */
function loadToolDetail(providerId) {
  const providerDir = resolve(TOOLS_DIR, providerId);
  const toolFile = resolve(providerDir, "tool.json");
  if (!existsSync(toolFile)) return null;

  const toolDef = JSON.parse(readFileSync(toolFile, "utf-8"));
  const configFile = resolve(providerDir, "config.json");
  let config = {};
  if (existsSync(configFile)) {
    try { config = JSON.parse(readFileSync(configFile, "utf-8")); } catch {}
  }

  // Mask secrets in config for display
  const maskedConfig = { ...config };
  const configSchema = toolDef.config || {};
  for (const key of Object.keys(configSchema)) {
    if (configSchema[key].secret && maskedConfig[key]) {
      maskedConfig[key] = maskedConfig[key].slice(0, 4) + "••••";
    }
  }

  return {
    id: providerId,
    ...toolDef,
    enabled: toolDef.enabled !== false,
    config: maskedConfig,
    configSchema: toolDef.config || {},
    configFilled: (() => {
      const requiredKeys = Object.entries(configSchema).filter(([, v]) => v.required).map(([k]) => k);
      return requiredKeys.length === 0 || requiredKeys.every(k => config[k] && !config[k].startsWith("YOUR_"));
    })(),
    dir: normalizePath(providerDir),
    hasHandler: existsSync(resolve(providerDir, "handler.mjs")),
  };
}

/** 測試 tool — 找到 registry 中的 handler 並執行 */
async function testTool(providerId, testParams) {
  const detail = loadToolDetail(providerId);
  if (!detail) return { ok: false, error: "Tool not found" };
  if (!detail.enabled) return { ok: false, error: "Tool is disabled" };

  const handler = toolRegistry.getHandler(detail.name);
  if (!handler) return { ok: false, error: "Handler not registered (restart may be needed)" };

  try {
    const result = await handler(testParams || {}, {});
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ── Route Handler ──

export default async function toolProviderRoutes(req, res) {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;

  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return true; }

  // GET /api/tools — 列出所有 Tool Providers
  if (req.method === "GET" && path === "/api/tools") {
    const tools = scanToolProviders();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ tools }));
    return true;
  }

  // GET /api/tools/templates — 取得預設模板列表
  if (req.method === "GET" && path === "/api/tools/templates") {
    const templates = getToolTemplates();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ templates }));
    return true;
  }

  // GET /api/tools/:id — 取得單一 Tool 詳情
  if (req.method === "GET" && path.startsWith("/api/tools/") && path.split("/").length === 4) {
    const providerId = path.split("/")[3];
    const detail = loadToolDetail(providerId);
    if (!detail) { res.writeHead(404, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Not found" })); return true; }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(detail));
    return true;
  }

  // POST /api/tools — 建立 Tool
  if (req.method === "POST" && path === "/api/tools") {
    try {
      const body = JSON.parse(await readBody(req));
      const { id, name, description, runner, parameters, api, config, icon, tags } = body;

      if (!id || !name) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "id and name are required" }));
        return true;
      }

      // Validate id (lowercase, no spaces)
      const safeId = id.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
      const providerDir = resolve(TOOLS_DIR, safeId);

      if (existsSync(resolve(providerDir, "tool.json"))) {
        res.writeHead(409, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `Tool "${safeId}" already exists` }));
        return true;
      }

      await mkdir(providerDir, { recursive: true });

      const toolDef = {
        name,
        description: description || "",
        runner: runner || "api",
        parameters: parameters || { type: "object", properties: {} },
        ...(runner === "api" && api ? { api } : {}),
        config: config || {},
        icon: icon || "🔧",
        tags: tags || [],
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await writeFile(resolve(providerDir, "tool.json"), JSON.stringify(toolDef, null, 2), "utf-8");

      // Write empty config.json from config schema
      const configValues = {};
      for (const [key, schema] of Object.entries(config || {})) {
        configValues[key] = schema.default || `YOUR_${key.toUpperCase()}_HERE`;
      }
      if (Object.keys(configValues).length > 0) {
        await writeFile(resolve(providerDir, "config.json"), JSON.stringify(configValues, null, 2), "utf-8");
      }

      // Auto-register into toolRegistry (hot load)
      try {
        const { initProviderTool } = await import("../tools/provider-loader.mjs");
        await initProviderTool(safeId);
      } catch (err) {
        console.warn("[ToolProvider API] Auto-register failed:", err.message);
      }

      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, id: safeId, path: normalizePath(providerDir) }));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // PATCH /api/tools/:id — 更新 Tool 定義
  if (req.method === "PATCH" && path.startsWith("/api/tools/") && path.split("/").length === 4) {
    const providerId = path.split("/")[3];
    const providerDir = resolve(TOOLS_DIR, providerId);
    const toolFile = resolve(providerDir, "tool.json");
    if (!existsSync(toolFile)) { res.writeHead(404, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Not found" })); return true; }

    try {
      const body = JSON.parse(await readBody(req));
      const toolDef = JSON.parse(readFileSync(toolFile, "utf-8"));

      // Updatable fields
      if (body.description !== undefined) toolDef.description = body.description;
      if (body.parameters !== undefined) toolDef.parameters = body.parameters;
      if (body.api !== undefined) toolDef.api = body.api;
      if (body.icon !== undefined) toolDef.icon = body.icon;
      if (body.tags !== undefined) toolDef.tags = body.tags;
      if (body.config !== undefined) toolDef.config = body.config;
      toolDef.updatedAt = new Date().toISOString();

      await writeFile(toolFile, JSON.stringify(toolDef, null, 2), "utf-8");

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // DELETE /api/tools/:id — 刪除 Tool
  if (req.method === "DELETE" && path.startsWith("/api/tools/") && path.split("/").length === 4) {
    const providerId = path.split("/")[3];
    const providerDir = resolve(TOOLS_DIR, providerId);
    if (!existsSync(resolve(providerDir, "tool.json"))) { res.writeHead(404, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Not found" })); return true; }

    // Unregister from toolRegistry
    try {
      const toolDef = JSON.parse(readFileSync(resolve(providerDir, "tool.json"), "utf-8"));
      toolRegistry.unregister(toolDef.name);
    } catch {}

    await rm(providerDir, { recursive: true, force: true });

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }

  // POST /api/tools/:id/test — 測試 Tool
  if (req.method === "POST" && path.match(/^\/api\/tools\/[^/]+\/test$/)) {
    const providerId = path.split("/")[3];
    try {
      const body = JSON.parse(await readBody(req));
      const result = await testTool(providerId, body.params || {});
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return true;
  }

  // POST /api/tools/:id/toggle — 啟用/停用
  if (req.method === "POST" && path.match(/^\/api\/tools\/[^/]+\/toggle$/)) {
    const providerId = path.split("/")[3];
    const toolFile = resolve(TOOLS_DIR, providerId, "tool.json");
    if (!existsSync(toolFile)) { res.writeHead(404, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Not found" })); return true; }

    const toolDef = JSON.parse(readFileSync(toolFile, "utf-8"));
    toolDef.enabled = toolDef.enabled === false ? true : false;
    toolDef.updatedAt = new Date().toISOString();
    await writeFile(toolFile, JSON.stringify(toolDef, null, 2), "utf-8");

    // Unregister if disabled
    if (!toolDef.enabled) {
      try { toolRegistry.unregister(toolDef.name); } catch {}
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, enabled: toolDef.enabled }));
    return true;
  }

  // PUT /api/tools/:id/config — 更新 config.json
  if (req.method === "PUT" && path.match(/^\/api\/tools\/[^/]+\/config$/)) {
    const providerId = path.split("/")[3];
    const providerDir = resolve(TOOLS_DIR, providerId);
    if (!existsSync(resolve(providerDir, "tool.json"))) { res.writeHead(404, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Not found" })); return true; }

    try {
      const body = JSON.parse(await readBody(req));
      // Merge with existing config
      let existingConfig = {};
      const configFile = resolve(providerDir, "config.json");
      if (existsSync(configFile)) {
        try { existingConfig = JSON.parse(readFileSync(configFile, "utf-8")); } catch {}
      }
      const merged = { ...existingConfig, ...body };
      await writeFile(configFile, JSON.stringify(merged, null, 2), "utf-8");

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  return false;
}

// ── 預設模板 ──

function getToolTemplates() {
  return [
    {
      id: "discord",
      name: "Discord",
      icon: "💬",
      category: "messaging",
      description: "Discord 訊息傳送與讀取",
      toolDef: {
        name: "discord_send",
        description: "發送 Discord 訊息到指定頻道",
        runner: "api",
        parameters: {
          type: "object",
          properties: {
            channel: { type: "string", description: "頻道 ID" },
            message: { type: "string", description: "訊息內容" },
          },
          required: ["channel", "message"],
        },
        api: {
          method: "POST",
          url: "https://discord.com/api/v10/channels/{{channel}}/messages",
          headers: {
            Authorization: "***",
            "Content-Type": "application/json",
          },
          body: { content: "{{message}}" },
        },
        config: {
          token: { type: "string", secret: true, required: true, description: "Discord Bot Token" },
        },
      },
    },
    {
      id: "telegram",
      name: "Telegram",
      icon: "✈️",
      category: "messaging",
      description: "Telegram 訊息傳送",
      toolDef: {
        name: "telegram_send",
        description: "發送 Telegram 訊息",
        runner: "api",
        parameters: {
          type: "object",
          properties: {
            chat_id: { type: "string", description: "聊天 ID" },
            text: { type: "string", description: "訊息內容" },
          },
          required: ["chat_id", "text"],
        },
        api: {
          method: "POST",
          url: "https://api.telegram.org/bot{{…token}}/sendMessage",
          headers: { "Content-Type": "application/json" },
          body: { chat_id: "{{chat_id}}", text: "{{text}}" },
        },
        config: {
          token: { type: "string", secret: true, required: true, description: "Telegram Bot Token" },
        },
      },
    },
    {
      id: "line",
      name: "LINE",
      icon: "🟢",
      category: "messaging",
      description: "LINE 訊息傳送",
      toolDef: {
        name: "line_send",
        description: "透過 LINE Messaging API 發送訊息",
        runner: "api",
        parameters: {
          type: "object",
          properties: {
            to: { type: "string", description: "接收者 ID" },
            message: { type: "string", description: "訊息內容" },
          },
          required: ["to", "message"],
        },
        api: {
          method: "POST",
          url: "https://api.line.me/v2/bot/message/push",
          headers: {
            Authorization: "Bearer {{…token}}",
            "Content-Type": "application/json",
          },
          body: {
            to: "{{to}}",
            messages: [{ type: "text", text: "{{message}}" }],
          },
        },
        config: {
          token: { type: "string", secret: true, required: true, description: "LINE Channel Access Token" },
        },
      },
    },
    {
      id: "sendgrid",
      name: "SendGrid Email",
      icon: "📧",
      category: "email",
      description: "透過 SendGrid 發送 Email",
      toolDef: {
        name: "email_send",
        description: "透過 SendGrid 發送 Email",
        runner: "api",
        parameters: {
          type: "object",
          properties: {
            to: { type: "string", description: "收件人 Email" },
            subject: { type: "string", description: "主旨" },
            content: { type: "string", description: "郵件內容" },
          },
          required: ["to", "subject", "content"],
        },
        api: {
          method: "POST",
          url: "https://api.sendgrid.com/v3/mail/send",
          headers: {
            Authorization: "Bearer {{…apiKey}}",
            "Content-Type": "application/json",
          },
          body: {
            personalizations: [{ to: [{ email: "{{to}}" }] }],
            from: { email: "{{…fromEmail}}" },
            subject: "{{subject}}",
            content: [{ type: "text/plain", value: "{{content}}" }],
          },
        },
        config: {
          apiKey: { type: "string", secret: true, required: true, description: "SendGrid API Key" },
          fromEmail: { type: "string", required: true, description: "寄件人 Email" },
        },
      },
    },
    {
      id: "slack",
      name: "Slack",
      icon: "💼",
      category: "messaging",
      description: "Slack 訊息傳送",
      toolDef: {
        name: "slack_send",
        description: "發送 Slack 訊息到指定頻道",
        runner: "api",
        parameters: {
          type: "object",
          properties: {
            channel: { type: "string", description: "頻道 ID 或名稱" },
            text: { type: "string", description: "訊息內容" },
          },
          required: ["channel", "text"],
        },
        api: {
          method: "POST",
          url: "https://slack.com/api/chat.postMessage",
          headers: {
            Authorization: "Bearer {{…token}}",
            "Content-Type": "application/json",
          },
          body: { channel: "{{channel}}", text: "{{text}}" },
        },
        config: {
          token: { type: "string", secret: true, required: true, description: "Slack Bot Token (xoxb-...)" },
        },
      },
    },
    {
      id: "custom",
      name: "自訂 API",
      icon: "✨",
      category: "custom",
      description: "連接任意 REST API",
      toolDef: {
        name: "",
        description: "",
        runner: "api",
        parameters: { type: "object", properties: {} },
        api: {
          method: "POST",
          url: "",
          headers: { "Content-Type": "application/json" },
          body: {},
        },
        config: {},
      },
    },
  ];
}
