# Codebase Map

> 驗證：`cd /Users/steward/App/tAgent && find packages -type f -name "*.mjs" -o -name "*.ts" -o -name "*.tsx" | grep -v node_modules | grep -v dist | wc -l`

## 重要目錄

```
tAgent/
├── packages/
│   ├── server/          # 🔴 後端核心
│   │   └── src/
│   │       ├── paaw-server.mjs        # HTTP 入口（~180 行）
│   │       ├── context-engine.mjs     # Context 組裝（513 行）
│   │       ├── routes/                # 20 個檔案（含 shared.mjs）
│   │       ├── lib/
│   │       │   ├── paaw-agent-loop.mjs # Agent Loop（872 行）
│   │       │   ├── llm-utils.mjs      # Retry/Sanitize（446 行）
│   │       │   ├── tool-engine/       # Tool Engine
│   │       │   ├── security/          # Security Kernel
│   │       │   └── bridge/            # Bridge
│   │       ├── tools/index.mjs        # 動態 Tool（1402 行）
│   │       ├── scheduler/             # 排程
│   │       └── websocket/             # WS/PTY
│   │
│   ├── ui/              # 🔴 前端（React + Vite）
│   │   └── src/
│   │       ├── App.tsx               # 主應用
│   │       ├── pages/                # 35 個頁面
│   │       ├── components/           # 共用組件
│   │       └── i18n/locales/         # 4 個 locale (en, ja, zh, zh-mix)
│   │
│   ├── shared/          # 🟡 共用型別 + Schema
│   ├── db/              # 🟡 SQLite (sql.js + Kysely)
│   ├── context/         # 🟢 Context 管理（進階）
│   └── engine/          # 🟢 執行引擎（TS 版本）
│
├── data/                # 🔴 檔案系統資料庫
│   ├── config/          # providers.json, user.json, workspaces.json
│   ├── apps/            # 3 個 App (ai-service-monitor, bookmarks, pocket)
│   ├── skills/          # building/, input-prompt/, physical-skill/
│   ├── crews/           # 7 個 AI 員工
│   ├── chats/           # 對話記錄
│   ├── ai-settings/     # 12 個 category 子目錄
│   └── ...
│
└── tests/               # 4 unit + 5 E2E
```

> 驗證 App 數量：`ls data/apps/`
> 驗證 Crew 數量：`ls data/crews/*.json | wc -l`
> 驗證 UI 頁面數：`ls packages/ui/src/pages/*.tsx | wc -l`
> 驗證 locale 數：`ls packages/ui/src/i18n/locales/`

## 重要檔案清單

### 必讀（改任何功能都要看）

| 檔案 | 行數 | 用途 |
|---|---|---|
| `packages/server/src/routes/shared.mjs` | ~180 | 所有路徑常數 + helpers |
| `packages/server/src/context-engine.mjs` | 513 | Context 組裝引擎 |
| `packages/server/src/tools/index.mjs` | 1402 | 動態 App Tool 產生 |
| `packages/server/src/lib/tool-engine/index.mjs` | ~310 | ReAct loop 核心 |

### 核心邏輯

| 檔案 | 行數 | 用途 |
|---|---|---|
| `packages/server/src/paaw-server.mjs` | 181 | HTTP 入口 |
| `packages/server/src/lib/paaw-agent-loop.mjs` | 872 | AI Agent Loop |
| `packages/server/src/lib/llm-utils.mjs` | 446 | Retry + Sanitize |
| `packages/server/src/lib/tool-engine/provider.mjs` | 244 | OpenAI adapter |
| `packages/server/src/lib/security/index.mjs` | 151 | Security Kernel |
| `packages/server/src/lib/bridge/paaw-bridge.mjs` | 595 | Docker Bridge |
| `packages/server/src/websocket/ws-handler.mjs` | 360 | WebSocket |

### 資料合約

| 檔案 | 用途 |
|---|---|
| `packages/shared/src/schemas/index.ts` | TypeBox Schema 定義 |
| `packages/shared/src/types/index.ts` | 共用型別 |
| `packages/db/src/types.ts` | DB table 定義 |
| `packages/db/src/migrate.ts` | SQL migration |

> 驗證行數：`wc -l packages/server/src/context-engine.mjs packages/server/src/tools/index.mjs packages/server/src/paaw-server.mjs`

## 閱讀起點建議

1. `paaw-server.mjs` → 了解路由分派
2. `routes/shared.mjs` → 了解路徑常數
3. `context-engine.mjs` → 了解 context 如何組裝
4. `lib/tool-engine/index.mjs` → 了解 ReAct loop
5. `tools/index.mjs` → 了解 App Tool 動態產生
6. `shared/src/schemas/index.ts` → 了解資料合約
7. `ui/src/App.tsx` → 了解前端路由
