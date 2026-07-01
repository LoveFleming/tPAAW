# PAAW UI × API 對照表

> 每個前端頁面/元件對應到的後端 API 端點。
>
> 最後更新：2026-07-01

---

## 總覽

| # | UI 頁面 | 檔案 | 主要 API 端點 | 備註 |
|---|--------|------|-------------|------|

### 核心功能

| # | UI 頁面 | 檔案 | API 端點 | Method | 用途 |
|---|--------|------|---------|--------|------|
| 1 | **Chat（主聊天）** | `ChatView.tsx` | `WS /ws` | WS | AI 對話串流 |
| | | | `/api/paaw/chats` | GET | 聊天列表 |
| | | | `/api/paaw/chats/:id` | GET/DELETE | 載入/刪除聊天 |
| | | | `/api/user/preferences` | GET/PUT | Model 偏好 |
| | | | `/api/paaw/providers` | GET | Provider 清單（model selector） |
| 2 | **Skill Builder** | `SkillBuilder.tsx` | `WS /ws` | WS | Skill 建構串流 |
| | | | `/api/skills` | GET | Skill 列表 |
| | | | `/api/skills/:id` | GET/PUT/DELETE | Skill CRUD |
| | | | `/api/skills/ai-generate` | POST | ✨ AI 生成 SKILL.md |
| | | | `/api/skills/:id/publish` | POST | 發佈 Skill |
| | | | `/api/skills/import` | POST | 匯入 Skill |
| | | | `/api/skills/:id/export` | GET | 匯出 Skill |
| | | | `/api/skill-builder/build-files` | GET | Build files 列表 |
| | | | `/api/ai-settings/skill-builder/build` | POST | Skill Builder context |
| | | | `/api/skill-test/run` | POST | 測試 Skill |
| | | | `/api/skill-test/file-content` | GET | 測試檔案內容 |
| 3 | **Coding IDE** | `CodingIDE.tsx` | `/api/agent-run/stream` | POST(SSE) | AI 串流執行 |
| | | | `/api/context/vibe-coding` | GET | Coding context |
| | | | `/api/vibe-fs/list` | GET | 檔案列表 |
| | | | `/api/vibe-fs/read` | GET | 讀取檔案 |
| | | | `/api/vibe-fs/write` | POST | 寫入檔案 |
| | | | `/api/vibe-fs/search` | GET | 搜尋檔案 |
| | | | `/api/vibe-git/status` | GET | Git 狀態 |
| | | | `/api/vibe-git/diff` | GET | Git diff |
| | | | `/api/vibe-git/log` | GET | Git log |
| | | | `/api/vibe-git/blame` | GET | Git blame |
| | | | `/api/vibe-git/reviews` | GET | Git reviews |
| | | | `/api/vibe-git/ai-comment` | GET | AI git 註解 |
| | | | `/api/vibe-chat?sessionId=vibe-ide` | POST | Vibe chat |
| 4 | **App Builder** | `AppBuilder.tsx` | `WS /ws` | WS | App 建構串流 |
| | | | `/api/context/app-builder` | GET | App Builder context |
| | | | `/api/apps` | GET | App 列表 |
| | | | `/api/app/:id` | GET/PUT/DELETE | App CRUD |
| | | | `/api/paaw/apps/import` | POST | 匯入 App |
| | | | `/api/paaw/apps/:id/export` | GET | 匯出 App |
| | | | `/api/paaw/app-skills` | GET | App Skill 清單 |
| | | | `/api/paaw/app-chat/:id` | POST | App 對話 |
| 5 | **Crew / Employee** | `EmployeeWorkspace.tsx` | `WS /ws` | WS | Employee AI 串流 |
| | | | `/api/context/employee?crewId=` | GET | Employee context |
| | | | `/api/crew?factory=` | GET | Crew 列表 |
| | | | `/api/crew/:id` | GET/PUT/DELETE | Crew CRUD |
| | | | `/api/crew-pic/:file` | GET | Crew 頭像 |
| | | | `/api/conversations/:id` | GET | 對話紀錄 |
| | | | `/api/saved-inputs/:id` | GET | 保存的輸入 |
| | | | `/api/work-log/:id` | GET | 工作日誌 |
| | | | `/api/paaw/crews/:id` | GET | Crew 詳情 |
| 6 | **Workflow Editor** | `WorkflowEditor.tsx` | `/api/paaw/workflows` | GET/POST | Workflow CRUD |
| | | | `/api/paaw/workflows/:id` | GET/PUT/DELETE | Workflow 單筆 |
| | | | `/api/paaw/workflows/:id/exec-history` | GET | 執行歷史 |
| | | | `/api/paaw/workflow-output-chat` | POST | Workflow 輸出對話 |
| 7 | **Workflow Exec** | `WorkflowExec.tsx` | `/api/paaw/skill-exec` | POST | Skill/Workflow 執行 |
| 8 | **Mind Map** | `MindMapViewer.tsx` | `/api/mindmap/generate` | POST | 從檔案產生心智圖 |
| | | | `/api/mindmap/from-text` | POST | 從文字產生心智圖 |
| | | | `/api/mindmap/list` | GET | 心智圖列表 |
| | | | `/api/mindmap/get?id=` | GET | 載入心智圖 |
| | | | `/api/mindmap/save` | POST | 儲存心智圖 |
| | | | `/api/paaw/providers` | GET | Model selector |
| 9 | **Notes** | `Notes.tsx` | `/api/notes/list` | GET | 筆記列表 |
| | | | `/api/notes/get?id=` | GET | 載入筆記 |
| | | | `/api/notes/create` | POST | 建立筆記 |
| | | | `/api/notes/update?id=` | PUT | 更新筆記 |
| | | | `/api/notes/delete?id=` | DELETE | 刪除筆記 |
| | | | `/api/notes/ai-write` | POST | AI 寫筆記 |
| | | | `/api/notes/search?q=` | GET | 搜尋筆記 |
| | | | `/api/notes/notebooks` | GET | 筆記本列表 |
| | | | `/api/notes/sections` | GET | 章節列表 |
| | | | `/api/notes/tags` | GET | 標籤列表 |
| | | | `/api/notes/by-tag?tag=` | GET | 依標籤篩選 |
| | | | `/api/notes/pin?id=` | PUT | 置頂筆記 |
| | | | `/api/notes/upload-image` | POST | 上傳圖片 |
| | | | `/api/paaw/providers` | GET | Model selector |
| 10 | **Project Board** | `ProjectBoard.tsx` | `/api/projects` | GET/POST | 專案 CRUD |
| | | | `/api/projects/:id` | GET/PUT/DELETE | 專案單筆 |
| | | | `/api/projects/:id/tasks` | GET/POST | 任務 CRUD |
| | | | `/api/projects/:id/tasks/:tid` | PUT/DELETE | 任務單筆 |
| | | | `/api/projects/:id/milestones` | GET/POST | 里程碑 CRUD |
| | | | `/api/projects/:id/milestones/:mid` | PUT/DELETE | 里程碑單筆 |
| | | | `/api/projects/:id/categories` | GET/POST | 分類 CRUD |
| | | | `/api/projects/:id/categories/:cid` | PUT/DELETE | 分類單筆 |
| 11 | **Project AI Panel** | `ProjectAiPanel.tsx` | `/api/paaw/chat` | POST | AI 建專案/分析（`contextTarget: "project"`） |
| | | | `/api/paaw/providers` | GET | Model selector |
| 12 | **Project Dashboard** | `ProjectDashboard.tsx` | `/api/project-dashboard?root=` | GET | 專案儀表板 |
| 13 | **Cron Jobs** | `CronJobsPage.tsx` | `/api/cron-jobs` | GET/POST | Cron Job CRUD |
| | | | `/api/cron-jobs/:id` | GET/PUT/DELETE | Cron Job 單筆 |
| | | | `/api/cron-jobs/:id/run` | POST | 手動執行 |
| | | | `/api/cron-jobs/:id/logs` | GET | 執行日誌 |
| | | | `/api/cron-jobs/:id/results` | GET | 執行結果 |
| | | | `/api/cron-result?path=` | GET | 結果詳情 |
| 14 | **App Pool** | `AppPool.tsx` | `/api/apps` | GET | App 列表 |
| | | | `/api/app/:id` | GET/DELETE | App 單筆 |
| | | | `/api/app/:id/publish` | POST | 發佈 App |
| | | | `/api/app/:id/status` | GET | App 狀態 |
| 15 | **Skills Page** | `SkillsPage.tsx` | `/api/skills` | GET | Skill 列表 |
| | | | `/api/skills/:id` | GET/DELETE | Skill 單筆 |
| 16 | **AI Settings** | `AISettingsPage.tsx` | `/api/ai-settings` | GET | 分類列表 |
| | | | `/api/ai-settings/:category` | GET/POST/DELETE | 分類檔案管理 |
| | | | `/api/ai-settings/:category/:file` | GET/PUT/DELETE | 單檔 CRUD |
| | | | `/api/ai-settings/agent-config` | GET/PUT | Agent 迴圈設定 |
| 17 | **System Prompts** | `SystemPromptsPage.tsx` | `/api/system-prompts` | GET/POST/PUT/DELETE | System prompt CRUD |
| 18 | **AI Crew** | `AICrew.tsx` | `/api/crew?factory=` | GET | Crew 列表 |
| | | | `/api/crew/:id` | GET/PUT/DELETE | Crew CRUD |
| | | | `/api/factories` | GET/POST | Factory 列表 |
| | | | `/api/factories/:id` | GET/PUT/DELETE | Factory 單筆 |

