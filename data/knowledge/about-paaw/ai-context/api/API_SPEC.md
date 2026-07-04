# API / Interface Spec

> 所有 endpoint 都可以實際驗證：啟動 server 後用 curl 測試

## HTTP API

Base URL: `http://localhost:4097`

> 驗證 port：`grep "PAAW_PORT" packages/server/src/routes/shared.mjs`

### Chat

| Endpoint | Method | Input | Output | 程式位置 |
|---|---|---|---|---|
| `/api/paaw/chats` | GET | — | `Chat[]` | `routes/chat.mjs` |
| `/api/paaw/chats` | POST | `{ id, title, messages }` | `Chat` | `routes/chat.mjs` |
| `/api/paaw/chats/:id` | GET | — | `Chat` | `routes/chat.mjs` |
| `/api/paaw/chats/:id` | PUT | `Partial<Chat>` | `Chat` | `routes/chat.mjs` |
| `/api/paaw/chats/:id` | DELETE | — | `{ ok: true }` | `routes/chat.mjs` |
| `/api/paaw/chat` | POST | `{ messages, model?, provider?, contextTarget?, systemPrompt? }` | SSE stream | `routes/chat.mjs` |

> 驗證 Chat CRUD：`grep -n "api/paaw/chats" packages/server/src/routes/chat.mjs`

**Chat SSE 格式：**
```
data: {"content": "文字片段"}
data: {"tool_call": {"name": "pocket_add", "args": {...}, "status": "executing"}}
data: {"tool_result": {"name": "pocket_add", "result": {...}}}
data: [DONE]
```

> 驗證 SSE 格式：`grep "data:.*JSON.stringify" packages/server/src/routes/chat.mjs | head -5`

**curl 驗證（需 server 運行）：**
```bash
# List chats
curl http://localhost:4097/api/paaw/chats

# Chat completion (SSE)
curl -N -X POST http://localhost:4097/api/paaw/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"hello"}]}'
```

### Apps

| Endpoint | Method | Input | Output | 程式位置 |
|---|---|---|---|---|
| `/api/apps` | GET | — | `App[]` | `routes/apps.mjs` |
| `/api/apps` | POST | `{ id, name, type, dataShape, schema }` | `{ ok, app }` | `routes/apps.mjs` |
| `/api/apps/:id` | PATCH | `Partial<App>` | `{ ok, app }` | `routes/apps.mjs` |
| `/api/app-data/:appId` | GET | — | `any[]` 或 `{}` | `routes/apps.mjs` |
| `/api/app-data/:appId` | PUT | `any` | `{ ok: true }` | `routes/apps.mjs` |

> 驗證：`grep -n "api/apps\|api/app-data" packages/server/src/routes/apps.mjs | head -10`

### Skill Test / CLI Run

| Endpoint | Method | Input | Output | 程式位置 |
|---|---|---|---|---|
| `/api/skill-test/run` | POST | `{ skillId, prompt, cwd?, timeout? }` | SSE stream | `routes/crew.mjs` |
| `/api/cli-run` | POST | `{ prompt, cwd?, maxToolCalls?, stream? }` | JSON 或 SSE | `routes/crew.mjs` |

> 驗證：`grep -n "skill-test/run\|cli-run" packages/server/src/routes/crew.mjs`

### System Prompts

| Endpoint | Method | Input | Output | 程式位置 |
|---|---|---|---|---|
| `/api/system-prompts` | GET | — | `{ [file]: content }` | `routes/chat.mjs` |
| `/api/system-prompts/:file` | GET | — | `{ file, content }` | `routes/chat.mjs` |
| `/api/system-prompts/:file` | PUT | `{ content: string }` | `{ file, saved }` | `routes/chat.mjs` |

> 驗證：`grep -n "system-prompts" packages/server/src/routes/chat.mjs`
> 驗證哪些 .md 檔可管理：`grep "PROMPT_FILES" packages/server/src/routes/chat.mjs`

---

## WebSocket API

Port: 4098

> 驗證：`grep "WS_PORT\|4098" packages/server/src/websocket/ws-handler.mjs`

**Client → Server：**

| type | 欄位 | 用途 |
|---|---|---|
| `spawn` | `options: { engine, cli, cwd, model, systemPrompt }` | 建立新 session |
| `input` | `text: string` | 使用者輸入 |
| `set_system_prompt` | `systemPrompt: string` | 更新 agent session 的 prompt |
| `resize` | `cols, rows` | 調整 PTY 大小 |
| `kill` | — | 結束 session |

**Server → Client：**

| type | 欄位 | 用途 |
|---|---|---|
| `ready` | `sessionId, platform` | session 已建立 |
| `cliReady` | — | CLI 就緒 |
| `agent_running` | — | Agent 開始執行 |
| `agent_event` | `event: tool_start/tool_end/thinking/response` | Agent 事件 |
| `agent_done` | `content, turns, toolCalls, success` | Agent 完成 |
| `agent_error` | `message` | Agent 錯誤 |
| `data` | `data` | Shell PTY 輸出 |
| `exit` | `exitCode` | PTY 結束 |

> 驗證：`grep "type.*agent_done\|type.*agent_event\|type.*agent_error\|type.*ready" packages/server/src/websocket/ws-handler.mjs`

---

## Bridge API

Port: 4100 (僅 Docker 模式)

> 驗證：`grep "BRIDGE_PORT\|4100" packages/server/src/lib/bridge/paaw-bridge.mjs`

| Endpoint | Method | 用途 |
|---|---|---|
| `/api/sync/request` | POST | 建立 sandbox→host 同步請求 |
| `/api/sync/pending` | GET | 列出待審核同步 |
| `/api/sync/diff/:id` | GET | 查看差異 |
| `/api/sync/approve/:id` | POST | 批准同步 |
| `/api/sync/reject/:id` | POST | 拒絕同步 |
| `/api/tool/proxy` | POST | 代理外部 API（keys 存 host） |
| `/api/tool/tokens` | GET | 列出已註冊的 token hosts |
| `/api/update/:action` | POST | 管理容器 |
| `/api/update/status` | GET | 容器狀態 |
| `/health` | GET | 健康檢查 |

> 驗證：`grep -n "api/sync\|api/tool\|api/update\|/health" packages/server/src/lib/bridge/paaw-bridge.mjs | head -15`

---

## Internal: Context Engine API

不是 HTTP API，是內部 JS API：

```js
const ctx = await contextEngine.build({ target: "chat" });
// 回傳: { systemPrompt: string, prompt?: string, provider?: object, meta?: object }
```

**12 個 target：** chat, skill-exec, workflow, crew, skill-builder, mindmap, notes, project, distill, app-exec, app-builder, coding

> 驗證：`grep -n 'case "' packages/server/src/context-engine.mjs`

---

## Internal: Tool Engine API

```js
const engine = new ToolEngine({ provider, executors, maxToolRounds, security });

// ReAct loop (async generator)
for await (const chunk of engine.run(systemPrompt, messages, model)) {
  // chunk.type: 'text' | 'tool_start' | 'tool_end' | 'done' | 'error'
}
```

> 驗證：`grep -n "type.*text\|type.*tool_start\|type.*tool_end\|type.*done\|type.*error" packages/server/src/lib/tool-engine/index.mjs | head -10`
