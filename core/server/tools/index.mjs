// tClaw Universal App Engine
// All apps are data-driven: defined in data/apps/*.json
// Generic CRUD tools work for any app based on its field schema
// New apps can be created at runtime — no code changes needed

import { readFile, writeFile, mkdir, readdir } from "fs/promises";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TCLAW_DATA_DIR = resolve(__dirname, "../../../data");
const APPS_DIR = resolve(TCLAW_DATA_DIR, "apps");
const APP_DATA_DIR = resolve(TCLAW_DATA_DIR, "app-data");

// ── Load all app definitions ──

async function loadApps() {
  await mkdir(APPS_DIR, { recursive: true });
  const files = await readdir(APPS_DIR);
  const apps = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      const data = JSON.parse(await readFile(resolve(APPS_DIR, f), "utf-8"));
      apps.push(data);
    } catch {}
  }
  return apps;
}

async function loadAppData(appId) {
  await mkdir(APP_DATA_DIR, { recursive: true });
  try {
    return JSON.parse(await readFile(resolve(APP_DATA_DIR, `${appId}.json`), "utf-8"));
  } catch {
    return [];
  }
}

async function saveAppData(appId, data) {
  await mkdir(APP_DATA_DIR, { recursive: true });
  await writeFile(resolve(APP_DATA_DIR, `${appId}.json`), JSON.stringify(data, null, 2), "utf-8");
}

// ── Build tool definitions dynamically ──

async function buildToolDefinitions() {
  const apps = await loadApps();
  const tools = [];

  // app_list — list all available apps
  tools.push({
    type: "function",
    function: {
      name: "app_list",
      description: "列出所有可用的 App",
      parameters: { type: "object", properties: {}, required: [] }
    }
  });

  // app_create — create a new app (user can create via chat!)
  tools.push({
    type: "function",
    function: {
      name: "app_create",
      description: "建立一個新的自訂 App。使用者描述想要的功能後，AI 幫他定義 fields 和提示詞。",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "App ID（英文、小寫、底線）" },
          name: { type: "string", description: "App 名稱（中文）" },
          icon: { type: "string", description: "App 圖示（emoji）" },
          description: { type: "string", description: "App 描述" },
          fields: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string", description: "欄位名稱（英文）" },
                type: { type: "string", enum: ["string", "number", "text", "date", "enum", "array", "boolean"], description: "欄位類型" },
                label: { type: "string", description: "欄位顯示名稱（中文）" },
                required: { type: "boolean", description: "是否必填" },
                options: { type: "array", items: { type: "string" }, description: "enum 選項" },
                default: { description: "預設值" }
              },
              required: ["name", "type"]
            },
            description: "資料欄位定義"
          },
          prompt: { type: "string", description: "AI 操作此 App 的提示詞（怎麼判斷要用、怎麼操作）" },
          listLabel: { type: "string", description: "列表時顯示哪個欄位" }
        },
        required: ["id", "name", "fields", "prompt"]
      }
    }
  });

  // app_edit — edit an existing app's definition
  tools.push({
    type: "function",
    function: {
      name: "app_edit",
      description: "修改 App 的定義（名稱、欄位、提示詞等）",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "App ID" },
          changes: {
            type: "object",
            description: "要修改的欄位",
            properties: {
              name: { type: "string" },
              icon: { type: "string" },
              description: { type: "string" },
              prompt: { type: "string" },
              fields: { type: "array" }
            }
          }
        },
        required: ["id", "changes"]
      }
    }
  });

  // For each app with data fields, generate CRUD tools
  for (const app of apps) {
    if (app.noData) continue;
    const appId = app.id;
    const appName = app.name;
    const fieldDesc = app.fields.map(f => `${f.name}(${f.type}${f.required ? ",必填" : ""})`).join(", ");

    // add record
    tools.push({
      type: "function",
      function: {
        name: `${appId}_add`,
        description: `${appName}：新增一筆資料。欄位：${fieldDesc}`,
        parameters: {
          type: "object",
          properties: Object.fromEntries(app.fields.map(f => {
            const prop = { description: f.label || f.name };
            if (f.type === "enum") prop.enum = f.options;
            else if (f.type === "number") prop.type = "number";
            else if (f.type === "boolean") prop.type = "boolean";
            else if (f.type === "array") { prop.type = "array"; prop.items = { type: "string" }; }
            else prop.type = "string";
            return [f.name, prop];
          })),
          required: app.fields.filter(f => f.required).map(f => f.name)
        }
      }
    });

    // list/query records
    const filterProps = {};
    for (const f of app.fields) {
      if (f.type === "enum" || f.type === "boolean" || f.type === "string") {
        filterProps[f.name] = { type: f.type === "enum" ? "string" : f.type, description: `篩選${f.label || f.name}` };
      }
    }
    if (app.filterable || app.searchable) {
      filterProps._search = { type: "string", description: "關鍵字搜尋" };
    }
    tools.push({
      type: "function",
      function: {
        name: `${appId}_list`,
        description: `${appName}：列出或查詢資料`,
        parameters: {
          type: "object",
          properties: {
            ...filterProps,
            _limit: { type: "number", description: "最多回傳幾筆（預設 20）" }
          },
          required: []
        }
      }
    });

    // get single record
    tools.push({
      type: "function",
      function: {
        name: `${appId}_get`,
        description: `${appName}：取得一筆資料的完整內容`,
        parameters: {
          type: "object",
          properties: { id: { type: "string", description: "記錄 ID" } },
          required: ["id"]
        }
      }
    });

    // update record
    tools.push({
      type: "function",
      function: {
        name: `${appId}_update`,
        description: `${appName}：更新一筆資料`,
        parameters: {
          type: "object",
          properties: {
            id: { type: "string", description: "記錄 ID" },
            ...Object.fromEntries(app.fields.map(f => {
              const prop = { description: f.label || f.name };
              if (f.type === "enum") prop.enum = f.options;
              else if (f.type === "number") prop.type = "number";
              else if (f.type === "boolean") prop.type = "boolean";
              else if (f.type === "array") { prop.type = "array"; prop.items = { type: "string" }; }
              else prop.type = "string";
              return [f.name, prop];
            }))
          },
          required: ["id"]
        }
      }
    });

    // delete record
    tools.push({
      type: "function",
      function: {
        name: `${appId}_delete`,
        description: `${appName}：刪除一筆資料`,
        parameters: {
          type: "object",
          properties: { id: { type: "string", description: "記錄 ID" } },
          required: ["id"]
        }
      }
    });
  }

  // Special tools for files app
  const hasFiles = apps.find(a => a.id === "files");
  if (hasFiles) {
    tools.push({
      type: "function",
      function: {
        name: "file_list",
        description: "列出工作區目錄的檔案",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "目錄相對路徑（預設根目錄）" },
            workspace: { type: "string", description: "工作區名稱或路徑（可選）" }
          },
          required: []
        }
      }
    });
    tools.push({
      type: "function",
      function: {
        name: "file_read",
        description: "讀取工作區內的檔案內容",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "檔案相對路徑" },
            workspace: { type: "string", description: "工作區名稱或路徑（可選）" }
          },
          required: ["path"]
        }
      }
    });
  }

  return { tools, apps };
}

