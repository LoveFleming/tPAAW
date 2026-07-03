# Change Guide for Future AI

> 修改任何功能前，先看對應的驗證指令確認現狀

## 修改功能前必讀

1. **本 AI Context Package** — `memory/paaw-docs/`
2. **`packages/server/src/routes/shared.mjs`** — 所有路徑常數
3. **`packages/shared/src/schemas/index.ts`** — 資料合約
4. **`packages/server/src/context-engine.mjs`** — Context 組裝邏輯

> 驗證你讀的是正確的檔案：`wc -l packages/server/src/routes/shared.mjs packages/shared/src/schemas/index.ts packages/server/src/context-engine.mjs`

---

## 修改類型 → 應該看哪些檔案

| 修改類型 | 應該看 | 驗證這些檔案存在 |
|---|---|---|
| Chat 行為 | `routes/chat.mjs`, `context-engine.mjs`, `lib/tool-engine/`, `ai-settings/chat/` | `ls packages/server/src/lib/tool-engine/ && ls data/ai-settings/chat/` |
| App Tool 產生 | `tools/index.mjs`, `routes/apps.mjs`, `shared/schemas/` | `ls packages/server/src/tools/index.mjs && ls packages/shared/src/schemas/` |
| AI Prompt/Context | `context-engine.mjs`, `data/ai-settings/{category}/` | `ls data/ai-settings/` |
| 新增 API endpoint | `routes/*.mjs`, `paaw-server.mjs` | `grep "ROUTE_MODULES" packages/server/src/paaw-server.mjs` |
| 前端頁面 | `ui/src/pages/`, `ui/src/App.tsx` | `ls packages/ui/src/pages/ \| wc -l` |
| 資料結構 | `shared/schemas/`, `db/types.ts`, `db/migrate.ts` | `ls packages/shared/src/schemas/ packages/db/src/types.ts packages/db/src/migrate.ts` |
| Security | `lib/security/`, `lib/bridge/` | `ls packages/server/src/lib/security/` |
| Agent Loop | `lib/paaw-agent-loop.mjs`, `lib/llm-utils.mjs` | `ls packages/server/src/lib/paaw-agent-loop.mjs packages/server/src/lib/llm-utils.mjs` |
| WebSocket/PTY | `websocket/ws-handler.mjs` | `ls packages/server/src/websocket/ws-handler.mjs` |
| 排程 | `scheduler/cron-jobs.mjs` | `ls packages/server/src/scheduler/cron-jobs.mjs` |

---

## 不可以輕易改的地方

### 🔴 shared.mjs（路徑常數集中地）

改了影響全部路由。如果要改路徑，必須全域搜尋引用。

> 驗證影響範圍：`grep -c "from.*shared.mjs\|from.*shared'" packages/server/src/routes/*.mjs packages/server/src/lib/**/*.mjs`

### 🔴 context-engine.mjs（所有 AI 功能的 context 來源）

改了可能讓所有 AI 行為異常。改完要逐個 target 測試。

> 驗證 12 個 target：`grep 'case "' packages/server/src/context-engine.mjs`

### 🔴 tools/index.mjs（動態 tool 產生邏輯，1402 行）

改了影響所有 App 在 chat 中的行為。

> 驗證影響：`grep -c "appId" packages/server/src/tools/index.mjs`

### 🔴 lib/tool-engine/index.mjs（ReAct loop 核心）

改了影響所有 chat 行為。

### 🔴 db/migrate.ts（資料庫 migration）

改了可能讓現有資料無法存取。加新表 OK，改現有表要小心。

### 🔴 shared/src/schemas/index.ts（API 合約）

改了可能破壞前後端溝通。

---

## ⚠️ 已知同步義務（Fleming 要求）

### 1. context-engine.mjs ↔ tools/index.mjs 的 loadAppInstructions()

兩個地方各實作了一次 App instructions 的組裝邏輯。只改一邊 = bug。

> 驗證兩邊存在：`grep -rn "loadAppInstructions\|buildAppInstructions" packages/server/src/`

### 2. i18n 四個 locale 檔

新字串一律寫 `t()` + 加 locale key。4 個檔案：zh.json, en.json, ja.json, zh-mix.json

> 驗證：`ls packages/ui/src/i18n/locales/`

### 3. 改完碼一定要 commit + push

> 原因：公司 Windows/Linux 跟 Mac mini 都從 repo pull，local fix 沒 push = 別人跑舊碼

---

## 改完必須更新

| 改了什麼 | 必須更新 |
|---|---|
| API 合約 | `shared/schemas/` |
| 資料結構 | `db/migrate.ts` |
| Context 邏輯 | `data/ai-settings/` 對應的 .md |
| UI 文字 | 4 個 locale 檔 |
| 路由 | `paaw-server.mjs` 的 ROUTE_MODULES |
| 本文件的對應章節 | `memory/paaw-docs/` |

---

## 改完必須跑的測試

```bash
# 最低限度
npm run test

# 改了前端
npm run test:e2e

# 改了核心 AI 流程（目前沒自動化測試，需手動）
# 1. 開 Chat 輸入一句話確認 AI 有回
# 2. 開一個 App 確認 tool 可以被呼叫
# 3. 開 Coding IDE 確認 Agent Loop 能跑
```

---

## 安全修改判斷指南

| 修改類型 | 安全？ | 判斷方式 |
|---|---|---|
| 只改 UI 樣式 | ✅ 安全 | 跑 E2E |
| 加新 route | ✅ 安全 | 確認 paaw-server.mjs 有註冊 |
| 改 ai-settings/*.md | ✅ 安全 | 改的是 prompt，不影響程式邏輯 |
| 加新 DB table | ✅ 安全 | migrate 只加不改 |
| 改 API 合約 | ⚠️ 小心 | 前後端都要改 |
| 改 context-engine.mjs | ⚠️ 小心 | 逐個 target 測試 |
| 改 tools/index.mjs | ⚠️ 小心 | 測所有 dataShape 的工具產生 |
| 改 tool-engine ReAct loop | 🔴 危險 | 影響所有 chat |
| 改 shared.mjs 路徑 | 🔴 危險 | 全域搜尋引用 |
| 改 DB 現有 table | 🔴 危險 | 可能破壞現有資料 |
