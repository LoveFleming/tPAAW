/**
 * Tool Provider Loader — 掃描 data/tools/ 載入外掛 tools
 *
 * 支援兩種 runner：
 *   1. api — 通用 HTTP 呼叫，tool.json 裡定義 URL/headers/body 模板，不用寫程式
 *   2. script — 自訂 handler.mjs，複雜邏輯用這個
 *
 * 目錄結構（支援兩種）：
 *   單一 tool:  data/tools/{provider}/tool.json
 *   多 tool:   data/tools/{provider}/tools/{tool-name}.json
 *
 * 用法：
 *   data/tools/my-tool/tool.json  → tool 定義 + runner 設定
 *   data/tools/my-tool/config.json → API key 等秘密（.gitignore）
 *   data/tools/my-tool/handler.mjs → 自訂 handler（runner=script 才需要）
 */

import { readdir, readFile } from "fs/promises";
import { existsSync, readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import { toolRegistry } from "../lib/tool-registry.mjs";
import { nanoid } from "nanoid";
import { randomUUID } from "crypto";

// Lazy import to avoid circular dependency
let _registerGroupFn = null;
async function getRegisterGroupFn() {
  if (!_registerGroupFn) {
    try {
      const mod = await import("../lib/paaw-agent-loop.mjs");
      _registerGroupFn = mod.registerProviderToolGroup;
    } catch {
      console.warn("[ToolProvider] Could not import registerProviderToolGroup");
    }
  }
  return _registerGroupFn;
}

const PAAW_ROOT = process.env.PAAW_ROOT || resolve(import.meta.dirname, "../../../../");
const TOOLS_DIR = resolve(PAAW_ROOT, "data/tools");

// ── Built-in template generators ──
const GENERATORS = {
  "@nanoid": (size) => nanoid(size ? parseInt(size) : undefined),
  "@uuid": () => randomUUID(),
  "@timestamp": () => String(Date.now()),
  "@isodate": () => new Date().toISOString(),
  "@today": () => new Date().toISOString().split("T")[0],
  "@yesterday": () => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().split("T")[0]; },
  "@now": () => new Date().toISOString(),
  "@unix": () => String(Math.floor(Date.now() / 1000)),
  "@hour_ago": () => { const d = new Date(); d.setHours(d.getHours() - 1); return d.toISOString(); },
};

// ── Core: register a tool + its group mapping ──

async function registerToolEntry(entry, source, toolGroup) {
  toolRegistry.register({ ...entry, source });
  if (toolGroup) {
    const fn = await getRegisterGroupFn();
    if (fn) fn(entry.name, toolGroup);
  }
}

// ── Build definition + handler from toolDef ──

function buildDefinition(toolDef) {
  return {
    type: "function",
    function: {
      name: toolDef.name,
      description: toolDef.description || "",
      parameters: toolDef.parameters || { type: "object", properties: {} },
    },
  };
}

async function buildHandler(toolDef, config, providerDir) {
  const runner = toolDef.runner || "api";
  if (runner === "api") return buildApiHandler(toolDef, config);
  if (runner === "script") return await buildScriptHandler(providerDir);
  console.warn(`[ToolProvider] Unknown runner: ${runner}`);
  return null;
}

// ── API runner ──

function buildApiHandler(toolDef, config) {
  const api = toolDef.api;
  if (!api || !api.url) {
    console.warn(`[ToolProvider] API runner needs 'api.url' in tool.json`);
    return null;
  }

  return async (args, ctx) => {
    const url = replaceTemplate(api.url, args, config);
    const method = api.method || "POST";
    const headers = {};
    for (const [key, val] of Object.entries(api.headers || {})) {
      headers[key] = replaceTemplate(val, args, config);
    }
    const body = api.body ? JSON.stringify(replaceTemplateDeep(api.body, args, config)) : undefined;

    try {
      const resp = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(15000) });
      const contentType = resp.headers.get("content-type") || "";
      let data;
      if (contentType.includes("application/json")) {
        data = await resp.json();
      } else {
        data = await resp.text();
      }

      if (!resp.ok) {
        return { text: `❌ ${toolDef.name} API 回傳 ${resp.status}: ${typeof data === "string" ? data.slice(0, 200) : JSON.stringify(data).slice(0, 200)}`, error: true };
      }

      const summary = typeof data === "object"
        ? (data.id ? `✅ ${toolDef.name} 成功 (id: ${data.id})` : `✅ ${toolDef.name} 成功`)
        : `✅ ${toolDef.name} 成功`;

      return { text: summary, data };
    } catch (err) {
      return { text: `❌ ${toolDef.name} 呼叫失敗：${err.message}`, error: true };
    }
  };
}

// ── Script runner ──

async function buildScriptHandler(providerDir) {
  const handlerFile = resolve(providerDir, "handler.mjs");
  if (!existsSync(handlerFile)) {
    console.warn(`[ToolProvider] Script runner needs handler.mjs in ${providerDir}`);
    return null;
  }
  try {
    const mod = await import(handlerFile);
    if (typeof mod.default === "function" || typeof mod.handler === "function") {
      return mod.default || mod.handler;
    }
    console.warn(`[ToolProvider] handler.mjs must export default function or handler function`);
    return null;
  } catch (err) {
    console.error(`[ToolProvider] Failed to import handler.mjs:`, err.message);
    return null;
  }
}