// ── Tool execution handlers ──

function buildHandlers(apps) {
  const handlers = {};

  // app_list
  handlers.app_list = async () => {
    const list = apps.map(a => `${a.icon} **${a.name}** — ${a.description}${a.builtIn ? " (內建)" : ""}`).join("\n");
    return { text: list || "目前沒有任何 App", apps: apps.map(a => ({ id: a.id, name: a.name, icon: a.icon })) };
  };

  // app_create — create new app at runtime!
  handlers.app_create = async ({ id, name, icon, description, fields, prompt, listLabel }) => {
    // Validate ID
    if (!/^[a-z][a-z0-9_]*$/.test(id)) {
      return { text: "❌ App ID 只能用小寫英文、數字和底線，必須以英文開頭", error: true };
    }
    // Check if already exists
    const existing = apps.find(a => a.id === id);
    if (existing) {
      return { text: `❌ App「${name}」已經存在（ID: ${id}）`, error: true };
    }
    const appDef = { id, name, icon: icon || "📦", description: description || name, fields, prompt, listLabel: listLabel || fields[0]?.name || "id", systemFields: ["id", "createdAt"], createdAt: new Date().toISOString() };
    await mkdir(APPS_DIR, { recursive: true });
    await writeFile(resolve(APPS_DIR, `${id}.json`), JSON.stringify(appDef, null, 2), "utf-8");
    // Initialize empty data file
    await saveAppData(id, []);
    return { text: `✅ 已建立 App「${name}」${icon || "📦"}！現在可以用 ${id}_add 來新增資料了。`, app: appDef };
  };

  // app_edit
  handlers.app_edit = async ({ id, changes }) => {
    const appDef = apps.find(a => a.id === id);
    if (!appDef) return { text: `❌ 找不到 App: ${id}`, error: true };
    const { readFile: rf, writeFile: wf } = await import("fs/promises");
    const fp = resolve(APPS_DIR, `${id}.json`);
    const current = JSON.parse(await rf(fp, "utf-8"));
    if (changes.name) current.name = changes.name;
    if (changes.icon) current.icon = changes.icon;
    if (changes.description) current.description = changes.description;
    if (changes.prompt) current.prompt = changes.prompt;
    if (changes.fields) current.fields = changes.fields;
    await wf(fp, JSON.stringify(current, null, 2), "utf-8");
    return { text: `✅ 已更新 App「${current.name}」`, app: current };
  };

  // Generic CRUD handlers for each app
  for (const app of apps) {
    if (app.noData) continue;
    const appId = app.id;

    // add
    handlers[`${appId}_add`] = async (args) => {
      const data = await loadAppData(appId);
      const id = `${appId}_${Date.now().toString(36)}`;
      const record = { id, createdAt: new Date().toISOString() };
      // Apply defaults and fill fields
      for (const f of app.fields) {
        if (args[f.name] !== undefined) record[f.name] = args[f.name];
        else if (f.default !== undefined) record[f.name] = f.default;
      }
      data.push(record);
      await saveAppData(appId, data);
      const displayField = app.listLabel || app.fields[0]?.name || "id";
      return { text: `✅ 已新增 ${app.icon} ${record[displayField] || id}`, record };
    };

    // list
    handlers[`${appId}_list`] = async (args) => {
      const data = await loadAppData(appId);
      let filtered = data;
      // Apply filters
      for (const f of app.fields) {
        if (args[f.name] !== undefined) {
          filtered = filtered.filter(r => r[f.name] === args[f.name]);
        }
      }
      // Search
      if (args._search) {
        const q = args._search.toLowerCase();
        const searchFields = app.searchable || app.fields.map(f => f.name);
        filtered = filtered.filter(r => searchFields.some(sf => String(r[sf] || "").toLowerCase().includes(q)));
      }
      // Limit
      const limit = args._limit || 20;
      filtered = filtered.slice(0, limit);
      if (filtered.length === 0) return { text: `${app.icon} ${app.name}沒有資料`, records: [] };
      const displayField = app.listLabel || app.fields[0]?.name || "id";
      const list = filtered.map(r => {
        let line = `${app.icon} [${r.id}] ${r[displayField] || ""}`;
        // Show status-like fields inline
        for (const f of app.fields) {
          if (f.name !== displayField && r[f.name] !== undefined && f.type === "enum") {
            line += ` (${r[f.name]})`;
          }
        }
        return line;
      }).join("\n");
      return { text: list, records: filtered };
    };

    // get
    handlers[`${appId}_get`] = async ({ id }) => {
      const data = await loadAppData(appId);
      const record = data.find(r => r.id === id);
      if (!record) return { text: `❌ 找不到 ID: ${id}`, error: true };
      const details = Object.entries(record).map(([k, v]) => {
        const fieldDef = app.fields.find(f => f.name === k);
        const label = fieldDef?.label || k;
        return `**${label}**: ${Array.isArray(v) ? v.join(", ") : v}`;
      }).join("\n");
      return { text: `## ${record[app.listLabel] || id}\n\n${details}`, record };
    };

    // update
    handlers[`${appId}_update`] = async (args) => {
      const { id, ...updates } = args;
      const data = await loadAppData(appId);
      const idx = data.findIndex(r => r.id === id);
      if (idx === -1) return { text: `❌ 找不到 ID: ${id}`, error: true };
      for (const [k, v] of Object.entries(updates)) {
        if (k === "id") continue;
        data[idx][k] = v;
      }
      await saveAppData(appId, data);
      const displayField = app.listLabel || app.fields[0]?.name || "id";
      return { text: `✅ 已更新 ${app.icon} ${data[idx][displayField] || id}`, record: data[idx] };
    };

    // delete
    handlers[`${appId}_delete`] = async ({ id }) => {
      let data = await loadAppData(appId);
      const target = data.find(r => r.id === id);
      if (!target) return { text: `❌ 找不到 ID: ${id}`, error: true };
      data = data.filter(r => r.id !== id);
      await saveAppData(appId, data);
      const displayField = app.listLabel || app.fields[0]?.name || "id";
      return { text: `🗑️ 已刪除 ${app.icon} ${target[displayField] || id}` };
    };
  }

  // Special: memory_save also updates MEMORY.md
  if (handlers.memory_add) {
    const origMemoryAdd = handlers.memory_add;
    handlers.memory_add = async (args) => {
      const result = await origMemoryAdd(args);
      // Update MEMORY.md
      try {
        const memPath = resolve(TCLAW_DATA_DIR, "MEMORY.md");
        let memContent = "";
        try { memContent = await readFile(memPath, "utf-8"); } catch {}
        const sectionHeader = `## ${args.key}`;
        const sectionBlock = `${sectionHeader}\n${args.content}`;
        const sectionRegex = new RegExp(`^## ${args.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, "m");
        if (sectionRegex.test(memContent)) {
          const lines = memContent.split("\n");
          let startIdx = -1, endIdx = lines.length;
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].match(new RegExp(`^## ${args.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`))) { startIdx = i; }
            else if (startIdx >= 0 && lines[i].startsWith("## ")) { endIdx = i; break; }
          }
          if (startIdx >= 0) {
            lines.splice(startIdx, endIdx - startIdx, sectionBlock);
            memContent = lines.join("\n");
          }
        } else {
          memContent = memContent.replace(/\n*$/, "") + "\n\n" + sectionBlock + "\n";
        }
        await writeFile(memPath, memContent, "utf-8");
      } catch (err) {
        console.error("[tClaw] memory MEMORY.md update error:", err.message);
      }
      return result;
    };
  }

  // File tools (special, not data-driven)
  handlers.file_list = async ({ path: dirPath = ".", workspace } = {}) => {
    try {
      const workspaces = JSON.parse(await readFile(resolve(TCLAW_DATA_DIR, "workspaces.json"), "utf-8"));
      const ws = workspace ? workspaces.directories?.find(w => w === workspace || w.includes(workspace)) : workspaces.directories?.[0];
      if (!ws) return { text: "沒有設定工作區，請先在設定中加入", error: true };
      const { readdir: rd } = await import("fs/promises");
      const fullDir = resolve(ws, dirPath);
      const entries = await rd(fullDir, { withFileTypes: true });
      const list = entries.map(e => `${e.isDirectory() ? "📁" : "📄"} ${e.name}`).join("\n");
      return { text: list || "(空目錄)", path: fullDir };
    } catch (err) {
      return { text: `讀取失敗: ${err.message}`, error: true };
    }
  };

  handlers.file_read = async ({ path: filePath, workspace }) => {
    try {
      const workspaces = JSON.parse(await readFile(resolve(TCLAW_DATA_DIR, "workspaces.json"), "utf-8"));
      const ws = workspace ? workspaces.directories?.find(w => w === workspace || w.includes(workspace)) : workspaces.directories?.[0];
      if (!ws) return { text: "沒有設定工作區", error: true };
      const fullPath = resolve(ws, filePath);
      const content = await readFile(fullPath, "utf-8");
      const preview = content.length > 5000 ? content.slice(0, 5000) + "\n... (截斷)" : content;
      return { text: preview, path: fullPath };
    } catch (err) {
      return { text: `讀取失敗: ${err.message}`, error: true };
    }
  };

  return handlers;
}