### 設定與系統

| # | UI 頁面 | 檔案 | API 端點 | Method | 用途 |
|---|--------|------|---------|--------|------|
| 19 | **Settings** | `SettingsPage.tsx` | `/api/paaw/providers` | GET/PUT | Provider 設定 |
| | | | `/api/user/preferences` | GET/PUT | 使用者偏好 |
| | | | `/api/paaw/user` | GET/PUT | 使用者資料 |
| | | | `/api/paaw/avatar` | POST | 上傳頭像 |
| | | | `/api/paaw/avatar/assistant` | GET | AI 頭像 |
| | | | `/api/models` | GET | Model 清單 |
| | | | `/api/ai-settings/agent-config` | GET/PUT | Agent 設定 |
| | | | `/api/distill/config` | GET | 蒸餾設定 |
| | | | `/api/distill/run` | POST | 執行蒸餾 |
| | | | `/api/distill/run/:source` | POST | 蒸餾單項 |
| | | | `/api/distill/record` | GET | 蒸餾紀錄 |
| 20 | **Onboarding** | `OnboardingPage.tsx` | `/api/paaw/user` | GET/PUT | 使用者資料 |
| | | | `/api/paaw/providers` | GET/PUT | Provider 設定 |
| | | | `/api/paaw/ui-state` | GET/PUT | UI 狀態 |
| 21 | **Backup** | `BackupSettings.tsx` | `/api/backup/config` | GET/PUT | 備份設定 |
| | | | `/api/backup/list` | GET | 備份列表 |
| | | | `/api/backup/run` | POST | 立即備份 |
| | | | `/api/backup/restore` | POST | 還原備份 |
| | | | `/api/backup/delete?filename=` | DELETE | 刪除備份 |
| 22 | **Monitoring** | `Monitoring.tsx` | — | — | 純前端（系統狀態） |
| 23 | **Provider Setup** | `ProviderSetupPage.tsx` | `/api/paaw/providers` | GET/PUT | Provider 設定 |

