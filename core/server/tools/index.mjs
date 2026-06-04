// tClaw Tool Registry — tools that the chat AI can call
// Each tool has: name, description, parameters (JSON Schema), execute function

import { readFile, writeFile, mkdir } from "fs/promises";
import { resolve, dirname } from "path";

const TCLAW_DATA_DIR = resolve(process.cwd(), "../../data");

// ── Tool definitions (OpenAI function calling format) ──

const toolDefinitions = [
  // ──── TODO ────
  {
    type: "function",
    function: {
      name: "todo_list",
      description: "列出所有待辦事項。可選擇依狀態篩選（all/pending/done）",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["all", "pending", "done"], description: "篩選狀態，預設 all" }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "todo_add",
      description: "新增一筆待辦事項",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "待辦內容" },
          priority: { type: "string", enum: ["high", "medium", "low"], description: "優先級，預設 medium" },
          due: { type: "string", description: "截止日期（ISO 格式或自然語言，如 '明天'、'下週一'）" }
        },
        required: ["text"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "todo_update",
      description: "更新待辦事項（改內容、改狀態、改優先級）",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "待辦 ID" },
          text: { type: "string", description: "新內容（可選）" },
          status: { type: "string", enum: ["pending", "done"], description: "新狀態（可選）" },
          priority: { type: "string", enum: ["high", "medium", "low"], description: "新優先級（可選）" }
        },
        required: ["id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "todo_delete",
      description: "刪除一筆待辦事項",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "待辦 ID" }
        },
        required: ["id"]
      }
    }
  },

  // ──── NOTES ────
  {
    type: "function",
    function: {
      name: "note_list",
      description: "列出所有筆記",
      parameters: {
        type: "object",
        properties: {
          tag: { type: "string", description: "依標籤篩選（可選）" }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "note_create",
      description: "建立一筆筆記",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "筆記標題" },
          content: { type: "string", description: "筆記內容" },
          tags: { type: "array", items: { type: "string" }, description: "標籤（可選）" }
        },
        required: ["title", "content"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "note_read",
      description: "讀取一筆筆記的完整內容",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "筆記 ID" }
        },
        required: ["id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "note_delete",
      description: "刪除一筆筆記",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "筆記 ID" }
        },
        required: ["id"]
      }
    }
  },

  // ──── FILE ────
  {
    type: "function",
    function: {
      name: "file_read",
      description: "讀取工作區內的檔案內容",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "檔案相對路徑" },
          workspace: { type: "string", description: "工作區名稱或路徑（可選，用預設工作區）" }
        },
        required: ["path"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "file_list",
      description: "列出工作區目錄的檔案",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "目錄相對路徑（可選，預設根目錄）" },
          workspace: { type: "string", description: "工作區名稱或路徑（可選）" }
        },
        required: []
      }
    }
  },

  // ──── MEMORY ────
  {
    type: "function",
    function: {
      name: "memory_save",
      description: "儲存重要資訊到長期記憶（跨對話保留）",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "記憶標題/分類" },
          content: { type: "string", description: "記憶內容" }
        },
        required: ["key", "content"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "memory_read",
      description: "讀取長期記憶",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "記憶標題/分類（可選，不填則列出所有）" }
        },
        required: []
      }
    }
  },

  // ──── WEB SEARCH ────
  {
    type: "function",
    function: {
      name: "web_search",
      description: "搜尋網路取得即時資訊",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "搜尋關鍵字" }
        },
        required: ["query"]
      }
    }
  }
];

// ── Tool execution handlers ──

async function loadJson(filename, fallback) {
  try {
    const data = await readFile(resolve(TCLAW_DATA_DIR, filename), "utf-8");
    return JSON.parse(data);
  } catch {
    return fallback;
  }
}

async function saveJson(filename, data) {
  await mkdir(TCLAW_DATA_DIR, { recursive: true });
  await writeFile(resolve(TCLAW_DATA_DIR, filename), JSON.stringify(data, null, 2), "utf-8");
}

