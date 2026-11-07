# PAAW — Personal AI Assistant Workspace

**Build your personal AI Workforce.**

PAAW 讓知識工作者用 AI 打造自己的工具，AI 幫你記資料，再把記下來的東西放大成可執行的能力。

> 人用 AI 自己做工具 → AI 幫你記資料 → AI 放大你記的資料 → 形成能力飛輪

---

## 🚀 安裝與使用

### 需求

- Node.js 20+（建議 22+）
- 任何一個 OpenAI-compatible LLM API（GLM / DeepSeek / OpenRouter / Anthropic…）

### 安裝

```bash
git clone <your-repo-url> paaw && cd paaw
npm install
```

### 設定 AI Provider

複製範例設定並填入你的 API key：

```bash
cp data/config/providers.example.json data/config/providers.json
```

編輯 `data/config/providers.json`：

```json
{
  "active": "zai",
  "providers": {
    "zai": {
      "name": "Z.ai GLM",
      "baseURL": "https://api.z.ai/v1",
      "apiKey": "你的-api-key",
      "models": [{ "id": "glm-5.1" }]
    }
  },
  "fallbacks": []
}
```

- `active` — 預設使用的 provider
- `fallbacks` — 備援鏈：主 model 限流時自動切換（可留空）

### 啟動

**生產模式（建議）：**

```bash
npm run build   # 建構前端
npm start       # 啟動 server（API :4097，前端由 server serve）
```

開啟 **http://localhost:4097**

**開發模式：**

```bash
npm run dev     # API server :4097 + Vite dev UI :5173
```

開啟 **http://localhost:5173**（Vite 會 proxy API 到 4097）

### 跑測試

```bash
npm test        # 全套 vitest（85 檔 / 1700+ tests）
```

### 埠一覽

| Port | 用途 |
|------|------|
| 4097 | API server（HTTP） |
| 4098 | 終端機 WebSocket（node-pty） |
| 5173 | 開發模式 Vite UI（僅 `npm run dev`） |

---

## ✨ 核心功能

### 💬 Chat Assistant — 聊天即工作

所有 App、Skill 在聊天視窗都能用，觸發關鍵字自動路由到對應 Tool。

- 主助理（林雨晴）統一入口，自然語言叫用任何 App / Skill
- 附件上傳、Markdown 渲染（表格、程式碼區塊、引用）
- 每個 App 自動註冊為聊天 Tool — 說一句「幫我翻譯」就路由到翻譯 App

### 🤖 AI Crew — 自組 AI 團隊

每個成員有獨立的角色、技能、個性、記憶與對話歷史，透過 A2A Protocol 互相協作。

| Agent | 代號 | 職位 |
|-------|------|------|
| 🏛️ 架構師 | 林曉薇 Xiaowei Lin | 系統架構設計、技術決策 |
| 💻 Developer | 普里亞·夏爾馬 Priya Sharma | 寫程式、實作功能 |
| 🧪 Tester | 迪維雅·雷迪 Divya Reddy | 撰寫與執行測試 |
| 📝 Doc Writer | 梅根·布魯克斯 Megan Brooks | 撰寫技術文件 |
| 🛡️ QA | 武大安 Da'an Wu | Code Review、品質把關 |
| 🎧 Helpdesk | 小春 林 Koharu Hayashi | 協助排查問題 |
| 🎖️ EM 大總管 | 陳哲宇 Ethan | 專案管理、自動派工調度 |

### 🏗️ Coding App — AI 軟體工廠（Release Unit Control Plane）

PAAW 最重要的應用：把「一個 repo = 一個 Release Unit」交給 AI 團隊開發，人類只做決策與 review。

**工作流程：**

```
開 task（人或 EM）→ EM 派工 → agent 寫碼 → 測試證據 → Review Board 審 → 人類決策卡 → release
```

