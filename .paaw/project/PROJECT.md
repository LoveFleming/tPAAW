# paaw

> 📄 Schema v2 · AI 區每次 CU 重寫 · 上次生成 2026-10-09 00:45 · User Remarks 由人維護

<!-- USER:START — 人的區（AI 絕不覆蓋） -->
## 📌 User Remarks

（人在 UI 或直接編輯這區 — AI 絕不覆蓋。放專案背景、地雷、口頭知識…）

<!-- USER:END -->

<!-- AI:START — CU 自動生成區（每次重寫，人改會被覆蓋） -->
## 🤖 AI Overview

### 一句話定位

PAAW（Personal AI Assistant Workspace）是一個個人 AI 助理工作區，讓使用者打造自己的 AI Workforce：包含 AI Agent runtime、coding IDE、任務板、技能/工作流/Agent 編排等完整功能，面向想以 AI 團隊進行開發與日常作業的個人使用者。

### 架構與模組

- 框架：資料中未列出特定框架（`frameworks` 為空）（資料待補）。
- 程式規模：約 1546 個 functions、2793 個 symbols（code intelligence 統計）。
- 結構：npm workspaces monorepo，包含 `@paaw/ui`（前端 UI）與 `@paaw/server`（Node HTTP server）兩個 workspace。
- 模組分佈（由 features 推導）：伺服器核心與 HTTP/WebSocket 入口（F-001）、共享型別與 schemas（F-002）、嵌入式 SQLite 資料庫層 sql.js/Kysely（F-003）、Context Engine 與 refinery（F-004/F-005）、Agent Loop 與 Tool Engine（F-006~F-008）、Skill/Workflow 引擎（F-009）、Coding IDE 與 Git/Issue/Task 管理（F-012~F-015）、Code Intelligence 與 Release Unit/Release Management（F-017~F-019）、Security Kernel 與路徑安全（F-021/F-022）、EM Dashboard 與自動派工（F-023/F-024）、A2A Protocol 與 Crew/Skills/Apps/Workflows（F-030~F-034）、Notes/Help Desk/專案管理/知識管理等應用（F-035~F-046）、備份/日誌/排程等維運功能（F-039~F-041）、瀏覽器自動化（F-043）、UI Shell/主題/i18n（F-058）等。

### 如何建置/跑/測

bash
# 同時跑 UI + API（開發）
npm run dev

# 分開跑
npm run dev:ui
npm run dev:server

# 建置（僅 UI）
npm run build

# 啟動
npm run start            # server workspace
npm run start:prod       # node scripts/prod-server.mjs

# 型別檢查（UI）
npm run typecheck

# 測試
npm run test             # vitest run
### Feature 清單（表格：| Feature | 說明 | 檔案數 |）

