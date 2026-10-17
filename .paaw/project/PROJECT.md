# paaw

> 📄 Schema v2 · AI 區每次 CU 重寫 · 上次生成 2026-10-16 13:00 · User Remarks 由人維護

<!-- USER:START — 人的區（AI 絕不覆蓋） -->
## 📌 User Remarks

## 📌 User Remarks

## 📌 User Remarks

（人在 UI 或直接編輯這區 — AI 絕不覆蓋。放專案背景、地雷、口頭知識…）

<!-- USER:END -->

<!-- AI:START — CU 自動生成區（每次重寫，人改會被覆蓋） -->
## 🤖 AI Overview

### 一句話定位
PAAW（Personal AI Assistant Workspace）是一個讓個人使用者「Build your personal AI Workforce」的一體式工作區：透過 AI 助理對話、Coding IDE、Skill/Workflow/Agent 執行運行時與自動派工編排，把個人 AI 團隊從開發到維運全套跑起來。

### 架構與模組
Monorepo 架構（npm workspaces：`@paaw/ui` 前端、`@paaw/server` 伺服器，另有 `@paaw/db`、`@paaw/context`、`@paaw/engine`、`packages/shared` 等基礎 workspace packages）。程式規模：約 2,527 個函式、4,450 個符號、126 個 error codes。依 features 推模組分佈：

- **核心 runtime**：伺服器入口、Agent Loop、Tool Engine、Security Kernel 安全鏈、LLM Utils、SQLite（sql.js/Kysely）嵌入式資料庫、Context Engine 與記憶
- **Coding 子系統**：Coding IDE 多頁簽工作台、coding.mjs 樞紐路由（80 APIs）、Code Intelligence（tree-sitter）、Feature Map、任務板/Issue/Release Manager（證據式放行）、交接、維運 Runbook、Release Unit 情報中心
- **AI 編排**：EM 自動派工（Night Shift）、Skill/Workflow 執行、A2A 協定、Cron 排程、Skill Builder、Skill Instance Model
- **周邊與 UI**：內建瀏覽器（人機共駕）、聊天、筆記、AI 客服中心、安裝式應用模組（learning/pm/secret/sre）、i18n、報表與審計面板
- **Bridge**：沙箱外宿主守門橋接器（:4100）

### 如何建置/跑/測
bash
npm run dev          # 同時跑 UI + API（concurrently）
npm run dev:ui       # 只跑前端
npm run dev:server   # 只跑後端
npm run build        # 建置 UI
npm run start        # 啟動 server
npm run start:prod   # node scripts/prod-server.mjs
npm run typecheck    # 型別檢查（UI）
npm run test         # vitest run
### Feature 清單（表格：| Feature | 說明 | 檔案數 |）

