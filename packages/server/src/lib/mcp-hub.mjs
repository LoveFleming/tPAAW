/**
 * MCP Hub — Model Context Protocol Client Manager
 *
 * PAAW 啟動時讀 data/config/mcp-servers.json，
 * 逐個連接 MCP server（stdio / SSE / in-process），
 * 收集 tool definitions，建立路由表。
 *
 * Agent call executeToolCall(name, params) 時，
 * Hub 轉發 JSON-RPC call 到對應的 MCP server。
 *
 * 加新工具 = 在 mcp-servers.json 加一段設定，不用改 PAAW 碼。
 */

import { spawn } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { randomUUID } from "crypto";

// ── State ──

const mcpServers = new Map();   // id → { conn, tools, status, process }
const toolRoute = new Map();    // toolName → serverId
let _initialized = false;

// ── MCP JSON-RPC types ──

/** Minimal MCP client over stdio */
class StdioMCPClient {
  constructor(serverId, config) {
    this.serverId = serverId;
    this.config = config;
    this.process = null;
    this._buffer = "";
    this._pending = new Map();   // requestId → { resolve, reject }
    this._nextId = 1;
    this.tools = [];
    this.ready = false;
  }

  async connect() {
    const { command, args = [], env = {} } = this.config;
    const fullEnv = { ...process.env, ...env };

    this.process = spawn(command, args, {
      env: fullEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.process.stdout.on("data", (chunk) => this._onStdout(chunk));
    this.process.stderr.on("data", (chunk) => {
      const msg = chunk.toString().trim();
      if (msg) console.log(`[mcp:${this.serverId}] stderr:`, msg.slice(0, 200));
    });

    this.process.on("exit", (code) => {
      console.log(`[mcp:${this.serverId}] process exited code=${code}`);
      this.ready = false;
    });

    // Wait for process to start
    await new Promise(r => setTimeout(r, 300));

    // Initialize handshake
    const initResult = await this._rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "paaw-mcp-hub", version: "1.0.0" },
    });

    // Send initialized notification
    this._notify("notifications/initialized", {});

    // List tools
    const toolsResult = await this._rpc("tools/list", {});
    this.tools = toolsResult?.tools || [];
    this.ready = true;

    console.log(`[mcp:${this.serverId}] connected, ${this.tools.length} tools`);
    return this.tools;
  }

  async callTool(name, args) {
    const result = await this._rpc("tools/call", { name, arguments: args });
    // MCP returns { content: [{ type: "text", text: "..." }] }
    if (result?.content?.[0]?.text) {
      try { return JSON.parse(result.content[0].text); }
      catch { return { result: result.content[0].text }; }
    }
    return result;
  }

  async disconnect() {
    this.ready = false;
    try { this.process?.stdin?.end(); } catch {}
    try { this.process?.kill("SIGTERM"); } catch {}
  }

  // ── JSON-RPC over stdio ──

  _onStdout(chunk) {
    this._buffer += chunk.toString();
    // MCP messages are newline-delimited JSON
    const lines = this._buffer.split("\n");
    this._buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed);
        this._handleMessage(msg);
      } catch (err) {
        // Might be a partial or non-JSON line
      }
    }
  }

  _handleMessage(msg) {
    // Response to our request
    if (msg.id && this._pending.has(msg.id)) {
      const { resolve, reject } = this._pending.get(msg.id);
      this._pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message || "MCP error"));
      else resolve(msg.result);
      return;
    }
    // Notification or server-initiated message — ignore for now
  }

  _rpc(method, params) {
    return new Promise((resolve, reject) => {
      const id = this._nextId++;
      this._pending.set(id, { resolve, reject });

      const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params });
      this.process.stdin.write(msg + "\n");

      // Timeout after 30s
      setTimeout(() => {
        if (this._pending.has(id)) {
          this._pending.delete(id);
          reject(new Error(`MCP timeout: ${method} (${this.serverId})`));
        }
      }, 30000);
    });
  }

  _notify(method, params) {
    const msg = JSON.stringify({ jsonrpc: "2.0", method, params });
    this.process.stdin.write(msg + "\n");
  }
}

/** In-process MCP server — for PAAW builtin tools */
class InProcessMCPClient {
  constructor(serverId, config, module) {
    this.serverId = serverId;
    this.config = config;
    this.module = module;
    this.tools = [];
    this.ready = false;
  }

  async connect() {
    if (this.module.init) await this.module.init(this.config);
    this.tools = this.module.getTools() || [];
    this.ready = true;
    console.log(`[mcp:${this.serverId}] in-process connected, ${this.tools.length} tools`);
    return this.tools;
  }

  async callTool(name, args) {
    return await this.module.execute(name, args);
  }

  async disconnect() {
    if (this.module.destroy) await this.module.destroy();
    this.ready = false;
  }
}

// ── Hub API ──

/**
 * Load + connect all MCP servers from config
 */
