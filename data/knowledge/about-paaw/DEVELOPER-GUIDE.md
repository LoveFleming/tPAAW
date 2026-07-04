# PAAW Developer Onboarding

> 這份文件讓任何 AI 或人類開發者能在 30 分鐘內理解 PAAW 全貌，接手開發。
>
> 最後更新：2026-07-01

---

## PAAW 是什麼？

**PAAW = Personal AI Assistant Workspace**

> Build your personal AI workforce — 人用 AI 自己做工具 → AI 幫你記資料 → AI 放大你記的資料

核心概念：
1. **Skill** 是最小能力單元（有固定 Markdown 格式）
2. **App** 是資料驅動或 Skill-based 的應用
3. **Crew** 是 AI 員工（綁定 Skill + 角色）
4. **所有 AI 功能共用同一套 Context Engine** — prompts 從 `data/ai-settings/` 讀取
5. **聊天視窗 + App 視窗** 雙入口，每個 App 自動成為 Chat Tool

---

## 技術棧

| 層 | 技術 |
|----|------|
| **Frontend** | React 19 + TypeScript + Vite |
| **Backend** | Node.js（純 `.mjs`，不用 TypeScript） |
| **Database** | JSON + Markdown files（`data/` 目錄），少量 SQLite |
| **AI** | OpenAI-compatible API（ providers.json 可切換多家） |
| **通訊** | WebSocket（即時串流）、SSE（單向串流）、REST |
| **部署** | Docker + docker-compose（含 Bridge 守護進程） |

⚠️ **關鍵原則**：
- **Server 端只寫 `.mjs`**（純 JavaScript），**不能** 用 TypeScript 語法
- **Frontend 用 `.tsx`**（TypeScript + React）
- **資料全是檔案**（JSON/Markdown），不是 DB-driven

---

## 30 秒啟動

```bash
# 1. Clone
git clone https://github.com/LoveFleming/tAgent.git
cd tAgent
git checkout dev

# 2. Install
npm install

# 3. 開發模式（同時跑 UI + API）
npm run dev
# → UI: http://localhost:5173 (Vite dev server)
# → API: http://localhost:4097

# 4. Production 模式
npm run build            # 建構 UI 到 packages/ui/dist/
npm run dev:server       # 只跑 server，會 serve UI dist
# → http://localhost:4097 (API + UI 同一個 port)
```

### 環境變數

| 變數 | 預設 | 用途 |
|------|------|------|
| `PAAW_PORT` | `4097` | API + 靜態 UI port |
| `PAAW_WS_PORT` | `4098` | WebSocket (PTY + AgentConsole) port |
| `PAAW_ROOT` | 自動偵測 | 資料根目錄 |
| `NODE_ENV` | `development` | `production` 時 server serve UI dist |
| `BRIDGE_TOKEN` | — | Docker Bridge 認證 |

Vite 前端的 API URL 由 `vite.config.ts` 的 `define` 注入，不依賴 `.env` 檔。

---

## Repo 結構（只看重要的）

```
tAgent/
├── packages/
│   ├── ui/                      # ← 前端（你在這裡寫 .tsx）
│   │   ├── src/
│   │   │   ├── App.tsx          # ★ Tab 路由 + Sidebar（所有頁面入口）
│   │   │   ├── api.ts           # ★ API_BASE（讀 env var）
│   │   │   ├── pages/           # 每個功能一個 .tsx（34 個頁面）
│   │   │   ├── components/      # 共用元件（AgentConsole, ModelSelector...）
│   │   │   ├── types/index.ts   # 共用型別 + buildSystemPrompt()
│   │   │   └── i18n/            # 多語系
│   │   └── vite.config.ts       # ★ Vite 設定（env 注入、proxy）
│   │
│   ├── server/                  # ← 後端（你在這裡寫 .mjs）
│   │   ├── src/
│   │   │   ├── paaw-server.mjs  # ★ Server 入口（載入所有 route + static UI）
│   │   │   ├── context-engine.mjs  # ★ Prompt 統一組裝器（最重要！）
│   │   │   ├── websocket/ws-handler.mjs  # WebSocket handler
│   │   │   ├── lib/paaw-agent-loop.mjs   # ★ AI 執行迴圈
│   │   │   ├── routes/          # API 路由（21 個 .mjs 檔）
│   │   │   ├── tools/index.mjs  # Tool 注入到 systemPrompt
│   │   │   ├── scheduler/cron-jobs.mjs  # 排程引擎
│   │   │   └── lib/security/    # Security Kernel（rate limit, audit, secret）
│   │   └── package.json
│   │
│   ├── db/                      # SQLite ORM (Drizzle) — 目前很少用
│   ├── engine/                  # 執行引擎（舊，部分 deprecated）
│   ├── context/                 # Context 管理（舊）
│   └── shared/                  # 共用型別
│
├── data/                        # ★ 所有資料（不是 DB，是檔案！）
│   ├── ai-settings/             # ★ AI 提示詞（改行為改這裡，不動 code）
│   ├── apps/                    # App 資料
│   ├── chats/                   # 聊天紀錄
│   ├── config/
│   │   ├── providers.json       # ★ AI Provider（API key, model）
│   │   └── user.json            # 使用者 + preferences
│   ├── crews/                   # Crew 定義
│   ├── cron/                    # Cron Job 定義
│   ├── skills/                  # Skill 檔案
│   ├── projects/                # 專案資料
│   ├── notes/                   # 筆記
│   └── mindmaps/                # 心智圖
│
├── docs/                        # ← 你在看這裡
│   ├── DEVELOPER-GUIDE.md       # ← 本文件
│   ├── AI-FEATURES.md           # 15 個 AI 功能完整清單
│   ├── PAAW-REFERENCE.md        # 技術參考（架構、API、如何改碼）
│   ├── PROMPT-ARCHITECTURE.md   # 提示詞組裝全圖
│   └── UI-API-MAPPING.md        # UI 頁面 × API 端點對照
│
├── Dockerfile                   # Production Docker image
├── docker-compose.yml           # PAAW + Bridge 架構
└── package.json                 # Workspace root
```

