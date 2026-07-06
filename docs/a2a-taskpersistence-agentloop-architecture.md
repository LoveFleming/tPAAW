# PAAW HelpDesk — A2A × Task Persistence × Agent Loop 架構文件

> **Version:** 2.0.0  
> **Last Updated:** 2026-07-06  
> **Scope:** PAAW Server (`packages/server/src/`)  
> **Changelog:** v2 — 全部 LLM 呼叫已遷移至 Vercel AI SDK (`ai` + `@ai-sdk/openai`)

---

## 📐 三層架構總覽

```
┌─────────────────────────────────────────────────────────────┐
│                     Agent Orchestrator                       │
│                   (外部客戶端 / A2A Client)                   │
│              POST /a2a/jsonrpc → message/send                │
└──────────────────────────┬──────────────────────────────────┘
                           │ JSON-RPC 2.0 over HTTP
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                        A2A Layer                             │
│                   (routes/a2a.mjs)                           │
│                                                              │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐ │
│  │ Agent Card  │  │ JSON-RPC     │  │ SSE Streaming      │ │
│  │ Discovery   │  │ Endpoint     │  │ (message/stream)   │ │
│  └─────────────┘  └──────┬───────┘  └────────────────────┘ │
│                          │                                   │
│    ┌─────────────────────┼─────────────────────────┐       │
│    │ message/send        │ message/stream          │       │
│    │ ├─ SYNC: 等待回傳    │ ├─ SSE 串流即時回傳      │       │
│    │ └─ ASYNC: webhook    │ └─ 逐 token 推送        │       │
│    └──────────┬──────────┴─────────────────────────┘       │
│               │                                              │
│         syncTicketFromTask()  ←→  HelpDesk Tickets           │
└───────────────┼──────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────┐
│                  Agent Loop Layer                            │
│             (lib/paaw-agent-loop.mjs)                        │
│  (a2a.mjs 內也有一組精簡版 runHelpDeskViaA2A)                  │
│                                                              │
│   ┌───────────────────────────────────────────────┐         │
│   │     Vercel AI SDK generateText/streamText      │         │
│   │     (取代舊的 ToolEngine + raw fetch)           │         │
│   │                                               │         │
│   │  1. 組裝 system prompt (SKILL.md + Knowledge)  │         │
│   │  2. generateText({ model, tools, maxSteps })  │         │
│   │  3. AI SDK 自動管理 tool-calling loop          │         │
│   │  4. onStepFinish 回報 tool 執行進度            │         │
│   │  5. result.text → 最終答案                     │         │
│   │                                               │         │
│   │  Tools: read_file, write_file, grep,          │         │
│   │         git, bash, ask_user, diff...          │         │
│   │  (via buildAISdkTools → aiTool + jsonSchema)  │         │
│   └───────────────────────┬───────────────────────┘         │
│                           │                                  │
│   ┌───────────────────────┴───────────────────────┐         │
│   │            AI SDK OpenAI Provider              │         │
│   │  createOpenAI({ baseURL, apiKey, headers })   │         │
│   │  Compatible: zai (GLM) / openrouter (Kimi/DS) │         │
│   │  Built-in retry + structured output           │         │
│   └───────────────────────────────────────────────┘         │
└───────────────┬──────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────┐
│               Task Persistence Layer                         │
│           (lib/task-persistence.mjs)                         │
│                                                              │
│   JsonTaskPersistence (file-based JSON store)                │
│   ┌─────────────────────────────────────────────┐           │
│   │  data/a2a-tasks/{taskId}.json               │           │
│   │  ├── id, contextId                          │           │
│   │  ├── status { state, timestamp }            │           │
│   │  ├── message (original user message)        │           │
│   │  ├── history [] (conversation messages)     │           │
│   │  ├── artifacts [] (produced responses)      │           │
│   │  ├── metadata { toolsUsed, model, ... }     │           │
│   │  ├── events [] (tool calls, lifecycle)      │           │
│   │  ├── memory [] (accumulated fragments)      │           │
│   │  ├── tokenUsage { prompt, completion }      │           │
│   │  ├── checkpoints [] (snapshots for rollback)│           │
│   │  └── trace [] (detailed execution trace)    │           │
│   └─────────────────────────────────────────────┘           │
│                                                              │
│   Methods:                                                   │
│   save / load / delete / list / findByContext                │
│   updateStatus / appendArtifact / appendEvent                │
│   appendMemory / saveTokens / saveCheckpoint / saveTrace     │
└─────────────────────────────────────────────────────────────┘
```