### 工廠入口（Factory）

| # | UI 頁面 | 檔案 | API 端點 | Method | 用途 |
|---|--------|------|---------|--------|------|
| 24 | **Factory Entry** | `FactoryEntryPage.tsx` | `/api/factories` | GET | Factory 列表 |
| 25 | **Factory Standards** | `FactoryStandards.tsx` | `/api/factories/:id` | GET | Factory 詳情 |
| 26 | **Operations Center** | `OperationsCenter.tsx` | `/api/factories` | GET | Factory 列表 |
| 27 | **Orchestrator** | `OrchestratorOverview.tsx` | `/api/factories` | GET | Factory 列表 |
| | **Orchestrator WS** | `OrchestratorWorkspace.tsx` | `WS /ws` | WS | Orchestrator 串流 |
| 28 | **Release Unit** | `ReleaseUnitExplorer.tsx` | `/api/factories/:id` | GET | Factory 詳情 |
| 29 | **Gates** | `Gates.tsx` | `/api/factories/:id` | GET | Factory 詳情 |
| 30 | **Gantt Chart** | `GanttChart.tsx` | `/api/projects` | GET | 專案列表 |
| 31 | **RCA** | `Rca.tsx` | `/api/factories/:id` | GET | Factory 詳情 |

### 檔案與知識

