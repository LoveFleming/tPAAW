# PAAW Developer Reference

> 給 AI / 開發者看的技術參考。看完這份就知道 PAAW 的架構、每個功能在哪、怎麼改。
>
> Repo: `LoveFleming/tAgent` · Branch: `dev`
> 最後更新：2026-06-30

---

## 專案結構

```
tAgent/
├── packages/
│   ├── ui/                  # 前端 (React + Vite + TypeScript)
│   │   └── src/
│   │       ├── App.tsx              # 路由 + Tab 管理 + Sidebar
│   │       ├── api.ts               # API_BASE export
│   │       ├── pages/               # 每個功能一個 .tsx
│   │       ├── components/          # 共用元件
│   │       │   ├── AgentConsole.tsx     # WebSocket AI 對話框（streaming）
│   │       │   ├── ModelSelector.tsx     # 模型切換下拉框
│   │       │   ├── SidebarFileTree.tsx   # 檔案樹 + 右鍵選單
│   │       │   ├── KnowledgeTree.tsx     # Knowledge 頁檔案樹
│   │       │   └── CrewEditor.tsx        # Crew 編輯器
│   │       ├── types/index.ts       # 共用型別 + buildSystemPrompt()
│   │       └── i18n/locales/        # zh.json, en.json, ja.json
│   │
│   ├── server/              # 後端 (Node.js, 純 .mjs)
│   │   └── src/
│   │       ├── context-engine.mjs       # ★ 統一 context 組裝器
│   │       ├── websocket/ws-handler.mjs # WebSocket handler (Chat, AgentConsole)
│   │       ├── lib/paaw-agent-loop.mjs  # ★ Agent 執行迴圈 (runAgentLoop / Stream)
│   │       ├── routes/                  # API 路由（每個功能一個檔）
│   │       └── scheduler/cron-jobs.mjs  # 排程引擎
│   │
│   ├── db/                  # SQLite ORM (Drizzle)
│   ├── engine/              # 執行引擎
│   ├── context/             # Context 管理
│   └── shared/              # 共用型別
│
├── data/                    # ★ 所有資料（JSON + Markdown，不是 DB）
│   ├── ai-settings/         # AI 系統提示詞（可線上編輯）
│   ├── apps/                # App 資料（每個 App 一個目錄）
│   ├── chats/               # 聊天紀錄
│   ├── config/              # 系統設定
│   │   ├── providers.json   # ★ AI Provider 設定（API key, model, baseURL）
│   │   ├── user.json        # 使用者資料 + preferences（model 偏好）
│   │   └── ui-state.json    # UI 狀態
│   ├── crews/               # Crew 定義（每個 Crew 一個 JSON）
│   ├── cron/                # Cron job 定義
│   ├── skills/              # Skill 檔案
│   │   ├── building/        # 正在建構的 skill
│   │   └── physical-skill/  # 已產生的 skill（可被 Crew / Cron 使用）
│   ├── workflows/           # Workflow 定義
│   ├── knowledge/           # 知識庫檔案
│   ├── mindmaps/            # 心智圖輸出
│   ├── notes/               # 筆記
│   └── distill/             # 蒸餾結果
│
└── docs/
    ├── AI-FEATURES.md       # AI 功能完整清單（context/model/streaming 對照）
    └── PAAW-REFERENCE.md    # ← 本文件
```

---

## 核心架構

### 三層結構

```
使用者
  ↓
前端 (React) — 發 prompt + systemPrompt 到 WebSocket / API
  ↓
後端 (Node.js) — runAgentLoop() 或 callLLMWithRetry()
  ↓
AI Provider — providers.json 決定用哪家 API
```

### Context Engine（最重要的檔案）

**檔案**：`packages/server/src/context-engine.mjs`

**作用**：組裝 AI 的 systemPrompt。所有 AI 功能的 context 都從這裡出。

```
contextEngine.build({ target }) → { systemPrompt, prompt?, provider? }
```

**核心函式**：

