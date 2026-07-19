# PAAW — Personal AI Assistant Workspace

**Build your personal AI Workforce.**

PAAW 讓知識工作者用 AI 打造自己的工具，AI 幫你記資料，再把記下來的東西放大成可執行的能力。

> 人用 AI 自己做工具 → AI 幫你記資料 → AI 放大你記的資料 → 形成能力飛輪

---

## ✨ 核心功能

### 🤖 AI Crew — 自組 AI 團隊

每個成員有獨立的角色、技能、個性、記憶與對話歷史。透過 A2A Protocol 互相協作。

| Agent | 代號 | 職位 |
|-------|------|------|
| 🏛️ 架構師 | 林曉薇 Xiaowei Lin | 系統架構設計、技術決策 |
| 💻 Developer | 普里亞·夏爾馬 Priya Sharma | 寫程式、實作功能 |
| 🧪 Tester | 迪維雅·雷迪 Divya Reddy | 撰寫與執行測試 |
| 📝 Doc Writer | 梅根·布魯克斯 Megan Brooks | 撰寫技術文件 |
| 🛡️ QA | 武大安 Da'an Wu | Code Review、品質把關 |
| 🎧 Helpdesk | 小春 林 Koharu Hayashi | 協助排查問題 |
| 🎖️ EM 大總管 | 陳哲宇 Ethan | 專案管理、夜間調度 |

### 🔧 Skill Builder — 最小能力單元

Skill 是 PAAW 的最小能力單元，可被 App、AI Crew、CronJob 叫用。

- 定義結構：Purpose → Inputs → Tool Access → Deterministic Script → Guardrails → Output Contract → Validation
- AI 輔助生成：描述需求，AI 自動產生 Skill 定義
- Skill 可自動註冊為 Chat Tool

### 📦 App Builder — 資料驅動應用

用 AI 打造自己的工具，每個 App 自動產生聊天 Tool。

- **Skill-based App** — 基於 Skill 定義，AI 產生 HTML + Schema
- **Data-driven App** — 結構化資料 + AI 洞見
- **雙入口** — 聊天視窗說一句話，或點開 App 視窗都能用
- **自動 Tool 註冊** — 新 App 自動成為聊天可呼叫的 Tool

### 💬 Chat Assistant — 聊天即工作

所有 App、Skill 在聊天視窗都能用。觸發關鍵字自動路由到對應 Tool。

- 主助理（林雨晴）統一入口
- 自然語言叫用任何 App / Skill
- 支援 Markdown 渲染（表格、程式碼區塊、引用等）

### 🌙 Night Shift — 夜間自動化

EM 大總管夜間自動跑測試、Code Review、寫文件。

- **EM 模式** — EM 規劃 3-5 項工作，依序派發給 AI Crew
- **Parallel 模式** — 6 個 agent 同時並行處理
- 報告統一存到 `.paaw/night-shift/reports/YYYY-MM-DD.md`
- 卡住可一鍵重置

### 📋 Issues Tracker — 專案議題管理

內建 Issue Tracker，AI agent 可直接讀取 / 建立 / 更新 / 刪除 issue。

### 🧠 Agent Memory — 長期記憶

每個 AI agent 有獨立的長期記憶檔案（`.paaw/agent-memory/{agentId}.md`），跨對話保留。

### 📝 Notes — 知識筆記

結構化筆記系統，支援 Notebook + Section 分層。

### 🔬 API Tester — API 測試工具

- 自動掃描專案 API routes（91+ endpoints）
- 按 path segment 分組，可摺疊
- 歷史紀錄儲存（`data/api-tester-history.json`）
- AI agent 可讀取歷史紀錄開發 E2E 測試

### 📊 LLM API Log — API 呼叫紀錄

每次 LLM 呼叫自動記錄：時間、agent、model、token、耗時、請求/回應預覽。

### 📁 File System — 檔案瀏覽

內建檔案瀏覽器，支援瀏覽、讀取、編輯專案檔案。

### 🔀 Git — 版本控制

內建 Git 面板：Status、Log、Diff、Blame、Changes、Add、Commit、Push、Pull。

