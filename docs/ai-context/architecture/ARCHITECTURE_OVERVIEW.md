# Architecture Overview

> 驗證：`cd /Users/steward/App/tPAAW && find packages -maxdepth 1 -type d | sort`

## 主要模組與責任

```
┌──────────────────────────────────────────────────────────┐
│                    packages/ui (React)                     │
│  App.tsx → 路由所有頁面                                    │
│  35 個頁面, 多個 components, i18n (4 locales)             │
└───────────────────────┬──────────────────────────────────┘
                        │ HTTP + SSE + WebSocket
┌───────────────────────▼──────────────────────────────────┐
│                  packages/server (Node.js)                 │
│  paaw-server.mjs (入口，~180 行) → 載入 routes → 分派     │
│  ├── routes/ (20 個檔案，含 shared.mjs)                   │
│  ├── context-engine.mjs (Context 組裝，513 行)             │
│  ├── tools/index.mjs (動態 App Tool，1402 行)              │
│  ├── lib/paaw-agent-loop.mjs (AI Agent loop，872 行)      │
│  ├── lib/tool-engine/ (Tool Engine + Security Kernel)     │
│  ├── lib/llm-utils.mjs (Retry/Sanitize，446 行)           │
│  ├── lib/bridge/paaw-bridge.mjs (Docker 守門員，595 行)   │
│  ├── lib/security/ (Policy Pipeline + Audit + Secret)     │
│  └── websocket/ws-handler.mjs (PTY + Agent，360 行)       │
└───────────────────────┬──────────────────────────────────┘
                        │
┌───────────────────────▼──────────────────────────────────┐
│  packages/shared (TypeBox schemas + types)                 │
│  packages/context (ContextAssembler + MemoryStore)         │
│  packages/db (SQLite via sql.js，9 張表)                   │
│  packages/engine (SkillRunner + WorkflowRunner, TS 版)     │
└──────────────────────────────────────────────────────────┘
                        │
┌───────────────────────▼──────────────────────────────────┐
│                    data/ (檔案系統資料庫)                   │
│  apps/, skills/, crews/, chats/, config/, knowledge/...   │
│  ai-settings/ (12 個 category 子目錄的 .md 規則檔)        │
└──────────────────────────────────────────────────────────┘
```

> 驗證 route 數量：`ls packages/server/src/routes/*.mjs | wc -l` → 20
> 驗證 ai-settings 類別：`ls data/ai-settings/`
> 驗證 DB 表數量：`grep "CREATE TABLE" packages/db/src/migrate.ts | wc -l` → 9

## 重要資料流

### Flow 1: Chat Completion（最核心）

```
使用者輸入 → ChatView (UI)
  → POST /api/paaw/chat { messages, model, contextTarget }
  → chat.mjs: 載入 provider config + context engine
  → contextEngine.build({ target: "chat" })
    → Layer 0: 硬編碼路徑
    → Layer 1: ai-settings/chat/*.md
    → Layer 2: 動態資料 (user.json + MEMORY.md + Apps)
    → Layer 3: Runtime Tools (api-registry + generated skills)
  → ToolEngine.run(systemPrompt, messages, model)
    → ReAct loop: LLM → tool_calls → execute → feed back → repeat
    → Security Kernel 每次工具呼叫前檢查
    → Result Validation (error detection + write verification)
  → SSE stream 回前端
  → distill 記錄互動
```

> 驗證 SSE：`grep "text/event-stream" packages/server/src/routes/chat.mjs`
> 驗證 ReAct loop：`grep "maxToolRounds" packages/server/src/lib/tool-engine/index.mjs`
> 驗證 Security：`grep "class SecurityKernel" packages/server/src/lib/security/index.mjs`

### Flow 2: Skill Execution via Chat Tool

```
Chat 中觸發工具 → tools/index.mjs 動態產生 tool definitions
  → 根據 app.json 的 dataShape + schema 自動產生 CRUD 工具
  → array: _add, _list, _get, _update, _delete (5 工具)
  → object: _get, _set (2 工具)
  → skill-based: _exec (1 工具)
  → ToolEngine 執行 → Result Validation
```

> 驗證工具產生：`grep -n "dataShape\|_add\|_list\|_get\|_set\|_exec" packages/server/src/tools/index.mjs | head -15`

## 主要 Entry Points

| Entry Point | 用途 | Port | 檔案路徑 |
|---|---|---|---|
| HTTP Server | Web API + 靜態前端 | 4097 | `packages/server/src/paaw-server.mjs` |
| WebSocket Server | PTY + Agent 模式 | 4098 | `packages/server/src/websocket/ws-handler.mjs` |
| Bridge Server | Docker 安全守門員 | 4100 | `packages/server/src/lib/bridge/paaw-bridge.mjs` |

> 驗證 HTTP port：`grep "PAAW_PORT\|4097" packages/server/src/routes/shared.mjs`
> 驗證 WS port：`grep "WS_PORT\|4098" packages/server/src/websocket/ws-handler.mjs`
> 驗證 Bridge port：`grep "BRIDGE_PORT\|4100" packages/server/src/lib/bridge/paaw-bridge.mjs`

## 設計風格與架構模式

1. **Monorepo (npm workspaces)** — 5 個 packages
2. **File-based Storage** — JSON 檔案作為主要資料庫
3. **Dynamic Tool Generation** — App schema 自動產生 CRUD tool
4. **Layered Context Engine** — 4 層 context（硬編碼 → Category Rules → 動態資料 → Runtime Tools）
5. **ReAct Loop** — Tool-calling + streaming
6. **Security Kernel** — Policy Pipeline + Approval + Audit + Secret Store
7. **SSE Streaming** — 所有 AI 回應走 Server-Sent Events
8. **Route Module Pattern** — 每個 route export async function(req, res) → boolean

> 驗證 Route Module pattern：`head -5 packages/server/src/routes/chat.mjs` → `export default async function`

## 外部依賴

| 依賴 | 用途 | 安裝在 |
|---|---|---|
| LLM API (zai/OpenRouter) | 所有 AI 功能 | runtime, providers.json |
| sql.js | SQLite 無原生依賴 | packages/db |
| node-pty | 終端機模擬 | packages/server |
| ws | WebSocket | packages/server |
| chokidar | 檔案監控 | packages/server |
| js-yaml | YAML 解析 | packages/server |
| React + Vite | 前端框架 | packages/ui |
| TypeBox | Schema 定義 | packages/shared |
