// PAAW Universal App Engine
// All apps are data-driven: defined in data/apps/*.json
// Schema-based: dataShape (array|object|none) + schema defines structure
// Generic CRUD tools work for any app based on its schema
// New apps can be created at runtime — no code changes needed

import { readFile, writeFile, mkdir, readdir } from "fs/promises";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PAAW_DATA_DIR = resolve(__dirname, "../../../../data");
const APPS_DIR = resolve(PAAW_DATA_DIR, "apps");

// ── Helpers to work with schema ──

// Extract fields from schema (new format) or legacy fields array
function extractFields(app) {
  // 1) New schema format: { items: { properties: { ... } } }
  if (app.schema?.items?.properties) {
    return Object.entries(app.schema.items.properties).map(([name, def]) => ({
      name,
      type: def.type || "string",
      required: checkRequired(app, name),
      label: def.label || name,
      options: def.enum || undefined,
      default: def.default !== undefined ? def.default : undefined,
    }));
  }

  // 2) Flat schema.properties format (common for data apps)
  if (app.schema?.properties && typeof app.schema.properties === "object") {
    // If there are oneOf variants, merge their properties (base schema properties take priority)
    const merged = { ...app.schema.properties };
    if (Array.isArray(app.schema.oneOf)) {
      for (const variant of app.schema.oneOf) {
        if (variant.properties) {
        for (const [k, v] of Object.entries(variant.properties)) {
          // Don't overwrite base properties (e.g., type with enum should keep its definition)
          if (!(k in app.schema.properties)) merged[k] = v;
        }
      }
      }
    }
    return Object.entries(merged).map(([name, def]) => ({
      name,
      type: def.type || "string",
      required: checkRequired(app, name),
      label: def.label || name,
      options: def.enum || (def.const ? [def.const] : undefined),
      default: def.default !== undefined ? def.default : undefined,
    }));
  }

  // 3) Legacy format: fields array
  return app.fields || [];
}

/** Determine if a field is required — checks top-level required and oneOf required arrays */
function checkRequired(app, fieldName) {
  if (Array.isArray(app.schema?.required) && app.schema.required.includes(fieldName)) return true;
  if (Array.isArray(app.schema?.oneOf)) {
    for (const variant of app.schema.oneOf) {
      if (Array.isArray(variant.required) && variant.required.includes(fieldName)) return true;
    }
  }
  return false;
}

function getDataShape(app) {
  if (app.dataShape) return app.dataShape;
  if (app.noData) return "none";
  return "array";
}

// ── Load all app definitions ──