// ── Load config.json ──

function loadConfig(providerDir) {
  const configFile = resolve(providerDir, "config.json");
  if (!existsSync(configFile)) return {};
  try { return JSON.parse(readFileSync(configFile, "utf-8")); } catch { return {}; }
}

// ── Scan tool definitions from a provider dir ──

function scanToolDefs(providerDir) {
  const results = [];
  const multiToolsDir = resolve(providerDir, "tools");
  const singleFile = resolve(providerDir, "tool.json");

  if (existsSync(multiToolsDir)) {
    const files = readdirSync(multiToolsDir);
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const toolDef = JSON.parse(readFileSync(resolve(multiToolsDir, f), "utf-8"));
        if (toolDef.enabled !== false) results.push(toolDef);
      } catch {}
    }
  } else if (existsSync(singleFile)) {
    try {
      const toolDef = JSON.parse(readFileSync(singleFile, "utf-8"));
      if (toolDef.enabled !== false) results.push(toolDef);
    } catch {}
  }

  return results;
}

// ── Register a single tool from toolDef ──

async function registerToolFromDef(toolDef, config, providerDir, sourceLabel) {
  const handler = await buildHandler(toolDef, config, providerDir);
  if (!handler) return false;

  await registerToolEntry({
    name: toolDef.name,
    definition: buildDefinition(toolDef),
    handler,
  }, sourceLabel, toolDef.group);

  return true;
}

// ── Load single provider (hot-reload) ──

export async function initProviderTool(providerId) {
  const providerDir = resolve(TOOLS_DIR, providerId);
  const config = loadConfig(providerDir);
  const toolDefs = scanToolDefs(providerDir);
  const sourceLabel = `tool-provider:${providerId}`;

  for (const toolDef of toolDefs) {
    try {
      const ok = await registerToolFromDef(toolDef, config, providerDir, sourceLabel);
      if (ok) console.log(`[ToolProvider] Hot-loaded: ${toolDef.name} (${providerId})`);
    } catch (err) {
      console.error(`[ToolProvider] Failed to hot-load ${providerId}/${toolDef.name}:`, err.message);
    }
  }
}

// ── Load all providers ──

export async function initProviderTools() {
  if (!existsSync(TOOLS_DIR)) return;

  const entries = await readdir(TOOLS_DIR, { withFileTypes: true });
  let count = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const providerDir = resolve(TOOLS_DIR, entry.name);
    const config = loadConfig(providerDir);
    const toolDefs = scanToolDefs(providerDir);
    const sourceLabel = `tool-provider:${entry.name}`;

    for (const toolDef of toolDefs) {
      try {
        const ok = await registerToolFromDef(toolDef, config, providerDir, sourceLabel);
        if (ok) {
          count++;
          console.log(`[ToolProvider] Registered: ${toolDef.name} (runner=${toolDef.runner || "api"}, provider=${entry.name})`);
        }
      } catch (err) {
        console.error(`[ToolProvider] Failed to load ${entry.name}/${toolDef.name}:`, err.message);
      }
    }
  }

  if (count > 0) {
    console.log(`[ToolProvider] Total external tools: ${count}`);
  }
}

// ── Template engine ──

function replaceTemplate(template, args, config) {
  if (typeof template !== "string") return template;
  return template.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    if (key.startsWith("@")) {
      const parts = key.split(":");
      const genKey = parts[0];
      const genArg = parts[1] || "";
      const gen = GENERATORS[genKey];
      if (gen) return gen(genArg);
      return `{{${key}}}`;
    }
    if (key.startsWith("…") || key.startsWith("...")) {
      const configKey = key.replace(/^[.…]+/, "");
      return config[configKey] ?? `{{${key}}}`;
    }
    return args[key] ?? config[key] ?? `{{${key}}}`;
  });
}

function replaceTemplateDeep(obj, args, config) {
  if (typeof obj === "string") return replaceTemplate(obj, args, config);
  if (Array.isArray(obj)) return obj.map(item => replaceTemplateDeep(item, args, config));
  if (obj && typeof obj === "object") {
    const result = {};
    for (const [key, val] of Object.entries(obj)) {
      result[key] = replaceTemplateDeep(val, args, config);
    }
    return result;
  }
  return obj;
}

// ── Context-engine instructions ──

export function loadProviderInstructions() {
  if (!existsSync(TOOLS_DIR)) return "";

  const entries = [];
  try {
    const dirs = readdirSync(TOOLS_DIR, { withFileTypes: true });
    for (const entry of dirs) {
      if (!entry.isDirectory()) continue;
      const providerDir = resolve(TOOLS_DIR, entry.name);
      const toolDefs = scanToolDefs(providerDir);
      for (const toolDef of toolDefs) {
        const params = toolDef.parameters?.properties
          ? Object.entries(toolDef.parameters.properties).map(([k, v]) => `${k}(${v.type || "string"}${v.description ? ": " + v.description : ""})`).join(", ")
          : "";
        entries.push(`${toolDef.name}: ${toolDef.description}${params ? "。參數：" + params : ""}`);
      }
    }
  } catch {}

  if (entries.length === 0) return "";
  return "外部 Tool Providers：\n" + entries.join("\n");
}
