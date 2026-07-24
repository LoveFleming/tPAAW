/**
 * Tool Provider Loader — 掃描 data/tools/ 載入外掛 tools
 *
 * 支援兩種 runner：
 *   1. api — 通用 HTTP 呼叫，tool.json 裡定義 URL/headers/body 模板，不用寫程式
 *   2. script — 自訂 handler.mjs，複雜邏輯用這個
 *
 * 用法：
 *   data/tools/my-tool/tool.json  → tool 定義 + runner 設定
 *   data/tools/my-tool/config.json → API key 等秘密（.gitignore）
 *   data/tools/my-tool/handler.mjs → 自訂 handler（runner=script 才需要）
 */

import { readdir, readFile } from "fs/promises";
import { existsSync, readFileSync } from "fs";
import { resolve, join } from "path";
import { toolRegistry } from "../lib/tool-registry.mjs";
import { nanoid } from "nanoid";
import { randomUUID } from "crypto";

const PAAW_ROOT = process.env.PAAW_ROOT || resolve(import.meta.dirname, "../../../../");
const TOOLS_DIR = resolve(PAAW_ROOT, "data/tools");

// ── 載入單一 Tool Provider（熱載入，供 API create 後立即註冊）──

export async function initProviderTool(providerId) {
  const providerDir = resolve(TOOLS_DIR, providerId);
  const toolFile = resolve(providerDir, "tool.json");

  if (!existsSync(toolFile)) return;

  const toolDef = JSON.parse(readFileSync(toolFile, "utf-8"));
  if (toolDef.enabled === false) return; // skip disabled

  const config = loadConfig(providerDir);
  const handler = await buildHandler(toolDef, config, providerDir);

  if (!handler) return;

  toolRegistry.register({
    name: toolDef.name,
    definition: {
      type: "function",
      function: {
        name: toolDef.name,
        description: toolDef.description || "",
        parameters: toolDef.parameters || { type: "object", properties: {} },
      },
    },
    source: `tool-provider:${providerId}`,
    handler,
  });

  console.log(`[ToolProvider] Hot-loaded: ${toolDef.name} (${providerId})`);
}

// ── 載入所有 Tool Providers ──

export async function initProviderTools() {
  if (!existsSync(TOOLS_DIR)) return;

  const entries = await readdir(TOOLS_DIR, { withFileTypes: true });
  let count = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const providerDir = resolve(TOOLS_DIR, entry.name);
    const toolFile = resolve(providerDir, "tool.json");

    if (!existsSync(toolFile)) continue;

    try {
      const toolDef = JSON.parse(readFileSync(toolFile, "utf-8"));
      const config = loadConfig(providerDir);
      const handler = await buildHandler(toolDef, config, providerDir);

      if (!handler) {
        console.warn(`[ToolProvider] Skip ${entry.name}: no handler built`);
        continue;
      }

      // 註冊到共用 registry
      toolRegistry.register({
        name: toolDef.name,
        definition: {
          type: "function",
          function: {
            name: toolDef.name,
            description: toolDef.description || "",
            parameters: toolDef.parameters || { type: "object", properties: {} },
          },
        },
        source: `tool-provider:${entry.name}`,
        handler,
      });

      count++;
      console.log(`[ToolProvider] Registered: ${toolDef.name} (runner=${toolDef.runner || "api"}, dir=${entry.name})`);
    } catch (err) {
      console.error(`[ToolProvider] Failed to load ${entry.name}:`, err.message);
    }
  }

  if (count > 0) {
    console.log(`[ToolProvider] Total external tools: ${count}`);
  }
}

// ── 載入 config.json（含 secret）──

function loadConfig(providerDir) {
  const configFile = resolve(providerDir, "config.json");
  if (!existsSync(configFile)) return {};
  try {
    return JSON.parse(readFileSync(configFile, "utf-8"));
  } catch {
    return {};
  }
}

// ── 根據 runner type 產生 handler ──

async function buildHandler(toolDef, config, providerDir) {
  const runner = toolDef.runner || "api";

  switch (runner) {
    case "api":
      return buildApiHandler(toolDef, config);
    case "script":
      return await buildScriptHandler(providerDir);
    default:
      console.warn(`[ToolProvider] Unknown runner: ${runner}`);
      return null;
  }
}

// ── API runner：通用 HTTP 呼叫 ──

function buildApiHandler(toolDef, config) {
  const api = toolDef.api;
  if (!api || !api.url) {
    console.warn(`[ToolProvider] API runner needs 'api.url' in tool.json`);
    return null;
  }

  return async (args, ctx) => {
    // 模板替換：{{參數名}} → args.參數名，{{…EN}} → config 對應值
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

      // 嘗試產生人類可讀的摘要
      const summary = typeof data === "object"
        ? (data.id ? `✅ ${toolDef.name} 成功 (id: ${data.id})` : `✅ ${toolDef.name} 成功`)
        : `✅ ${toolDef.name} 成功`;

      return { text: summary, data };
    } catch (err) {
      return { text: `❌ ${toolDef.name} 呼叫失敗：${err.message}`, error: true };
    }
  };
}

// ── Script runner：自訂 handler.mjs ──

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

// ── Template 工具 ──

/**
 * 替換 {{key}} 模板
 * {{參數名}} → args[參數名]
 * {{…configKey}} → config[configKey]（… 開頭表示從 config 讀，不從 args）
 */
// ── Built-in generators for template engine ──
const GENERATORS = {
  "@nanoid": (size) => nanoid(size ? parseInt(size) : undefined),
  "@uuid": () => randomUUID(),
  "@timestamp": () => String(Date.now()),
  "@isodate": () => new Date().toISOString(),
};

function replaceTemplate(template, args, config) {
  if (typeof template !== "string") return template;
  return template.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    // {{@generator}} or {{@generator:size}}
    if (key.startsWith("@")) {
      const parts = key.split(":");
      const genKey = parts[0];
      const genArg = parts[1] || "";
      const gen = GENERATORS[genKey];
      if (gen) return gen(genArg);
      return `{{${key}}}`;
    }
    // {{…xxx}} → config.xxx
    if (key.startsWith("…") || key.startsWith("...")) {
      const configKey = key.replace(/^[.…]+/, "");
      return config[configKey] ?? `{{${key}}}`;
    }
    // {{xxx}} → args.xxx
    return args[key] ?? config[key] ?? `{{${key}}}`;
  });
}

/**
 * 遞迴替換物件裡所有字串值的模板
 */
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

// ── 產生 context-engine 用的 tool 說明 ──

export function loadProviderInstructions() {
  if (!existsSync(TOOLS_DIR)) return "";

  const entries = [];
  try {
    const dirs = readdirSync(TOOLS_DIR, { withFileTypes: true });
    for (const entry of dirs) {
      if (!entry.isDirectory()) continue;
      const toolFile = resolve(TOOLS_DIR, entry.name, "tool.json");
      if (!existsSync(toolFile)) continue;
      try {
        const toolDef = JSON.parse(readFileSync(toolFile, "utf-8"));
        const params = toolDef.parameters?.properties
          ? Object.entries(toolDef.parameters.properties).map(([k, v]) => `${k}(${v.type || "string"}${v.description ? ": " + v.description : ""})`).join(", ")
          : "";
        entries.push(`${toolDef.name}: ${toolDef.description}${params ? "。參數：" + params : ""}`);
      } catch {}
    }
  } catch {}

  if (entries.length === 0) return "";
  return "外部 Tool Providers：\n" + entries.join("\n");
}

// readdirSync for loadProviderInstructions (sync, runs at context build time)
import { readdirSync } from "fs";
