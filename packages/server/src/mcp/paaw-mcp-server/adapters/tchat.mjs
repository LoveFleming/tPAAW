/**
 * tChat Adapter
 *
 * 公司 tChat 通訊軟體整合。
 * 目前 mock 模式 — 寫到 PAAW chat file 模擬。
 * 接真實 tChat 只改 execute() 裡的 send/read/reply。
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

export const id = "tchat";
export const name = "tChat 通訊軟體";

const _readCursors = new Map();  // roomId → lastReadIndex

export const tools = [
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

let CHAT_DIR = null;

export async function init(config) {
  const paawRoot = process.env.PAAW_ROOT || config?.paawRoot || process.cwd();
  CHAT_DIR = join(paawRoot, "data", "chats");
}

export async function execute(toolName, args, config) {
  const { roomId, message } = args;

  switch (toolName) {
    case "tchat_send":
    case "tchat_reply":
      return await _sendMessage(roomId, message, toolName === "tchat_reply");
    case "tchat_read":
      return await _readMessages(roomId);
    default:
      return { error: `Unknown tool: ${toolName}` };
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

  // Always update cursor — handles file reset/new file correctly
  _readCursors.set(roomId, chat.messages.length - 1);

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
  return { replies, count: replies.length };
}