---

## 核心架構（必讀）

### 1. Context Engine — Prompt 的心臟

**檔案**：`packages/server/src/context-engine.mjs`

所有 AI 功能的 systemPrompt 都從這裡組裝：

```
contextEngine.build({ target }) → { systemPrompt, provider }
```

**分層組裝**：

```
Layer 0: buildFullSystemContext()  ← 所有 AI 共用底層
  _base/paaw-context.md      — PAAW 路徑、結構
  _base/core-rules.md        — 行為準則
  chat/identity.md           — AI 人設
  使用者資訊 + MEMORY.md
  Apps 清單 + Tool 規則
  project/identity + rules   — 專案規則
  guardrails + reply-rules   — 安全 + 格式

Layer 1: buildDynamicContext()  ← 動態資料
  Recent files, git status, etc.

Layer 2: 各 target 專用 rules  ← 功能層
  chat → 最近對話摘要
  skill-builder → skill-format + builder-rules + test-rules
  mindmap → mindmap/system-prompt.md
  notes → notes/system-prompt.md
  project → project/identity.md + project/rules.md
```

**7 個 target**：

| target | method | 用在哪 |
|--------|--------|--------|
| `chat` | `_buildChat()` | Chat, Coding IDE, App Builder |
| `skill-exec` | `_buildSkillExec()` | Skill Exec, Workflow, Cron Skill |
| `skill-builder` | `_buildSkillBuilder()` | Skill Builder, ✨ AI 生成 |
| `crew` | `_buildCrew()` | Crew/Employee |
| `mindmap` | `_buildMindmap()` | Mind Map |
| `notes` | `_buildNotes()` | Notes |
| `project` | `_buildProject()` | Project AI 助理 |

### 2. Agent Loop — AI 執行引擎

**檔案**：`packages/server/src/lib/paaw-agent-loop.mjs`

```javascript
// 一次性（Skill Exec, Workflow, Mindmap, Notes）
const result = await runAgentLoop({
  prompt, systemPrompt, model, cwd,
  maxTurns, timeout, rootDir, skillMd
});

// 串流版（Coding IDE）
runAgentLoopStream(config, res);  // SSE
```

### 3. AgentConsole — 前端 WebSocket 元件

**檔案**：`packages/ui/src/components/AgentConsole.tsx`

所有需要 AI 串流的頁面都用這個元件：
- 建立 WebSocket 連線
- 傳 systemPrompt + model
- 顯示 streaming 回覆 + tool call 事件

**使用 AgentConsole 的頁面**：Chat, SkillBuilder, EmployeeWorkspace, Coding IDE, AppBuilder

### 4. Model Selector — 三種實作方式

| 類型 | 適用 | 行為 |
|------|------|------|
| **ModelSelector 元件** | Chat, SkillBuilder, Crew, Coding IDE, App Builder | 存 `user.json.preferences.{feature}`，跨 session 持久化 |
| **Inline dropdown** | Mindmap, Notes, Project AI | 存 component state，每次開頁面預設 global defaultModel |
| **API body model** | Workflow, Skill Exec, Cron, Distill | API 參數，不存偏好 |