// ── Build system prompt section for all apps ──

function buildAppInstructions(apps) {
  return apps.map(app => {
    let desc = `${app.icon} **${app.name}** — ${app.description}`;
    if (app.noData) {
      desc += `\n工具：${(app.tools || []).join(", ")}`;
    } else {
      desc += `\n工具：${app.id}_add, ${app.id}_list, ${app.id}_get, ${app.id}_update, ${app.id}_delete`;
      desc += `\n欄位：${app.fields.map(f => `${f.name}(${f.label || f.name}${f.required ? ",必填" : ""})`).join(", ")}`;
    }
    desc += `\n操作指南：${app.prompt}`;
    return desc;
  }).join("\n\n");
}

// ── Cache layer: tools are built once, refreshed on demand ──

let _cache = null;
let _cacheTime = 0;
const CACHE_TTL = 30000; // 30s cache, apps can be added without restart

async function getToolsAndHandlers() {
  const now = Date.now();
  if (_cache && now - _cacheTime < CACHE_TTL) return _cache;
  const apps = await loadApps();
  const { tools } = await buildToolDefinitions();
  const handlers = buildHandlers(apps);
  const appInstructions = buildAppInstructions(apps);
  _cache = { tools, handlers, apps, appInstructions };
  _cacheTime = now;
  return _cache;
}

// Force refresh (called after app_create)
function invalidateCache() { _cache = null; _cacheTime = 0; }

export { getToolsAndHandlers, invalidateCache, buildAppInstructions };
