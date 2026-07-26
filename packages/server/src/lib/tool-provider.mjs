/**
 * Tool Provider Registry
 * 
 * Auto-loads tool providers from data/tools/{provider-id}/
 * Each provider has:
 *   - provider.json  (tool definitions + config schema)
 *   - runner.mjs     (execution logic, runner=script only)
 *   - config.json    (user config, .gitignore'd)
 * 
 * Provider types:
 *   - script: Node.js module with execute() function
 *   - api:    REST API proxy (no runner.mjs needed)
 *   - builtin: PAAW internal tools
 */

import { readdir, readFile, writeFile, mkdir } from "fs/promises";
import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";

const providers = new Map();       // id → { config, runner, definitions }
const toolIndex = new Map();       // toolName → providerId

/**
 * Load all tool providers from data/tools/
 */
export async function loadToolProviders(toolsRoot) {
  providers.clear();
  toolIndex.clear();

  if (!existsSync(toolsRoot)) {
    console.log("[tool-provider] No tools directory found, skipping");
    return [];
  }

  // Always load builtin tools first
  const builtinTools = _getBuiltinTools();
  for (const t of builtinTools) {
    toolIndex.set(t.function.name, "_builtin");
  }
  providers.set("_builtin", { id: "_builtin", type: "builtin", definitions: builtinTools, runner: null });

  // Scan data/tools/ for provider directories
  let entries = [];
  try { entries = await readdir(toolsRoot, { withFileTypes: true }); } catch { return []; }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const providerDir = join(toolsRoot, entry.name);
    const providerJsonPath = join(providerDir, "provider.json");
    if (!existsSync(providerJsonPath)) continue;

    try {
      const providerJson = JSON.parse(readFileSync(providerJsonPath, "utf-8"));
      const configPath = join(providerDir, "config.json");
      let config = {};
      try { config = JSON.parse(readFileSync(configPath, "utf-8")); } catch {}

      // Check if provider is enabled
      if (config.enabled === false) {
        console.log(`[tool-provider] Skipping disabled provider: ${providerJson.id}`);
        continue;
      }

      const definitions = (providerJson.tools || []).map(t => ({
        type: "function",
        function: t,
      }));

      // Load runner if runner type is "script"
      let runner = null;
      if (providerJson.runner === "script") {
        const runnerPath = join(providerDir, "runner.mjs");
        if (existsSync(runnerPath)) {
          const runnerUrl = resolve(runnerPath);
          runner = (await import(`file://${runnerUrl}`)).default;
          // Initialize runner if needed
          if (runner.init) {
            try { await runner.init(config); }
            catch (err) { console.error(`[tool-provider] Init failed for ${providerJson.id}:`, err.message); continue; }
          }
        }
      }

      // Register tools
      providers.set(providerJson.id, {
        id: providerJson.id,
        type: providerJson.runner || "script",
        config,
        runner,
        definitions,
        providerJson,
      });

      for (const t of definitions) {
        toolIndex.set(t.function.name, providerJson.id);
      }

      console.log(`[tool-provider] Loaded "${providerJson.id}" with ${definitions.length} tools`);
    } catch (err) {
      console.error(`[tool-provider] Failed to load ${entry.name}:`, err.message);
    }
  }

  return Array.from(providers.values());
}

/**
 * Get all tool definitions (for LLM function calling)
 */
export function getAllToolDefinitions() {
  const all = [];
  for (const p of providers.values()) {
    all.push(...p.definitions);
  }
  return all;
}

/**
 * Get specific tool definitions by names (for agentic workflow with filtered tools)
 */
export function getToolDefinitions(names) {
  const all = getAllToolDefinitions();
  if (!names || names.length === 0) return all;
  return all.filter(t => names.includes(t.function.name));
}

/**
 * Execute a tool call
 */
export async function executeToolCall(toolName, params, context) {
  const providerId = toolIndex.get(toolName);
  if (!providerId) return { error: `Unknown tool: ${toolName}` };

  const provider = providers.get(providerId);
  if (!provider) return { error: `Provider not found: ${providerId}` };

  // Builtin tools
  if (providerId === "_builtin") {
    return await _executeBuiltin(toolName, params, context);
  }

  // Script runner
  if (provider.runner?.execute) {
    return await provider.runner.execute(toolName, params, { ...context, config: provider.config });
  }

  // API runner
  if (provider.type === "api") {
    return await _executeApiCall(toolName, params, provider);
  }

  return { error: `No runner for tool: ${toolName}` };
}

/**
 * Get provider metadata list (for UI)
 */
export function listProviders() {
  return Array.from(providers.values()).map(p => ({
    id: p.id,
    name: p.providerJson?.name || p.id,
    icon: p.providerJson?.icon || "🔧",
    description: p.providerJson?.description || "",
    type: p.type,
    toolCount: p.definitions.length,
    tools: p.definitions.map(d => ({ name: d.function.name, description: d.function.description })),
    enabled: p.config?.enabled !== false,
  }));
}

// ── Builtin tools (always available) ──

function _getBuiltinTools() {
  return [
    {
      type: "function",
      function: {
        name: "wait",
        description: "等待指定秒數，讓使用者有時間回覆。預設 30 秒。",
        parameters: {
          type: "object",
          properties: {
            seconds: { type: "number", description: "等待秒數（最大 120）", default: 30 },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "finish",
        description: "完成任務，回報最終結果。",
        parameters: {
          type: "object",
          properties: {
            summary: { type: "string", description: "任務完成的摘要報告" },
          },
          required: ["summary"],
        },
      },
    },
  ];
}

async function _executeBuiltin(toolName, params, context) {
  switch (toolName) {
    case "wait": {
      const seconds = Math.min(params.seconds || 30, 120);
      await new Promise(r => setTimeout(r, seconds * 1000));
      return { waited: seconds };
    }
    case "finish":
      return { ok: true, finished: true, summary: params.summary };
    default:
      return { error: `Unknown builtin tool: ${toolName}` };
  }
}

// ── API runner (REST proxy) ──

async function _executeApiCall(toolName, params, provider) {
  const { providerJson, config } = provider;
  const toolDef = provider.definitions.find(d => d.function.name === toolName);
  if (!toolDef) return { error: `Tool not found: ${toolName}` };

  const apiConfig = providerJson.api || {};
  const baseUrl = (apiConfig.baseUrl || "").replace(/\{\{(\w+)\}\}/g, (_, k) => config[k] || "");

  const method = apiConfig.method || "POST";
  const endpoint = toolDef.function.endpoint || `/${toolName}`;
  const url = baseUrl + endpoint;

  try {
    const resp = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", ...(apiConfig.headers || {}) },
      body: method !== "GET" ? JSON.stringify(params) : undefined,
    });
    const data = await resp.json();
    return data;
  } catch (err) {
    return { error: err.message };
  }
}