| 函式 | 說明 |
|------|------|
| `buildFullSystemContext()` | ★ 共用函式，組裝完整系統 context（identity, user, memory, apps, tools, guardrails 等） |
| `_buildChat()` | Chat 用 = full context + 最近對話摘要 |
| `_buildSkillBuilder()` | Skill Builder 用 = full context + skill-format + builder-rules + test-rules |
| `_buildSkillExec()` | Skill 執行用 = full context + app SYSTEM.md + skill-rules |
| `_buildCrew()` | Crew 用 = full context + skill-rules + crew rolePrompt |
| `_buildWorkflow()` | Workflow 用 = 呼叫 `_buildSkillExec()` |

**Target 對照**：

| target | 用在哪 | 額外帶的 context |
|--------|--------|-----------------|
| `chat` | Chat, Coding IDE, AppBuilder, Mindmap, Notes | 最近對話摘要 |
| `skill-exec` | Skill Exec, Workflow, Cron Skill | app SYSTEM.md + skill-rules |
| `skill-builder` | Skill Builder, ✨ AI 生成 | skill-format + builder-rules + test-rules |
| `crew` | Crew/Employee | crew rolePrompt |

### Agent Loop（AI 執行引擎）

**檔案**：`packages/server/src/lib/paaw-agent-loop.mjs`

| 函式 | 說明 |
|------|------|
| `runAgentLoop(config)` | 一次性執行，回傳完整結果 |
| `runAgentLoopStream(config, res)` | SSE 串流版本（用於 `/api/agent-run/stream`） |

**config 參數**：

```javascript
{
  prompt,          // 使用者訊息
  systemPrompt,    // 系統 context（從 contextEngine 來）
  model,           // 可選，override provider model
  cwd,             // 工作目錄
  maxTurns,        // 最大 tool call 輪數（預設讀 agent-config.json）
  timeout,         // 逾時秒數
  rootDir,         // PAAW_ROOT
  skillMd,         // 可選，SKILL.md 內容
}
```

### Provider 設定

**檔案**：`data/config/providers.json`

```json
{
  "active": "zai",             // 目前用哪家
  "defaultModel": "glm-5.1",   // 預設 model
  "providers": {
    "zai": { "name": "...", "baseURL": "...", "apiKey": "...", "models": [...] },
    "openrouter": { ... }
  }
}
```

**讀取方式**：
- 後端：`loadProviderConfig()` in `context-engine.mjs` 或 inline `readFileSync(providers.json)`
- `resolveLLM(modelOverride)` — 各 route 檔有自己的小版（mindmap, notes, distill）

### Agent 設定

**檔案**：`data/ai-settings/agent-config.json`

```json
{
  "maxTurns": 100,
  "timeoutSeconds": 1800,
  "bashTimeoutSeconds": 300,
  "shellTimeoutMs": 600000
}
```

**讀取**：`loadAgentConfig()` in `routes/context.mjs`（有 mtime cache）

### 使用者偏好

**檔案**：`data/config/user.json`

```json
{
  "name": "阿明",
  "assistantName": "林語晴",
  "preferences": {
    "chat": "glm-5.1",
    "skillBuilder": "glm-5.1",
    "appBuilder": "glm-5.1",
    "coding": "glm-5.1",
    "codingIDE": "glm-5.1",
    "employee_crew-id": "glm-5.1"
  }
}
```

**API**：
- `GET /api/user/preferences` → `{ preferences: {...} }`
- `PUT /api/user/preferences` → `{ key: "chat", value: "glm-5.1" }`

---

## AI Settings 檔案

**位置**：`data/ai-settings/`

這些是 Markdown / JSON 檔案，決定 AI 的行為。可以透過 AI Settings 頁面線上編輯。

