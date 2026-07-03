# Core Flow Documentation

> 每條流程都附驗證指令，可獨立確認

---

## Flow 1: Chat Completion（最核心）

**Trigger：** 使用者在 ChatView 輸入訊息

### Step-by-step

1. 前端 POST `/api/paaw/chat` with `{ messages, model, contextTarget }`
2. `chat.mjs` 載入 `providers.json`，解析 provider + model
3. `contextEngine.build({ target: "chat" })` 組裝 system prompt：
   - Layer 0: `buildBaseContext()` — Knowledge + Workspace 路徑
   - Layer 1: `readCategoryFiles("chat")` — ai-settings/chat/*.md
   - Layer 2: `buildDynamicContext()` — user.json + MEMORY.md + Apps
   - Layer 3: `buildRuntimeTools()` — API registry + generated skills
4. 載入 `tools/index.mjs` 的 tool definitions + handlers
5. 建立 `ToolEngine`（含 SecurityKernel）
6. ToolEngine.run() — ReAct loop（最多 maxToolRounds 輪）：
   - LLM 回文字 → yield text → SSE
   - LLM 回 tool_calls → Security check → execute → Result Validation → feed back
   - 偵測假 tool call → 重試
7. SSE `[DONE]` 結束
8. distill 記錄互動

### Main functions

- `routes/chat.mjs` — Chat route handler
- `contextEngine.build()` — Context 組裝
- `ToolEngine.run()` — ReAct loop
- `OpenAICompatibleAdapter.chat()` — LLM API 呼叫
- `SecurityKernel.checkToolCall()` — 安全檢查

### Input / Output

- Input: `{ messages: Message[], model?: string, provider?: string, contextTarget?: string }`
- Output: SSE stream (text chunks + tool events + [DONE])

### Error handling

- Provider 無 API key → 400 error
- LLM API 失敗 → `llm-utils.mjs` retry (最多 5 次, exponential backoff 2s~30s)
- 空白回應 → `isMeaningfulContent()` 偵測 → retry
- 假 tool call → `looksLikeFakeToolCall()` 偵測 → 重試
- Tool 失敗 → `detectToolError()` → 告訴 LLM 失敗

### Side effects

- distill 記錄 AI 互動
- tool 執行可能修改 app-data / 檔案

### 驗證指令

```bash
# 驗證 Chat route 存在
grep -n "api/paaw/chat" packages/server/src/routes/chat.mjs

# 驗證 Context Engine 的 chat target
grep "_buildChat" packages/server/src/context-engine.mjs

# 驗證 ReAct loop
grep -n "maxToolRounds\|for.*round" packages/server/src/lib/tool-engine/index.mjs | head -5

# 驗證 Security 整合
grep "SecurityKernel\|this.security" packages/server/src/lib/tool-engine/index.mjs | head -5

# 驗證 SSE streaming
grep "text/event-stream" packages/server/src/routes/chat.mjs

# 驗證 distill 記錄
grep "recordChatInteraction" packages/server/src/routes/chat.mjs
```

---

## Flow 2: Skill Execution via Chat Tool

**Trigger：** LLM 在 chat 中呼叫 `{appId}_add/list/get/update/delete/exec` 工具

### Step-by-step

1. `tools/index.mjs` 啟動時 `loadApps()` 讀取 `data/apps/*/app.json`
2. 根據每個 app 的 dataShape + schema 動態產生 tool definitions
3. `app_list` 工具列出所有已安裝 App
4. LLM 呼叫工具時，handler 讀寫 `data/app-data/{appId}.json`
5. Result Validation：寫入操作後回查確認

### Main functions

- `tools/index.mjs: loadApps()` — 載入所有 App 定義
- `tools/index.mjs: buildToolDefinitions()` — 動態產生 tool definitions
- `tools/index.mjs: buildToolHandlers()` — 動態產生 tool handlers

### Input / Output

- Input: tool call args (符合 app schema)
- Output: tool result (JSON)

### 驗證指令

```bash
# 驗證 App 載入
grep "loadApps" packages/server/src/tools/index.mjs

# 驗證 DataShape 工具產生
grep -n "dataShape.*array\|_add\|_list\|_get\|_update\|_delete" packages/server/src/tools/index.mjs | head -10