export async function loadMCPServers(configPath, paawRoot) {
  if (_initialized) return;
  _initialized = true;

  // Always load builtin tools first
  const builtin = await _loadBuiltin();
  for (const t of builtin.tools) {
    toolRoute.set(t.function.name, "_builtin");
  }
  mcpServers.set("_builtin", { id: "_builtin", type: "builtin", conn: builtin, tools: builtin.tools, status: "ready" });

  // Read config file
  if (!existsSync(configPath)) {
    console.log("[mcp-hub] No mcp-servers.json found, using builtin only");
    return;
  }

  let rawConfig;
  try {
    rawConfig = readFileSync(configPath, "utf-8");
  } catch (err) {
    console.error("[mcp-hub] Failed to read mcp-servers.json:", err.message);
    return;
  }

  // Replace {{PAAW_ROOT}} placeholder
  const resolved = rawConfig.replace(/\{\{PAAW_ROOT\}\}/g, paawRoot.replace(/\/$/, ""));

  let config;
  try {
    config = JSON.parse(resolved);
  } catch (err) {
    console.error("[mcp-hub] Failed to parse mcp-servers.json:", err.message);
    return;
  }

  // Connect each server
  for (const [serverId, serverConfig] of Object.entries(config)) {
    if (serverConfig.enabled === false) {
      console.log(`[mcp-hub] Skipping disabled server: ${serverId}`);
      continue;
    }

    try {
      let conn;

      if (serverConfig.transport === "in-process") {
        // Load in-process module
        const modulePath = serverConfig.module.startsWith(".")
          ? resolve(paawRoot, serverConfig.module)
          : serverConfig.module;
        const module = (await import(`file://${modulePath}`)).default;
        conn = new InProcessMCPClient(serverId, serverConfig, module);
      } else {
        // Default: stdio
        conn = new StdioMCPClient(serverId, serverConfig);
      }

      const tools = await conn.connect();

      // Register tools in route table
      const toolDefs = tools.map(t => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description || "",
          parameters: t.inputSchema || { type: "object", properties: {} },
        },
      }));

      mcpServers.set(serverId, {
        id: serverId,
        type: serverConfig.transport || "stdio",
        conn,
        tools: toolDefs,
        status: "ready",
      });

      for (const t of toolDefs) {
        toolRoute.set(t.function.name, serverId);
      }

      console.log(`[mcp-hub] Registered ${toolDefs.length} tools from "${serverId}"`);
    } catch (err) {
      console.error(`[mcp-hub] Failed to connect "${serverId}":`, err.message);
      mcpServers.set(serverId, { id: serverId, type: "error", conn: null, tools: [], status: `error: ${err.message}` });
    }
  }
}

/**
 * Get all tool definitions (for LLM function calling)
 */
export function getAllToolDefinitions() {
  const all = [];
  for (const s of mcpServers.values()) {
    all.push(...s.tools);
  }
  return all;
}

/**
 * Get specific tool definitions by names
 */
export function getToolDefinitions(names) {
  const all = getAllToolDefinitions();
  if (!names || names.length === 0) return all;
  return all.filter(t => names.includes(t.function.name));
}

/**
 * Execute a tool call — routes to the right MCP server
 */
export async function executeToolCall(toolName, params, context) {
  const serverId = toolRoute.get(toolName);
  if (!serverId) return { error: `Unknown tool: ${toolName}` };

  const server = mcpServers.get(serverId);
  if (!server?.conn) return { error: `Server not connected: ${serverId}` };

  try {
    return await server.conn.callTool(toolName, params);
  } catch (err) {
    return { error: `MCP call failed: ${err.message}` };
  }
}

/**
 * List all MCP servers + their tools (for UI / GET /tool-providers)
 */
export function listProviders() {
  return Array.from(mcpServers.values()).map(s => ({
    id: s.id,
    type: s.type,
    status: s.status,
    toolCount: s.tools.length,
    tools: s.tools.map(t => ({ name: t.function.name, description: t.function.description })),
  }));
}

/**
 * Graceful shutdown — disconnect all MCP servers
 */
export async function shutdownMCP() {
  for (const [id, server] of mcpServers) {
    if (server.conn) {
      try { await server.conn.disconnect(); } catch {}
    }
  }
  mcpServers.clear();
  toolRoute.clear();
  _initialized = false;
  console.log("[mcp-hub] All servers disconnected");
}

// ── Builtin tools (wait, finish — always in-process) ──

/** Builtin MCP server — implements the same interface as InProcessMCPClient */
const builtinServer = {
  serverId: "_builtin",
  ready: true,
  tools: [
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
  ],

  async init() {},

  getTools() {
    return [
      { name: "wait", description: "等待指定秒數（最大 120）", inputSchema: { type: "object", properties: { seconds: { type: "number", default: 30 } } } },
      { name: "finish", description: "完成任務，回報最終結果", inputSchema: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] } },
    ];
  },

  async callTool(name, args) {
    switch (name) {
      case "wait": {
        const seconds = Math.min(args.seconds || 30, 120);
        await new Promise(r => setTimeout(r, seconds * 1000));
        return { waited: seconds };
      }
      case "finish":
        return { ok: true, finished: true, summary: args.summary };
      default:
        return { error: `Unknown builtin: ${name}` };
    }
  },

  async disconnect() {},
};

async function _loadBuiltin() {
  return builtinServer;
}
