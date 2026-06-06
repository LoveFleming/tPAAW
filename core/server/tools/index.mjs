// tAgent Universal App Engine
// All apps are data-driven: defined in data/apps/*.json
// Schema-based: dataShape (array|object|none) + schema defines structure
// Generic CRUD tools work for any app based on its schema
// New apps can be created at runtime — no code changes needed

import { readFile, writeFile, mkdir, readdir } from "fs/promises";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TAGENT_DATA_DIR = resolve(__dirname, "../../../data");
const APPS_DIR = resolve(TAGENT_DATA_DIR, "apps");
const APP_DATA_DIR = resolve(TAGENT_DATA_DIR, "app-data");

// ── Helpers to work with schema ──

// Extract fields from schema (new format) or legacy fields array
function extractFields(app) {
  if (app.schema?.items?.properties) {
    // New schema format: { items: { properties: { ... } } }
    return Object.entries(app.schema.items.properties).map(([name, def]) => ({
      name,
      type: def.type || "string",
      required: def.required || false,
      label: def.label || name,
      options: def.enum || undefined,
      default: def.default !== undefined ? def.default : undefined,
    }));
  }
  // Legacy format: fields array
  return app.fields || [];
}

function getDataShape(app) {
  if (app.dataShape) return app.dataShape;
  if (app.noData) return "none";
  return "array";
}

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
      description: "建立一個新的自訂 App。使用者描述想要的功能後，AI 幫他定義 schema。",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "App ID（英文、小寫、底線）" },
          name: { type: "string", description: "App 名稱（中文）" },
          icon: { type: "string", description: "App 圖示（emoji）" },
          description: { type: "string", description: "App 描述" },
          dataShape: { type: "string", enum: ["array", "object"], description: "資料形態：array（清單）或 object（單一設定）" },
          schema: {
            type: "object",
            description: "JSON Schema 定義資料結構",
            properties: {
              items: {
                type: "object",
                properties: {
                  properties: {
                    type: "object",
                    description: "欄位定義，key 是欄位名，value 是 { type, required?, default?, enum? }"
                  }
                }
              }
            }
          },
          aiPrompt: { type: "string", description: "AI 操作此 App 的簡短提示（一句話）" }
        },
        required: ["id", "name", "schema", "aiPrompt"]
      }
    }
  });

  // app_edit — edit an existing app's definition
  tools.push({
    type: "function",
    function: {
      name: "app_edit",
      description: "修改 App 的定義（名稱、schema、提示詞等）",
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
              aiPrompt: { type: "string" },
              schema: { type: "object" },
              dataShape: { type: "string", enum: ["array", "object", "none"] }
            }
          }
        },
        required: ["id", "changes"]
      }
    }
  });

  // For each app, generate tools based on dataShape
  for (const app of apps) {
    const shape = getDataShape(app);
    if (shape === "none") continue;

    const appId = app.id;
    const appName = app.name;
    const fields = extractFields(app);
    const fieldDesc = fields.map(f => `${f.name}(${f.type}${f.required ? ",必填" : ""})`).join(", ");

    if (shape === "array") {
      // add record
      tools.push({
        type: "function",
        function: {
          name: `${appId}_add`,
          description: `${appName}：新增一筆資料。欄位：${fieldDesc}`,
          parameters: {
            type: "object",
            properties: Object.fromEntries(fields.map(f => {
              const prop = { description: f.label || f.name };
              if (f.type === "enum") prop.enum = f.options;
              else if (f.type === "number") prop.type = "number";
              else if (f.type === "boolean") prop.type = "boolean";
              else if (f.type === "array") { prop.type = "array"; prop.items = { type: "string" }; }
              else prop.type = "string";
              return [f.name, prop];
            })),
            required: fields.filter(f => f.required).map(f => f.name)
          }
        }
      });

      // list/query records
      const filterProps = {};
      for (const f of fields) {
        if (f.type === "enum" || f.type === "boolean" || f.type === "string") {
          filterProps[f.name] = { type: f.type === "enum" ? "string" : f.type, description: `篩選${f.label || f.name}` };
        }
      }
      filterProps._search = { type: "string", description: "關鍵字搜尋" };
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
              ...Object.fromEntries(fields.map(f => {
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

    if (shape === "object") {
      // Single object app: get / set
      tools.push({
        type: "function",
        function: {
          name: `${appId}_get`,
          description: `${appName}：取得設定`,
          parameters: { type: "object", properties: {}, required: [] }
        }
      });

      tools.push({
        type: "function",
        function: {
          name: `${appId}_set`,
          description: `${appName}：更新設定。欄位：${fieldDesc}`,
          parameters: {
            type: "object",
            properties: Object.fromEntries(fields.map(f => {
              const prop = { description: f.label || f.name };
              if (f.type === "enum") prop.enum = f.options;
              else if (f.type === "number") prop.type = "number";
              else if (f.type === "boolean") prop.type = "boolean";
              else prop.type = "string";
              return [f.name, prop];
            })),
            required: fields.filter(f => f.required).map(f => f.name)
          }
        }
      });
    }
  }

  // Special tools for files app (dataShape: none)
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
    const list = apps.map(a => `${a.icon} **${a.name}** — ${a.description}`).join("\n");
    return { text: list || "目前沒有任何 App", apps: apps.map(a => ({ id: a.id, name: a.name, icon: a.icon, dataShape: getDataShape(a) })) };
  };

  // app_create — create new app at runtime!
  handlers.app_create = async ({ id, name, icon, description, dataShape, schema, aiPrompt }) => {
    if (!/^[a-z][a-z0-9_]*$/.test(id)) {
      return { text: "❌ App ID 只能用小寫英文、數字和底線，必須以英文開頭", error: true };
    }
    const existing = apps.find(a => a.id === id);
    if (existing) {
      return { text: `❌ App「${name}」已經存在（ID: ${id}）`, error: true };
    }
    const appDef = {
      id,
      name,
      icon: icon || "📦",
      description: description || name,
      status: "published",
      dataShape: dataShape || "array",
      schema,
      aiPrompt,
      createdAt: new Date().toISOString(),
    };
    await mkdir(APPS_DIR, { recursive: true });
    await writeFile(resolve(APPS_DIR, `${id}.json`), JSON.stringify(appDef, null, 2), "utf-8");
    // Initialize data file
    const initialData = appDef.dataShape === "object" ? {} : [];
    await saveAppData(id, initialData);
    return { text: `✅ 已建立 App「${name}」${icon || "📦"}！`, app: appDef };
  };

  // app_edit
  handlers.app_edit = async ({ id, changes }) => {
    const appDef = apps.find(a => a.id === id);
    if (!appDef) return { text: `❌ 找不到 App: ${id}`, error: true };
    const fp = resolve(APPS_DIR, `${id}.json`);
    const current = JSON.parse(await readFile(fp, "utf-8"));
    for (const [key, val] of Object.entries(changes)) {
      if (val !== undefined) current[key] = val;
    }
    await writeFile(fp, JSON.stringify(current, null, 2), "utf-8");
    invalidateCache();
    return { text: `✅ 已更新 App「${current.name}」`, app: current };
  };

  // Generic handlers for each app based on dataShape
  for (const app of apps) {
    const shape = getDataShape(app);
    if (shape === "none") continue;

    const appId = app.id;
    const fields = extractFields(app);

    if (shape === "array") {
      // add
      handlers[`${appId}_add`] = async (args) => {
        const data = await loadAppData(appId);
        const id = `${appId}_${Date.now().toString(36)}`;
        const record = { id, createdAt: new Date().toISOString() };
        for (const f of fields) {
          if (args[f.name] !== undefined) record[f.name] = args[f.name];
          else if (f.default !== undefined) record[f.name] = f.default;
        }
        data.push(record);
        await saveAppData(appId, data);
        const displayField = fields[0]?.name || "id";
        return { text: `✅ 已新增 ${app.icon} ${record[displayField] || id}`, record };
      };

      // list
      handlers[`${appId}_list`] = async (args) => {
        const data = await loadAppData(appId);
        let filtered = data;
        for (const f of fields) {
          if (args[f.name] !== undefined) {
            filtered = filtered.filter(r => r[f.name] === args[f.name]);
          }
        }
        if (args._search) {
          const q = args._search.toLowerCase();
          filtered = filtered.filter(r => fields.some(f => String(r[f.name] || "").toLowerCase().includes(q)));
        }
        const limit = args._limit || 20;
        filtered = filtered.slice(0, limit);
        if (filtered.length === 0) return { text: `${app.icon} ${app.name}沒有資料`, records: [] };
        const displayField = fields[0]?.name || "id";
        const list = filtered.map(r => {
          let line = `${app.icon} [${r.id}] ${r[displayField] || ""}`;
          for (const f of fields) {
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
          const fieldDef = fields.find(f => f.name === k);
          const label = fieldDef?.label || k;
          return `**${label}**: ${Array.isArray(v) ? v.join(", ") : v}`;
        }).join("\n");
        return { text: `## ${record[fields[0]?.name] || id}\n\n${details}`, record };
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
        const displayField = fields[0]?.name || "id";
        return { text: `✅ 已更新 ${app.icon} ${data[idx][displayField] || id}`, record: data[idx] };
      };

      // delete
      handlers[`${appId}_delete`] = async ({ id }) => {
        let data = await loadAppData(appId);
        const target = data.find(r => r.id === id);
        if (!target) return { text: `❌ 找不到 ID: ${id}`, error: true };
        data = data.filter(r => r.id !== id);
        await saveAppData(appId, data);
        const displayField = fields[0]?.name || "id";
        return { text: `🗑️ 已刪除 ${app.icon} ${target[displayField] || id}` };
      };
    }

    if (shape === "object") {
      // get — return the single object
      handlers[`${appId}_get`] = async () => {
        const data = await loadAppData(appId);
        if (!data || Object.keys(data).length === 0) {
          return { text: `${app.icon} ${app.name}尚未設定`, data: {} };
        }
        const details = Object.entries(data).map(([k, v]) => {
          const fieldDef = fields.find(f => f.name === k);
          const label = fieldDef?.label || k;
          return `**${label}**: ${Array.isArray(v) ? v.join(", ") : v}`;
        }).join("\n");
        return { text: `## ${app.name}\n\n${details}`, data };
      };

      // set — update fields of the single object
      handlers[`${appId}_set`] = async (args) => {
        let data = await loadAppData(appId);
        if (!data || typeof data !== "object" || Array.isArray(data)) data = {};
        for (const f of fields) {
          if (args[f.name] !== undefined) data[f.name] = args[f.name];
          else if (f.default !== undefined && data[f.name] === undefined) data[f.name] = f.default;
        }
        data.updatedAt = new Date().toISOString();
        await saveAppData(appId, data);
        return { text: `✅ 已更新 ${app.icon} ${app.name}`, data };
      };
    }
  }

  // Special: memory_add also updates MEMORY.md
  if (handlers.memory_add) {
    const origMemoryAdd = handlers.memory_add;
    handlers.memory_add = async (args) => {
      const result = await origMemoryAdd(args);
      try {
        const memPath = resolve(TAGENT_DATA_DIR, "MEMORY.md");
        let memContent = "";
        try { memContent = await readFile(memPath, "utf-8"); } catch {}
        const fields = extractFields(apps.find(a => a.id === "memory"));
        const keyField = args[fields?.find(f => f.name === "key")?.name || "key"] || "untitled";
        const contentField = args[fields?.find(f => f.name === "content")?.name || "content"] || "";
        const sectionHeader = `## ${keyField}`;
        const sectionBlock = `${sectionHeader}\n${contentField}`;
        const sectionRegex = new RegExp(`^## ${keyField.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, "m");
        if (sectionRegex.test(memContent)) {
          const lines = memContent.split("\n");
          let startIdx = -1, endIdx = lines.length;
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].match(new RegExp(`^## ${keyField.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`))) { startIdx = i; }
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
        console.error("[tAgent] memory MEMORY.md update error:", err.message);
      }
      return result;
    };
  }

  // File tools (dataShape: none, special tools)
  handlers.file_list = async ({ path: dirPath = ".", workspace } = {}) => {
    try {
      const workspaces = JSON.parse(await readFile(resolve(TAGENT_DATA_DIR, "workspaces.json"), "utf-8"));
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
      const workspaces = JSON.parse(await readFile(resolve(TAGENT_DATA_DIR, "workspaces.json"), "utf-8"));
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
// Global rule: API is /api/app-data/{appId}, universal for all apps
// Each app only needs: name, description, aiPrompt (short hint)

function buildAppInstructions(apps) {
  const lines = ["通用 API：/api/app-data/{appId}（GET 讀取、POST 新增、PATCH 更新、DELETE 刪除）\n"];
  for (const app of apps) {
    const shape = getDataShape(app);
    let desc = `${app.icon} **${app.name}** — ${app.description}`;
    if (shape === "none") {
      desc += `\n工具：${(app.tools || []).join(", ")}`;
    } else if (shape === "object") {
      desc += `\n工具：${app.id}_get, ${app.id}_set`;
    } else {
      desc += `\n工具：${app.id}_add, ${app.id}_list, ${app.id}_get, ${app.id}_update, ${app.id}_delete`;
    }
    desc += `\n${app.aiPrompt || ""}`;
    lines.push(desc);
  }
  return lines.join("\n\n");
}

// ── Cache layer ──

let _cache = null;
let _cacheTime = 0;
const CACHE_TTL = 30000;

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

function invalidateCache() { _cache = null; _cacheTime = 0; }

export { getToolsAndHandlers, invalidateCache, buildAppInstructions };