async function loadApps() {
  await mkdir(APPS_DIR, { recursive: true });
  const entries = await readdir(APPS_DIR, { withFileTypes: true });
  const apps = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const data = JSON.parse(await readFile(resolve(APPS_DIR, entry.name, "app.json"), "utf-8"));
      apps.push(data);
    } catch {}
  }
  return apps;
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
      description: "建立一個新的 App。支援 Data App 和 Skill-based App。Skill-based App 會自動產生聊天 Tool + 觸發關鍵字路由。",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "App ID（英文、小寫、底線）" },
          name: { type: "string", description: "App 名稱（中文）" },
          icon: { type: "string", description: "App 圖示（emoji）" },
          description: { type: "string", description: "App 描述" },
          type: { type: "string", enum: ["data", "skill-based"], description: "App 類型：data（純資料）或 skill-based（AI 執行）" },
          dataShape: { type: "string", enum: ["array", "object", "none"], description: "資料形態" },
          triggers: { type: "array", items: { type: "string" }, description: "觸發關鍵字（聊天中說這些詞會自動路由到此 App）" },
          schema: {
            type: "object",
            description: "JSON Schema 定義資料結構",
          },
          aiPrompt: { type: "string", description: "AI 操作此 App 的簡短提示（一句話）" },
          skills: {
            type: "object",
            description: "Skill 定義（skill-based 時使用），key 是 skill 名稱，value 是 SKILL.md 內容",
            additionalProperties: { type: "string" }
          },
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
              dataShape: { type: "string", enum: ["array", "object", "none"] },
              type: { type: "string", enum: ["data", "skill-based"], description: "App 類型" },
              cli: { type: "string", enum: ["qwen", "claude", "opencode"], description: "CLI 引擎（skill-based 時使用）" },
              triggers: { type: "array", items: { type: "string" }, description: "聊天觸發關鍵字" },
              skills: { type: "array", items: { type: "object" }, description: "綁定的 Skills，每個 { id, path, role }" }
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
        description: "列出工作區目錄的檔案。不指定 workspace 時會列出所有可用工作區供選擇",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "目錄相對路徑（預設根目錄）" },
            workspace: { type: "string", description: "工作區名稱或路徑（可選，不填則列出所有工作區）" }
          },
          required: []
        }
      }
    });
    tools.push({
      type: "function",
      function: {
        name: "file_read",
        description: "讀取工作區內的檔案內容。不指定 workspace 時會自動在所有工作區中搜尋該檔案",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "檔案相對路徑" },
            workspace: { type: "string", description: "工作區名稱或路徑（可選，不填則跨工作區搜尋）" }
          },
          required: ["path"]
        }
      }
    });
  }

  // ── Skill-based apps: auto-generate {appId}_exec tool ──
  // Any app with type=skill-based + schema + triggers gets an exec tool automatically
  for (const app of apps) {
    if (app.type !== "skill-based") continue;
    const appId = app.id;
    const triggerHint = app.triggers?.length
      ? `觸發關鍵字：${app.triggers.join("、")}。`
      : "";
    // Build parameters from app.execSchema or app.schema (or use defaults)
    const props = {};
    const required = [];
    const execSchema = app.execSchema?.properties || app.schema?.properties;
    if (execSchema) {
      for (const [key, def] of Object.entries(execSchema)) {
        props[key] = {
          type: def.type || "string",
          description: def.description || key,
          ...(def.default !== undefined ? { default: def.default } : {}),
        };
        if (def.required) required.push(key);
      }
    }
    // Every skill-based exec also gets a _raw_output flag
    props._raw_output = { type: "boolean", description: "回傳原始 CLI 輸出（除錯用）" };

    tools.push({
      type: "function",
      function: {
        name: `${appId}_exec`,
        description: `${app.icon || "🔧"} ${app.name}：${app.description}。${triggerHint}Skill + CLI 執行。`,
        parameters: {
          type: "object",
          properties: props,
          required: required.length ? required : undefined,
        },
      },
    });
  }

  return { tools, apps };
}

// ── Generic skill result formatter ──
// Turns structured JSON from any skill-based app into readable text