```
ai-settings/
├── _base/
│   ├── core-rules.md          # PAAW 核心規則（tool usage, file ops）
│   └── paaw-context.md        # PAAW 路徑 + 環境變數（{{PAAW_ROOT}} 會被替換）
│
├── chat/
│   ├── identity.md            # AI 人設（名字、風格、語氣）
│   ├── tool-rules.md          # Tool 使用規則
│   ├── guardrails.md          # 安全限制
│   ├── system-prompt.md       # 系統行為規範
│   └── reply-rules.md         # 回覆格式規則
│
├── skill-builder/
│   ├── skill-format.md        # SKILL.md 格式規範
│   ├── builder-rules.md       # 建構規則
│   └── test-rules.md          # 測試規則
│
├── crew/
│   └── skill-rules.md         # Skill 執行通用規則
│
├── app-builder/
│   └── app-builder-rules.md   # App 建構規則
│
├── mindmap/
│   └── system-prompt.md       # 心智圖產生規則
│
├── notes/
│   └── system-prompt.md       # 筆記整理規則
│
├── project/
│   ├── identity.md            # 專案管理 AI 人設
│   └── rules.md               # 專案管理規則
│
├── distill/
│   ├── system-prompt.md       # 蒸餾器基礎規則
│   ├── chat.md                # Chat 對話蒸餾 prompt
│   ├── vibe.md                # Coding CLI 蒸餾 prompt
│   ├── cron.md                # Cron 排程蒸餾 prompt
│   └── vibe-coding.md         # Coding IDE 蒸餾 prompt
│
└── agent-config.json          # Agent 迴圈設定
```

**載入方式**：`buildFullSystemContext()` 會讀取這些檔案並組裝成 systemPrompt。

**模板變數**：
- `{{PAAW_ROOT}}` → 替換為絕對路徑
- `{{assistantName}}` → 替換為 user.json 的 assistantName
- `{{nickname}}` → 替換為暱稱

---

## 功能清單 + 檔案對照

### AI 功能（14 個）

| 功能 | 前端 | 後端 route | Context target | 執行方式 |
|------|------|-----------|---------------|---------|
| Chat | `ChatView.tsx` | `ws-handler.mjs` (WS) | `chat` | `runAgentLoop()` |
| Skill Builder | `SkillBuilder.tsx` | `ai-settings.mjs` | `skill-builder` | `runAgentLoop()` |
| ✨ AI 生成 | `SkillBuilder.tsx` | `skills-api.mjs` | `skill-builder` | `callLLMWithRetry()` |
| Skill Exec | — | `workflow.mjs` | `skill-exec` | `runAgentLoop()` |
| Workflow | `WorkflowExec.tsx` | `workflow.mjs` | `skill-exec` | `runAgentLoop()` |
| Cron | `CronJobsPage.tsx` | `cron-jobs.mjs` | `chat` / `skill-exec` | `runAgentLoop()` |
| Crew/Employee | `EmployeeWorkspace.tsx` | `ai-settings.mjs` | `crew` | `runAgentLoop()` |
| Coding IDE | `Coding IDE.tsx` | `ws-handler.mjs` (WS) | `chat` | `runAgentLoop()` |
| Coding IDEIDE | `Coding IDEIDE.tsx` | `cron-jobs.mjs` (SSE) | `chat` | `runAgentLoopStream()` |
| App Builder | `AppBuilder.tsx` | `ws-handler.mjs` (WS) | `chat` | `runAgentLoop()` |
| Mindmap | `MindMapViewer.tsx` | `mindmap.mjs` | `chat` | `callLLMWithRetry()` |
| Notes | `Notes.tsx` | `notes.mjs` | `chat` | `callLLMWithRetry()` |
| Distill | `SettingsPage.tsx` | `distill.mjs` | — | `callLLMWithRetry()` |
| AI Settings | `AISettingsPage.tsx` | `ai-settings.mjs` | — | （管理用，不直接跑 AI） |

### 非 AI 功能