---

## 如何改碼（常見場景）

### 改 AI 行為（不改 code！）

直接改 `data/ai-settings/` 下對應的 Markdown：

| 想改什麼 | 改哪個檔 |
|---------|---------|
| AI 人設/語氣 | `chat/identity.md` |
| Tool 使用規則 | `chat/tool-rules.md` |
| 安全限制 | `chat/guardrails.md` |
| 回覆格式 | `chat/reply-rules.md` |
| Skill 建構規則 | `skill-builder/builder-rules.md` |
| 心智圖行為 | `mindmap/system-prompt.md` |
| 筆記行為 | `notes/system-prompt.md` |
| 專案助理行為 | `project/identity.md` + `project/rules.md` |

### 加新 AI 功能

1. **建 route**：`packages/server/src/routes/your-feature.mjs`
2. **接 context**：`import { contextEngine } from "../context-engine.mjs"` → `contextEngine.build({ target: "your-feature" })`
3. **加 target**：在 `context-engine.mjs` 加 `_buildYourFeature()`，在 `ai-settings.mjs` targetMap 加入口
4. **call AI**：`runAgentLoop()`（要 tool）或 `callLLMWithRetry()`（純對話）
5. **建前端頁面**：`packages/ui/src/pages/YourFeature.tsx`
6. **加路由**：在 `App.tsx` 加 tab type + render 邏輯 + sidebar NavItem
7. **加 model selector**：inline dropdown 或 `<ModelSelector feature="yourFeature" />`

### 換 AI Provider

- **前端**：Settings → 供應商 → 新增/編輯
- **後端**：改 `data/config/providers.json`
- **API**：`PUT /api/paaw/providers`

### 加新 Tool（讓 AI 可呼叫）

- **前端**：Settings → Tools → 新增
- **後端**：`tools.mjs` → API Tools 自動注入 systemPrompt

### 加新 Skill

- **前端**：Skill Builder → 填表 → Build
- **產出**：`data/skills/building/{slug}/skill-source.md`（UI 編輯格式 `@@@section@@@`）+ `package/SKILL.md`（執行格式 Markdown）

---

## 開發規則（踩過的坑）

### ⚠️ 必讀

1. **`.mjs` 不能用 TypeScript 語法** — `: any`, `as`, `interface` 全部不行
2. **改完碼一定要 commit + push** — 不 push 別人 pull 到舊碼 = bug 還在
3. **tools.mjs 路由順序** — 特定路由（`/skills`, `/skills/:id`）必須在 `/:id` 之前
4. **`resolveLLM()` 各檔有小版** — mindmap, notes, distill 各自實作，改 provider 邏輯要全部改
5. **`buildFullSystemContext()` 是共用基底** — 改這個 = 影響所有 15 個 AI 功能
6. **providers.json 有 API key** — 不要 commit 到 public repo
7. **App.tsx tab type** — 改名要同時改：sidebar NavItem, renderPage switch, getPageTitle switch
8. **Skill Builder 雙格式** — `skill-source.md` 用 `@@@section@@@`（UI 編輯用），`package/SKILL.md` 用標準 Markdown（執行用）
9. **前端 port 讀 env var** — 不要 hardcode `4097`，用 `import.meta.env.VITE_PAAW_PORT`
10. **CORS 全開** — 目前 `Access-Control-Allow-Origin: *`，production 前要改

### Coding 規則

- ❌ `const reqBody = body || (await _readBody(req));` — `body` 不存在就炸
- ✅ `const reqBody = await _readBody(req);` — 直接賦值
- 任何 `||` fallback 的左側變數，必須在同 scope 已經宣告/賦值過

---

## 相關文件

看完本文件後，依需要讀：

| 文件 | 看完知道 |
|------|---------|
| `AI-FEATURES.md` | 15 個 AI 功能的 context/model/streaming 完整對照 |
| `PAAW-REFERENCE.md` | 架構細節、API 速查、如何加新功能 |
| `PROMPT-ARCHITECTURE.md` | 每個 AI 功能的 prompt 實際組裝結構 |
| `UI-API-MAPPING.md` | 每個 UI 頁面對應哪些 API 端點 |

---

## Git 工作流

```
main → 穩定版（很少直接 push）
  └── dev → 日常開發（主要 branch）
```

- **所有開發推 `dev`**
- Commit message 格式：`feat:` / `fix:` / `docs:` / `refactor:` / `chore:`
- 不開 PR，直接 push 到 `dev`