| Feature | 說明 | 檔案數 |
| --- | --- | --- |
| F-001 PAAW Server Core & HTTP Entrypoint | Main Node HTTP server, route loading, crash logging, WebSocket setup, EPIPE guard | 5 |
| F-002 Shared Utilities & Schemas | Shared types, typebox schemas (skills, workflows, apps, chat), ID/template utils | 4 |
| F-003 SQLite Database Layer (sql.js/Kysely) | Embedded database: connection, migrations, repositories for runs, chats, data store | 8 |
| F-004 Context Engine & Refinery | Context assembly with memory store, token estimation, and context refinery for agent prompts | 4 |
| F-005 Server Context Engine | Dynamic context building: providers, skills, user profile, memory, workspaces, runtime tools | 2 |
| F-006 Agent Loop | Self-owned AI runtime with tool-calling loop for coding tasks | 1 |
| F-007 Tool Engine (Server) | Tool engine with provider adapter, tool registry, write verification, security kernel integration | 7 |
| F-008 Engine Tool Engine (TS) | TypeScript tool engine with OpenAI-compatible provider adapter and tool registry | 4 |
| F-009 Skill Runner & Workflow Engine | Prompt/Data/Api/Script runners executing skills and topologically-sorted workflows | 3 |
| F-010 LLM Utils & Provider Retry | Model resolution, content sanitization, retry/backoff for LLM fetch and streaming | 2 |
| F-011 Chat Interface | Main chat UI with markdown rendering, tool badges, model switching, conversation CRUD | 5 |
| F-012 Coding IDE | Main coding workspace: file tree, editor, terminal, git panel, staged changes, browser panel | 8 |
| F-013 Git Integration Panel | Git status view, diff view, review view, commit bar with file grouping by category | 9 |
| F-014 Issue Tracking | Lightweight issue tracking stored in .paaw/issues with import of known issues | 2 |
| F-015 Task Board & Pipeline | Coding task board with phase pipeline, decompose, repair loop, health fix, overnight queue | 6 |
| F-016 Feature Mapping | Feature map CRUD, AI-generated understanding, refresh mapping, validation and coverage stats | 5 |
| F-017 Code Intelligence | Tree-sitter based symbol index, call graph, dependency graph, test code map, API function map, context packages | 5 |
| F-018 Release Unit Intelligence | Release unit model, dependency graphs, impact analysis, metrics, architecture view, API extraction, codebase QA | 20 |
| F-019 Release Management | Pending release approvals, test runs, readiness evidence, quality debt, retrofit | 7 |
| F-020 Coding Health | Code health score panel for the coding IDE | 4 |
| F-021 Coding Security (Path Safety) | ID sanitization, path traversal protection, conversation sanitization | 1 |
| F-022 Security Kernel | Policy pipeline, approval manager, secret store, audit log for tool execution | 5 |
| F-023 EM Dashboard & Auto Dispatch | Engineering Manager agent dashboard with dispatch planning, EM sessions, parallel sessions, auto dispatch reports | 9 |
| F-024 Execution Plans | Plan/subtask lifecycle for auto-dispatch execution: create, resume, mark completed, interrupted plans | 2 |
| F-025 Agent Memory | Per-agent memory storage and editing panel | 3 |
| F-026 Coding Handover | Handover state bundle generation (git, plans, issues, decisions, next actions) | 3 |
| F-027 Coding Ops & Troubleshooting | Ops status, runbook list/save, scripts, troubleshooting panel with runbook generation | 2 |
| F-028 Doc Coverage | Documentation coverage tracking and undocumented commit detection | 2 |
| F-029 Tests Page | Test intelligence view with AI ask for gaps and mapping | 1 |
| F-030 A2A Protocol | Agent-to-agent protocol endpoints: agent cards, task lifecycle, interrupt, streaming agent loop | 3 |
| F-031 AI Crew Management | Crew CRUD, agent editor, model/skill/fallback assignment, skill test run, CLI run | 8 |
| F-032 Skills System | Skill listing, creation (markdown format), import/export, skill builder wizard | 4 |
| F-033 App Builder & App Pool | App creation from skills, preview, publish, and published app pool management | 4 |
| F-034 Workflow Editor & Execution | Visual ReactFlow workflow editor with skill/tool nodes, topological execution, results view | 3 |
| F-035 Notes App | Notebook/section-based note management with AI write, search, tags, pinning, images | 2 |
| F-036 Help Desk | AI helpdesk with ticket management, knowledge base, skill-driven answers | 2 |
| F-037 Assistant & User Settings | User profile, avatar, app rules, providers, workspaces, UI state, version, knowledge paths | 6 |
| F-038 System Prompts | System prompt file editing per role/agent | 2 |
| F-039 Cron Jobs & Scheduler | Cron job CRUD, scheduled execution with agent loop, delivery to chat, agent-run endpoints | 2 |
| F-040 Backup & Restore | Backup config, tar.gz creation/restore, cleanup, cron-triggered sync backup | 2 |
| F-041 Log Management & Retention | LLM logs, agent exec logs, cost history, retention config, purge | 6 |
| F-042 Knowledge Distillation | Distill knowledge from chat/vibe/cron interactions into knowledge files via LLM | 1 |
| F-043 Shared Browser Session | Playwright browser automation: tabs, navigation, dialogs, downloads, clipboard, screencast streaming, install setup | 5 |
| F-044 Mind Map Generation | LLM-generated mind maps from files/directories rendered with markmap | 2 |
| F-045 Project Management Board | Project board with categories, tasks, milestones, Gantt chart, project AI panel | 4 |
| F-046 Knowledge Tree & File Management | Knowledge directory tree with rename, move, import picker, .paaw tree init/generate | 8 |
| F-047 Vibe Sessions | Session persistence for vibe coding workflows | 1 |
| F-048 API Tester | API proxy, save, and streaming test endpoints | 1 |
| F-049 Plugins & Agentic Bindings | Plugin registry CRUD and agentic binding config (bind tools to plugins) | 4 |
| F-050 Employee Workspace | Workspace for employee agents to launch assigned tasks with model selection | 1 |
| F-051 Orchestrator Views | Orchestrator overview and workspace with node contracts, flow steps, decision rules, observability, API specs (mock data driven) | 12 |
| F-052 Ops Dashboard (Mock) | Operations center, monitoring, RCA, gates dashboards driven by mock data | 5 |
| F-053 Briefing Player | Markdown briefing renderer with highlight.js and draggable reference markers | 1 |
| F-054 Project Dashboard & Decision Log | Project stats dashboard and ADR decision log viewer with add capability | 4 |
| F-055 Pocket & Session History | Pocket notes storage and session history listing | 2 |
| F-056 PAAW Bridge (Docker Sync) | Bridge server for container sync requests, diffs, approvals, tool proxy, container updates | 1 |
| F-057 Context Compaction & Truncation | Token estimation, smart tool result truncation, history turn limits, conversation compaction | 2 |
| F-058 App Shell, Theme & i18n | Root app shell with tab management, sidebar navigation, theme provider, multi-locale i18n (zh/zh-mix/en/ja) | 12 |
| F-059 Coding Cost Attribution | Cost attribution for coding tasks and release units, model pricing, USD cost calculation | 2 |
| F-060 CU Mechanical Rescan & Source Scan | Code understanding mechanical layer rescan (code intel, test intel, change intel) and source file counting | 2 |
| F-061 Build & Ops Scripts | Packaging, dev server, paaw sync, postinstall emoji font, runtime guard scanner (TDZ/null iterable) | 5 |
| F-062 Shell Execution & Utilities | Cross-platform shell exec helpers, stable hashing/diff JSON writes, import checking, snapshot | 7 |

### 維運要點

- 測試現況：共 30 個測試檔（unit 19、integration 0、e2e 11），覆蓋率 5.3%——偏低，改動時需以手動驗證與 e2e 補強。
- Error codes：尚無（資料待補）。
- 生產啟動走 `npm run start:prod`（`scripts/prod-server.mjs`）；開發用 `npm run dev` 同時跑 UI 與 server。
- 資料儲存為嵌入式 SQLite（sql.js/Kysely），注意備份（F-040）與日誌保留/清除（F-041）設定。
- 涉及 Agent tool 執行的變更請留意 Security Kernel（F-022）與路徑安全（F-021）；shell 執行受 ADR-020 約束。

### 最新決策

- ADR-020: Constrained Shell Execution for AI Agents (project_run_command)
- ADR-019: Shared Tool Registry (OCP-compliant)
- ADR-018: Night Shift 三模組職責邊界與分層策略

<!-- AI:END -->