- **📋 Task Pipeline** — spec → implement → test → review → release 的結構化 pipeline；bootstrap 階段可用短版（spec → implement → commit）快速迭代
- **🎖️ EM Auto Dispatch** — EM 大總管自動調度：掃描待辦 task、規劃順序、依序派發給 AI Crew（EM 模式），或 6 agent 並行（Parallel 模式）；進度即時輪詢（status.json events），跑完自動產報告
- **🔍 Review Board** — 多模型 code review（baseline..HEAD），产出 approve / review-notes / request-changes 結論 + 證據矩陣；request-changes 自動開 issue 打回
- **✅ 測試證據（Evidence）** — 測試結果保鮮落檔，覆蓋率變化追蹤；「No answer without evidence」— 沒有證據的結論不算數
- **🪪 決策卡（Approval Card）** — agent 要跑危險指令時跳出審批卡，人類批准才執行；唯讀操作不卡
- **🐛 Issues Tracker** — 內建 issue 管理（ISS-001 遞增、狀態機 open→resolved、KNOWN-ISSUES.md 匯入）；AI agent 直接讀寫
- **🏥 Code Health** — 專案健康掃描：測試失敗、type 錯誤、dead code；發現問題可開修復 task
- **🧩 RU Skills** — 把全域 skill 綁定到專案（clone 進 `.paaw/skills/`），agent 對話自動掛載；掛載 vs 回讀有 engagement 統計（掛了沒人讀 = context 浪費訊號）
- **📚 Doc Coverage** — 文件覆蓋率（哪些 feature 沒文件）
- **📦 Releases / Handover** — release 打包 + 交接狀態（目前改了什麼、測到哪、下一步）
- **🔧 Troubleshooting** — 修復知識庫：git fix commits + bug tasks + error codes 聚合成 deterministic facts，零 token 查詢

**鐵律：** agent 只能 commit 不能 push（push 由人類決定）；agent 只能重啟本專案的 dev server，PAAW 本身的 process 不可動。

### 🔧 Skill Builder — 最小能力單元

Skill 是 PAAW 的最小能力單元，可被 App、AI Crew、CronJob 叫用。

- 定義結構：Purpose → Inputs → Tool Access → Deterministic Script → Guardrails → Output Contract → Validation
- AI 輔助生成：描述需求，AI 自動產生 Skill 定義
- Skill 自動註冊為 Chat Tool

### 📦 App Builder — 資料驅動應用

用 AI 打造自己的工具，每個 App 自動產生聊天 Tool。

- **Skill-based App** — 基於 Skill 定義，AI 產生 HTML + Schema
- **Data-driven App** — 結構化資料 + AI 洞見
- **雙入口** — 聊天視窗說一句話，或點開 App 視窗都能用
- **自動 Tool 註冊** — 新 App 自動成為聊天可呼叫的 Tool

### 🌊 Workflow Builder — 工作流編排

把 Skill / App / Agent 串成多步驟工作流，條件分支、循環、人工節點。

### ⏰ Execution Center — 排程與監控

- **CronJob** — 排程執行 Skill 或 App；AI agent 透過 Tool 動態建立 / 管理
- 執行歷史與狀態監控

### 🧠 Knowledge & Memory

- **Knowledge** — 專案知識庫文件
- **Notes** — 結構化筆記（Notebook + Section 分層）
- **Agent Memory** — 每個 agent 獨立長期記憶（`.paaw/agent-memory/`），跨對話保留
- **Project Docs** — 決策紀錄、changelog、FAQ、runbook，agent 可讀可寫

### 📁 檔案與 Git

- **File System** — 內建檔案瀏覽器：瀏覽、讀取、編輯
- **Git 面板** — Status、Log、Diff、Blame、Changes、Add、Commit、Push、Pull

### 🔬 開發者工具

- **API Tester** — 自動掃描專案 API routes、按 path 分組、歷史紀錄（AI 可讀來開發 E2E 測試）
- **LLM API Log** — 每次 LLM 呼叫自動記錄：時間、agent、model、token、耗時、tool 呼叫審計（allow-list 比對）
- **Audit Log** — 安全事件稽核（blocked tool calls、審批軌跡）
- **Skill Engagement** — skill 掛載 vs 回讀統計（context 浪費訊號）

---

## 🛠️ AI Agent 工具一覽

AI agent 透過共享 Tool Registry 存取 **75+ tools**：

### 檔案與程式碼
| Tool | 說明 |
|------|------|
| `read_file` / `write_file` / `edit_file` | 讀寫編輯檔案 |
| `glob` / `grep` | 搜尋檔案與內容 |
| `diff` | 檔案差異比對 |
| `bash` | 執行 shell 指令（見安全設計） |
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
Skills + Apps + Memory + Issues + Coding Pipeline
  ↓