| 功能 | 前端 | 後端 route | 說明 |
|------|------|-----------|------|
| Cron Jobs 管理 | `CronJobsPage.tsx` | `cron-jobs.mjs` | 排程定義 CRUD |
| App Pool | `AppPool.tsx` | `apps.mjs` | App 管理 |
| Skills 瀏覽 | `SkillsPage.tsx` | `skill.mjs` | Skill 列表 |
| Workflow Editor | `WorkflowEditor.tsx` | `workflow.mjs` | Workflow 編輯 |
| Crew Editor | `AICrew.tsx` + `CrewEditor.tsx` | `crew.mjs` | Crew 管理 |
| AI Settings | `AISettingsPage.tsx` | `ai-settings.mjs` | Context 分類 + 檔案管理 |
| Settings | `SettingsPage.tsx` | `ai-settings.mjs` | Provider/Agent/偏好/備份 |
| Knowledge | (Sidebar 樹) | `vibe-fs.mjs` | 知識庫檔案管理 |
| File Explorer | (Sidebar 樹) | `vibe-fs.mjs` | 檔案系統操作 |
| Terminal | `ShellTerminal.tsx` | — | 終端機 |
| Monitoring | `Monitoring.tsx` | — | 系統監控 |
| Backup | `BackupSettings.tsx` | `backup.mjs` | 備份 |
| API Tester | (Settings 內) | `api-tester.mjs` | API 測試工具 |
| Tools 管理 | (Settings 內) | `tools.mjs` | 系統工具 CRUD |
| Projects | `ProjectBoard.tsx` + `ProjectDashboard.tsx` | `projects.mjs` | 專案管理 |

---

## API 端點速查

### Context & Model

| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/context/:target` | 取得完整系統 context（target: chat, skill-builder, crew...） |
| POST | `/api/ai-settings/skill-builder/build` | Skill Builder 專用（帶 skillDef） |
| GET | `/api/user/preferences` | 讀取使用者偏好（model 選擇等） |
| PUT | `/api/user/preferences` | 更新偏好 `{ key, value }` |
| GET | `/api/paaw/providers` | 讀取 provider 設定 |
| PUT | `/api/paaw/providers` | 更新 provider 設定 |
| GET | `/api/ai-settings/agent-config` | 讀取 agent 迴圈設定 |
| PUT | `/api/ai-settings/agent-config` | 更新 agent 迴圈設定 |

### AI 操作

| Method | Path | 說明 |
|--------|------|------|
| WS | `/ws` | Chat / AgentConsole WebSocket |
| POST | `/api/agent-run/stream` | SSE 串流（Coding IDEIDE） |
| POST | `/api/paaw/skill-exec` | Skill / Workflow 執行 |
| POST | `/api/skills/generate` | ✨ AI 生成 SKILL.md |
| POST | `/api/ai-settings/skill-builder/build` | Skill Builder build |
| POST | `/api/mindmap/generate` | 心智圖產生 |
| POST | `/api/notes/ai-write` | AI 筆記 |
| POST | `/api/distill/run` | 蒸餾全部 |
| POST | `/api/distill/run/:source` | 蒸餾指定來源 |

### 檔案操作

| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/paaw-root` | 取得 PAAW_ROOT 路徑 |
| GET | `/api/paaw/file-read` | 讀取檔案 |
| POST | `/api/paaw/file-write` | 寫入檔案 |
| GET | `/api/vibe-fs/list` | 列目錄 |
| POST | `/api/vibe-fs/create` | 建檔案/目錄 |
| DELETE | `/api/vibe-fs/delete` | 刪除 |
| PUT | `/api/vibe-fs/rename` | 改名 |

### Skill / App / Crew / Workflow

| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/skills` | Skill 列表 |
| GET | `/api/skills/:id` | Skill 詳情 |
| GET | `/api/skill-builder/build-files` | Build files 列表 |
| GET | `/api/apps` | App 列表 |
| GET | `/api/crews` | Crew 列表 |
| GET | `/api/workflows` | Workflow 列表 |

---

## 前端架構

### Tab 系統

`App.tsx` 管理 tabs，格式：`{scope}:{type}#{count}`

| type | 頁面 |
|------|------|
| `chat` | ChatView |
| `skillbuilder` | SkillBuilder |
| `appbuilder` | AppBuilder |
| `vibecoding` | Coding IDE |
| `crew` | EmployeeWorkspace |
| `workflow` | WorkflowExec |
| `mindmap` | MindMapViewer |
| `notes` | Notes |
| `settings` | SettingsPage |
| `aisettings` | AISettingsPage |
| 其他 | Factory 相關頁面 |

