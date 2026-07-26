#!/usr/bin/env node
/**
 * PAAW Generic MCP Server
 *
 * 一個 process，載入多個 adapter。
 * 每个 adapter 是一個 .mjs 檔，export tools + execute()。
 *
 * Adapter 檔案放在 adapters/ 目錄，自動發現。
 * 加新工具 = 丟一個 .mjs 進去，重啟。完事。
 *
 * Adapter interface:
 *   export const id = "tchat"
 *   export const name = "tChat 通訊軟體"
 *   export const tools = [{ name, description, inputSchema }]
 *   export async function execute(toolName, args, config) { return result }
 *   export async function init(config) {}  // optional
 *
 * 通訊：JSON-RPC over stdio
 */

import { readdirSync, readFileSync, existsSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { createInterface } from "readline";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ADAPTERS_DIR = join(__dirname, "adapters");
const CONFIG_DIR = join(__dirname, "adapters", "_config");

// ── Load adapters ──

const adapters = new Map();   // adapterId → { id, name, tools, execute, config }
const toolIndex = new Map();  // toolName → adapterId

async function loadAdapters() {
  if (!existsSync(ADAPTERS_DIR)) {
    console.error("[paaw-mcp] No adapters/ directory");
    return;
  }

  const entries = readdirSync(ADAPTERS_DIR, { withFileTypes: true });
  const adapterFiles = entries
    .filter(e => e.isFile() && e.name.endsWith(".mjs"))
    .map(e => e.name);

  for (const file of adapterFiles) {
    const filePath = join(ADAPTERS_DIR, file);
    try {
      const mod = await import(`file://${resolve(filePath)}`);
      const adapterId = mod.id || file.replace(".mjs", "");

      // Load adapter-specific config
      let config = {};
      const configPath = join(CONFIG_DIR, `${adapterId}.json`);
      if (existsSync(configPath)) {
        try {
          const rawConfig = readFileSync(configPath, "utf-8");
          const paawRoot = process.env.PAAW_ROOT || process.cwd();
          const resolved = rawConfig.replace(/\{\{PAAW_ROOT\}\}/g, paawRoot);
          config = JSON.parse(resolved);
        } catch {}
      }

      // Skip disabled
      if (config.enabled === false) {
        console.error(`[paaw-mcp] Skipping disabled adapter: ${adapterId}`);
        continue;
      }

      // Init if needed
      if (mod.init) {
        try { await mod.init(config); }
        catch (err) { console.error(`[paaw-mcp] Init failed for ${adapterId}: ${err.message}`); continue; }
      }

      const tools = mod.tools || [];
      adapters.set(adapterId, {
        id: adapterId,
        name: mod.name || adapterId,
        tools,
        execute: mod.execute,
        config,
      });

      for (const t of tools) {
        toolIndex.set(t.name, adapterId);
      }

      console.error(`[paaw-mcp] Loaded adapter "${adapterId}" (${tools.length} tools)`);
    } catch (err) {
      console.error(`[paaw-mcp] Failed to load ${file}: ${err.message}`);
    }
  }

  console.error(`[paaw-mcp] Total: ${adapters.size} adapters, ${toolIndex.size} tools`);
}

// ── MCP JSON-RPC Server (stdio) ──

const rl = createInterface({ input: process.stdin });

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let msg;
  try { msg = JSON.parse(trimmed); }
  catch { return; }

  const { id, method, params } = msg;

  // Notifications (no id) — ignore
  if (id === undefined || id === null) return;

  switch (method) {
    case "initialize":
      send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "paaw-mcp-server", version: "1.0.0" },
        },
      });
      break;

    case "tools/list": {
      // Merge all adapter tools
      const allTools = [];
      for (const a of adapters.values()) {
        allTools.push(...a.tools);
      }
      send({ jsonrpc: "2.0", id, result: { tools: allTools } });
      break;
    }

    case "tools/call": {
      const { name, arguments: args } = params || {};
      const adapterId = toolIndex.get(name);

      if (!adapterId) {
        send({
          jsonrpc: "2.0",
          id,
          error: { code: -32602, message: `Unknown tool: ${name}` },
        });
        return;
      }

      const adapter = adapters.get(adapterId);
      adapter.execute(name, args || {}, adapter.config)
        .then((result) => {
          send({
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: JSON.stringify(result) }],
            },
          });
        })
        .catch((err) => {
          send({
            jsonrpc: "2.0",
            id,
            error: { code: -32603, message: err.message },
          });
        });
      break;
    }

    default:
      send({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Unknown method: ${method}` },
      });
  }
});

// ── Startup ──

loadAdapters().then(() => {
  console.error("[paaw-mcp] Server ready (stdio, waiting for JSON-RPC)");
});

process.on("SIGTERM", () => {
  console.error("[paaw-mcp] Shutting down");
  process.exit(0);
});
