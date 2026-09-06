# 🎖️ Engineering Manager 報告

**日期：** 2026-08-02
**時間：** 22:31:07
**結果：** ✅ 0 成功 / ❌ 0 失敗 / 8 總計
**模式：** EM 智慧調度（部分工作需人工確認）

---

## 📊 專案現況

## 專案現況摘要

### Git Status
工作目錄乾淨，沒有未提交變更。

### Action Log（Change 水位 — 最近 20 條 agent 變更紀錄）
[08:00] tester/create: 新增 67 個單元測試（shared-utils 42 + dependency-context 25），修復 night-shift mock 策略，發現生產 bug ISS-027 → tests/unit/shared-utils.test.ts, tests/unit/dependency-context.test.mjs, tests/unit/night-shift-shared.test.mjs [created]
[08:16] app-builder-test/create: 建立測試檔案 data/apps/test-app/hello.txt → data/apps/test-app/hello.txt [created]
[10:25] tPAAW/create: Built ai-news-digest SKILL.md artifact from skill-source.md → building/ai-news-digest/package/SKILL.md, building/ai-news-digest/skill-source.md [created]
[12:41] developer/fix: 移除 Coding IDE AI 下拉式選單中的「EM 自動調度」item → packages/ui/src/pages/CodingIDE.tsx [fixed]
[05:12] developer/fix: 隱藏 sidebar Execution section 的 Workflows NavItem → packages/ui/src/App.tsx [fixed]
[05:09] developer/fix: 隱藏 sidebar Build section 的 Workflow Builder NavItem → packages/ui/src/App.tsx [fixed]
[03:02] em/decide: EM session 完成：調度 4 項工作，成功 2 項 [adr]
[03:02] doc-writer/review: 根據 git log 19e1963..5b80c26 的 16 個 commit 更新 CHANGELOG 2026-07-19 — Night Shift 統一重構完整記錄 → .paaw/CHANGELOG.md [created]
[02:58] architect/review: Night Shift 三模組邊界審查完成，產出 ADR-010 + 開立 3 個技術債 issue → packages/server/src/lib/overnight-manager.mjs, packages/server/src/lib/night-shift-shared.mjs, packages/server/src/routes/coding-night-shift.mjs, packages/server/src/routes/coding.mjs [adr]
[02:46] developer/fix: 修復 QA review 發現的 3 項 Night Shift regression（race condition、legacy route、polling bug），各自獨立 commit → packages/server/src/routes/coding-night-shift.mjs, packages/server/src/routes/coding.mjs, packages/ui/src/components/EMDashboard.tsx, packages/ui/src/components/NightShiftPanel.tsx [fixed]
[01:56] qa/review: Night Shift 統一重構 Code Review 完成 — 審查 11 commits，發現 3 項 regression（1 個 race condition、1 個 legacy route 殘留、1 個前端 polling bug），Gate Check 結果 CONDITIONAL → packages/server/src/routes/coding-night-shift.mjs, packages/server/src/lib/overnight-manager.mjs, packages/server/src/lib/night-shift-shared.mjs, packages/server/src/routes/coding.mjs, packages/ui/src/components/EMDashboard.tsx, packages/ui/src/components/NightShiftPanel.tsx, tests/unit/night-shift-shared.test.mjs [suggestions]
[01:34] tester/create: 為 night-shift-shared.mjs 撰寫 54 個單元測試，涵蓋全部 8 個 exported function → tests/unit/night-shift-shared.test.mjs [created]
[14:21] coding.qa/review: Night Shift QA Code Review started — reviewing 16 commits across 36 files [suggestions]
[14:03] developer/fix: 修復 semgrep warning: refinery.ts 使用 json-stable-stringify 取代 JSON.stringify → packages/context/src/refinery/refinery.ts, packages/context/package.json [fixed]
[00:29] em/decide: EM session 完成：調度 4 項工作，成功 3 項 [adr]
[00:28] doc-writer/review: 根據 git log 更新 CHANGELOG.md — 補齊 2026-07-17 的 20 筆 commit 記錄 → .paaw/CHANGELOG.md [created]
[00:25] architect/review: 審查 dependency-context.mjs 架構設計，產出 ADR-005 記錄設計決策，發現 4 項技術債 → packages/server/src/lib/dependency-context.mjs, packages/server/src/lib/paaw-agent-loop.mjs [adr]

