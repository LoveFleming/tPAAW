// PAAW Universal App Engine
// All apps are data-driven: defined in data/apps/*.json
// Schema-based: dataShape (array|object|none) + schema defines structure
// Generic CRUD tools work for any app based on its schema
// New apps can be created at runtime — no code changes needed

import { readFile, writeFile, mkdir, readdir } from "fs/promises";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname, join, isAbsolute, relative } from "path";
import { fileURLToPath } from "url";
import { PAAW_ROOT } from "../routes/shared.mjs";

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
      // Fallback: use dirname as app id if app.json missing it
      if (!data.id) data.id = entry.name;
      if (!data.name) data.name = entry.name;
      apps.push(data);
    } catch {}
  }
  return apps;
}

// ── Build tool definitions dynamically ──

async function buildToolDefinitions() {
  const apps = await loadApps();
  const tools = [];

  // ── Unified Notes tool (replaces 7 separate notes_* tools) ──
  tools.push({
    type: "function",
    function: {
      name: "notes",
      description: "管理筆記：搜尋、建立、列出筆記本/分類、讀取、最近筆記。用 action 指定操作。回傳結果中的連結格式為 #/notes?note=ID&notebook=ID，請原樣輸出不可修改。",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["search", "get", "recent", "create", "list_notebooks", "list_sections", "create_section"], description: "操作" },
          q: { type: "string", description: "搜尋關鍵字（action=search）" },
          id: { type: "string", description: "筆記 ID（action=get）" },
          notebook: { type: "string", description: "筆記本 ID" },
          section: { type: "string", description: "分類 ID" },
          title: { type: "string", description: "筆記標題" },
          content: { type: "string", description: "筆記內容" },
          prompt: { type: "string", description: "AI 整理提示" },
          tags: { type: "array", items: { type: "string" }, description: "標籤" },
          name: { type: "string", description: "分類名稱（action=create_section）" },
          icon: { type: "string", description: "分類圖示" },
          limit: { type: "number", description: "數量上限（action=recent，預設 10）" },
        },
        required: ["action"],
      },
    },
  });

    // app_list — list all available apps
  tools.push({
    type: "function",
    function: {
      name: "app_list",
      description: "列出所有可用的 App",
      parameters: { type: "object", properties: {}, required: [] }
    }
  });

  // ── Project Board tools (built-in) ──
  tools.push({
    type: "function",
    function: {
      name: "project_status",
      description: "查看專案看板的整體狀態，包括所有專案的進度、完成率、里程碑。可指定單一專案查看詳情。",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string", description: "（可選）指定專案 ID 查看單一專案詳情，不指定則列出所有專案摘要" },
        },
      },
    },
  });
  tools.push({
    type: "function",
    function: {
      name: "project_update_task",
      description: "更新專案任務狀態。點擊循環切換：todo → progress → done。",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string", description: "專案 ID" },
          taskId: { type: "string", description: "任務 ID" },
          status: { type: "string", enum: ["todo", "progress", "done"], description: "新狀態" },
        },
        required: ["projectId", "taskId", "status"],
      },
    },
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
    if (!appId || appId === "undefined") continue;  // skip broken apps
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

  // file_list & file_read — always available (global tools)
  tools.push({
    type: "function",
    function: {
      name: "file_list",
      description: "列出目錄的檔案。workspace 填工作區名稱或 'knowledge' 列出 Knowledge 目錄。path 填子目錄路徑（預設根目錄）。不指定 workspace 時列出所有工作區和 Knowledge 檔案。",
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
      description: "讀取檔案內容。path 支援絕對路徑或相對路徑，不指定 workspace 時會自動在所有工作區和 Knowledge 目錄中搜尋",
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

  // ── Skill-based apps: auto-generate {appId}_exec tool ──
  // Any app with type=skill-based + schema + triggers gets an exec tool automatically
  for (const app of apps) {
    if (app.type !== "skill-based") continue;
    const appId = app.id;
    if (!appId || appId === "undefined") continue;
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

  // ── Memory tools (global, always available) ──
  tools.push({
    type: "function",
    function: {
      name: "memory_add",
      description: "新增一筆記憶到 MEMORY.md。當使用者說「記住」「幫我記」或學到重要資訊時使用。",
      parameters: {
        type: "object",
        properties: {
          section: { type: "string", description: "記憶分類，例如：使用者偏好、重要決策、近期待辦、專案脈絡、備忘" },
          content: { type: "string", description: "要記住的內容" }
        },
        required: ["section", "content"]
      }
    }
  });
  tools.push({
    type: "function",
    function: {
      name: "memory_update",
      description: "更新 MEMORY.md 中某個分類的內容。如果分類不存在會新增。",
      parameters: {
        type: "object",
        properties: {
          section: { type: "string", description: "要更新的分類名稱" },
          content: { type: "string", description: "新的完整內容（會取代該分類下所有內容）" }
        },
        required: ["section", "content"]
      }
    }
  });

  // ── Memory read tool (global, always available) ──
  tools.push({
    type: "function",
    function: {
      name: "memory_read",
      description: "讀取 MEMORY.md 的內容。可以讀整份或指定分類。當需要回憶之前記住的事情、使用者偏好、重要決策時使用。",
      parameters: {
        type: "object",
        properties: {
          section: { type: "string", description: "要讀取的分類名稱（可選）。不填則讀取整份 MEMORY.md。" }
        },
        required: []
      }
    }
  });

  // ── Task Management tools (global, always available) ──
  tools.push({
    type: "function",
    function: {
      name: "task_create",
      description: "在 Code Project 裡建立一個 Task。支援 requirement/bug/security/chore 類型。當使用者說「記錄一個需求」「加個 bug」「有個安全問題」或在討論中識別出待辦事項時使用。",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Task 標題" },
          type: { type: "string", enum: ["requirement", "bug", "security", "chore"], description: "Task 類型" },
          priority: { type: "string", enum: ["critical", "high", "medium", "low"], description: "優先級，預設 medium" },
          effort: { type: "string", enum: ["S", "M", "L", "XL"], description: "工作量估計" },
          description: { type: "string", description: "詳細說明" },
          assignee: { type: "string", description: "指派對象：human / em / architect / developer 等" },
          labels: { type: "array", items: { type: "string" }, description: "標籤" },
          note: { type: "string", description: "建立時的第一筆討論紀錄（選填）" },
        },
        required: ["title", "type"]
      }
    }
  });
  tools.push({
    type: "function",
    function: {
      name: "task_update",
      description: "更新 Code Project 裡的 Task。可以改狀態、優先級、指派人、加討論紀錄。當使用者說「這個 bug 修好了」「把這個標成高優先」或 EM 完成夜間工作時使用。",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Task ID（例如 TASK-001 或 ISS-001）" },
          status: { type: "string", enum: ["open", "in-progress", "resolved", "closed", "wontfix"], description: "新狀態" },
          priority: { type: "string", enum: ["critical", "high", "medium", "low"], description: "新優先級" },
          assignee: { type: "string", description: "新指派對象" },
          note: { type: "string", description: "加入的討論紀錄" },
          executionResult: { type: "object", description: "EM 派工執行結果 { summary, filesChanged, success }" },
        },
        required: ["id"]
      }
    }
  });
  tools.push({
    type: "function",
    function: {
      name: "task_list",
      description: "查詢 Code Project 裡的 Task 列表。可以依狀態、類型、優先級篩選。當使用者說「有哪些待辦」「bug 列表」「安全問題」或 EM 準備夜間派工時使用。",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", description: "篩選狀態，逗號分隔（例如：open,in-progress）" },
          type: { type: "string", description: "篩選類型，逗號分隔（例如：bug,security）" },
          priority: { type: "string", description: "篩選優先級，逗號分隔" },
          search: { type: "string", description: "搜尋關鍵字" },
        },
        required: []
      }
    }
  });

  tools.push({
    type: "function",
    function: {
      name: "task_decompose",
      description: "將一個大 Task 拆分成多個子任務。EM 收到大任務（例如「修所有安全問題」「修今天的 bugs」）時，必須先用這個工具拆分，再逐個派工。不要一次給 agent 一大坨工作。",
      parameters: {
        type: "object",
        properties: {
          parentId: { type: "string", description: "要拆分的父 Task ID（例如 TASK-026）" },
          subTasks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string", description: "子任務標題" },
                type: { type: "string", enum: ["requirement", "bug", "security", "chore"], description: "子任務類型（預設繼承父任務）" },
                priority: { type: "string", enum: ["critical", "high", "medium", "low"], description: "優先級" },
                effort: { type: "string", enum: ["S", "M", "L", "XL"], description: "工作量估計" },
                assignee: { type: "string", description: "指派對象" },
                description: { type: "string", description: "子任務詳細說明" },
                relatedFiles: { type: "array", items: { type: "string" }, description: "相關檔案" },
              },
              required: ["title"]
            },
            description: "拆分後的子任務列表"
          },
        },
        required: ["parentId", "subTasks"]
      }
    }
  });

  tools.push({
    type: "function",
    function: {
      name: "dispatch_agent",
      description: "派工給其他 agent 執行任務。EM 拆分好子任務後，用這個 tool 把具體工作交給對應的 agent。一次只派一個 agent，等結果回來再派下一個。",
      parameters: {
        type: "object",
        properties: {
          agentId: {
            type: "string",
            enum: ["architect", "developer", "tester", "doc-writer", "qa", "helpdesk"],
            description: "目標 agent：architect(林曉薇), developer(Priya), tester(Divya), doc-writer(Megan), qa(武大安), helpdesk(小春)",
          },
          task: {
            type: "string",
            description: "具體任務說明（要明確：哪個檔案、哪個函數、要做什麼）。例如：修 packages/ui/src/components/UserInput.tsx 中 handleSubmit 的 XSS 問題，使用 DOMPurify sanitize input",
          },
          taskId: {
            type: "string",
            description: "對應的 TASK-XXX ID（如果有），dispatch 前後會自動更新 task 狀態",
          },
        },
        required: ["agentId", "task"],
      },
    },
  });

  // ── Cron Job tools (global, always available) ──
  tools.push({
    type: "function",
    function: {
      name: "schedule_cronjob",
      description: "建立排程（Cron Job）。可以設定提醒或定期報告。當使用者說「每天提醒我」「每小時跑一次」「排程」時使用。",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "排程名稱（中文），例如：吃保健品提醒" },
          type: { type: "string", enum: ["reminder", "report"], description: "reminder=定時提醒，report=定期執行 Skill 報告" },
          reminderText: { type: "string", description: "提醒文字（type=reminder 時必填），例如：該吃保健品了！💊" },
          skillId: { type: "string", description: "Skill ID（type=report 時必填），例如：translate" },
          schedule: { type: "string", description: "Cron 表達式（5 欄）：分 時 日 月 週。例如 '0 9 * * *'=每天9點、'0 * * * *'=每小時、'0 9 * * 1'=每週一9點、'*/30 * * * *'=每30分鐘" },
          prompt: { type: "string", description: "額外指示（type=report 時可選）" },
          outputTarget: { type: "string", enum: ["chat", "path"], description: "輸出目標：chat=聊天視窗，path=指定路徑。預設 chat" },
          outputPath: { type: "string", description: "輸出路徑（outputTarget=path 時必填）" },
        },
        required: ["name", "type", "schedule"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "list_cronjobs",
      description: "列出所有排程（Cron Jobs）。顯示名稱、類型、排程、狀態。",
      parameters: { type: "object", properties: {}, required: [] },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "update_cronjob",
      description: "更新排程設定。可以修改排程時間、提醒文字、啟用/停用等。",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "排程 ID（名稱轉 kebab-case）" },
          name: { type: "string", description: "新名稱（可選）" },
          schedule: { type: "string", description: "新 cron 表達式（可選）" },
          reminderText: { type: "string", description: "新提醒文字（可選）" },
          enabled: { type: "boolean", description: "啟用/停用（可選）" },
          prompt: { type: "string", description: "新指示（可選）" },
        },
        required: ["id"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "delete_cronjob",
      description: "刪除排程。",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "排程 ID 或名稱" },
        },
        required: ["id"],
      },
    },
  });

  tools.push({
    type: "function",
    function: {
      name: "run_cronjob",
      description: "立即執行排程（手動觸發）。",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "排程 ID 或名稱" },
        },
        required: ["id"],
      },
    },
  });

  // ── Unified project_info (read) + project_edit (mutation) ──
  tools.push({
    type: "function",
    function: {
      name: "project_info",
      description: "Read project knowledge. Use category to specify what you need.",
      parameters: {
        type: "object",
        properties: {
          category: { type: "string", enum: ["context", "decisions", "standards", "changelog", "issues", "features", "feature_detail", "runbook", "faq", "sessions", "test_map", "security", "recent_changes", "api_history"], description: "Category to read" },
          id: { type: "string", description: "Feature/issue ID for detail queries" },
          search: { type: "string", description: "Search term" },
          status: { type: "string", description: "Filter by status (comma-separated)" },
          priority: { type: "string", description: "Filter by priority (comma-separated)" },
        },
        required: ["category"],
      },
    },
  });
  tools.push({
    type: "function",
    function: {
      name: "project_edit",
      description: "Modify project data: create/update/delete issues, update features, run commands.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["issue_create", "issue_update", "issue_delete", "feature_update_docs", "feature_update_mapping", "run_command"], description: "Action" },
          id: { type: "string", description: "Issue/feature ID" },
          title: { type: "string", description: "Title" },
          priority: { type: "string", enum: ["critical", "high", "medium", "low"], description: "Priority" },
          status: { type: "string", enum: ["open", "in-progress", "resolved", "closed", "wontfix"], description: "Status" },
          labels: { type: "array", items: { type: "string" }, description: "Labels" },
          description: { type: "string", description: "Description" },
          note: { type: "string", description: "Note to add" },
          featureId: { type: "string", description: "Related feature ID" },
          documentation: { type: "string", description: "Documentation markdown" },
          codeFiles: { type: "array", items: { type: "string" }, description: "Code files" },
          command: { type: "string", description: "Command to run" },
        },
        required: ["action"],
      },
    },
  });

    return { tools, apps };
}