### ⏰ CronJob — 排程任務

排程執行 Skill 或 App，支援 AI agent 透過 Tool 動態建立 / 管理。

### 🔄 A2A Protocol — Agent 間通訊

標準 JSON-RPC A2A Protocol，每個 agent 有獨立 endpoint（`/a2a/architect`、`/a2a/developer` 等）。

---

## 🛠️ AI Agent 工具一覽

AI agent 透過共享 Tool Registry 存取 **75+ tools**：

### 檔案與程式碼
| Tool | 說明 |
|------|------|
| `read_file` / `write_file` / `edit_file` | 讀寫編輯檔案 |
| `glob` / `grep` | 搜尋檔案與內容 |
| `diff` | 檔案差異比對 |
| `bash` | 執行 shell 指令 |
| `project_run_command` | 跑 build / test / lint（白名單安全限制） |

### Git
| Tool | 說明 |
|------|------|
| `git` | Git 操作（status / log / diff / blame / add / commit） |

### 專案知識
| Tool | 說明 |
|------|------|
| `project_context` | 專案概況 |
| `project_features` | 功能清單 |
| `project_standards` | 程式規範 |
| `project_decisions` / `record_decision` | 決策紀錄 |
| `project_changelog` / `update_changelog` | 變更紀錄 |
| `project_faq` | 常見問題 |
| `project_runbook` | 操作手冊 |
| `project_security` | 安全資訊 |
| `project_test_map` | 測試對照表 |

### Issues
| Tool | 說明 |
|------|------|
| `project_issues` | 列出 / 篩選 issue |
| `project_issue_create` | 建立 issue |
| `project_issue_update` | 更新 issue |
| `project_issue_delete` | 刪除 issue |

### 記憶與筆記
| Tool | 說明 |
|------|------|
| `agent_memory_save` / `agent_memory_load` | Agent 長期記憶 |
| `action_log_add` / `action_log_list` | 動作紀錄 |
| `notes_search` / `notes_get` / `notes_create` | 筆記搜尋與管理 |
| `memory_add` / `memory_update` | 記憶管理 |

### API 測試
| Tool | 說明 |
|------|------|
| `project_api_history` | 讀取 API Tester 歷史紀錄 |

### 專案變更
| Tool | 說明 |
|------|------|
| `project_recent_changes` / `project_change_record` | 最近變更 |
| `project_sessions` | 對話歷史 |
| `update_docs` | 更新文件 |

### App 與排程
| Tool | 說明 |
|------|------|
| `app_list` / `app_create` / `app_edit` | App 管理 |
| `schedule_cronjob` / `list_cronjobs` / `run_cronjob` | 排程管理 |
| `project_status` / `project_update_task` | 專案狀態 |

### 互動
| Tool | 說明 |
|------|------|
| `ask_user` | 向使用者提問 |
| `browser_test` | 瀏覽器測試 |

---

## 🏗️ 架構

```
使用者
  ↓ 聊天視窗 / App 視窗 / A2A
  ↓
AI Crew (7 agents)
  ↓ 共享 Tool Registry (75+ tools)
  ↓
Skills + Apps + Memory + Issues
  ↓
知識飛輪：資料 → AI 讀取 → 產生洞見 → 回饋
```

### 多 Loop + 共享 Registry

PAAW 有兩個獨立的 agent loop：

- **Loop A**（`paaw-agent-loop.mjs`）— Coding agents 主力 loop（架構師、Developer、Tester 等）
- **Loop B**（`ToolEngine`）— Chat / A2A / Helpdesk loop

兩個 loop 透過 **共享 Tool Registry** 統一管理 tools。新增 tool 只需 `register()` 一次，兩個 loop 同時生效（OCP 原則：loop closed、tool open）。

### A2A Protocol

每個 agent 有獨立的 A2A endpoint，支援 JSON-RPC `message/send`：

```
POST /a2a/architect    — 架構師
POST /a2a/developer    — Developer
POST /a2a/tester       — Tester
POST /a2a/doc-writer   — Doc Writer
POST /a2a/qa           — QA
POST /a2a/helpdesk     — Helpdesk
POST /a2a/em           — EM 大總管
```