function buildHandlers(apps) {
  const handlers = {};

  const PAAW_PORT = process.env.PAAW_PORT || "4097";
  const API = `http://127.0.0.1:${PAAW_PORT}`;

  // app_list — call REST API
  handlers.app_list = async () => {
    try {
      const resp = await fetch(`${API}/api/apps`);
      const apps = await resp.json();
      if (!Array.isArray(apps)) return { text: "目前沒有任何 App", apps: [] };
      const list = apps.map(a => `${a.icon || "📦"} **${a.name}** — ${a.description || ""}`).join("\n");
      return { text: list || "目前沒有任何 App", apps: apps.map(a => ({ id: a.id, name: a.name, icon: a.icon, dataShape: a.dataShape })) };
    } catch (err) {
      return { text: `❌ 讀取失敗：${err.message}`, error: true };
    }
  };

  // app_create — create new app via REST API
  handlers.app_create = async ({ id, name, icon, description, dataShape, schema, aiPrompt, type, triggers, skills }) => {
    try {
      const resp = await fetch(`http://127.0.0.1:${PAAW_PORT}/api/apps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, name, icon, description, dataShape, schema, aiPrompt, type, triggers, skills }),
      });
      const result = await resp.json();
      if (!result.ok) return { text: `❌ ${result.error}`, error: true };
      invalidateCache();
      const extra = type === "skill-based" ? "（Skill-based，已自動產生 Tool + SKILL.md）" : "";
      return { text: `✅ 已建立 App「${name}」${icon || "📦"}${extra}`, app: result.app };
    } catch (err) {
      return { text: `❌ 建立失敗：${err.message}`, error: true };
    }
  };

  // app_create — create new app via REST API
  handlers.app_create = async ({ id, name, icon, description, dataShape, schema, aiPrompt, type, triggers, skills }) => {
    try {
      const resp = await fetch(`${API}/api/apps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, name, icon, description, dataShape, schema, aiPrompt, type, triggers, skills }),
      });
      const result = await resp.json();
      if (!result.ok) return { text: `❌ ${result.error}`, error: true };
      invalidateCache();
      const extra = type === "skill-based" ? "（Skill-based，已自動產生 Tool + SKILL.md）" : "";
      return { text: `✅ 已建立 App「${name}」${icon || "📦"}${extra}`, app: result.app };
    } catch (err) {
      return { text: `❌ 建立失敗：${err.message}`, error: true };
    }
  };

  // app_edit — update app via REST API
  handlers.app_edit = async ({ id, changes }) => {
    try {
      const resp = await fetch(`${API}/api/apps/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes),
      });
      const result = await resp.json();
      if (!result.ok) return { text: `❌ ${result.error}`, error: true };
      invalidateCache();
      return { text: `✅ 已更新 App「${result.app?.name || id}」`, app: result.app };
    } catch (err) {
      return { text: `❌ 更新失敗：${err.message}`, error: true };
    }
  };

  // Generic handlers for each app based on dataShape — all via REST API
  for (const app of apps) {
    const shape = getDataShape(app);
    if (shape === "none") continue;

    const appId = app.id;
    const fields = extractFields(app);

    if (shape === "array") {
      // add — POST /api/app-data/:appId
      handlers[`${appId}_add`] = async (args) => {
        try {
          const resp = await fetch(`${API}/api/app-data/${appId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(args),
          });
          const record = await resp.json();
          if (record.error) return { text: `❌ ${record.error}`, error: true };
          // Smart display: pick the first non-empty meaningful field
          const displayText = record.word || record.text || record.title || record.event || record.name || record.id;
          return { text: `✅ 已新增 ${app.icon} **${displayText}** (${record.type || ""})`, record };
        } catch (err) {
          return { text: `❌ 新增失敗：${err.message}`, error: true };
        }
      };

      // list — GET /api/app-data/:appId (client-side filter)
      handlers[`${appId}_list`] = async (args) => {
        try {
          const resp = await fetch(`${API}/api/app-data/${appId}`);
          let data = await resp.json();
          if (!Array.isArray(data)) data = [];
          // Client-side filtering
          for (const f of fields) {
            if (args[f.name] !== undefined) {
              data = data.filter(r => r[f.name] === args[f.name]);
            }
          }
          if (args._search) {
            const q = args._search.toLowerCase();
            data = data.filter(r => fields.some(f => String(r[f.name] || "").toLowerCase().includes(q)));
          }
          const limit = args._limit || 20;
          data = data.slice(0, limit);
          if (data.length === 0) return { text: `${app.icon} ${app.name}沒有資料`, records: [] };
          const displayField = fields[0]?.name || "id";
          const list = data.map(r => {
            let line = `${app.icon} [${r.id}] ${r[displayField] || ""}`;
            for (const f of fields) {
              if (f.name !== displayField && r[f.name] !== undefined && f.type === "enum") {
                line += ` (${r[f.name]})`;
              }
            }
            return line;
          }).join("\n");
          return { text: `✅ 找到 ${data.length} 筆資料：\n\n${list}`, records: data };
        } catch (err) {
          return { text: `❌ 查詢失敗：${err.message}`, error: true };
        }
      };

      // get — GET /api/app-data/:appId (find by id)
      handlers[`${appId}_get`] = async ({ id }) => {
        try {
          const resp = await fetch(`${API}/api/app-data/${appId}`);
          let data = await resp.json();
          if (!Array.isArray(data)) data = [];
          const record = data.find(r => r.id === id);
          if (!record) return { text: `❌ 找不到 ID: ${id}`, error: true };
          const details = Object.entries(record).map(([k, v]) => {
            const fieldDef = fields.find(f => f.name === k);
            const label = fieldDef?.label || k;
            return `**${label}**: ${Array.isArray(v) ? v.join(", ") : v}`;
          }).join("\n");
          return { text: `## ${record[fields[0]?.name] || id}\n\n${details}`, record };
        } catch (err) {
          return { text: `❌ 查詢失敗：${err.message}`, error: true };
        }
      };

      // update — PATCH /api/app-data/:appId/:id
      handlers[`${appId}_update`] = async (args) => {
        const { id, ...updates } = args;
        try {
          const resp = await fetch(`${API}/api/app-data/${appId}/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(updates),
          });
          if (!resp.ok) return { text: `❌ 找不到 ID: ${id}`, error: true };
          const record = await resp.json();
          return { text: `✅ 已更新 ${app.icon} ${record[fields[0]?.name] || id}`, record };
        } catch (err) {
          return { text: `❌ 更新失敗：${err.message}`, error: true };
        }
      };

      // delete — DELETE /api/app-data/:appId/:id
      handlers[`${appId}_delete`] = async ({ id }) => {
        console.log(`[tool] pocket_delete called: appId=${appId}, id=${id}, API=${API}`);
        try {
          const url = `${API}/api/app-data/${appId}/${id}`;
          console.log(`[tool] DELETE URL: ${url}`);
          const resp = await fetch(url, {
            method: "DELETE",
          });
          console.log(`[tool] DELETE response status: ${resp.status}`);
          const result = await resp.json();
          console.log(`[tool] DELETE result:`, JSON.stringify(result));
          if (result.error) return { text: `❌ ${result.error}`, error: true };
          return { text: `🗑️ 已刪除 ${app.icon} ${id}` };
        } catch (err) {
          console.log(`[tool] DELETE error: ${err.message}`);
          return { text: `❌ 刪除失敗：${err.message}`, error: true };
        }
      };
    }

    if (shape === "object") {
      // get — GET /api/app-data/:appId
      handlers[`${appId}_get`] = async () => {
        try {
          const resp = await fetch(`${API}/api/app-data/${appId}`);
          const data = await resp.json();
          if (!data || Object.keys(data).length === 0) {
            return { text: `${app.icon} ${app.name}尚未設定`, data: {} };
          }
          const details = Object.entries(data).map(([k, v]) => {
            const fieldDef = fields.find(f => f.name === k);
            const label = fieldDef?.label || k;
            return `**${label}**: ${Array.isArray(v) ? v.join(", ") : v}`;
          }).join("\n");
          return { text: `## ${app.name}\n\n${details}`, data };
        } catch (err) {
          return { text: `❌ 讀取失敗：${err.message}`, error: true };
        }
      };

      // set — PUT /api/app-data/:appId (full replace)
      handlers[`${appId}_set`] = async (args) => {
        try {
          // First get current data
          const getResp = await fetch(`${API}/api/app-data/${appId}`);
          let data = await getResp.json();
          if (!data || typeof data !== "object" || Array.isArray(data)) data = {};
          for (const f of fields) {
            if (args[f.name] !== undefined) data[f.name] = args[f.name];
            else if (f.default !== undefined && data[f.name] === undefined) data[f.name] = f.default;
          }
          data.updatedAt = new Date().toISOString();
          const putResp = await fetch(`${API}/api/app-data/${appId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
          });
          if (!putResp.ok) return { text: `❌ 寫入失敗`, error: true };
          return { text: `✅ 已更新 ${app.icon} ${app.name}`, data };
        } catch (err) {
          return { text: `❌ 設定失敗：${err.message}`, error: true };
        }
      };
    }
  }

  // Special: memory_add also updates MEMORY.md
  if (handlers.memory_add) {
    const origMemoryAdd = handlers.memory_add;
    handlers.memory_add = async (args) => {
      const result = await origMemoryAdd(args);
      try {
        const memPath = resolve(PAAW_DATA_DIR, "MEMORY.md");
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
        console.error("[PAAW] memory MEMORY.md update error:", err.message);
      }
      return result;
    };
  }

  // ── Skill-based apps: exec via REST API ──
  // Calls POST /api/apps/:appId/exec
  for (const app of apps) {
    if (app.type !== "skill-based") continue;
    const appId = app.id;

    handlers[`${appId}_exec`] = async (args) => {
      try {
        const resp = await fetch(`${API}/api/apps/${appId}/exec`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(args),
        });
        const result = await resp.json();
        if (result.error) return { text: `❌ ${result.error}`, error: true };

        const raw = (result.output || "").trim();

        // Try to parse JSON from CLI output
        let parsed = null;
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try { parsed = JSON.parse(jsonMatch[0]); } catch {}
        }

        if (parsed) {
          // Return structured data — AI will format it nicely
          // Keep text short for UI preview; full data goes in .data for AI
          const preview = parsed.translation || parsed.output || parsed.result || raw.slice(0, 100);
          return {
            text: String(preview).slice(0, 120),
            data: parsed,
            structured: true,
            raw: false,
          };
        }

        return { text: raw || "執行完成", raw: false };
      } catch (err) {
        return { text: `❌ 執行失敗：${err.message}`, error: true };
      }
    };
  }

  // File tools (dataShape: none, special tools)
  // Helper: load workspace directories
  async function loadWorkspaces() {
    try {
      const ws = JSON.parse(await readFile(resolve(PAAW_DATA_DIR, "workspaces.json"), "utf-8"));
      return ws.directories || [];
    } catch { return []; }
  }

  // Helper: match workspace by name/path fragment
  function matchWorkspace(dirs, hint) {
    if (!hint) return null;
    return dirs.find(w => w === hint || w.endsWith("/" + hint) || w.includes(hint)) || null;
  }

  handlers.file_list = async ({ path: dirPath = ".", workspace } = {}) => {
    try {
      const dirs = await loadWorkspaces();
      if (dirs.length === 0) return { text: "沒有設定工作區，請先在設定中加入", error: true };

      // No workspace specified → list all workspaces
      if (!workspace) {
        const wsList = dirs.map((w, i) => `${i + 1}. **${w.split("/").pop()}** — ${w}`).join("\n");
        return { text: `可用工作區（${dirs.length} 個）：\n${wsList}\n\n請指定 workspace 參數來選擇工作區，或直接使用 workspace 名稱。` };
      }

      const ws = matchWorkspace(dirs, workspace);
      if (!ws) return { text: `找不到工作區「${workspace}」。可用：${dirs.map(d => d.split("/").pop()).join(", ")}`, error: true };

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
      // Validate filePath
      if (!filePath || typeof filePath !== 'string') {
        return { text: "請提供有效的檔案路徑", error: true };
      }

      // Support absolute paths directly
      if (filePath.startsWith('/')) {
        try {
          const content = await readFile(filePath, "utf-8");
          const preview = content.length > 5000 ? content.slice(0, 5000) + "\n... (截斷)" : content;
          return { text: preview, path: filePath };
        } catch {
          return { text: `找不到檔案「${filePath}」`, error: true };
        }
      }

      const dirs = await loadWorkspaces();
      // Also search knowledge directory
      const knowledgeDir = resolve(PAAW_DATA_DIR, "knowledge");
      const searchAll = [...dirs, knowledgeDir];

      // If workspace specified, use it; otherwise search all workspaces + knowledge
      const searchDirs = workspace ? [matchWorkspace(dirs, workspace)].filter(Boolean) : searchAll;
      if (searchDirs.length === 0) return { text: `找不到工作區「${workspace}」`, error: true };

      for (const ws of searchDirs) {
        const fullPath = resolve(ws, filePath);
        try {
          const content = await readFile(fullPath, "utf-8");
          const preview = content.length > 5000 ? content.slice(0, 5000) + "\n... (截斷)" : content;
          return { text: preview, path: fullPath, workspace: ws };
        } catch { /* not in this workspace, try next */ }
      }

      const wsHint = workspace ? `（在 ${workspace} 中）` : `（已搜尋 ${dirs.length} 個工作區）`;
      return { text: `找不到檔案「${filePath}」${wsHint}`, error: true };
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
    if (app.type === "skill-based") {
      desc += `\n工具：${app.id}_exec（Skill + CLI 執行，不是 CRUD）`;
      if (app.triggers) desc += `\n觸發關鍵字：${app.triggers.join("、")}`;
    } else if (shape === "none") {
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