const toolHandlers = {
  // ──── TODO ────
  async todo_list({ status = "all" }) {
    const todos = await loadJson("todos.json", []);
    const filtered = status === "all" ? todos : todos.filter(t => t.status === status);
    if (filtered.length === 0) return { text: "沒有待辦事項 🎉", todos: [] };
    const list = filtered.map((t, i) => {
      const icon = t.status === "done" ? "✅" : t.priority === "high" ? "🔴" : t.priority === "low" ? "⚪" : "🟡";
      return `${icon} [${t.id}] ${t.text}${t.due ? ` (截止: ${t.due})` : ""}`;
    }).join("\n");
    return { text: list, todos: filtered };
  },

  async todo_add({ text, priority = "medium", due }) {
    const todos = await loadJson("todos.json", []);
    const id = `todo_${Date.now().toString(36)}`;
    const todo = { id, text, priority, status: "pending", due: due || null, createdAt: new Date().toISOString() };
    todos.push(todo);
    await saveJson("todos.json", todos);
    const icon = priority === "high" ? "🔴" : priority === "low" ? "⚪" : "🟡";
    return { text: `已新增 ${icon} ${text}`, todo };
  },

  async todo_update({ id, text, status, priority }) {
    const todos = await loadJson("todos.json", []);
    const idx = todos.findIndex(t => t.id === id);
    if (idx === -1) return { text: `找不到待辦 ${id}`, error: true };
    if (text) todos[idx].text = text;
    if (status) todos[idx].status = status;
    if (priority) todos[idx].priority = priority;
    await saveJson("todos.json", todos);
    return { text: `已更新 [${id}] ${todos[idx].text}`, todo: todos[idx] };
  },

  async todo_delete({ id }) {
    let todos = await loadJson("todos.json", []);
    const before = todos.length;
    todos = todos.filter(t => t.id !== id);
    if (todos.length === before) return { text: `找不到待辦 ${id}`, error: true };
    await saveJson("todos.json", todos);
    return { text: `已刪除 [${id}]` };
  },

  // ──── NOTES ────
  async note_list({ tag } = {}) {
    const notes = await loadJson("notes.json", []);
    let filtered = notes;
    if (tag) filtered = notes.filter(n => n.tags?.includes(tag));
    if (filtered.length === 0) return { text: "沒有筆記", notes: [] };
    const list = filtered.map(n => `📝 [${n.id}] ${n.title}${n.tags?.length ? ` #${n.tags.join(" #")}` : ""}`).join("\n");
    return { text: list, notes: filtered.map(n => ({ id: n.id, title: n.title, tags: n.tags })) };
  },

  async note_create({ title, content, tags = [] }) {
    const notes = await loadJson("notes.json", []);
    const id = `note_${Date.now().toString(36)}`;
    const note = { id, title, content, tags, createdAt: new Date().toISOString() };
    notes.push(note);
    await saveJson("notes.json", notes);
    return { text: `已建立筆記「${title}」`, note: { id, title } };
  },

  async note_read({ id }) {
    const notes = await loadJson("notes.json", []);
    const note = notes.find(n => n.id === id);
    if (!note) return { text: `找不到筆記 ${id}`, error: true };
    return { text: `## ${note.title}\n\n${note.content}`, note };
  },

  async note_delete({ id }) {
    let notes = await loadJson("notes.json", []);
    const target = notes.find(n => n.id === id);
    if (!target) return { text: `找不到筆記 ${id}`, error: true };
    notes = notes.filter(n => n.id !== id);
    await saveJson("notes.json", notes);
    return { text: `已刪除筆記「${target.title}」` };
  },

  // ──── FILE ────
  async file_list({ path: dirPath = ".", workspace } = {}) {
    try {
      const workspaces = await loadJson("workspaces.json", []);
      const ws = workspace ? workspaces.find(w => w.name === workspace || w.path === workspace) : workspaces[0];
      if (!ws) return { text: "沒有設定工作區，請先在設定中加入", error: true };
      const { readdir } = await import("fs/promises");
      const fullDir = resolve(ws.path, dirPath);
      const entries = await readdir(fullDir, { withFileTypes: true });
      const list = entries.map(e => `${e.isDirectory() ? "📁" : "📄"} ${e.name}`).join("\n");
      return { text: list || "(空目錄)", path: fullDir };
    } catch (err) {
      return { text: `讀取失敗: ${err.message}`, error: true };
    }
  },

  async file_read({ path: filePath, workspace }) {
    try {
      const workspaces = await loadJson("workspaces.json", []);
      const ws = workspace ? workspaces.find(w => w.name === workspace || w.path === workspace) : workspaces[0];
      if (!ws) return { text: "沒有設定工作區", error: true };
      const fullPath = resolve(ws.path, filePath);
      const content = await readFile(fullPath, "utf-8");
      const preview = content.length > 5000 ? content.slice(0, 5000) + "\n... (截斷)" : content;
      return { text: preview, path: fullPath };
    } catch (err) {
      return { text: `讀取失敗: ${err.message}`, error: true };
    }
  },

  // ──── MEMORY ────
  async memory_save({ key, content }) {
    const memories = await loadJson("memories.json", {});
    memories[key] = { content, updatedAt: new Date().toISOString() };
    await saveJson("memories.json", memories);
    // Also update MEMORY.md
    try {
      const memPath = resolve(TCLAW_DATA_DIR, "MEMORY.md");
      let memContent = "";
      try { memContent = await readFile(memPath, "utf-8"); } catch {}
      const sectionHeader = `## ${key}`;
      const sectionBlock = `${sectionHeader}\n${content}`;
      // Check if section exists
      const sectionRegex = new RegExp(`^## ${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, "m");
      if (sectionRegex.test(memContent)) {
        // Replace existing section (up to next ## or end)
        const lines = memContent.split("\n");
        let startIdx = -1, endIdx = lines.length;
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].match(new RegExp(`^## ${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`))) { startIdx = i; }
          else if (startIdx >= 0 && lines[i].startsWith("## ")) { endIdx = i; break; }
        }
        if (startIdx >= 0) {
          lines.splice(startIdx, endIdx - startIdx, sectionBlock);
          memContent = lines.join("\n");
        }
      } else {
        // Append new section
        memContent = memContent.replace(/\n*$/, "") + "\n\n" + sectionBlock + "\n";
      }
      await writeFile(memPath, memContent, "utf-8");
    } catch (err) {
      console.error("[tClaw] memory_save MEMORY.md update error:", err.message);
    }
    return { text: `已記住「${key}」🧠` };
  },

  async memory_read({ key } = {}) {
    const memories = await loadJson("memories.json", {});
    if (!key) {
      const keys = Object.keys(memories);
      if (keys.length === 0) return { text: "記憶是空白的", keys: [] };
      return { text: keys.map(k => `🧠 ${k}`).join("\n"), keys };
    }
    const item = memories[key];
    if (!item) return { text: `找不到「${key}」的記憶`, error: true };
    return { text: `🧠 ${key}:\n${item.content}`, key, content: item.content };
  },

  // ──── WEB SEARCH (placeholder — needs search API) ────
  async web_search({ query }) {
    // For now, return a hint. Can be connected to a search API later.
    return { text: `搜尋「${query}」— 搜尋功能尚未接入 API，敬請期待`, query, note: "需配置搜尋 API" };
  }
};

// ── Export ──

export { toolDefinitions, toolHandlers };