---

## 📁 目錄結構

```
tPAAW/
├── packages/
│   ├── ui/                     ← React 前端 (Vite + Tailwind + i18n)
│   ├── server/                 ← HTTP + WebSocket API server
│   │   ├── src/
│   │   │   ├── lib/            ← 核心邏輯
│   │   │   │   ├── paaw-agent-loop.mjs    ← Loop A (coding agents)
│   │   │   │   ├── tool-engine/           ← Loop B (chat/a2a/helpdesk)
│   │   │   │   ├── tool-registry.mjs      ← 共享 Tool Registry
│   │   │   │   ├── tool-registry-init.mjs ← Registry 初始化
│   │   │   │   ├── agent-rules.mjs        ← Agent 硬性規則
│   │   │   │   ├── overnight-manager.mjs  ← Night Shift
│   │   │   │   ├── night-shift-shared.mjs ← Night Shift 共用
│   │   │   │   ├── domain-agent-registry.mjs
│   │   │   │   └── llm-utils.mjs
│   │   │   ├── routes/         ← API routes (31 files)
│   │   │   ├── tools/          ← Tool definitions + handlers
│   │   │   └── paaw-server.mjs ← Server entry
│   ├── shared/                 ← 共用型別、工具
│   ├── db/                     ← SQLite + Kysely ORM
│   ├── context/                ← Context 管理
│   └── engine/                 ← 執行引擎
├── data/                       ← 使用者資料
│   ├── crews/                  ← AI 成員定義 JSON + 頭像
│   ├── skills/                 ← Skills 定義
│   ├── apps/                   ← App 定義 + 資料
│   ├── config/                 ← Provider、設定
│   ├── chats/                  ← 對話歷史
│   ├── notes/                  ← 筆記
│   ├── llm-logs/               ← LLM API 呼叫紀錄
│   ├── api-tester-history.json ← API Tester 歷史
│   └── coding-memory/          ← Agent 對話記錄
├── .paaw/
│   ├── agent-memory/           ← Agent 長期記憶
│   ├── night-shift/            ← Night Shift 設定 + 報告
│   ├── issues/                 ← Issue Tracker 資料
│   ├── coding-memory/          ← Coding agent 對話
│   └── sessions/               ← 工作階段記錄
└── docs/                       ← 文件
```

---

## 🚀 快速開始

```bash
npm install
npm run dev
```

- Dashboard: http://localhost:5173
- API Server: http://localhost:4097

### AI Provider 設定

在 `data/config/providers.json` 設定 LLM Provider：

```json
{
  "zai": { "apiKey": "...", "baseUrl": "..." },
  "openrouter": { "apiKey": "...", "baseUrl": "..." }
}
```

支援 model fallback chain：primary model 限流時自動切換到 fallback。

---

## 🔒 安全設計

### Agent Commit 規則

PAAW 的 coding agents **只能 commit，不能 push**。Push 由人類決定。

### Shell 指令安全

`project_run_command` 工具限制：

- ✅ **允許：** `npm`、`npx`、`yarn`、`pnpm`、`node`、`tsc`、`mvn`、`gradle`、`python`、`pip`、`cargo`、`go`、`make`、`dotnet`
- ❌ **禁止：** `rm`、`git push`、`git reset`、`sudo`、`curl`、`wget`、`>`、`|`、`;`、`&&`、`||`
- ⏱️ Timeout：預設 60 秒，最長 300 秒
- ✂️ 輸出截斷：最多 8000 字

---

## 🌐 i18n

支援 4 種語言：繁體中文 (`zh`)、英文 (`en`)、日文 (`ja`)、中日混合 (`zh-mix`)。

---

## 🧰 技術棧

| 層 | 技術 |
|----|------|
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS |
| Server | Node.js HTTP + WebSocket (node-pty) |
| Database | SQLite + Kysely ORM |
| Architecture | npm workspaces monorepo |
| AI Protocol | A2A (JSON-RPC) |
| LLM | OpenAI-compatible API (GLM 5.1 / DeepSeek / OpenRouter) |

---

## License

MIT