知識飛輪：資料 → AI 讀取 → 產生洞見 → 回饋
```

### 多 Loop + 共享 Registry

PAAW 有兩個獨立的 agent loop：

- **Loop A**（`paaw-agent-loop.mjs`）— Coding agents 主力 loop（架構師、Developer、Tester 等）
- **Loop B**（`ToolEngine`）— Chat / A2A / Helpdesk loop

兩個 loop 透過 **共享 Tool Registry** 統一管理 tools。新增 tool 只需 `register()` 一次，兩個 loop 同時生效（loop closed、tool open）。

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

### 目錄結構

```
paaw/
├── packages/
│   ├── ui/                     ← React 前端 (Vite + Tailwind + i18n)
│   ├── server/                 ← HTTP + WebSocket API server
│   │   ├── src/
│   │   │   ├── lib/            ← 核心邏輯
│   │   │   │   ├── paaw-agent-loop.mjs    ← Loop A (coding agents)
│   │   │   │   ├── tool-engine/           ← Loop B (chat/a2a/helpdesk)
│   │   │   │   ├── security/              ← Security Kernel（政策管線/審批/稽核/密鑰）
│   │   │   │   ├── em-*.mjs               ← EM 調度 / task store / job entrypoints
│   │   │   │   ├── auto-dispatch-*.mjs    ← 自動派工
│   │   │   │   ├── release-unit/          ← RU 模型 / 依賴圖 / 影響分析
│   │   │   │   └── shell-guard.mjs        ← bash process 範圍防護
│   │   │   ├── routes/         ← API routes
│   │   │   ├── tools/          ← Tool definitions + handlers
│   │   │   └── paaw-server.mjs ← Server entry
│   ├── shared/                 ← 共用型別、工具
│   ├── db/                     ← SQLite + Kysely ORM
│   ├── context/                ← Context 管理
│   └── engine/                 ← 執行引擎
├── data/                       ← 使用者資料（crews / skills / apps / config / chats / notes…）
├── .paaw/                      ← 各 Release Unit 的工作區（tasks / features / issues / agent-memory…）
└── tests/                      ← 測試
```

---

## 🔒 安全設計

### Security Kernel

每個 tool call 都過政策管線：參數檢查 → exec 安全 → fs 保護 → rate limit → 審批 gate。

- **危險指令硬擋** — `rm -rf /`、`mkfs`、fork bomb、`> /dev/sda`、遠端下載等，任何模式都擋（含空白混淆變體）
- **系統目錄保護** — `data/config/`、`data/db/` 不可被 fs 工具寫入
- **審批模式** — `auto`（開發，自動通過）/ `always`（每個寫入操作都要人工批准）/ `deny`（全拒）；唯讀工具永免審批
- **稽核日誌** — 每次 tool call 的 start / allowed / blocked 全落盤

### Agent Commit 規則

PAAW 的 coding agents **只能 commit，不能 push**。Push 由人類決定。

### Shell 指令安全

`bash` 工具的 process 範圍鐵律（shell-guard）：

- ❌ `pkill` / `killall` / `taskkill` / `fuser -k` — 一律擋（無法保證只打到本專案）
- ❌ 碰 PAAW 自身 process（paaw-server / port 4097、4098、4100、5173）
- ❌ 啟動第二份 PAAW
- ✅ `kill` 只放行本專案受控 dev-server 的 pid
- ✅ build / test / git / 一般查詢不受影響

`project_run_command` 白名單：

- ✅ `npm`、`npx`、`node`、`tsc`、`python`、`cargo`、`go`、`make`…
- ❌ `rm`、`git push`、`sudo`、`curl`、`wget`、管線與重導向
- ⏱️ Timeout 60s（最長 300s）、輸出截斷 8000 字

---

## 🌐 i18n

支援 4 種語言：繁體中文 (`zh`)、英文 (`en`)、日文 (`ja`)、中日混合 (`zh-mix`)。

---

## 🧰 技術棧

| 層 | 技術 |
|----|------|
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS |
| Server | Node.js HTTP + WebSocket (node-pty)，零外部 server 依賴 |
| Database | SQLite + Kysely ORM |
| Architecture | npm workspaces monorepo |
| AI Protocol | A2A (JSON-RPC) |
| LLM | OpenAI-compatible API（GLM / DeepSeek / OpenRouter…） |

---

## 測試

```bash
npm test
```

85 個測試檔 / 1700+ tests，覆蓋：API routes、Security Kernel 安全矩陣、ToolEngine 寫入驗證、Release Unit 模型、db 層、auto-dispatch 控制面。