---

## 1. A2A Layer (`routes/a2a.mjs`)

### 職責
A2A (Agent-to-Agent) Protocol 是 PAAW 對外的標準介面，實作 **JSON-RPC 2.0** 規範，讓其他 Agent（如 Agent Orchestrator）可以透過統一協議對話。

### 端點

| 端點 | 方法 | 說明 |
|------|------|------|
| `/.well-known/agent.json` | GET | Agent Card 發現（能力宣告） |
| `/a2a` | POST | JSON-RPC 主要端點 |
| `/api/a2a/tasks` | GET | PAAW UI 用 — 列出所有任務 |
| `/api/a2a/agent-card` | GET | PAAW UI 用 — 取得 Agent Card |

### 支援的 JSON-RPC Methods

| Method | 說明 | 回傳模式 |
|--------|------|----------|
| `message/send` | 發送訊息，取回結果 | SYNC（同步等待）或 ASYNC（webhook） |
| `message/stream` | 發送訊息，SSE 串流回傳 | SSE（即時串流） |
| `tasks/get` | 查詢任務狀態 | 同步 |
| `tasks/list` | 列出任務 | 同步 |
| `tasks/cancel` | 取消任務 | 同步 |

### 兩種執行模式

#### SYNC 模式（預設）
```
Client → POST /a2a { method: "message/send" }
  ↓
A2A 建立任務 → status: "working"
  ↓
呼叫 Agent Loop (runHelpDeskViaA2A)
  ↓
任務完成 → status: "completed"
  ↓
Client ← JSON-RPC response (含完整 task)
```

#### ASYNC 模式（webhook）
```
Client → POST /a2a { method: "message/send", configuration: { pushNotification: { url } } }
  ↓
A2A 建立任務 → 立即回傳 status: "working"
  ↓ (背景執行)
Agent Loop 執行中 → webhook 通知 status: "working" (thinking / tool execution)
  ↓
任務完成 → webhook 通知 status: "completed" (含最終結果)
```

### Agent Card
```json
{
  "protocolVersion": "0.3.0",
  "name": "PAAW Agent",
  "capabilities": {
    "streaming": true,
    "pushNotifications": true,
    "stateTransition": true
  },
  "skills": [{
    "id": "paaw-helpdesk",
    "name": "PAAW HelpDesk"
  }]
}
```

### A2A → HelpDesk Ticket Bridge
每次 A2A 任務完成後，`syncTicketFromTask()` 會：
1. 檢查是否已有對應 ticket（用 `a2a:{taskId}` tag 比對）
2. 沒有就建立新 ticket
3. 同步所有對話歷史
4. 同步任務狀態（completed → answered, input-required → input-required）

---

## 2. Agent Loop Layer (`lib/paaw-agent-loop.mjs` + a2a.mjs 內联)

### 職責
Agent Loop 是 PAAW 的 AI 推理引擎，負責：
- 組裝 system prompt（SKILL.md + Knowledge Base + Memory）
- 透過 Vercel AI SDK 的 `generateText` 管理 function calling 迴圈
- 執行工具並把結果自動餵回 LLM（AI SDK 內建）
- 控制最大步數（maxSteps）、安全策略

### Vercel AI SDK 整合（v2.0.0 更新）

所有 LLM 呼叫已從 raw `fetch` + 手動 ToolEngine 遷移至 **Vercel AI SDK**：

| 項目 | 舊（v1） | 新（v2） |
|------|----------|----------|
| LLM 呼叫 | `callLLMWithRetry(apiUrl, headers, body)` | `generateText({ model, system, messages, tools })` |
| Tool loop | 手動 `for` + parse response + execute tools | AI SDK `maxSteps` 自動管理 |
| Provider | 手動組 `baseURL + headers + apiKey` | `createOpenAI({ baseURL, apiKey, headers })` |
| Streaming | `fetchStreamWithRetry` + 手動 SSE | `streamText()` + `textStream` |
| Tool 定義 | `PAAW_TOOLS` array + `executeTool` switch | `aiTool({ parameters: jsonSchema() })` |
| 共用 helper | `llm-utils.mjs` | `ai-sdk-helpers.mjs` (`paawGenerate()`) |