# 驗證 Result Validation
grep -n "verifyWriteResult\|detectToolError" packages/server/src/lib/tool-engine/index.mjs
```

---

## Flow 3: Context Engine Assembly

**Trigger：** 任何需要 AI 的功能

### Step-by-step

1. 呼叫 `contextEngine.build({ target })`
2. 根據 target 選擇組裝策略
3. Layer 0: `buildBaseContext()` — 路徑
4. Layer 1: `readCategoryFiles(category)` — ai-settings/{category}/*.md
5. Layer 2: `buildDynamicContext()` — user.json + MEMORY.md + Apps
6. Layer 3: `buildRuntimeTools()` — API registry + generated skills
7. 回傳 `{ systemPrompt, prompt?, provider?, meta? }`

### 各 target 的差異

| Target | Layer 0 | Layer 1 | Layer 2 | Layer 3 | Extra |
|---|---|---|---|---|---|
| chat | ✅ | chat/ | ✅ | ✅ | recent chats |
| crew | ✅ | crew/ | ❌ | ❌ | crew rolePrompt |
| skill-exec | ✅ | crew/ | ❌ | ❌ | SKILL.md + SYSTEM.md |
| skill-builder | ✅ | skill-builder/{phase}/ | ❌ | ❌ | — |
| workflow | ✅ | crew/ + workflow/ | ✅ | ❌ | SKILL.md |
| app-builder | ✅ | app-builder/ | ❌ | ✅ | — |
| coding | ✅ | chat/ | ✅ | ✅ | = chat |

> 需要人工確認：mindmap/notes/project/distill/app-exec 的 layer 差異，需逐一看 `_buildXxx()` 函式

### 驗證指令

```bash
# 驗證 4 層結構
grep -n "buildBaseContext\|readCategoryFiles\|buildDynamicContext\|buildRuntimeTools" packages/server/src/context-engine.mjs

# 驗證各 target 的實作
grep -n "_buildChat\|_buildCrew\|_buildSkillExec\|_buildWorkflow" packages/server/src/context-engine.mjs
```

---

## Flow 4: Agent Loop (Coding IDE / Skill Test)

**Trigger：** 使用者在 Coding IDE 輸入（paaw-agent engine）

### Step-by-step

1. WebSocket `type: "spawn"` with `engine: "paaw-agent"`
2. 使用者輸入 → `runAgentLoop()`
3. `buildSystemPrompt()` — agent-loop/system-prompt.md + workspace paths + tool list
4. 初始化 messages: [system, user]
5. ReAct loop（最多 maxTurns 輪）：
   - `callLLM()` — LLM API with PAAW_TOOLS
   - 有 tool_calls → `executeTool()` (read_file, write_file, bash, grep, git, glob, diff, edit_file, ask_user)
   - 路徑安全：寫入僅限 workspaceDirs
   - 無 tool_calls → 回傳文字
6. WebSocket 推送結果

### PAAW_TOOLS（9 個）

| Tool | 用途 |
|---|---|
| read_file | 讀取檔案（支援 offset/limit） |
| write_file | 寫入檔案 |
| edit_file | 精確文字替換 |
| glob | 搜尋檔案 |
| grep | 搜尋內容 |
| diff | 比較差異 |
| git | Git 操作 |
| bash | Shell 命令 |
| ask_user | 詢問使用者 |

### 驗證指令

```bash
# 驗證 9 個工具定義
grep "name:.*_file\|name:.*glob\|name:.*grep\|name:.*diff\|name:.*git\|name:.*bash\|name:.*ask_user" packages/server/src/lib/paaw-agent-loop.mjs

# 驗證路徑安全
grep -n "isPathAllowed\|workspaceDirs" packages/server/src/lib/paaw-agent-loop.mjs

# 驗證 WS 連線
grep "paaw-agent\|engine.*paaw" packages/server/src/websocket/ws-handler.mjs | head -3
```

---

## Flow 5: Bridge Sync (Docker)

**Trigger：** 開發者在 Docker sandbox 修改了檔案

### Step-by-step

1. POST `/api/sync/request` → `createSyncRequest(subPath)`
2. `docker cp` 從容器複製到暫存目錄
3. `diff -rq` 或 hash-based 比對
4. 人類審核
5. approve → 寫入 host data/
6. reject → 清理暫存

### 驗證指令

```bash
# 驗證 sync 流程
grep -n "createSyncRequest\|approveSync\|rejectSync" packages/server/src/lib/bridge/paaw-bridge.mjs

# 驗證 tool proxy
grep -n "api/tool/proxy\|TOOL_TOKENS" packages/server/src/lib/bridge/paaw-bridge.mjs
```