// ── Generic skill result formatter ──
// Turns structured JSON from any skill-based app into readable text

function buildHandlers(apps) {
  const handlers = {};

  const PAAW_PORT = process.env.PAAW_PORT || "4097";
  const API = `http://127.0.0.1:${PAAW_PORT}`;

  // ── Unified project_info + project_edit ──
  handlers.project_info = async (args = {}) => {
    const cat = args.category;
    if (!cat) return "Error: category is required.";
    const root = args.cwd || PAAW_ROOT;
    switch (cat) {
      case "issues": {
        const file = join(root, ".paaw", "issues", "ISSUES.json");
        if (!existsSync(file)) return "(No issues tracking initialized)";
        try {
          const data = JSON.parse(readFileSync(file, "utf-8"));
          let issues = data.issues || [];
          if (args.status) { const ss = args.status.split(",").map(s => s.trim()); issues = issues.filter(i => ss.includes(i.status)); }
          if (args.priority) { const ps = args.priority.split(",").map(p => p.trim()); issues = issues.filter(i => ps.includes(i.priority)); }
          if (issues.length === 0) return "(No matching issues found)";
          return "Issues (" + issues.length + "):\n" + issues.map(i => `[${i.id}] ${i.status} | ${i.priority} | ${i.title}${i.labels?.length ? ` [${i.labels.join(",")}]` : ""}`).join("\n");
        } catch (err) { return `Error reading issues: ${err.message}`; }
      }
      case "features": {
        const file = join(root, ".paaw", "features", "FEATURES.json");
        if (!existsSync(file)) return "(No features registered)";
        try {
          const data = JSON.parse(readFileSync(file, "utf-8"));
          let features = data.features || [];
          if (args.search) { const s = args.search.toLowerCase(); features = features.filter(f => f.name?.toLowerCase().includes(s) || f.description?.toLowerCase().includes(s)); }
          return "Features (" + features.length + "):\n" + features.map(f => `[${f.id}] ${f.name} (${f.status})`).join("\n");
        } catch (err) { return `Error: ${err.message}`; }
      }
      case "context": {
        const ctxFile = join(root, "PROJECT.md");
        if (!existsSync(ctxFile)) return "(No project context found)";
        return readFileSync(ctxFile, "utf-8");
      }
      default: return `Category '${cat}' not implemented in chat assistant. Available: issues, features, context`;
    }
  };

  handlers.project_edit = async (args = {}) => {
    const action = args.action;
    if (!action) return "Error: action is required.";
    const root = args.cwd || PAAW_ROOT;
    switch (action) {
      case "issue_create": {
        if (!args.title) return "Error: title is required.";
        const file = join(root, ".paaw", "issues", "ISSUES.json");
        let data = { issues: [] };
        if (existsSync(file)) { try { data = JSON.parse(readFileSync(file, "utf-8")); } catch {} }
        const num = (data.issues || []).length + 1;
        const id = `ISS-${String(num).padStart(3, "0")}`;
        const issue = { id, title: args.title, priority: args.priority || "medium", status: "open", labels: args.labels || [], description: args.description || "", featureId: args.featureId || null, createdAt: new Date().toISOString(), notes: [] };
        data.issues = data.issues || [];
        data.issues.push(issue);
        const dir = join(root, ".paaw", "issues");
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
        return `Created issue ${id}: ${issue.title} [${issue.priority}]`;
      }
      case "issue_update": {
        const file = join(root, ".paaw", "issues", "ISSUES.json");
        if (!existsSync(file)) return "⚠️ No issues tracking.";
        try {
          const data = JSON.parse(readFileSync(file, "utf-8"));
          const issue = (data.issues || []).find(i => i.id === args.id);
          if (!issue) return `Issue ${args.id} not found.`;
          if (args.status) issue.status = args.status;
          if (args.priority) issue.priority = args.priority;
          if (args.note) { issue.notes = issue.notes || []; issue.notes.push({ text: args.note, date: new Date().toISOString() }); }
          issue.updatedAt = new Date().toISOString();
          writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
          return `Updated ${args.id}: status=${issue.status}, priority=${issue.priority}${args.note ? ", note added" : ""}`;
        } catch (err) { return `Error: ${err.message}`; }
      }
      case "issue_delete": {
        const file = join(root, ".paaw", "issues", "ISSUES.json");
        if (!existsSync(file)) return "⚠️ No issues tracking.";
        try {
          const data = JSON.parse(readFileSync(file, "utf-8"));
          const idx = (data.issues || []).findIndex(i => i.id === args.id);
          if (idx === -1) return `Issue ${args.id} not found.`;
          const removed = data.issues.splice(idx, 1)[0];
          writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
          return `Deleted issue ${removed.id}: ${removed.title}`;
        } catch (err) { return `Error: ${err.message}`; }
      }
      default: return `Action '${action}' not implemented in chat assistant. Available: issue_create, issue_update, issue_delete`;
    }
  };



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
    if (!appId || appId === "undefined") continue;  // skip broken apps
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


  // ── Skill-based apps: exec via REST API ──
  // Calls POST /api/apps/:appId/exec
  for (const app of apps) {
    if (app.type !== "skill-based") continue;
    const appId = app.id;
    if (!appId || appId === "undefined") continue;

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

  // ── Cron Job handlers (global) ──
  handlers.schedule_cronjob = async (args) => {
    try {
      const resp = await fetch(`${API}/api/cron-jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: args.name,
          type: args.type || "reminder",
          reminderText: args.reminderText || "",
          skillId: args.skillId || "",
          schedule: args.schedule || "0 9 * * *",
          prompt: args.prompt || "",
          outputTarget: args.outputTarget || "chat",
          outputPath: args.outputPath || "",
        }),
      });
      const job = await resp.json();
      if (job.error) return { text: `❌ ${job.error}`, error: true };
      const typeLabel = job.type === "reminder" ? "⏰ 提醒" : "📊 報告";
      const detail = job.type === "reminder" ? (job.reminderText || "") : (job.skillId || "");
      return { text: `✅ 已建立排程：${typeLabel} **${job.name}**\n排程：\`${job.schedule}\`${detail ? "\n内容：" + detail : ""}\nID: ${job.id}`, job };
    } catch (err) {
      return { text: `❌ 建立排程失敗：${err.message}`, error: true };
    }
  };

  handlers.list_cronjobs = async () => {
    try {
      const resp = await fetch(`${API}/api/cron-jobs`);
      const jobs = await resp.json();
      if (!Array.isArray(jobs) || jobs.length === 0) return { text: "目前沒有任何排程", jobs: [] };
      const list = jobs.map(j => {
        const icon = j.type === "reminder" ? "⏰" : "📊";
        const status = j.enabled ? "✅" : "⏸️";
        const detail = j.type === "reminder" ? (j.reminderText || "") : (j.skillId || "");
        return `${icon} ${status} **${j.name}** — \`${j.schedule}\`${detail ? " → " + detail : ""} (ID: ${j.id})`;
      }).join("\n");
      return { text: `排程列表（${jobs.length} 個）：\n\n${list}`, jobs };
    } catch (err) {
      return { text: `❌ 讀取排程失敗：${err.message}`, error: true };
    }
  };

  handlers.update_cronjob = async (args) => {
    try {
      // If id doesn't look like a kebab ID, try to find by name
      let jobId = args.id;
      const listResp = await fetch(`${API}/api/cron-jobs`);
      const jobs = await listResp.json();
      if (Array.isArray(jobs)) {
        const match = jobs.find(j => j.id === args.id || j.name === args.id);
        if (match) jobId = match.id;
      }
      const patch = {};
      if (args.name !== undefined) patch.name = args.name;
      if (args.schedule !== undefined) patch.schedule = args.schedule;
      if (args.reminderText !== undefined) patch.reminderText = args.reminderText;
      if (args.enabled !== undefined) patch.enabled = args.enabled;
      if (args.prompt !== undefined) patch.prompt = args.prompt;

      const resp = await fetch(`${API}/api/cron-jobs/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!resp.ok) return { text: `❌ 找不到排程 ID: ${args.id}`, error: true };
      const job = await resp.json();
      return { text: `✅ 已更新排程 **${job.name}**`, job };
    } catch (err) {
      return { text: `❌ 更新排程失敗：${err.message}`, error: true };
    }
  };

  handlers.delete_cronjob = async ({ id }) => {
    try {
      // Try to find by name first
      let jobId = id;
      const listResp = await fetch(`${API}/api/cron-jobs`);
      const jobs = await listResp.json();
      if (Array.isArray(jobs)) {
        const match = jobs.find(j => j.id === id || j.name === id);
        if (match) jobId = match.id;
      }
      const resp = await fetch(`${API}/api/cron-jobs/${jobId}`, { method: "DELETE" });
      if (!resp.ok) return { text: `❌ 找不到排程: ${id}`, error: true };
      return { text: `🗑️ 已刪除排程 ${id}` };
    } catch (err) {
      return { text: `❌ 刪除排程失敗：${err.message}`, error: true };
    }
  };

  handlers.run_cronjob = async ({ id }) => {
    try {
      let jobId = id;
      const listResp = await fetch(`${API}/api/cron-jobs`);
      const jobs = await listResp.json();
      if (Array.isArray(jobs)) {
        const match = jobs.find(j => j.id === id || j.name === id);
        if (match) jobId = match.id;
      }
      const resp = await fetch(`${API}/api/cron-jobs/${jobId}/run`, { method: "POST" });
      if (!resp.ok) return { text: `❌ 找不到排程: ${id}`, error: true };
      return { text: `▶ 已立即執行排程 **${id}**` };
    } catch (err) {
      return { text: `❌ 執行排程失敗：${err.message}`, error: true };
    }
  };

  // ── Memory handlers (global) ──
  // Tool definitions are in buildToolDefinitions()
  const MEMORY_FILE = resolve(PAAW_DATA_DIR, "config/MEMORY.md");

  handlers.memory_read = async ({ section } = {}) => {
    try {
      let mem = "";
      try { mem = await readFile(MEMORY_FILE, "utf-8"); } catch { return { text: "MEMORY.md 尚未建立，目前沒有任何記憶。" }; }
      if (!section) {
        // Return full memory (truncate if very large)
        const truncated = mem.length > 8000 ? mem.slice(0, 8000) + "\n... ( truncated, 共 " + mem.length + " 字元)" : mem;
        return { text: truncated };
      }
      // Return specific section
      const escSection = section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const sectionRegex = new RegExp(`^## ${escSection}\\s*$`, "m");
      if (!sectionRegex.test(mem)) {
        return { text: `找不到分類「${section}」。現有分類：\n${[...mem.matchAll(/^## (.+)$/gm)].map(m => "- " + m[1]).join("\n")}` };
      }
      const lines = mem.split("\n");
      let startIdx = -1, endIdx = lines.length;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].match(new RegExp(`^## ${escSection}\\s*$`))) { startIdx = i; }
        else if (startIdx >= 0 && lines[i].startsWith("## ")) { endIdx = i; break; }
      }
      if (startIdx >= 0) {
        const sectionContent = lines.slice(startIdx, endIdx).join("\n");
        return { text: sectionContent };
      }
      return { text: `找不到分類「${section}」的內容。` };
    } catch (err) {
      return { text: `讀取記憶失敗：${err.message}`, error: true };
    }
  };

  handlers.memory_add = async ({ section, content }) => {
    try {
      let mem = "";
      try { mem = await readFile(MEMORY_FILE, "utf-8"); } catch {}
      const header = `## ${section}`;
      const escSection = section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const sectionRegex = new RegExp(`^## ${escSection}\\s*$`, "m");
      if (sectionRegex.test(mem)) {
        const lines = mem.split("\n");
        let startIdx = -1, endIdx = lines.length;
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].match(new RegExp(`^## ${escSection}\\s*$`))) { startIdx = i; }
          else if (startIdx >= 0 && lines[i].startsWith("## ")) { endIdx = i; break; }
        }
        if (startIdx >= 0) {
          lines.splice(endIdx, 0, `- ${content}`);
          mem = lines.join("\n");
        }
      } else {
        mem = mem.replace(/\n*$/, "") + `\n\n${header}\n- ${content}\n`;
      }
      await writeFile(MEMORY_FILE, mem, "utf-8");
      return { text: `✅ 已記住：${section} — ${content.slice(0, 60)}${content.length > 60 ? "..." : ""}` };
    } catch (err) {
      return { text: `記憶寫入失敗：${err.message}`, error: true };
    }
  };

  handlers.memory_update = async ({ section, content }) => {
    try {
      let mem = "";
      try { mem = await readFile(MEMORY_FILE, "utf-8"); } catch {}
      const header = `## ${section}`;
      const escSection = section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const sectionRegex = new RegExp(`^## ${escSection}\\s*$`, "m");
      if (sectionRegex.test(mem)) {
        const lines = mem.split("\n");
        let startIdx = -1, endIdx = lines.length;
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].match(new RegExp(`^## ${escSection}\\s*$`))) { startIdx = i; }
          else if (startIdx >= 0 && lines[i].startsWith("## ")) { endIdx = i; break; }
        }
        if (startIdx >= 0) {
          lines.splice(startIdx + 1, endIdx - startIdx - 1, content);
          mem = lines.join("\n");
        }
      } else {
        mem = mem.replace(/\n*$/, "") + `\n\n${header}\n${content}\n`;
      }
      await writeFile(MEMORY_FILE, mem, "utf-8");
      return { text: `✅ 已更新：${section}` };
    } catch (err) {
      return { text: `記憶更新失敗：${err.message}`, error: true };
    }
  };

  // ── Task Management handlers (global) ──
  handlers.task_create = async ({ title, type, priority, effort, description, assignee, labels, note } = {}) => {
    try {
      // Use first workspace path as project path, or PAAW_ROOT
      const workspaces = await loadWorkspaces();
      const projectPath = workspaces.length > 0 ? workspaces[0] : PAAW_ROOT;
      const resp = await fetch(`${API}/api/coding-tasks?path=${encodeURIComponent(projectPath)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title, type, priority: priority || "medium", effort, description: description || "", assignee: assignee || null,
          labels: labels || [], notes: note ? [{ by: "agent", at: new Date().toISOString(), content: note }] : [],
          createdBy: "agent",
        }),
      });
      const data = await resp.json();
      if (data.id) {
        const typeIcon = { requirement: "📋", bug: "🐛", security: "🔒", chore: "🔧" }[type] || "📋";
        return { text: `${typeIcon} 已建立 ${data.id}：${title}（${type}/${priority || "medium"}）${assignee ? `→ ${assignee}` : ""}` };
      }
      return { text: `❌ 建立失敗：${data.error || "未知錯誤"}`, error: true };
    } catch (err) {
      return { text: `❌ 建立失敗：${err.message}`, error: true };
    }
  };

  handlers.task_update = async ({ id, status, priority, assignee, note, executionResult } = {}) => {
    try {
      const workspaces = await loadWorkspaces();
      const projectPath = workspaces.length > 0 ? workspaces[0] : PAAW_ROOT;
      const updateBody = {};
      if (status) updateBody.status = status;
      if (priority) updateBody.priority = priority;
      if (assignee) updateBody.assignee = assignee;
      if (executionResult) updateBody.executionResult = executionResult;

      // First update the task fields
      if (Object.keys(updateBody).length > 0) {
        const resp = await fetch(`${API}/api/coding-tasks/${encodeURIComponent(id)}?path=${encodeURIComponent(projectPath)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updateBody),
        });
        const data = await resp.json();
        if (data.error) return { text: `❌ 更新失敗：${data.error}`, error: true };
      }

      // Then add note if provided
      if (note) {
        const resp = await fetch(`${API}/api/coding-tasks/${encodeURIComponent(id)}/notes?path=${encodeURIComponent(projectPath)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: note, by: "agent" }),
        });
        const data = await resp.json();
        if (data.error) return { text: `❌ 新增討論紀錄失敗：${data.error}`, error: true };
      }

      const statusText = status ? `狀態→${status}` : "";
      const priorityText = priority ? `優先級→${priority}` : "";
      const assigneeText = assignee ? `指派→${assignee}` : "";
      const noteText = note ? " + 已加討論紀錄" : "";
      return { text: `✅ ${id} 已更新：${[statusText, priorityText, assigneeText].filter(Boolean).join(", ")}${noteText}` };
    } catch (err) {
      return { text: `❌ 更新失敗：${err.message}`, error: true };
    }
  };

  handlers.task_list = async ({ status, type, priority, search } = {}) => {
    try {
      const workspaces = await loadWorkspaces();
      const projectPath = workspaces.length > 0 ? workspaces[0] : PAAW_ROOT;
      let url = `${API}/api/coding-tasks?path=${encodeURIComponent(projectPath)}`;
      const params = [];
      if (status) params.push(`status=${encodeURIComponent(status)}`);
      if (type) params.push(`type=${encodeURIComponent(type)}`);
      if (priority) params.push(`priority=${encodeURIComponent(priority)}`);
      if (search) params.push(`search=${encodeURIComponent(search)}`);
      if (params.length > 0) url += "&" + params.join("&");

      const resp = await fetch(url);
      const data = await resp.json();
      const issues = data.issues || [];
      if (issues.length === 0) return { text: "沒有符合條件的 Task" };

      const statusIcon = { open: "🔴", "in-progress": "🔧", resolved: "✅", closed: "✅", wontfix: "➖" };
      const typeIcon = { requirement: "📋", bug: "🐛", security: "🔒", chore: "🔧" };
      let text = `📋 **Task 列表**（${issues.length} 筆）\n\n`;
      for (const t of issues) {
        const si = statusIcon[t.status] || "⬜";
        const ti = typeIcon[t.type] || "📋";
        const eff = t.effort ? ` [${t.effort}]` : "";
        const assign = t.assignee ? ` → ${t.assignee}` : "";
        const nsr = t.executionResult ? (t.executionResult.success ? " 🌙✅" : " 🌙❌") : "";
        text += `${si} ${ti} **${t.id}** ${t.title}${eff}${assign}${nsr} (${t.priority})\n`;
      }
      return { text, count: issues.length };
    } catch (err) {
      return { text: `❌ 查詢失敗：${err.message}`, error: true };
    }
  };

  handlers.task_decompose = async ({ parentId, subTasks } = {}) => {
    try {
      const workspaces = await loadWorkspaces();
      const projectPath = workspaces.length > 0 ? workspaces[0] : PAAW_ROOT;
      const resp = await fetch(`${API}/api/coding-tasks/decompose?path=${encodeURIComponent(projectPath)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentId, subTasks, createdBy: "agent" }),
      });
      const data = await resp.json();
      if (data.subTasks) {
        let text = `✂️ ${parentId} 已拆分為 ${data.subTasks.length} 個子任務：\n\n`;
        for (const s of data.subTasks) {
          const typeIcon = { requirement: "📋", bug: "🐛", security: "🔒", chore: "🔧" }[s.type] || "📋";
          const assignee = s.assignee ? ` → ${s.assignee}` : "";
          text += `${typeIcon} **${s.id}**: ${s.title}${assignee}\n`;
        }
        text += `\n💡 逐個派工，一次一個 agent，做完確認再派下一個`;
        return { text, subTasks: data.subTasks };
      }
      return { text: `❌ 拆分失敗：${data.error || "未知錯誤"}`, error: true };
    } catch (err) {
      return { text: `❌ 拆分失敗：${err.message}`, error: true };
    }
  };

  handlers.dispatch_agent = async ({ agentId, task, taskId } = {}) => {
    if (!agentId || !task) return { text: "❌ dispatch_agent 需要 agentId 和 task" };

    const { getAgentByCrewId, buildSystemPrompt } = await import("../lib/domain-agent-registry.mjs");
    const agent = getAgentByCrewId(`coding.${agentId}`);
    if (!agent) return { text: `❌ 找不到 agent: ${agentId}` };

    // Check if agent is busy
    try {
      const busyResp = await fetch(`${API}/api/coding-crew/running?agentId=${agentId}`);
      if (busyResp.ok) {
        const busyData = await busyResp.json();
        if (busyData.running) return { text: `⏳ ${agentId} 正忙（已跑 ${busyData.elapsedS || '?'}s），等一下再派` };
      }
    } catch {}

    // Update task status to in-progress if taskId provided
    if (taskId) {
      try {
        const workspaces = await loadWorkspaces();
        const projectPath = workspaces.length > 0 ? workspaces[0] : PAAW_ROOT;
        await fetch(`${API}/api/coding-tasks/${taskId}?path=${encodeURIComponent(projectPath)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "in-progress", assignee: agentId }),
        });
      } catch {}
    }

    try {
      const { runAgentLoop } = await import("../lib/paaw-agent-loop.mjs");
      const workspaces = await loadWorkspaces();
      const projRoot = workspaces.length > 0 ? workspaces[0] : PAAW_ROOT;

      // Build system prompt for the target agent
      const systemPrompt = await buildSystemPrompt(agent.agentId, { cwd: projRoot });

      const result = await runAgentLoop({
        prompt: task,
        systemPrompt,
        cwd: projRoot,
        agentId: agent.agentId,
        maxTurns: 30,
        timeout: 0, // no timeout — dispatched tasks may need extended time
        rootDir: projRoot,
      });

      const success = result.success;
      const content = result.content || "";
      const preview = content.slice(0, 500);

      // Update task with result if taskId provided
      if (taskId) {
        try {
          const workspaces2 = await loadWorkspaces();
          const projectPath2 = workspaces2.length > 0 ? workspaces2[0] : PAAW_ROOT;
          await fetch(`${API}/api/coding-tasks/${taskId}?path=${encodeURIComponent(projectPath2)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              status: success ? "resolved" : "open",
              executionResult: {
                summary: success ? preview.slice(0, 200) : `Agent ${agentId} failed`,
                filesChanged: [],
                success,
              },
            }),
          });
        } catch {}
      }

      const agentNames = { architect: "林曉薇", developer: "Priya", tester: "Divya", "doc-writer": "Megan", qa: "武大安", helpdesk: "小春" };
      const name = agentNames[agentId] || agentId;
      if (success) {
        return { text: `✅ ${name} (${agentId}) 完成任務！\n\n${preview}`, taskId };
      } else {
        return { text: `❌ ${name} (${agentId}) 執行失敗：\n\n${preview}`, taskId, error: true };
      }
    } catch (err) {
      // Mark task as failed
      if (taskId) {
        try {
          const workspaces = await loadWorkspaces();
          const projectPath = workspaces.length > 0 ? workspaces[0] : PAAW_ROOT;
          await fetch(`${API}/api/coding-tasks/${taskId}?path=${encodeURIComponent(projectPath)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              status: "open",
              executionResult: { summary: `Dispatch error: ${err.message}`, filesChanged: [], success: false },
            }),
          });
        } catch {}
      }
      return { text: `❌ 派工失敗：${err.message}`, error: true };
    }
  };

  // File tools (dataShape: none, special tools)
  // Helper: load workspace directories
  async function loadWorkspaces() {
    try {
      const ws = JSON.parse(await readFile(resolve(PAAW_DATA_DIR, "workspaces.json"), "utf-8"));
      return ws.directories || [];
    } catch { return []; }
  }

  // Helper: convert absolute path to relative if under PAAW_DATA_DIR (cross-platform)
  // Detect if a path is absolute, including Unix paths on Windows
  const isAbsPath = (d) => isAbsolute(d) || (d.startsWith('/') && process.platform === 'win32');

  // Helper: knowledge directory (fixed path)
  async function loadKnowledgeDirs() {
    return [resolve(PAAW_DATA_DIR, "knowledge")];
  }

  // Helper: list knowledge files synchronously (for file_list display)
  async function loadKnowledgeFiles() {
    const files = [];
    const { readdirSync, readFileSync: readSync } = await import("fs");
    const knowledgeDirs = [resolve(PAAW_DATA_DIR, "knowledge")];
    for (const knowledgeDir of knowledgeDirs) {
      const label = knowledgeDirs.length > 1 ? `[${knowledgeDir.split("/").pop()}] ` : "";
      try {
        const entries = readdirSync(knowledgeDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile()) files.push(`${label}${entry.name}`);
          else if (entry.isDirectory()) {
            try {
              const sub = readdirSync(resolve(knowledgeDir, entry.name), { withFileTypes: true });
              for (const s of sub) { if (s.isFile()) files.push(`${label}${entry.name}/${s.name}`); }
            } catch {}
          }
        }
      } catch {}
    }
    return files;
  }

  // Helper: match workspace by name/path fragment
  function matchWorkspace(dirs, hint) {
    if (!hint) return null;
    return dirs.find(w => w === hint || w.endsWith("/" + hint) || w.includes(hint)) || null;
  }

  handlers.file_list = async ({ path: dirPath = ".", workspace } = {}) => {
    try {
      const dirs = await loadWorkspaces();
      const knowledgeDirs = await loadKnowledgeDirs();

      // Support listing Knowledge directory
      if (workspace === "knowledge") {
        const results = [];
        for (const kd of knowledgeDirs) {
          try {
            const { readdir: rd } = await import("fs/promises");
            const targetDir = dirPath === "." || dirPath === "knowledge" ? kd : resolve(kd, dirPath);
            const entries = await rd(targetDir, { withFileTypes: true });
            const label = knowledgeDirs.length > 1 ? `[${kd.split("/").pop()}] ` : "";
            const list = entries.map(e => `${e.isDirectory() ? "📁" : "📄"} ${label}${e.name}`).join("\n");
            results.push(`📚 ${kd.split("/").pop()}：\n${list || "(空目錄)"}`);
          } catch (err) {
            results.push(`❌ ${kd.split("/").pop()}：讀取失敗`);
          }
        }
        return { text: results.join("\n\n") };
      }

      if (dirs.length === 0 && knowledgeDirs.length === 0) return { text: "沒有設定工作區或 Knowledge 目錄", error: true };

      // No workspace specified → list all workspaces + knowledge
      if (!workspace) {
        const parts = [];
        if (dirs.length > 0) {
          const wsList = dirs.map((w, i) => `${i + 1}. **${w.split("/").pop()}** — ${w}`).join("\n");
          parts.push(`可用工作區（${dirs.length} 個）：\n${wsList}`);
        }
        if (knowledgeDirs.length > 0) {
          const kFiles = await loadKnowledgeFiles();
          parts.push(`📚 Knowledge（${knowledgeDirs.length} 個目錄，${kFiles.length} 個檔案，用 file_read 讀取）：\n${kFiles.map(f => `- ${f}`).join("\n")}`);
        }
        parts.push(`請指定 workspace 參數來選擇工作區，或用 workspace=\"knowledge\" 列出 Knowledge 目錄。`);
        return { text: parts.join("\n\n") };
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

      // Support absolute paths directly (Unix /xxx or Windows C:\xxx / D:\xxx)
      if (filePath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(filePath)) {
        try {
          const content = await readFile(filePath, "utf-8");
          const preview = content.length > 5000 ? content.slice(0, 5000) + "\n... (截斷)" : content;
          return { text: preview, path: filePath };
        } catch {
          return { text: `找不到檔案「${filePath}」`, error: true };
        }
      }

      const dirs = await loadWorkspaces();
      // Also search knowledge directories
      const knowledgeDirs = await loadKnowledgeDirs();
      const searchAll = [...dirs, ...knowledgeDirs];

      // If workspace specified, use it; otherwise search all workspaces + knowledge
      let searchDirs;
      if (workspace === "knowledge") {
        searchDirs = knowledgeDirs;
      } else if (workspace) {
        searchDirs = [matchWorkspace(dirs, workspace)].filter(Boolean);
      } else {
        searchDirs = searchAll;
      }
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

  // ── Notes handlers (built-in) ──
    // ── Unified notes handler ──
  handlers.notes = async (args = {}) => {
    const action = args.action;
    if (!action) return "Error: action is required.";
    
    switch (action) {
      case "list_notebooks": {
        try {
          const dir = join(PAAW_ROOT, "data", "notes");
          if (!existsSync(dir)) return "目前沒有任何筆記本。";
          const entries = (await readdir(dir)).filter(e => e.endsWith(".json") && e !== "sections.json");
          if (entries.length === 0) return "目前沒有任何筆記本。";
          const result = [];
          for (const e of entries) {
            try {
              const nb = JSON.parse(readFileSync(join(dir, e), "utf-8"));
              result.push({ id: nb.id || e.replace(".json", ""), name: nb.name || nb.id, noteCount: (nb.notes || []).length });
            } catch {}
          }
          return { text: result.map(r => `📁 ${r.name} (${r.id}) — ${r.noteCount} 筆記`).join("\n"), notebooks: result };
        } catch { return "讀取筆記本失敗"; }
      }
      case "create": {
        const notebook = args.notebook || "personal";
        const section = args.section || "default";
        const title = args.title;
        const content = args.content || args.prompt || "";
        const tags = args.tags || [];
        if (!title && !content) return { text: "❌ 請提供標題或內容", error: true };
        try {
          const dir = join(PAAW_ROOT, "data", "notes");
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
          const file = join(dir, `${notebook}.json`);
          let nb = { id: notebook, name: notebook, notes: [] };
          if (existsSync(file)) { try { nb = JSON.parse(readFileSync(file, "utf-8")); } catch {} }
          const note = { id: `note-${Date.now()}`, title: title || "未命名筆記", content, tags, sectionId: section, createdAt: new Date().toISOString() };
          if (!Array.isArray(nb.notes)) nb.notes = [];
          nb.notes.push(note);
          writeFileSync(file, JSON.stringify(nb, null, 2), "utf-8");
          return { text: `✅ 筆記已建立：${note.title}`, noteId: note.id, notebook, link: `#/notes?note=${note.id}&notebook=${notebook}` };
        } catch (err) { return { text: `❌ 建立失敗：${err.message}`, error: true }; }
      }
      case "create_section": {
        const notebook = args.notebook;
        const name = args.name;
        const icon = args.icon || "📁";
        if (!notebook || !name) return "❌ 需要 notebook 和 name";
        try {
          const file = join(PAAW_ROOT, "data", "notes", "sections.json");
          let all = {};
          if (existsSync(file)) { try { all = JSON.parse(readFileSync(file, "utf-8")); } catch {} }
          if (!all[notebook]) all[notebook] = [{ id: "default", name: "Default" }];
          const secId = name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || `sec-${Date.now()}`;
          all[notebook].push({ id: secId, name, icon });
          writeFileSync(file, JSON.stringify(all, null, 2), "utf-8");
          return `✅ 分類已建立：${name} (${notebook})`;
        } catch (err) { return `❌ 建立失敗：${err.message}`; }
      }
      case "search": {
        const q = args.q || "";
        if (!q) return "❌ 請提供搜尋關鍵字";
        try {
          const dir = join(PAAW_ROOT, "data", "notes");
          if (!existsSync(dir)) return "沒有筆記";
          const entries = (await readdir(dir)).filter(e => e.endsWith(".json") && e !== "sections.json");
          const results = [];
          for (const e of entries) {
            try {
              const nb = JSON.parse(readFileSync(join(dir, e), "utf-8"));
              for (const n of (nb.notes || [])) {
                if (`${n.title} ${n.content}`.toLowerCase().includes(q.toLowerCase())) {
                  results.push({ notebook: nb.id, title: n.title, id: n.id, preview: (n.content || "").slice(0, 100) });
                }
              }
            } catch {}
          }
          if (results.length === 0) return `找不到包含「${q}」的筆記`;
          return { text: results.map(r => `📄 ${r.title} (${r.notebook})\n  ${r.preview}...`).join("\n"), results };
        } catch { return "搜尋失敗"; }
      }
      default: return `未知操作 '${action}'。可用：list_notebooks, create, create_section, search`;
    }
  };

  // ── Unified notes handler (replaces notes_search, notes_get, notes_recent, notes_create) ──
  handlers.notes = async (args = {}) => {
    const action = args.action;
    if (!action) return "Error: action is required.";

    switch (action) {
      case "search": {
        const q = args.q;
        if (!q) return { text: "❌ 請提供搜尋關鍵字", error: true };
        try {
          const resp = await fetch(`${API}/api/notes/search?q=${encodeURIComponent(q)}`);
          const data = await resp.json();
          const results = data.results || [];
          if (results.length === 0) return { text: `找不到包含「${q}」的筆記` };
          const lines = results.map(r => {
            const link = `#/notes?note=${r.id}&notebook=${r.notebookId}`;
            return `📝 **${r.title}**\n   📁 ${r.notebookName || ""}\n   ${r.excerpt}...\n   🔗 [開啟筆記](${link})`;
          });
          return { text: `找到 ${results.length} 則相關筆記：\n\n${lines.join("\n\n")}`, results };
        } catch (err) { return { text: `❌ 搜尋失敗：${err.message}`, error: true }; }
      }
      case "get": {
        const id = args.id, notebook = args.notebook || "default";
        if (!id) return { text: "❌ 請提供筆記 ID", error: true };
        try {
          const resp = await fetch(`${API}/api/notes/get?id=${id}&notebook=${encodeURIComponent(notebook)}`);
          const data = await resp.json();
          if (!data.note) return { text: "找不到這則筆記", error: true };
          const note = data.note;
          const plain = (note.content || "").replace(/<[^>]+>/g, "");
          const link = `#/notes?note=${note.id}&notebook=${note.notebookId}`;
          return { text: `📝 **${note.title}**\n📁 ${note.notebookId}\n🕐 ${note.updatedAt}\n\n${plain.slice(0, 500)}${plain.length > 500 ? "..." : ""}\n\n🔗 [開啟筆記](${link})`, note };
        } catch (err) { return { text: `❌ 讀取失敗：${err.message}`, error: true }; }
      }
      case "recent": {
        const limit = args.limit || 10;
        try {
          const resp = await fetch(`${API}/api/notes/recent?limit=${limit}`);
          const data = await resp.json();
          const notes = data.notes || [];
          if (notes.length === 0) return { text: "沒有筆記" };
          const lines = notes.map(n => {
            const link = `#/notes?note=${n.id}&notebook=${n.notebookId}`;
            return `📝 **${n.title}**\n   📁 ${n.notebookName || ""} · 🕐 ${n.updatedAt ? new Date(n.updatedAt).toLocaleDateString("zh-TW") : ""}\n   ${n.excerpt || ""}...\n   🔗 [開啟筆記](${link})`;
          });
          return { text: `最近 ${notes.length} 則筆記：\n\n${lines.join("\n\n")}`, notes };
        } catch (err) { return { text: `❌ 讀取失敗：${err.message}`, error: true }; }
      }
      case "create": {
        const { content, prompt, notebook, section, title, tags } = args;
        try {
          const aiResp = await fetch(`${API}/api/notes/ai-write`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content, prompt: prompt || "" }),
          });
          const aiData = await aiResp.json();
          if (!aiData.ok) return { text: `❌ AI 整理失敗：${aiData.error}`, error: true };
          const createResp = await fetch(`${API}/api/notes/create`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              notebookId: notebook || "default",
              sectionId: section || "default",
              title: title || aiData.title || "AI 筆記",
              content: aiData.content || "",
              tags: tags || aiData.tags || [],
            }),
          });
          const createData = await createResp.json();
          if (!createData.ok) return { text: "❌ 建立筆記失敗", error: true };
          const link = `#/notes?note=${createData.note.id}&notebook=${createData.note.notebookId}`;
          const preview = (aiData.content || "").replace(/<[^>]+>/g, "").slice(0, 200);
          let sectionLabel = "";
          try {
            const secResp = await fetch(`${API}/api/notes/sections?notebook=${encodeURIComponent(notebook || "default")}`);
            const secData = await secResp.json();
            const sec = (secData.sections || []).find(s => s.id === (section || "default"));
            sectionLabel = sec ? (sec.id === "default" ? "未分類" : sec.name) : "";
          } catch {}
          const locationInfo = sectionLabel ? `\n📁 分類：${sectionLabel}` : "";
          return { text: `✅ 已建立筆記！\n\n📝 **${createData.note.title}**${locationInfo}\n${preview}...\n\n🔗 [開啟筆記](${link})`, note: createData.note };
        } catch (err) { return { text: `❌ 建立筆記失敗：${err.message}`, error: true }; }
      }
      case "list_notebooks": {
        try {
          const resp = await fetch(`${API}/api/notes/notebooks`);
          const data = await resp.json();
          const nbs = data.notebooks || [];
          if (nbs.length === 0) return { text: "目前沒有筆記本" };
          const lines = nbs.map(nb => `📁 **${nb.name}** (${nb.id}) — ${nb.noteCount || 0} 筆記`);
          return { text: `筆記本列表：\n\n${lines.join("\n")}`, notebooks: nbs };
        } catch (err) { return { text: `❌ 讀取失敗：${err.message}`, error: true }; }
      }
      case "list_sections": {
        const notebook = args.notebook || "default";
        try {
          const resp = await fetch(`${API}/api/notes/sections?notebook=${encodeURIComponent(notebook)}`);
          const data = await resp.json();
          const sections = data.sections || [];
          const lines = sections.map(s => `${s.id === "default" ? "📋" : "📁"} ${s.name} (${s.id})`);
          return { text: `筆記本「${notebook}」的分類：\n\n${lines.join("\n")}`, sections };
        } catch (err) { return { text: `❌ 讀取失敗：${err.message}`, error: true }; }
      }
      case "create_section": {
        const { notebook, name, icon } = args;
        if (!notebook || !name) return { text: "❌ 需要 notebook 和 name", error: true };
        try {
          const resp = await fetch(`${API}/api/notes/sections`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ notebookId: notebook, name, icon: icon || "📁" }),
          });
          const data = await resp.json();
          if (!data.ok) return { text: "❌ 建立分類失敗", error: true };
          return { text: `✅ 分類已建立：${name} (${notebook})` };
        } catch (err) { return { text: `❌ 建立失敗：${err.message}`, error: true }; }
      }
      default: return `Unknown action '${action}'. Valid: search, get, recent, create, list_notebooks, list_sections, create_section`;
    }
  };

  // ── Project Board handlers ──
  handlers.project_status = async ({ projectId } = {}) => {
    try {
      if (projectId) {
        const resp = await fetch(`${API}/api/projects/${encodeURIComponent(projectId)}`);
        const data = await resp.json();
        if (!data.project) return { error: "專案不存在" };
        const p = data.project;
        const allTasks = (p.categories || []).flatMap(c => c.tasks || []);
        const done = allTasks.filter(t => t.status === "done").length;
        const prog = allTasks.filter(t => t.status === "progress").length;
        const total = allTasks.length;
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        let text = `${p.icon} **${p.name}**\n`;
        text += `${p.description}\n\n`;
        text += `📊 進度：${done}/${total} 完成（${pct}%）· 進行中 ${prog}\n\n`;
        text += `📋 分類：\n`;
        for (const cat of (p.categories || [])) {
          const cDone = (cat.tasks || []).filter(t => t.status === "done").length;
          const cTotal = (cat.tasks || []).length;
          text += `${cat.icon} ${cat.name} — ${cDone}/${cTotal}\n`;
          for (const t of (cat.tasks || [])) {
            const icon = t.status === "done" ? "✅" : t.status === "progress" ? "🔧" : "⬜";
            text += `  ${icon} ${t.name}\n`;
          }
        }
        text += `\n🏁 里程碑：\n`;
        for (const m of (p.milestones || [])) {
          const icon = m.status === "done" ? "✅" : m.status === "progress" ? "🔧" : "⬜";
          text += `${icon} ${m.name}${m.date ? ` (${m.date})` : ""}\n`;
        }
        return { text, project: { id: p.id, name: p.name, pct } };
      } else {
        const resp = await fetch(`${API}/api/projects`);
        const data = await resp.json();
        const projects = data.projects || [];
        if (projects.length === 0) return { text: "尚無專案" };
        let text = `📋 **專案看板**（${projects.length} 個專案）\n\n`;
        for (const p of projects) {
          text += `${p.icon} **${p.name}** — ${p.taskDone}/${p.taskTotal}（${p.taskPct}%）`;
          if (p.milestonesTotal > 0) text += ` · 🏁 ${p.milestonesDone}/${p.milestonesTotal}`;
          text += `\n`;
        }
        return { text, projects };
      }
    } catch (err) {
      return { error: err.message };
    }
  };

  handlers.project_update_task = async ({ projectId, taskId, status }) => {
    try {
      const resp = await fetch(`${API}/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await resp.json();
      if (data.ok) {
        return { text: `已更新任務「${data.task.name}」狀態為 ${status}`, task: data.task };
      }
      return { error: data.error || "更新失敗" };
    } catch (err) {
      return { error: err.message };
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