### 兩種實作

| 實作 | 位置 | 用途 |
|------|------|------|
| **完整版** | `lib/paaw-agent-loop.mjs` | Agent Builder（coding tasks），有完整工具集 |
| **精簡版** | `a2a.mjs: runHelpDeskViaA2A()` | A2A HelpDesk，用 AI SDK generateText + 快取 |

### AI SDK Tool-Calling Flow

```
1. Build system prompt (SKILL.md + Knowledge + Memory)
          |
          v
2. generateText({
     model: openai(modelName),
     system: systemPrompt,
     messages: [...],
     tools: aiSdkTools,
     maxSteps: 6,
     onStepFinish: callback
   })
   -> AI SDK manages entire tool-calling loop internally
          |
          v
   AI SDK auto:
   - Call LLM API
   - Got tool_calls -> auto execute
   - Feed results back to LLM
   - Repeat until text response or maxSteps
   - onStepFinish reports per-step progress
          |
          v
3. result.text -> final answer
   result.steps -> execution history
   result.usage -> token stats
```

┌──────────────────────────────────────────┐
│  1. 組裝 system prompt                    │
│     SKILL.md + Knowledge Base + Memory    │
└────────────────┬─────────────────────────┘
                 ▼
┌──────────────────────────────────────────┐
│  2. 呼叫 LLM API (function calling)      │
│     POST /chat/completions               │
│     tools: [read_file, grep, git, ...]   │
└────────────────┬─────────────────────────┘
                 ▼
           LLM 回應是什麼？
          /              \
     tool_calls           純文字
         │                  │
         ▼                  ▼
┌─────────────────┐   ┌──────────────┐
│ 3. 執行工具      │   │ 5. 完成！     │
│ 產生結果字串     │   │ 回傳最終答案  │
└────────┬────────┘   └──────────────┘
         │
         ▼
┌──────────────────────────────────────────┐
│ 4. 工具結果作為 tool message 餵回 LLM    │
│    回到步驟 2                            │
└──────────────────────────────────────────┘
```

### 內建工具集

| 類別 | 工具 | 說明 |
|------|------|------|
| **檔案** | `read_file` | 讀取檔案（支援 offset/limit） |
| | `write_file` | 寫入檔案（自動建目錄） |
| | `edit_file` | 精確替換（old_text → new_text） |
| **搜尋** | `glob` | 檔案模式匹配 |
| | `grep` | 內容搜尋（ripgrep） |
| **Git** | `diff` | 差異比較 |
| | `git` | Git 命令 |
| **Shell** | `bash` | Shell 命令執行 |
| **互動** | `ask_user` | 向使用者提問 |
| **記錄** | `record_decision` | ADR 記錄 |
| | `update_changelog` | 變更日誌 |
| | `update_docs` | 文件更新 |

### 安全策略
- **路徑限制**：讀取限 rootDir + workspace dirs；寫入限 workspace dirs
- **自動快照**：修改前自動建立 pre-edit snapshot
- **超時控制**：可設定 maxTurns（預設 20）和 timeout（預設 120s）
- **審計日誌**：所有工具呼叫記錄到 task events

### Fallback 機制
當 Agent Loop 跑完 maxToolRounds 但產出文字太短（<100字），會強制再呼叫一次 LLM 直接生成摘要答案，確保使用者一定拿到回應。

---

## 3. Task Persistence Layer (`lib/task-persistence.mjs`)

### 職責
提供任務的持久化儲存，讓 A2A 任務在伺服器重啟後仍可查詢、恢復。

### 目前實作：JsonTaskPersistence
- **儲存方式**：JSON 檔案，一個 task 一個檔案
- **儲存位置**：`data/a2a-tasks/{taskId}.json`
- **檔案名**：經過 sanitize（只允許 `[a-zA-Z0-9_-]`）

### Task 資料結構

```typescript
interface TaskRecord {
  id: string;                          // 唯一 ID
  contextId: string;                   // 對話脈絡 ID（多輪對話用）
  
  status: {
    state: 'submitted' | 'working' | 'input-required' 
         | 'completed' | 'canceled' | 'failed';
    timestamp: string;                 // ISO 8601
    message?: string;                  // 狀態附加訊息
  };
  
  message: object;                     // 原始使用者訊息
  history: Message[];                  // 完整對話歷史
  artifacts: Artifact[];               // 產出的回應
  
