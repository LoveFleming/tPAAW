/**
 * tChat Tool Provider Runner
 * 
 * 目前是 mock 版本 — 寫到 PAAW chat file 模擬 tChat 訊息
 * 之後接真實 tChat API 只改這個檔，不用動核心碼
 * 
 * 接真實 tChat 時：
 *   1. 改 init() 建立 WebSocket / API 連線
 *   2. 改 execute() 的 send/read/reply 用真實 API
 *   3. 加 event listener 把收到的訊息推到 PAAW
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

export default {
  id: "tchat",

  async init(config) {
    this.config = config;
    this._readCursors = new Map();  // roomId → lastReadIndex

    // 之後接真實 tChat 時在這裡建立連線
    // this.client = new TChatClient({ token: config.apiToken });
    // await this.client.connect();

    console.log("[tchat] Provider initialized (mock mode)");
  },

  async execute(toolName, params, context) {
    const { roomId, message } = params;
    const chatDir = context?.chatDir || join(context?.paawRoot || ".", "data", "chats");

    switch (toolName) {
      case "tchat_send":
      case "tchat_reply": {
        return await this._sendMessage(chatDir, roomId, message, toolName === "tchat_reply");
      }
      case "tchat_read": {
        return await this._readMessages(chatDir, roomId);
      }
      default:
        return { error: `Unknown tChat tool: ${toolName}` };
    }
  },

  async _sendMessage(chatDir, roomId, message, isReply) {
    await mkdir(chatDir, { recursive: true });
    const chatFile = join(chatDir, `${roomId}.json`);

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

    // Update cursor
    const idx = chat.messages.length - 1;
    if (!this._readCursors.has(roomId)) this._readCursors.set(roomId, idx);

    console.log(`[tchat] send → ${roomId}: ${message.slice(0, 80)}...`);
    return { ok: true, roomId, sent: message.slice(0, 200) };
  },

  async _readMessages(chatDir, roomId) {
    const chatFile = join(chatDir, `${roomId}.json`);
    if (!existsSync(chatFile)) return { replies: [], count: 0 };

    const chat = JSON.parse(readFileSync(chatFile, "utf-8"));
    const messages = chat.messages || [];

    const lastRead = this._readCursors.get(roomId) ?? -1;
    const newReplies = messages
      .map((m, i) => ({ ...m, _idx: i }))
      .filter(m => m._idx > lastRead && m.role === "user");

    this._readCursors.set(roomId, messages.length - 1);

    const replies = newReplies.map(m => ({ content: m.content, timestamp: m.timestamp }));
    console.log(`[tchat] read ← ${roomId}: ${replies.length} new replies`);
    return { replies, count: replies.length };
  },

  async destroy() {
    // 之後接真實 tChat 時在這裡斷開連線
    // this.client?.disconnect();
    console.log("[tchat] Provider destroyed");
  },
};