| Feature | 說明 | 檔案數 |
| --- | --- | --- |
| F20261016-001 Next.js 16 非同步路由參數技能範本 | 示範 Next.js 16 params/searchParams/cookies()/headers()/draftMode() 非同步寫法的單一 TSX 範本檔 | 1 |
| F20261016-002 Next.js 16 非同步 Params 頁面範本 | App Router 頁面範本，params/searchParams 改 Promise 後的可貼上骨架 | 1 |
| F20261016-003 Next.js 16 「use cache」快取範本教材 | 註解式範例教學 "use cache"：元件/函式/頁面級、PPR、標籤失效等 8 段示範 | 1 |
| F20261016-004 Next.js 16 平行路由範例教材 | Parallel Routes 最佳實踐樣板（技能知識庫內） | 1 |
| F20261016-005 Next.js Route Handler API 範本 | app/api/[...]/route.ts 教學型樣板檔 | 1 |
| F20261016-006 Next.js Server Actions 表單範本 | Server Actions 處理表單完整寫法範本 | 1 |
| F20261016-007 PAAW Bridge | 沙箱外宿主守門橋接器（:4100）：同步審查、API 代理、容器生命週期 | 2 |
| F20261016-008 Skill/Workflow/Agent 執行運行時與 API | Agent Loop、Tool Registry、對話壓縮、workflow/crew/apps 路由層 | 2 |
| F20261016-009 A2A 代理協作協定服務 | JSON-RPC 2.0 實作 A2A v1.0，支援同步/SSE/webhook | 2 |
| F20261016-010 Agent 執行日誌與保留政策 | 任務軌跡查詢、token/成本統計、三類日誌保留與 purge | 1 |
| F20261016-011 外部整合設定：Plugins 與 Agentic 綁定 | iframe 插件與 Agentic workflow 工具註冊，JSON 檔為單一資料源 | 2 |
| F20261016-012 AI 設定與記憶蒸餾中心 | AI Settings（提示詞/Provider/執行設定）+ Distill 記憶蒸餾引擎 | 1 |
| F20261016-013 個人助理設定與工作區中樞 | /api/paaw/* 設定端點：頭像、模型鏈、Workflow CRUD、匯入匯出等 | 3 |
| F20261016-014 共用內建瀏覽器 API | Playwright headless 瀏覽器的串流、輸入回注、分頁/下載/錄影 API | 1 |
| F20261016-015 AI 助理對話後端 | session CRUD、SSE 串流、圖片上傳（Vision）、提示詞管理 | 1 |
| F20261016-016 自動派工控制端點 | Auto Dispatch start/stop/reset/preview/status 等 7 端點 | 1 |
| F20261016-017 編碼團隊派工與專案知識後端 | Coding Crew 對話派工、EM 規劃、.paaw 知識庫、安全護欄 | 1 |
| F-023 檔案系統與 Git 操作服務 | vibe-fs 檔案讀寫/搜尋 + git 操作 + 文件覆蓋率追蹤 | 2 |
| F-056 EM 調度設定管理 | {project}/.paaw/em/config.json 的讀取/深合併/重設 | 1 |
| F20261016-020 交接狀態彙整與交接包生成 | on-demand 交接包 API + deterministic 交接狀態彙整器 | 13 |
| F-030 程式碼問題追蹤 API | Issue CRUD/統計/筆記，存於 .paaw/issues/ISSUES.json | 1 |
| F-041 維運狀態與 Runbook 管理 | git 狀態、runbook 讀寫、release 摘要，供 Ops AI 診斷 | 2 |
| F-037 上線放行與證據決策卡 | Release Manager 放行流程 + Trust Score 證據卡 | 1 |
| F-048 Release Unit 技能實例管理 | skill clone 進 {ru}/.paaw/skills/，跟 RU 存檔/移機/handover | 1 |
| F20261016-025 暫存變更摘要儲存 | staged-changes.json 的 GET/POST/DELETE | 2 |
| F20261016-026 個人助理設定與使用者檔案 API | /api/paaw/* 32 個 API：檔案、Provider、開發模式、白名單 | 1 |
| F20261016-027 安全審計紀錄查詢 | audit-*.jsonl 唯讀報表 API，免 Elasticsearch | 1 |
| F-043 內建共用瀏覽器 | 16 個 /api/browser/* 端點，人機共駕、CDP 串流、操作回放 | 1 |
| F-011 AI 助理對話服務 | chat.mjs + uploads.mjs，附件存路徑不存 base64 | 2 |
| F20261016-030 自動派工執行控制 API | 7 端點管理派工生命週期，執行邏輯委託 lib 模組 | 1 |
| F20261016-031 Coding Agent 團隊對話派工與專案知識庫 API | 最大後端樞紐（coding.mjs 4300+ 行），80 個 API | 6 |
| F-028 文件覆蓋率追蹤與專案檔案 Git 操作 API | doc-coverage + vibe-fs runGit，兩者實體耦合 | 3 |
| F20261016-033 EM 總管編排行為設定管理 | 編排行為設定（非 prompt/頭像），UI 為 EM Dashboard | 2 |
| F-014 編碼專案議題追蹤與已知問題匯入 | Issue CRUD、KNOWN-ISSUES.md 匯入，EM 派工讀取上下文 | 1 |
| F-027 維運現況總覽與 Runbook 存取 | 維運總覽 + runbook 讀寫，Ops AI 同源讀取 | 1 |
| F-019 上線放行閘門與證據審查 | coding-releases/evidence + RR 單狀態機 | 4 |
| F20261016-037 Code Review 委員會會議記錄瀏覽 | .paaw/review-board/*.md 唯讀 API 供會議記錄頁渲染 | 1 |
| F20261016-038 專案 AI 團隊與技能資產管理 | per-project agents/ 與 skills/，模板跟版 | 3 |
| F20261016-039 AI 暫存變更交接摘要 | staged_summary tool ↔ Git 面板的交接樞紐 | 1 |
| F-015 Coding 任務板 | feature-first 任務 CRUD + TaskGit 任務級 git 操作 | 2 |
| F-024 自動派工執行計畫管理 | Execution Plan 狀態機、中斷恢復、多消費端 | 2 |
| F-036 AI 客服中心 | A2A/人類提問、ToolEngine 作答、票務管理 | 1 |
| F20261016-043 系統清理總管（Janitor）與 Console 日誌檢視器 | log/ 垃圾層清理，不碰 data/ 與 .paaw | 2 |
| F20261016-044 LLM 呼叫日誌查詢、審計與 Skill 使用報表 | 聚合 llm JSONL 日誌：token/成本統計、審計、Skill 注入報表 | 1 |
| F-035 筆記本管理與 AI 筆記整理 | 三層筆記系統（Notebook→Section→Note）22 端點 + AI 整理 | 1 |
| F-049 外部插件註冊與 iframe 嵌入管理 | web app 註冊為側欄插件、iframe 分頁 | 1 |
| F-018 Release Unit 專案情報中心 | 29 個 /api/ru/* 端點：依賴圖、影響分析、健康評分、問答 | 10 |
| F-002 共用 API 資料契約 | TypeBox schemas，無執行邏輯 | 1 |
| F20261016-049 AI 編碼工作台 | App.tsx 殼 + CodingIDE 三欄工作區，25 種頁簽 | 20 |
| F-031 自訂 Agent 建立精靈 | 4 步驟 Modal 精靈，含快速模板與工具預設 | 1 |
| F20261016-051 Agent 執行軌跡檢視與 RU 成本觀測 | 任務清單、RU token/USD 成本、逐步時間線 | 1 |
| F20261016-052 AI 安全審計紀錄面板 | 安全事件紀錄面板（audit-log.jsonl） | 1 |
| F20261016-053 create（自動命名） | （agent 長肉失敗，自動降級）此 feature 含 0 個檔案 | 0 |
| F20261016-054 AI 團隊成員角色頭像產生器 | 確定性 SVG 圓形頭像，無狀態 | 1 |
| F-013 Git 提交輸入列與 AI Commit 訊息生成 | 固定提交列 + AI 生成 commit message | 1 |
| F20261016-056 Git 差異檢視 | Diff 分組摺疊瀏覽、歷史提交雙欄檢查 | 1 |
| F20261016-057 Git 變更審查與提交面板 | Status/Diff 主面板，整合證據卡與 unpushed 審查 | 2 |
| F20261016-058 LLM API 呼叫日誌檢視器 | 配對日誌表格 + 統計 + 單筆詳情 | 1 |
| F20261016-059 模組 App 免建置動態頁面載入 | esbuild 即時 bundle + blob 動態 import | 2 |
| F20261016-060 Release Unit 新人 12 問證據式問答入口 | 12 題固定 onboarding 問答 UI | 1 |
| F20261016-061 Skill 注入使用報表 | 哪些 skill 被注入、誰在用、注入多少字 | 1 |
| F20261016-062 Agent 用量與成本報表 | 前端聚合每日長條圖與四張交叉表 | 1 |
| F-058 UI 多語系介面（i18n） | 自建輕量 i18n：Context + hook + 四份字典 | 1 |
| F-032 Skill Builder 工作台 | 對話式技能建構、測試與發佈 + AgentConsole | 2 |
| F-053 簡報播放器 | 圖片+Markdown 自動配對投影片播放 | 1 |
| F20261016-066 個人 AI 助理主對話介面 | ChatView 主聊天頁，跨頁注入訊息入口 | 1 |
| F-045 專案甘特圖時程檢視 | 唯讀時間軸任務視覺化 | 1 |
| F-040 系統設定中心與備份還原 | 九分頁設定中樞 + 備份還原 | 2 |
| F20261016-069 安裝式應用模組伺服器端 | learning/pm/secret/sre 四模組路由層 + 共用 sheets 引擎 | 17 |
| F20261016-070 AI 助理核心基礎套件 | @paaw/db（SQLite）、@paaw/context、@paaw/engine | 20 |
| F20261016-071 PAAW 核心 runtime | 伺服器入口、安全鏈、Tool Engine、EM 派工編排 | 39 |
| F20261016-072 工作區周邊功能 API 與通用 App 工具引擎 | 五個獨立路由 + Universal App Engine | 6 |
| F20261016-073 共用型別契約與前端基礎工具層 | packages/shared 型別與工具 + UI 基礎 | 7 |
| F20261016-074 建置測試設定與產品打包維運腳本 | Vite/Playwright/Vitest 設定 + scripts/ 維運工具鏈 | 10 |
| F-001 PAAW Server Core & HTTP Entrypoint | HTTP server、route loading、crash logging、WebSocket、EPIPE guard | 5 |
| F-003 SQLite Database Layer | sql.js/Kysely 連線、migrations、repositories | 8 |
| F-004 Context Engine & Refinery | 記憶儲存、token 估算、context refinery | 4 |
| F-005 Server Context Engine | providers/skills/profile/memory/workspaces 動態 context 組裝 | 2 |
| F-006 Agent Loop | tool-calling loop 的 AI runtime | 1 |
| F-007 Tool Engine (Server) | provider adapter、tool registry、寫入驗證、安全整合 | 7 |
| F-008 Engine Tool Engine (TS) | OpenAI-compatible adapter + tool registry | 4 |
| F-009 Skill Runner & Workflow Engine | 四種 runner + 拓撲排序 workflow | 3 |
| F-010 LLM Utils & Provider Retry | 模型解析、內容清理、retry/backoff | 2 |
| F-012 Coding IDE | 主工作區：檔案樹、編輯器、Terminal、Git、瀏覽器 | 8 |
| F-016 Feature Mapping | Feature map CRUD、AI 理解、覆蓋率統計 | 5 |
| F-017 Code Intelligence | tree-sitter 符號索引、call graph、依賴圖 | 5 |
| F-020 Coding Health | 程式健康評分面板 | 4 |
| F-021 Coding Security (Path Safety) | ID 清理、路徑穿越防護、對話清理 | 1 |
| F-022 Security Kernel | 政策管線、審批、secret store、審計 | 5 |
| F-025 Agent Memory | per-agent 記憶儲存與編輯面板 | 3 |
| F-026 Coding Handover | 交接包生成（git/plans/issues/decisions） | 3 |
| F-029 Tests Page | 測試情報檢視與 AI 詢問覆蓋缺口 | 1 |
| F-033 App Builder & App Pool | 從 skill 建 App、預覽、發佈與管理 | 4 |
| F-034 Workflow Editor & Execution | ReactFlow 視覺編輯 + 拓撲執行 | 3 |
| F-038 System Prompts | per role/agent 系統提示詞編輯 | 2 |
| F-039 Cron Jobs & Scheduler | Cron CRUD、排程執行、投遞對話 | 2 |
| F-042 Knowledge Distillation | 從 chat/vibe/cron 互動蒸餾知識檔 | 1 |
| F-044 Mind Map Generation | LLM 心智圖 + markmap 渲染 | 2 |
| F-046 Knowledge Tree & File Management | 知識目錄樹管理與 .paaw tree 初始化 | 8 |
| F-047 Vibe Sessions | vibe coding session 持久化 | 1 |
| F-050 Employee Workspace | 員工 agent 啟動任務的工作區 | 1 |
| F-051 Orchestrator Views | 編排者總覽（mock data 驅動） | 12 |
| F-052 Ops Dashboard (Mock) | 維運中心/監控/RCA/閘門儀表板（mock） | 5 |
| F-054 Project Dashboard & Decision Log | 專案統計 + ADR 決策紀錄檢視 | 4 |
| F-055 Pocket & Session History | 隨手筆記與 session 歷史 | 2 |
| F-057 Context Compaction & Truncation | token 估算、工具結果截斷、對話壓縮 | 2 |
| F-059 Coding Cost Attribution | coding 任務與 RU 的成本歸因 | 2 |
| F-060 CU Mechanical Rescan & Source Scan | CU 機械層重掃與原始檔計數 | 2 |
| F-061 Build & Ops Scripts | 打包、paaw sync、postinstall、runtime guard scanner | 5 |
| F-062 Shell Execution & Utilities | 跨平台 shell exec、雜項工具 | 7 |

### 維運要點
- **測試現況**：共 69 個測試檔（unit 58、e2e 11、integration 0、contract 0）；跑 `npm run test`（vitest run），E2E 使用 Playwright。Integration 與 contract 測試為 0，釋出前建議補強。
- **Error codes**：系統定義 126 個 error codes，排障時可依 code 對照。
- **維運提醒**：
  - 日誌落在 `log/`（LLM 呼叫 JSONL、audit-YYYY-MM-DD.jsonl），有保留天數政策與 Janitor 清理，Janitor 不會動 `data/` 使用者資產與 `{ru}/.paaw`。
  - Bridge 服務跑在宿主機 :4100，是沙箱與外部唯一通道，需確認其健康（/health）。
  - 審計與日誌查詢為 JSONL 檔案直讀，不依賴 Elasticsearch；注意磁碟成長。
  - 自動派工有 reset 端點可清殭屍狀態。

### 最新決策
- ADR-020: Constrained Shell Execution for AI Agents (project_run_command)
- ADR-019: Shared Tool Registry (OCP-compliant)
- ADR-018: Night Shift 三模組職責邊界與分層策略

<!-- AI:END -->