  metadata: {
    toolsUsed: string[];               // 使用過的工具
    model: string;                     // 使用的模型
    liveState?: string;                // 即時狀態
    needsInfo?: boolean;               // 是否需要更多資訊
    error?: string;
  };
  
  // ── 擴充欄位（Agent Loop 期間累積）──
  events?: Event[];                    // 工具呼叫、生命週期事件
  memory?: MemoryFragment[];           // 記憶片段
  tokenUsage?: { prompt, completion, total };
  checkpoints?: Checkpoint[];          // 快照（用於 rollback）
  trace?: TraceEntry[];                // 詳細執行追蹤
  
  createdAt: string;
  updatedAt: string;
}
```

### API 介面

| 方法 | 說明 |
|------|------|
| `save(task)` | 建立或更新完整 task |
| `load(taskId)` | 載入單一 task |
| `delete(taskId)` | 刪除 task |
| `list(filter?)` | 列出所有 tasks（可篩選 contextId / state） |
| `findByContext(contextId)` | 用 contextId 找最新 task |
| `updateStatus(taskId, status)` | 更新狀態 |
| `appendArtifact(taskId, artifact)` | 附加產出 |
| `appendEvent(taskId, event)` | 附加事件（工具呼叫等） |
| `appendMemory(taskId, memory)` | 附加記憶片段 |
| `saveTokens(taskId, usage)` | 累加 token 用量 |
| `saveCheckpoint(taskId, data)` | 儲存檢查點 |
| `saveTrace(taskId, trace)` | 儲存追蹤記錄 |

### 設計考量

**為什麼用 JSON 檔案而不是 SQLite？**
- A2A 任務數量不大（每日 < 100）
- JSON 檔案可讀性高，方便 debug
- 無 schema migration 需求
- 未來可無痛換成 DB-backed adapter（介面已抽象）

**Adapter Pattern**
```javascript
// 目前：
const taskStore = new JsonTaskPersistence(TASKS_DIR);

// 未來可換成：
const taskStore = new SqliteTaskPersistence(DB_PATH);
// 或
const taskStore = new RedisTaskPersistence(REDIS_URL);
```

只要實作相同介面，A2A Layer 和 Agent Loop 不需改動。

---

## 🔄 三層互動流程（完整時序）

### 場景：Agent Orchestrator 發問題到 PAAW HelpDesk

```
Orchestrator          A2A Layer           Agent Loop          Task Store
     │                    │                    │                    │
     │ message/send       │                    │                    │
     │───────────────────>│                    │                    │
     │                    │ makeTask()         │                    │
     │                    │ save(task)────────────────────────────>│
     │                    │ status: "working"  │                    │
     │                    │                    │                    │
     │                    │ runHelpDeskViaA2A()│                    │
     │                    │───────────────────>│                    │
     │                    │                    │ 組裝 prompt         │
     │                    │                    │ call LLM API      │
     │                    │                    │ LLM: tool_calls   │
     │                    │                    │ execute tools     │
     │                    │ onProgress ────────│                    │
     │                    │ appendEvent ──────────────────────────>│
     │                    │                    │ 餵回結果 → LLM     │
     │                    │                    │ LLM: 純文字        │
     │                    │<───────────────────│                    │
     │                    │                    │                    │
     │                    │ status: "completed"│                    │
     │                    │ push history       │                    │
     │                    │ save(task)────────────────────────────>│
     │                    │ syncTicketFromTask()                    │
     │                    │                    │                    │
     │<───────────────────│ result (Task)      │                    │
     │                    │                    │                    │
```

### 場景：Webhook 非同步模式

```
Orchestrator          A2A Layer           Agent Loop          Webhook
     │                    │                    │                    │
     │ message/send       │                    │                    │
     │ + pushNotification │                    │                    │
     │───────────────────>│                    │                    │
     │<───────────────────│ status: "working"  │                    │
     │                    │                    │                    │
     │               (背景執行)                 │                    │
     │                    │───────────────────>│                    │
     │                    │                    │ thinking...        │
     │                    │<───────────────────│                    │
     │                    │ webhook: "thinking"│───────────────────>│
     │                    │                    │                    │
     │                    │                    │ tool: read_file    │
     │                    │<───────────────────│                    │
     │                    │ webhook: "tool"    │───────────────────>│
     │                    │                    │                    │
     │                    │                    │ final answer       │
     │                    │<───────────────────│                    │
     │                    │ webhook: "done"    │───────────────────>│
     │                    │                    │                    │
