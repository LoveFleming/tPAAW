# PAAW HelpDesk Knowledge Base

> 其他 Agent 可查詢的 PAAW 知識庫

## PAAW 是什麼？

**PAAW (Personal AI Assistant Workspace)** — Build your personal AI workforce

核心概念：人用 AI 自己做工具 → AI 幫你記資料 → AI 放大你記的資料 → 形成能力飛輪

## 核心模組

### 1. Chat Assistant（聊天助理）
- 所有 App 在聊天視窗都能使用
- 支援 SSE 串流回應
- 自動路由到相關 Skill / App

### 2. Skill Builder（技能建構器）
- Skill 是最小的能力單元
- 格式：Purpose → Inputs → Deterministic Script → Guardrails → Output Contract → Validation
- App、Workflow、Crew、CronJob 都會叫用 Skill

### 3. App Builder（應用建構器）
- 資料驅動 或 Skill-based
- 每個 App 自動產生 Chat Tool
- 雙入口：聊天視窗 + App 視窗
- App 資料 = AI 的記憶

### 4. Workflow Builder（工作流建構器）
- 多步驟自動化流程

### 5. Knowledge / Files（知識與檔案管理）
- AI 讀取知識產生洞見

### 6. Memory（記憶管理）
- 分層記憶架構

### 7. Execution Center（執行中心）
- CronJob 排程
- 監控與日誌

## Capability Platform 三層架構

```
使用者（不會寫程式）
  ↓ 在聊天視窗或 App Builder 說「我要做一個 XX app」
App Builder（AI 幫你建 Skill + App）
  ↓ 產出：app.json + app.html + data
自動註冊為 Chat Tool
  ↓
使用者從「聊天視窗」或「App 視窗」都能用
  ↓
App 產生的資料 → AI 讀取 → 產生洞見
```

## A2A Protocol (Agent-to-Agent)
- JSON-RPC 2.0 binding
- `GET /.well-known/agent.json` → Agent Card
- `POST /a2a` → JSON-RPC endpoint
- Methods: `message/send`, `message/stream`, `tasks/get`, `tasks/list`, `tasks/cancel`

## Tech Stack
- Frontend: React 18 + Tailwind CSS
- Backend: Node.js HTTP server
- Data: JSON file-based storage (data/)
- AI: Multi-provider (GLM, DeepSeek, OpenRouter)

## App 結構
每個 App 包含：
- `app.json` — metadata, schema, triggers
- `app.html` — UI (standalone HTML)
- `data/app-data/<app-id>.json` — 資料

## API 端點
- `GET /api/apps` — 列出所有 App
- `GET/PUT /api/app-data/:appId` — App 資料 CRUD
- `GET/POST/PUT/DELETE /api/paaw/chats/:id` — 聊天 CRUD
- `POST /a2a` — Agent-to-Agent JSON-RPC
- `POST /api/helpdesk/ask` — 客服提問
- `GET /api/helpdesk/knowledge` — 知識庫