### AgentConsole

**元件**：`packages/ui/src/components/AgentConsole.tsx`

所有 WebSocket AI 對話都靠這個元件。它：
1. 建立 WebSocket 連線
2. 把 `systemPrompt` + `model` 傳給後端
3. 顯示 streaming 回覆 + tool call 事件

**使用 AgentConsole 的頁面**：ChatView, SkillBuilder, EmployeeWorkspace, Coding IDE, AppBuilder

### ModelSelector

**元件**：`packages/ui/src/components/ModelSelector.tsx`

```tsx
<ModelSelector feature="chat" value={model} onChange={setModel} />
```

- `feature` — preference key（chat, skillBuilder, appBuilder, coding, codingIDE, employee_{id}）
- 啟動時 `GET /api/user/preferences` 讀取初始值
- `onChange` 時自動 `PUT /api/user/preferences` 儲存
- 列出 `providers.json` 中所有 provider 的所有 model

---

## 如何改程式

### 加新的 AI 功能

1. **建 route**：在 `packages/server/src/routes/` 新增 `.mjs` 檔
2. **接 context**：`import { contextEngine } from "../context-engine.mjs"` → `contextEngine.build({ target: "chat" })`
3. **call AI**：用 `runAgentLoop()`（要 tool）或 `callLLMWithRetry()`（純對話）
4. **建前端頁面**：在 `packages/ui/src/pages/` 新增 `.tsx`
5. **加路由**：在 `App.tsx` 加 tab type + render 邏輯
6. **加 sidebar**：在 `App.tsx` 的 sidebar 加 NavItem
7. **加 ModelSelector**：`<ModelSelector feature="yourFeature" ... />`

### 改 AI 行為

- **改人設** → 編輯 `data/ai-settings/chat/identity.md`
- **改 tool 規則** → 編輯 `data/ai-settings/chat/tool-rules.md`
- **改安全限制** → 編輯 `data/ai-settings/chat/guardrails.md`
- **改回覆風格** → 編輯 `data/ai-settings/chat/reply-rules.md`
- **改 Skill 建構規則** → 編輯 `data/ai-settings/skill-builder/builder-rules.md`

### 換 AI Provider

- **前端**：Settings → 供應商 → 新增/編輯 provider
- **後端**：編輯 `data/config/providers.json`
- **API**：`PUT /api/paaw/providers`

### 加新 Tool（讓 AI 可呼叫）

- **前端**：Settings → Tools → 新增
- **後端**：`tools.mjs` → API Tools 會自動被 `buildFullSystemContext()` 注入到 systemPrompt

### 加新 Skill

- **前端**：Skill Builder → 填表 → Build
- **檔案產出**：`data/skills/building/{slug}/skill-source.md` + `data/skills/building/{slug}/package/SKILL.md`
- **執行**：`POST /api/paaw/skill-exec` with `{ skillId, input }`

---

## 常見陷阱

1. **`.mjs` 是純 JavaScript** — 不能用 TypeScript 語法（`: any`, `as`, `interface`）
2. **tools.mjs 路由順序** — 特定路由（`/skills`, `/skills/:id`）必須在 `/:id` 之前，否則雙重回應
3. **改完碼要 commit + push** — 不 push 別人 pull 到舊碼
4. **`resolveLLM()` 各檔有小版** — mindmap, notes, distill 各自實作，改 provider 邏輯要全部改
5. **`buildFullSystemContext()` 是共用基底** — 改這個 = 影響所有 14 個 AI 功能
6. **providers.json 有 API key** — 不要 commit 到 public repo
7. **user.json 的 `preferences` key** — feature name 要跟 ModelSelector 的 `feature` prop 一致
8. **App.tsx tab type** — 改名要同時改：sidebar NavItem, renderPage switch, getPageTitle switch