```

---

## 📁 檔案位置

```
packages/server/src/
├── routes/
│   ├── a2a.mjs              ← A2A Layer（JSON-RPC 端點 + Agent Card）
│   └── helpdesk.mjs         ← HelpDesk REST API（PAAW UI 用）
├── lib/
│   ├── task-persistence.mjs ← Task Persistence Layer
│   ├── paaw-agent-loop.mjs  ← 完整版 Agent Loop（coding tasks）
│   ├── llm-utils.mjs        ← LLM 呼叫工具（retry, stream, sanitize）
│   ├── paaw-project.mjs     ← Agent 工作目錄管理
│   └── paaw-snapshot.mjs    ← 修改前自動快照
└── tools/
    └── index.mjs            ← ToolEngine 工具定義 + handler
├── ai-sdk-helpers.mjs       ← 共用 AI SDK helper (paawGenerate, createAIModel)

data/
├── a2a-tasks/               ← Task JSON 檔案
│   ├── task-xxx.json
│   └── task-yyy.json
├── config/
│   └── providers.json       ← LLM Provider 設定
├── helpdesk/
│   ├── tickets.json         ← HelpDesk 工單
│   └── KNOWLEDGE.md         ← 知識庫
└── skills/
    └── physical-skill/
        └── help-desk/
            └── SKILL.md     ← HelpDesk Skill 定義
```

---

## 📦 已遷移至 Vercel AI SDK 的模組（v2.0.0）

| 模組 | 檔案 | 舊方式 | 新方式 |
|------|------|--------|--------|
| **HelpDesk** | `routes/helpdesk.mjs` | `ToolEngine.run()` | `generateText({ tools, maxSteps })` |
| **A2A HelpDesk** | `routes/a2a.mjs:runHelpDeskViaA2A` | `ToolEngine.run()` | `generateText({ tools, maxSteps })` |
| **A2A Agent Loop** | `routes/a2a.mjs:runAgentLoop` | `ToolEngine.run()` | `generateText({ tools })` |
| **Chat SSE** | `routes/chat.mjs` | `ToolEngine.run()` + 手動 SSE | `streamText()` + `textStream` |
| **Agent Loop** | `lib/paaw-agent-loop.mjs:runAgentLoop` | `callLLMWithRetry` + 手動 loop | `generateText({ tools, maxSteps })` |
| **Agent Loop Stream** | `lib/paaw-agent-loop.mjs:runAgentLoopStream` | `fetchStreamWithRetry` | `streamText()` |
| **Distill** | `routes/distill.mjs` | `callLLMWithRetry` | `paawGenerate()` |
| **Mindmap** | `routes/mindmap.mjs` | `callLLMWithRetry` | `paawGenerate()` |
| **Notes AI** | `routes/notes.mjs` | `callLLMWithRetry` | `paawGenerate()` |
| **Skills API** | `routes/skills-api.mjs` | `callLLMWithRetry` | `paawGenerate()` |
| **Vibe Sessions** | `routes/vibe-sessions.mjs` | `callLLMWithRetry` | `paawGenerate()` |
| **Cron Jobs** | `scheduler/cron-jobs.mjs` | `callLLMWithRetry` | `paawGenerate()` |
| **Project** | `routes/project.mjs` | `callLLMWithRetry` | `paawGenerate()` |
| **Agent Orchestrator** | `agent-orchestrator/src/server.ts` | raw `fetch` | `generateText()` |

**共用的 helper：** `lib/ai-sdk-helpers.mjs`
- `paawGenerate(rootDir, input, options)` — 一行搞定 LLM 呼叫
- `createAIModel(rootDir, modelOverride)` — 建立 AI SDK model object

---

## 🔮 未來擴展方向

1. **TaskPersistence 換 DB** — 介面已抽象，可無痛換 SQLite/Redis
2. **Agent Loop 沙箱化** — 工具執行包在 Docker container 裡
3. **A2A 多 Agent 協作** — 多個 PAAW Agent 互相調度
4. **Streaming Artifact** — 支援圖片、結構化資料作為 artifact
5. **Checkpoint Rollback** — 利用 checkpoint 做任務回滾和分支

---

*Generated by PAAW HelpDesk — 2026-07-06*