### 專案知識

### PROJECT.md
# tPAAW

> An AI agent management platform with a coding IDE for feature mapping, issue tracking, and code health analysis — designed for developers working with AI agents to manage and evolve their codebase.

## Quick Facts
| | |
|---|---|
| Language | TypeScript |
| Framework | React/Next.js |
| Runtime | Node.js |
| Package Manager | npm |
| Last Updated | 2025-01-15 |

## What This Project Does

tPAAW provides a unified coding IDE where developers collaborate with AI agents to map features to source files, track issues, analyze code health, and manage multi-agent workflows. It includes a "Night Shift" mode where an Engineering Manager leads a 6-agent team for overnight work, and maintains all project knowledge in a version-controllable `.paaw/` directory.

## Architecture at a Glance

```
┌─────────────────────────────────────────────────────────────┐
│                    Browser (React/Next.js)                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │
│  │  Coding   │ │ Feature  │ │  Issue   │ │ Agent Memory │  │
│  │   IDE     │ │ Mapping  │ │ Tracker  │ │    Panel     │  │
│  └─────┬─────┘ └─────┬────┘ └────┬─────┘ └──────┬───────┘  │
└────────┼──────────────┼───────────┼──────────────┼──────────┘
         │              │           │              │
         ▼              ▼           ▼              ▼
┌─────────────────────────────────────────────────────────────┐
│                    API Server (Node.js)                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │
│  │  Routes  │ │  Tools   │ │  Skills  │ │ Agent Engine │  │
│  └─────┬────┘ └─────┬────┘ └─────┬────┘ └──────┬───────┘  │
└────────┼──────────────┼───────────┼──────────────┼──────────┘
         │              │           │              │
         ▼              ▼           ▼              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Data & Knowledge Layer                     │
│  ┌──────────────┐ ┌──────────

### STATUS.md
# Project Status

> 每次重大變更後更新。AI 可讀取此檔案了解專案進度。

**最後更新：** 2026-07-11
**版本：** dev branch, commit `703788a`

## 已完成功能

### Coding App (AI-Native IDE)
- [x] 檔案總管 + 程式碼編輯器（多 tab）
- [x] 終端機（node-pty）
- [x] Git 面板（status / diff / blame / review）
- [x] API 測試器
- [x] 瀏覽器預覽
- [x] AI 聊天面板（串流回應）

### AI Crew 團隊
- [x] 6 位專業角色（architect / developer / tester / qa / doc-writer / helpdesk）
- [x] 每位角色有 expertise + guardrails（專業範圍 + 轉介規則 + 拒絕主題）
- [x] Crew 對話持久化（`.paaw/coding-memory/conversations/{crewId}.json`）
- [x] 歸檔系統（新對話 → 歸檔舊對話 → 可載入繼續）
- [x] 智能上下文窗口管理（Token budget ≈12000，修剪消息自動總結）
- [x] Thinking bubble 歷史保留（`_thinkingHistory[]`）

### EM 大總管
- [x] EM Dashboard Landing Page
- [x] EM Chat（自然語言指揮）
- [x] Code Understanding（9 步驟專案掃描）
- [x] 5-category Health Scores
- [x] Agent Activity Log（即時操作記錄）

### 基礎設施
- [x] A2A Protocol 客戶端（`/api/a2a/message/stream`）
- [x] paaw-agent-loop.mjs（自建 tool-calling loop）
- [x] domain-agent-registry.mjs（Crew 載入 + system prompt 組裝）
- [x] 20 個 AI 工具（read/write/edit/glob/grep/git/bash/...）
- [x] Crew 編輯器（expertise + guardrails textarea）
- [x] ModelSelector（runtime 選擇，不綁 crew）

## 進行中
- [ ] `.paaw/` 知識庫填充（本批次：8 個檔案建立中）

## 待做
- [ ] 測試自動化整合（test runner UI）
- [ ] CI/CD 基礎（push → build + test）
- [ ] 知識庫提煉（歸檔對話 → FAQ/Runbook）
- [ ] AI 自動更新 STATUS.md / CHANGELOG.md
- [ ] EM Dashboard 交接狀態面板


### DECISIONS.md
# Decision Records

> Architecture Decision Records (ADR). Each record explains WHY a decision was made.

## ADR-001: File-based Knowledge Store (.paaw/ directory)

**Date:** project inception
**Status:** Accepted

### Context
The platform needs a persistent, version-controllable knowledge base that both humans and AI agents can read/write. Traditional databases would add operational complexity and create a dependency that conflicts with the goal of making the project self-contained and portable.

### Decision
Store all project knowledge (architecture, decisions, feature maps, issue tracking) as markdown and JSON files in a `.paaw/` directory at the project root. This directory serves as the canonical knowledge store.

### Consequences
- Positive: No database setup required; files are naturally version-controlled with git
- Positive: Both humans and AI agents can read/write using standard file operations
- Negative: No built-in query language; must parse files manually
- Neutral: Directory structure conventions must be strictly followed to remain machine-parseable

### Alternatives Considered
- SQLite database: Rejected because it adds a binary dependency and is harder to inspect/diff
- Cloud API: Rejected because it requires network access and external service setup

---

## ADR-002: Structured Agent Communication via .paaw/ API Tools

**Date:** d4c6caf (from git log)
**Status:** Accepted

### Context
AI agents were using raw `read_file` to access project knowledge, leading to inconsistent parsing and brittle behavior. Agents need a structured, predictable interface to read/write knowledge.

### Decision
Replace raw file access with structured `.paaw/` API tools. Agents use dedicated tools (e.g., `read_feature_map`, `write_decision`) that enforce schema and validation, rather than directly manipulating files.

### Consequences
- Positive: Agents produce consistent, valid knowledge entries
- Positive: Easier to add validation and error handling
- Negative: Additiona

### CODING-STANDARDS.md
# Coding Standards

> 本專案的 Coding 規範。AI 在寫碼時必須遵守。

## 通用原則

1. 改完碼一定要 commit + push，不留 uncommitted local change
2. 新字串必須用 t() + 加 locale key（如適用）
3. 永遠處理 IME composition（useRef，不要用 useState）

## ⚠️ 跨平台路徑處理（Windows / macOS / Linux）

### 絕對禁止
- ❌ `new URL(import.meta.url).pathname` — Windows 上會產生 `/C:/path`（多一個 `/`），導致路徑重複磁碟機代號
- ❌ `import.meta.url.replace("file://", "")` — 不處理 Windows 的 `/C:` 前綴
- ❌ `pathname.replace(/^\//, "")` — hack，只治標

### 正確做法
- ✅ 一律用 `fileURLToPath(import.meta.url)` 取得 `__filename`/`__dirname`
- ✅ 用 `shared.mjs` 已導出的 `PAAW_ROOT` 常數，不要自己算
- ✅ 所有回傳前端的 path 一律經 `normalizePath()`（`shared.mjs` 導出）把 `\` 轉 `/`
- ✅ 路徑切割用 `split(/[\\/]/)` 不要硬寫 `split("/")`

### 為什麼重要
- Mac 開發時路徑全用 `/` 不會出錯，但 Windows 上 Node.js 的 `resolve/join` 產生 `\`
- `new URL(import.meta.url).pathname` 在 Windows 回傳 `/C:/path`，`resolve()` 把它當相對路徑拼出 `C:\C:\path`
- 前端收到 `C:\path` 放進 URL query string，反斜線可能被吃掉

### 檢查清單（每次動到路徑相關 code）
1. 新增 `import.meta.url` 用法？→ 必須走 `fileURLToPath`
2. 回傳 path 給前端？→ 必須 `normalizePath()`
3. 用 `split("/")` 切路徑？→ 改 `split(/[\\/]/)`
4. 需要 PAAW_ROOT？→ import from `shared.mjs`，不要自己算
5. 新增 route 檔案？→ 確認 `__filename`/`__dirname` 用 `fileURLToPath`

## 規範子目錄

將各語言/框架的規範放在 `standards/` 子目錄：

- `standards/typescript.md` — TypeScript 規範
- `standards/react.md` — React 規範
- `standards/naming.md` — 命名規範
- `standards/git-commit.md` — Commit message 規範

> 可透過 Coding IDE 的 Standards Editor 編輯，或點「Import」匯入範本。


### CHANGELOG.md
# Changelog

> 每次重大變更後更新。AI 完成任務後可呼叫 `update_changelog` 自動追加。

## 2026-07-11

### Changed
- crew `expertise`/`guardrails.redirectRules`/`guardrails.refuseTopics` 從 `string[]` 改為 `string`（textarea）
- CrewEditor 移除 TagInput component，改用 3 個 textarea
- `buildSystemPrompt` 直接注入文字，不再 `map(e => \`- ${e}\`)`
- EmployeeWorkspace ModelSelector 不再寫回 crew JSON（純 runtime）

### Removed
- `crew.risk` 欄位（含 RiskBadge UI）
- `crew.chatConfig.model` 欄位
- `crew.chatConfig.approvalMode` 欄位
- `CrewEditor` 的 ModelSelector 和 approval dropdown
- `AICrew.tsx` 的 RiskBadge import

### Added
- `Crew.expertise` (string) — 專業範圍 textarea
- `Crew.guardrails.redirectRules` (string) — 轉介規則 textarea
- `Crew.guardrails.refuseTopics` (string) — 拒絕主題 textarea
- CrewEditor「專業範圍與護欄」fieldset（含 placeholder 範例）
- AICrew 卡片右上角改為 🛡️ expertise 數量 badge
- `.paaw/` 8 大知識檔案建立（PROJECT / STATUS / DECISIONS / CHANGELOG / TEST-EVIDENCE / KNOWN-ISSUES / NEXT-ACTIONS / AI-OPERATING-GUIDE）

### Commits
- `703788a` refactor: expertise/guardrails 從 tag input 改為 textarea
- `79a9b57` refactor: 移除 crew risk/model/approvalMode + 新增 expertise/guardrails UI

## 2026-07-10

### Added
- Crew 對話持久化 API（`GET/POST/DELETE /api/coding-crew/conversations/:crewId`）
- 智能上下文窗口管理（Token budget ≈12000，修剪消息自動總結 150 chars）
- 獨立上下文窗口 API（`POST /api/coding-crew/context-window`）
- 歸檔系統（`POST .../archive`, `GET .../archives`, `GET .../archives/:id`）
- 新對話按鈕 + 歷史記錄面板（帶標題/數量/時間戳）
- `ChatMessage._thinkingHistory` — 保留 thinking bubble 歷史
- 6 個 Crew 提示詞升級（expertise + guardrails 專業邊界）
- `buildSystemPrompt` 注入 expertise + guardrails
- 移除 4 個空殼 Crew（ai.spec, e2e-tester, spec-writer, unit-tester）
- 前端：Crew 切換自動載入對話、2 秒防抖動自動儲存

### Changed
- `coding.mjs` 和 `a2a.mjs`（4 處）的 `slice(-20)` → Token budget 邏輯
- `ChatMessage` 增加 `_thinkingHistory?: string[]`

### Commits
- `783be36` feat: 6 位 Coding AI 員工專業 prompts + 護欄
- `af498f4` feat: 開新對話功能 + 歸檔歷史對話查看
- `20e8c5b` feat: 保留 thinking bubble 歷史到 _thinkingHistory
- `4e0b70a` feat: Coding App 對話紀錄持久化 + 智慧 context wind

### KNOWN-ISSUES.md
# Known Issues

> 已知問題清單。解決後標記 ✅ 並記錄解法。

## 🔴 Open

### KI-001: AGENT-MEMORY 目錄為空
- **影響：** AI 沒有跨對話記憶，每次新對話從零開始
- **Workaround：** 對話持久化可 partially 彌補（載入舊對話繼續）
- **優先級：** Medium
- **相關：** `agent_memory_save` / `agent_memory_load` tool 已存在但未被使用

### KI-002: 無自動化測試
- **影響：** 改完碼只能手動驗證，regression 風險高
- **Workaround：** 每次改完跑 `vite build` 當 smoke test
- **優先級：** High
- **相關：** TEST-EVIDENCE.md 待整合 section

### KI-003: Token budget 估算不精確
- **影響：** CJK 內容實際 token 數偏高（每字 ~2-3 token，估算用 4 chars/token）
- **Workaround：** 12000 budget 偏保守，安全側誤差
- **優先級：** Low
- **相關：** ADR-001

### KI-004: 跨平台路徑問題歷史債
- **影響：** Windows 上路徑處理容易出錯（`new URL().pathname` → `/C:/path`）
- **Workaround：** 已建立 CODING-STANDARDS.md 規範，但舊 code 可能殘留
- **優先級：** Medium
- **相關：** CODING-STANDARDS.md, MEMORY.md 跨平台路徑紀律

### KI-005: i18n 可能有硬編碼字串
- **影響：** 部分舊 UI code 可能有中文硬編碼，未走 `t()` 
- **Workaround：** 2026-07-01 已做一次完整 i18n 補全
- **優先級：** Low
- **相關：** CODING-STANDARDS.md i18n section

## ✅ Resolved

### KI-000: slice(-20) 上下文截斷
- **解法：** Token budget + 修剪消息總結（ADR-001）
- **解決日期：** 2026-07-10

### KI-RESOLVED-001: per-crew model 管理混亂
- **解法：** 移除 chatConfig.model，統一用 PAAW fallback chain（ADR-003）
- **解決日期：** 2026-07-11

### KI-RESOLVED-002: guardrails 用 tag 限制表達力
- **解法：** 改為 textarea（ADR-004）
- **解決日期：** 2026-07-11


### NEXT-ACTIONS.md
# Next Actions

> 下一步待辦。AI 讀取此檔案決定接下來做什麼。

## 🔴 Priority — 立即

1. **EM Dashboard 交接狀態面板** — 右側加一個 panel，顯示 8 個知識檔案的填充狀態（✅/⚠️/❌），backup 人一眼看到完整度
2. **跑 Code Understanding** — 用 AI 掃描專案，自動填充 ARCHITECTURE.md / API spec / error mapping 等
3. **整理已歸檔對話** — 從 coding-memory/conversations/.archive/ 提煉 FAQ

## 🟡 Important — 本週

4. **測試自動化整合** — test runner UI，AI 寫的測試結果反饋到 TEST-EVIDENCE.md
5. **CI/CD 基礎** — push → build + test pipeline
6. **AI 自動更新知識庫** — AI 完成任務後自動更新 STATUS.md / CHANGELOG.md

## 🟢 Nice to Have

7. **前端展示上下文窗口統計** — 顯示 token 使用量、修剪數量
8. **知識庫提煉** — 歸檔對話 → Runbook / FAQ
9. **多 Crew 協作流程** — architect → developer → tester 自動 flow
10. **版本發布管理** — tag-based release notes

## 💡 Backlog

- 多專案支援（一個 PAAW 管多個 repo）
- AI 自動 code review on PR
- 知識庫搜尋（semantic search on .paaw/）
- AI 自動寫 test case
- Crew 效能分析（回應品質、速度、token 消耗）


### AI-OPERATING-GUIDE.md
# AI Operating Guide — Backup 接手指南

> 看完這份就能指揮 AI 團隊。不需要問任何人。

## AI 團隊成員

| ID | 角色 | 名字 | 專業範圍 | 拒絕 |
|----|------|------|---------|------|
| `coding.architect` | 架構師 | 林曉薇 | 系統架構、技術選型、ADR | 非技術問題、具體 bug 修復 |
| `coding.developer` | 開發者 | Priya Sharma | TS/React/Node.js 全端 | 非開發問題、CI/CD 部署 |
| `coding.tester` | 測試工程師 | Divya Reddy | Jest/Vitest/Playwright | 非測試問題、部署維運 |
| `coding.qa` | QA | 武大安 | Code Review、品質把關 | 非品質問題、功能實作 |
| `coding.doc-writer` | 文件撰寫 | Megan Brooks | 技術文件、API 文件 | 非文件問題、程式碼實作 |
| `coding.helpdesk` | 技術支援 | 小春 林 | Debug、環境問題、FAQ | 非技術問題、功能實作 |

每位成員有 **轉介規則**：超出範圍的問題會建議找對應的人。

## 怎麼指揮

### 方式一：EM 大總管（推薦）
1. 打開 Coding App → 🎖️ EM 大總管 tab
2. 用自然語言描述需求：「幫我加一個 XXX 功能」
3. EM 會自動分派給對應 agent
4. 右側可看到 Agent Activity Log（即時操作記錄）

### 方式二：直接找 agent
1. 打開 AI Crew tab
2. 選擇要對話的 agent（架構師 / Developer / Tester / QA / Doc Writer / Helpdesk）
3. 直接在 chat 發訊息
4. 對話自動持久化，切換 crew 會自動載入該 crew 的對話

### 方式三：A2A API
```
POST /api/a2a/message/stream
{
  "agentId": "coding.developer",
  "message": "修復 XXX bug"
}
```

## 工作流程範例

### 新功能開發
```
Architect (曉薇)     → 討論設計、產出 ADR
    ↓
Developer (Priya)    → 實作程式碼
    ↓
Tester (Divya)       → 寫測試
    ↓
QA (大安)            → Code Review
    ↓
Doc Writer (Megan)   → 更新文件 + CHANGELOG
```

### Bug 修復
```
Helpdesk (小春)      → 初步排查、重現步驟
    ↓
Developer (Priya)    → 修復
    ↓
Tester (Divya)       → 回歸測試
```

### 知識庫維護
```
EM Dashboard → 🧠 Code Understanding 按鈕
    ↓
AI 掃描專案（9 步驟）
    ↓
產出：PROJECT.md / ARCHITECTURE.md / DECISIONS.md / API spec / error mapping
    ↓
人工審閱 + 補充產品定位
```

## AI 可用的工具（20 個）

### 檔案操作
- `read_file` — 讀檔案
- `write_file` — 寫檔案
- `edit_file` — 精確編輯
- `glob` — 檔案搜尋
- `grep` — 內容搜尋
- `diff` — 比對差異

### 版本控制
- `git` — Git 操作（status, diff, commit, push...）

### 執行
- `bash` — 執行 shell 命令
- `browser_test` — 瀏覽器測試

### 知識管理
- `record_decision` — 寫 ADR 到 DECISIONS.md
- `update_changelog` — 寫變更到 CHANGELOG.md
- `update_docs` — 更新文件
- `action_log_add` — 記錄操作
- `action_log_list` — 查詢操作記錄

### 記憶
- `agent_memory_save` — 存

### 📝 Open Tasks (6)

**TASK-029** [high] security → developer
修 XSS in user-input.tsx:handleSubmit

**TASK-030** [high] security → developer
修 SQL injection in api/users.mjs:getUser

**TASK-031** [high] security → developer
加 CSP header to server config

**TASK-032** [high] security → developer
更新 dependency lodash 4.17.21

**TASK-033** [high] security → tester
補 security scan 測試

**TASK-038** [high] security → developer
修 XSS in handleSubmit
Use DOMPurify to sanitize input before rendering

### 🔒 Security Findings (1346)
1346 findings (86 files affected). Top: packages/server/src/routes/coding.mjs (65), packages/ui/src/pages/SettingsPage.tsx (62), packages/server/src/routes/coding-night-shift.mjs (54), packages/server/src/routes/backup.mjs (53), packages/server/src/routes/coding-features.mjs (52)

**Top affected files:**
- packages/server/src/routes/coding.mjs (65 findings, WARNING): Detected possible user input going into a `path.join` or `path.resolve` function. This could possibl
- packages/ui/src/pages/SettingsPage.tsx (62 findings, WARNING): found prompt() call; should this be in production code?
- packages/server/src/routes/coding-night-shift.mjs (54 findings, WARNING): Detected calls to child_process from a function argument `cmd`. This could lead to a command injecti
- packages/server/src/routes/backup.mjs (53 findings, WARNING): Detected possible user input going into a `path.join` or `path.resolve` function. This could possibl
- packages/server/src/routes/coding-features.mjs (52 findings, WARNING): Detected possible user input going into a `path.join` or `path.resolve` function. This could possibl
- packages/ui/src/components/IssueTracker.tsx (50 findings, WARNING): found confirm() call; should this be in production code?
- packages/ui/src/pages/SkillBuilder.tsx (48 findings, WARNING): Translation key 'skillBuilder.fieldLabelLabel' should match format 'MODULE.FEATURE.*'
- packages/server/src/scheduler/cron-jobs.mjs (47 findings, WARNING): Detected that function argument `jobId` has entered the fs module. An attacker could potentially con



---

## 📋 工作清單

### 1. ⏳ [high] developer — 修復 XSS 漏洞（合併 TASK-029 + TASK-038）：在 packages/ui/src/components/user-input.tsx 的 handleSubmit 函式中，使用者輸入未經淨化就直接渲染到 DOM。解法：安裝 DOMPurify（npm install dompurify @types/dompurify），在 handleSubmit 中將使用者輸入先經 DOMPurify.sanitize() 處理再使用。確認所有 render user input 的路徑都過 sanitize。參考 CODING-STANDARDS.md 的通用原則。Effort: S
> XSS 是最高風險的安全漏洞，且已有兩個 open task 指向同一問題

### 2. ⏳ [high] developer — 修復 SQL injection 漏洞（TASK-030）：在 packages/server/src/routes/api/users.mjs（或對應路徑）的 getUser 函式中，使用者提供的參數直接拼接進 SQL 查詢字串。解法：改用 parameterized query / prepared statement（若用 ORM 則改用 parameter binding），確保所有動態值都走 placeholder 而非字串拼接。檢查同檔案其他 query 是否也有同樣問題，一併修復。Effort: S
> SQL injection 可直接導致資料庫被完整讀取或破壞

### 3. ⏳ [high] developer — 為 API server 加入 Content-Security-Policy header（TASK-031）：在 packages/server 的主 server 啟動檔案（尋找 createServer 或 express app 設定處），加入 CSP middleware/response header。建議 policy：default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:。如果用 Express，加 helmet 或手動 setHeader。確保不阻擋現有功能（WebSocket、inline style）。Effort: S
> CSP 是 XSS 的深度防禦層，缺少 CSP 會讓 XSS 攻擊影響放大

### 4. ⏳ [high] developer — 更新 lodash 相依套件（TASK-032）：執行 npm info lodash versions 確認最新穩定版（目前 4.17.21 已知有 CVE）。如果 lodash 仍有活躍維護版則升級到最新版；如果已停滯則評估替換方案。更新 package.json + package-lock.json，跑 vite build 確認無 breaking change。若 lodash 僅被少量使用，評估是否可用原生 JS 替換後直接移除依賴。Effort: S
> 已知 CVE 的依賴是供應鏈攻擊的常見入口

### 5. ⏳ [high] developer — 修復 packages/server/src/routes/coding.mjs 的 path traversal 漏洞（65 findings, CWE-22）：semgrep 偵測到多處使用者輸入直接傳入 path.join / path.resolve。找到所有接收前端 path 參數的 route handler，加入路徑驗證：用 path.resolve() 解析後檢查結果是否以允許的根目錄（如 PAAW_ROOT 或專案 workspace root）為前綴，若不是則回傳 403。可提取共用函式 safeResolvePath(baseDir, userInput) 供整個檔案複用。參考 CODING-STANDARDS.md 跨平台路徑處理規範。Effort: M
> 這是 security findings 數量最多的檔案，path traversal 可讀取任意系統檔案

### 6. ⏳ [high] developer — 修復 packages/server/src/routes/backup.mjs 的 path traversal 漏洞（53 findings, CWE-22）：同 coding.mjs 的修復模式。找到所有接收前端 path / filename 參數的 handler，加入前綴驗證邏輯。備份功能尤其危險因為可能涉及檔案系統寫入。建立 safeResolvePath 驗證函式（或從 shared.mjs 匯入共用），確保所有路徑都在允許範圍內。Effort: M
> backup route 涉及檔案系統讀寫，path traversal 風險極高

### 7. ⏳ [high] developer — 修復 packages/server/src/routes/coding-features.mjs 的 path traversal 漏洞（52 findings, CWE-22）：同上修復模式。找到所有接收前端 path 參數的 route handler，加入路徑前綴驗證。如果 coding.mjs 已建立了共用的 safeResolvePath 函式，在此檔案匯入並複用。確保 feature map 相關的檔案操作都在 .paaw/ 或專案目錄範圍內。Effort: M
> 52 個 findings 顯示大量未驗證的路徑操作，風險等級高

### 8. ⏳ [high] developer — 修復 packages/server/src/routes/coding-night-shift.mjs 的 command injection 漏洞（54 findings）：semgrep 偵測到 child_process 的 cmd 參數來自使用者輸入。找到所有 exec / execSync / spawn 呼叫，如果是執行固定命令則改用 execFile with args array（避免 shell 解析）；如果必須接受使用者命令則加入白名單驗證或嚴格的 input sanitization。參考 Night Shift 相關 ADR-010 的架構邊界設計。Effort: M
> command injection 可直接取得 server shell，是最高嚴重等級的漏洞

---

*由 PAAW Engineering Manager 自動產生*