| # | UI 頁面 | 檔案 | API 端點 | Method | 用途 |
|---|--------|------|---------|--------|------|
| 32 | **File Editor** | `FileEditor.tsx` | `/api/vibe-fs/read` | GET | 讀取檔案 |
| | | | `/api/vibe-fs/write` | POST | 寫入檔案 |
| | | | `/api/paaw/file-write` | POST | 寫入檔案（舊） |
| 33 | **File Viewer** | `FileViewer.tsx` | `/api/fs/file?path=` | GET | 讀取檔案 |
| | | | `/api/fs/browse?path=` | GET | 瀏覽目錄 |
| | | | `/api/fs/browse-files?path=` | GET | 瀏覽檔案 |
| | | | `/api/fs/tree?root=` | GET | 目錄樹 |
| | | | `/api/fs/tree-deep?root=` | GET | 深層目錄樹 |
| | | | `/api/fs/rmdir?path=` | DELETE | 刪除目錄 |
| 34 | **Briefing Player** | `BriefingPlayer.tsx` | `/api/fs/browse?path=` | GET | 簡報列表 |
| | | | `/api/fs/file?path=` | GET | 簡報內容 |

### 工具元件（非頁面）

| 元件 | 檔案 | API 端點 | Method | 用途 |
|------|------|---------|--------|------|
| **AgentConsole** | `AgentConsole.tsx` | `WS /ws` | WS | AI 對話串流（Chat/SkillBuilder/AppBuilder/Crew 共用） |
| **ShellTerminal** | `ShellTerminal.tsx` | `WS /ws` | WS | 終端機 |
| **ModelSelector** | `ModelSelector.tsx` | `/api/user/preferences` | GET/PUT | Model 偏好 |
| | | `/api/paaw/providers` | GET | Provider 清單 |
| **SidebarFileTree** | `SidebarFileTree.tsx` | `/api/vibe-fs/list` | GET | 檔案列表 |
| **KnowledgeTree** | (Sidebar) | `/api/vibe-fs/list` | GET | 知識庫檔案 |
| **CrewEditor** | `CrewEditor.tsx` | `/api/crew/:id` | GET/PUT | Crew 編輯 |

---

## API 端點 → Route 檔對照

| Route 檔 | Prefix | 主要端點 |
|----------|--------|---------|
| `ai-settings.mjs` | `/api/ai-settings` | 分類管理、context build、agent-config |
| `api-tester.mjs` | `/api/api-tester` | API 測試 proxy、歷史 |
| `apps.mjs` | `/api/app`, `/api/apps` | App CRUD、發佈 |
| `assistant.mjs` | `/api/paaw/app-chat` | App 內對話 |
| `backup.mjs` | `/api/backup` | 備份/還原 |
| `chat.mjs` | `/api/paaw/chat`, `/api/paaw/chats` | 通用 AI 對話、聊天紀錄 |
| `context.mjs` | `/api/context` | Context engine 查詢 |
| `crew.mjs` | `/api/crew`, `/api/factories` | Crew/Factory CRUD |
| `distill.mjs` | `/api/distill` | 蒸餾 |
| `mindmap.mjs` | `/api/mindmap` | 心智圖 |
| `notes.mjs` | `/api/notes` | 筆記 |
| `pocket.mjs` | `/api/paaw-root`, `/api/paaw/user` | 系統資訊、使用者 |
| `projects.mjs` | `/api/projects`, `/api/project-dashboard` | 專案管理 |
| `shared.mjs` | — | 共用函式（PORT, PAAW_ROOT 等） |
| `skill.mjs` | `/api/skills`, `/api/skill-builder` | Skill 管理 |
| `skills-api.mjs` | `/api/skills/generate`, `/api/skill-test` | Skill AI 生成、測試 |
| `tools.mjs` | `/api/tool-registry`, `/api/paaw/skill-config` | 工具管理 |
| `vibe-fs.mjs` | `/api/vibe-fs`, `/api/fs` | 檔案系統 |
| `vibe-sessions.mjs` | `/api/vibe-git`, `/api/vibe-chat` | Git、Vibe chat |
| `workflow.mjs` | `/api/paaw/workflows`, `/api/paaw/skill-exec` | Workflow、Skill 執行 |
| `ws-handler.mjs` | `WS /ws` | WebSocket（Chat/AgentConsole/Terminal） |
| `cron-jobs.mjs` | `/api/cron-jobs` | 排程 |

---

## 通訊方式

| 方式 | 使用場景 |
|------|---------|
| **WebSocket** (`/ws`) | Chat, Skill Builder, App Builder, Crew, Terminal — 需要雙向即時串流 |
| **SSE** (`/api/agent-run/stream`) | Coding IDE — 單向串流 |
| **REST** (`/api/*`) | 所有其他功能 — 一次性 request/response |
