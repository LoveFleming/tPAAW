# Risk and Design Debt

> 每個風險都附驗證指令，不是猜的

## 架構風險

### 🔴 R1: File-based Storage 無 ACID

**問題：** App data、Chats 都是 JSON 檔案讀寫，併發時可能資料損壞

**位置：** `data/app-data/`, `data/chats/`

**影響：** 同時兩個請求寫同一個 chat JSON 可能丟資料

**緩解：** 單人使用場景下風險低

> 驗證檔案讀寫無鎖：`grep -c "lock\|mutex\|semaphore\|flock" packages/server/src/routes/apps.mjs` → 0

---

### 🔴 R2: 無認證系統

**問題：** API 完全開放，CORS = `*`

**位置：** `packages/server/src/paaw-server.mjs:59`

**影響：** 任何人可讀寫所有資料

> 驗證：`grep "Access-Control-Allow-Origin" packages/server/src/paaw-server.mjs`
> 輸出：`res.setHeader("Access-Control-Allow-Origin", "*");`

---

### 🔴 R3: API Key 明文存 JSON

**問題：** `data/config/providers.json` 包含明文 API key

**位置：** `data/config/providers.json` → `"apiKey": "sk-or-..."`

**緩解：** .gitignore 排除 data/；Bridge 模式下 keys 只在 host

> 驗證 .gitignore：`grep "data/" .gitignore`
> ⚠️ 但 providers.json 的 key 是真實的，不應在文件中展示

---

### 🟡 R4: Monolith Server

**問題：** 單 process，一個 route 的 bug 可能拖垮整個 server

**位置：** `paaw-server.mjs` — 所有 route 載入同一 process

> 驗證：`grep "createServer" packages/server/src/paaw-server.mjs`

---

## 隱含假設

### A1: 單人使用

DB schema 有 user_id 但實際沒用。所有資料沒有 user 隔離。

> 驗證：`grep "user_id" packages/db/src/types.ts | head -5` → 有欄位
> 但驗證實際使用：`grep "userId\|user_id" packages/server/src/routes/apps.mjs` → 大多不用

### A2: 本地部署

假設 PAAW 跑在 localhost，無需 TLS。

> 驗證：`grep -c "https\|TLS\|SSL\|certificate" packages/server/src/paaw-server.mjs` → 0

### A3: LLM API 永遠可用

沒有離線模式或降級方案。API 掛了 = PAAW 無法用。

### A4: JSON 檔案不會損壞

讀取時 try/catch 但不修復，損壞的 JSON 檔只回傳空值。

> 驗證：`grep "catch.*return.*\[\]\|catch.*return.*{}" packages/server/src/routes/apps.mjs`

### A5: data/ 目錄結構不變

大量 hard-coded 路徑。

> 驗證 hard-code 數量：`grep -c "resolve(.*data/" packages/server/src/routes/shared.mjs`

---

## Coupling 問題

### C1: context-engine.mjs ↔ tools/index.mjs（Fleming 已知）

`loadAppInstructions()` 在兩個地方各實作一次：
- `context-engine.mjs:209` — `loadAppInstructions()`
- `tools/index.mjs:1361` — `buildAppInstructions()`

只改一邊 = 聊天視窗看到的 tool 資訊不一致。

> 驗證：`grep -rn "loadAppInstructions\|buildAppInstructions" packages/server/src/`

### C2: chat.mjs ↔ tool-engine/

Chat route 直接建立 ToolEngine，中間無抽象層。

> 驗證：`grep "new ToolEngine" packages/server/src/routes/chat.mjs`

### C3: ws-handler.mjs ↔ paaw-agent-loop.mjs

Agent session 狀態直接在 WS handler 管理，無獨立狀態管理。

> 驗證：`grep "agentSessions\|agentState" packages/server/src/websocket/ws-handler.mjs | wc -l`

### C4: 所有 routes ↔ shared.mjs

全部路徑常數集中在一個檔案，改一個常數影響所有路由。

> 驗證引用數：`grep -l "shared.mjs" packages/server/src/routes/*.mjs | wc -l`

---

## 不容易改的地方

### D1: tools/index.mjs（1402 行）

邏輯複雜：schema 解析、多種 dataShape、Notes 特殊處理、tool handler 產生

> 驗證行數：`wc -l packages/server/src/tools/index.mjs`

### D2: PAAW_TOOLS 硬編碼

Agent Loop 的 9 個工具定義在 `paaw-agent-loop.mjs` 的 `PAAW_TOOLS` 陣列，不是動態產生。

> 驗證：`grep "const PAAW_TOOLS" packages/server/src/lib/paaw-agent-loop.mjs`

### D3: SSE 多處實作

chat.mjs, ws-handler.mjs, crew.mjs 各自實作 SSE streaming，模式相似但不統一。

> 驗證：`grep -l "text/event-stream" packages/server/src/routes/*.mjs packages/server/src/websocket/*.mjs`

### D4: data/ 目錄結構

改了會影響所有路徑常數。

> 驗證路徑常數數量：`grep -c "resolve(" packages/server/src/routes/shared.mjs`

---

## 文件不足的地方

1. **前端組件文件** — 35 個頁面沒有獨立文件
2. **AI Settings .md 檔** — 各 category 的 .md 檔缺少使用說明
3. **Cron 排程格式** — 缺少 cron expression 範例
4. **Bridge sync 流程** — Docker 部署缺少 walk-through

## 測試不足的地方

1. **核心 AI 流程** — Chat + Tool Engine + SSE 完全沒自動化測試
2. **Agent Loop** — 沒測試
3. **Security Kernel** — 沒測試
4. **App Tool 動態產生** — 沒測試
5. **LLM Retry** — 沒測試
6. **i18n 一致性** — 沒自動驗證 4 個 locale key
