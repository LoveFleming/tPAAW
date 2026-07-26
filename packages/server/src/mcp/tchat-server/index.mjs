#!/usr/bin/env node
/**
 * tChat MCP Server
 *
 * 獨立的 MCP (Model Context Protocol) server。
 * PAAW 透過 MCP Hub 連接這個 server，不需要改 PAAW 核心碼。
 *
 * 目前是 mock 模式 — 寫到 PAAW chat file 模擬 tChat 訊息。
 * 接真實 tChat 時只改這個檔案的 execute() 函式。
 *
 * 啟動方式（由 MCP Hub 自動 spawn）：
 *   node /path/to/tchat-mcp-server/index.mjs
 *
 * 或手動測試：
 *   echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' | node index.mjs
 *
 * 通訊協定：newline-delimited JSON-RPC over stdio
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { createInterface } from "readline";

// ── Config ──

const PAAW_ROOT = process.env.PAAW_ROOT || join(import.meta.dirname, "../../../../App/tPAAW");
const CHAT_DIR = join(PAAW_ROOT, "data", "chats");

// 讀取游標（記住每個 room 讀到哪裡）
const _readCursors = new Map();  // roomId → lastReadIndex

// ── MCP Tool Definitions ──

const TOOLS = [
  {
    name: "tchat_send",
    description: "發送訊息到指定的 tChat 聊天室/群組。訊息會顯示在該聊天室的對話中。",
    inputSchema: {
      type: "object",
      properties: {
        roomId: { type: "string", description: "tChat 房間 ID 或群組 ID" },
        message: { type: "string", description: "要發送的訊息內容（支援 Markdown）" },
      },
      required: ["roomId", "message"],
    },
  },
  {
    name: "tchat_read",
    description: "讀取指定 tChat 聊天室的新回覆（自上次讀取後）。回傳 user 角色的回覆內容。",
    inputSchema: {
      type: "object",
      properties: {
        roomId: { type: "string", description: "tChat 房間 ID 或群組 ID" },
      },
      required: ["roomId"],
    },
  },
  {
    name: "tchat_reply",
    description: "回覆使用者在 tChat 聊天室中的問題。",
    inputSchema: {
      type: "object",
      properties: {
        roomId: { type: "string", description: "tChat 房間 ID 或群組 ID" },
        message: { type: "string", description: "回覆內容" },
      },
      required: ["roomId", "message"],
    },
  },
];

// ── Tool Execution ──

async function executeTool(name, args) {
  const { roomId, message } = args;

  switch (name) {
    case "tchat_send":
    case "tchat_reply": {
      return await _sendMessage(roomId, message, name === "tchat_reply");
    }
    case "tchat_read": {
      return await _readMessages(roomId);
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

async function _sendMessage(roomId, message, isReply) {
  await mkdir(CHAT_DIR, { recursive: true });
  const chatFile = join(CHAT_DIR, `${roomId}.json`);

  let chat;
  try { chat = JSON.parse(await readFile(chatFile, "utf-8")); }
  catch {
    chat = { id: roomId, title: `tChat: ${roomId}`, messages: [], createdAt: new Date().toISOString() };
  }

  const prefix = isReply ? "💬 **[tChat 回覆]** " : "💬 **[tChat]** ";
  chat.messages.push({
    role: "assistant",
    content: prefix + message,
    timestamp: new Date().toISOString(),
    _source: "tchat",
  });
  chat.updatedAt = new Date().toISOString();
  await writeFile(chatFile, JSON.stringify(chat, null, 2), "utf-8");

  // Update cursor to last message we wrote
  const idx = chat.messages.length - 1;
  if (!_readCursors.has(roomId)) _readCursors.set(roomId, idx);

  console.error(`[tchat-mcp] send → ${roomId}: ${message.slice(0, 80)}...`);
  return { ok: true, roomId, sent: message.slice(0, 200) };
}

async function _readMessages(roomId) {
  const chatFile = join(CHAT_DIR, `${roomId}.json`);
  if (!existsSync(chatFile)) return { replies: [], count: 0 };

  const chat = JSON.parse(readFileSync(chatFile, "utf-8"));
  const messages = chat.messages || [];

  const lastRead = _readCursors.get(roomId) ?? -1;
  const newReplies = messages
    .map((m, i) => ({ ...m, _idx: i }))
    .filter(m => m._idx > lastRead && m.role === "user" && !m._source?.includes("tchat"));

  _readCursors.set(roomId, messages.length - 1);

  const replies = newReplies.map(m => ({ content: m.content, timestamp: m.timestamp }));
  console.error(`[tchat-mcp] read ← ${roomId}: ${replies.length} new replies`);
  return { replies, count: replies.length };
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

  const { jsonrpc, id, method, params } = msg;

  // Handle notifications (no id)
  if (id === undefined || id === null) return;

  // Handle requests
  switch (method) {
    case "initialize":
      send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "tchat-mcp-server", version: "1.0.0" },
        },
      });
      break;

    case "notifications/initialized":
      // No response needed for notifications
      break;

    case "tools/list":
      send({
        jsonrpc: "2.0",
        id,
        result: { tools: TOOLS },
      });
      break;

    case "tools/call": {
      const { name, arguments: args } = params || {};
      executeTool(name, args || {})
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

// Graceful shutdown
process.on("SIGTERM", () => {
  console.error("[tchat-mcp] Shutting down");
  process.exit(0);
});

console.error("[tchat-mcp] Server ready (stdio, waiting for JSON-RPC)");
