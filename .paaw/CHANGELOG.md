# Changelog

> 由 PAAW AI-Native IDE 自動維護。每次 AI 完成任務後自動追加變更記錄。

## 2026-07-18

### Added
- 為 `paaw-agent-loop.mjs` 的 `effectiveMaxTurns` 邏輯新增 25 個單元測試，涵蓋 `runAgentLoop` 和 `runAgentLoopStream` 在 `maxTurns` 未定義、為 null、明確指定、為 0 時的行為

### Changed
- 清理舊備份 (backup-2026-07-13) 並新增備份 (backup-2026-07-17)
- 更新 status-cache、coding-memory 及 config 檔案

### Commits
- `0f868bc` chore: cleanup old backups and add new backup 2026-07-17

---

### changed
- 完整重構 CHANGELOG.md — 根據 git log (aaa62fc~2ecb9b6) 補齊 2026-07-17 共 20 筆 commit 的變更記錄，涵蓋 P0 anti-breakage、PAAW Gateway、EM Dashboard 修復群組、程式碼審計批量修復等

### changed
- code changes (1 new file)

### changed
- +309 −111 lines across 7 files

### fixed
- refinery.ts weeklyRefine: 以 json-stable-stringify 取代 JSON.stringify，修復 semgrep no-stringify-keys warning

### added
- Reports tab — EM report list + viewer (GET/DELETE /api/coding-reports/list, /:date) with markdown rendering

### added
- Health check endpoint (GET /api/coding-health) — checks provider config, feature map, issues, Night Shift stuck-run detection, security scan freshness, LLM activity, coding standards (checks .paaw/ and .paaw/project/)

### added
- Layer 3 feature map validation (feature-map-validator.mjs) — deterministic checks on AI output: missing files, missing APIs, duplicate assignments, orphan files, hallucinated references in AI understanding

### added
- AI feature discovery from orphan files (POST /api/coding-features/discover) — groups unmapped source files into new features with L3 validation before writing

### added
- AI understanding generation for all 9 features (POST /api/coding-features/:id/understand) — Overview, Architecture, Data Flow, Key Decisions, Test Coverage, Risks, Dependencies

### added
- Night Shift timeout protection — global 10-min timeout that force-fails stuck runs; Phase 0 feature map refresh + L3 validation before dispatching agents

### added
- EM Dashboard passes ModelSelector model to EM/Night Shift + Phase 0 feature map refresh

### fixed
- Reports tab renders markdown (ReactMarkdown + remark-gfm) instead of plain text

### fixed
- Refinery weeklyRefine: replace JSON.stringify with json-stable-stringify for deterministic output

### fixed
- Code Understanding: same 3 fixes as refresh-mapping (truncated JSON recovery, file existence validation, sanitize)

### fixed
- Health check: check .paaw/project/ for CODING-STANDARDS.md + fix issues wrapper (issues.json vs ISSUES.json)

### fixed
- Security scan: restore full language --include list, rely on --exclude data/semgrep-rules (scan JS/TS/Python/Java/Go/Ruby/PHP/C/C++/C#)

### fixed
- Security scan: only scan source code files via --include, exclude semgrep-rules dir + non-web languages + JSON/MD/data

### fixed
- UX: instant scroll to bottom instead of smooth animation; don't auto-scroll EM chat to bottom on initial load

### changed
- ## Night Shift Task: Test Coverage

Changed files:
- .paaw/CHANGELOG.md
- .paaw/ (1 new file)

### changed
- +421 −11 lines across 8 files

## 2026-07-17

### Added
- **P0 anti-breakage — 依賴上下文注入**：AI 修改檔案前自動注入 `dependency-context.mjs` 分析結果（誰依賴此檔案、誰呼叫此函式、相關測試檔案），防止「改東壞西」
- **P0 anti-breakage — 自動測試驗證**：AI 修改檔案後自動尋找受影響的測試並執行，失敗時通知 AI 自我修正
- **PAAW Gateway**：獨立的 DevOps 管理平台，作為 standalone process (:4199) 管理 PAAW Server (:4097)
  - Dashboard：系統健康度、PAAW Server 狀態、git 資訊、備份摘要
  - 版本管理：目前/最新版本、git commit、一鍵升級
  - Upgrade：git stash → git pull → npm install → restart PAAW Server（Gateway 保持存活）
  - 備份與還原：手動 + 定時排程（tar data/ + .paaw/）
  - Process Manager：啟動/停止/重啟 PAAW Server
  - 使用者認證：JWT 簡單認證（admin/developer 角色）
  - 事件日誌：所有操作的稽核軌跡
  - 內建暗色主題 UI，無需 build，開箱即用
- **EM dispatch prompts 完整 finding 細節** — EM 下達工作指示時帶入完整掃描發現

### Fixed
- **EM Dashboard 修復群組**：
  - EM 自動排程無反應 — SSE 事件格式不匹配（前端只解析 CU 格式，忽略 task 事件）
  - EM 自動排程 root cause — `callLLM` 回傳已解析的物件，`.json()` 報錯導致空工作清單
  - `_readBody not defined` — coding.mjs em-run route 遺漏 inline body reader
  - EM 訊息樣式與 CodingIDE 一致 — 左對齊 + 頭像 + 使用者石色氣泡
  - EM Dashboard 模型選擇器獨立狀態（不再綁 activeCrew）
  - 隱藏 Night Shift 上次執行時間戳（避免 EM Dashboard 顯示過時資訊）
- **程式碼審計批量修復**（CodingIDE）：
  - IME composition guard — chat textarea 三層保護防止中日韓輸入 Enter 誤送
  - Crew 切換時清除 chatInput（避免資料跨 tab 洩漏）
  - Streaming API 儲存累積內容（而非過時狀態）
  - `contextDebug.totalLength` null-safe 檢查
- **CodingIDE — showArchivePanel TDZ 錯誤**：useState 擺放位置在 useEffect 之後，移至上層
- **EM Dashboard**：`conversationHistory` 閉包過時問題、`emContextDebug` 物件渲染 crash、`totalLength` 型別守衛
- **NightShiftPanel**：`fetchStatus useEffect` 遺漏 `rootPath` 相依（導致過時路徑）
- LLM 日誌 `agentId` 回退 — 舊日誌無 `agentId` 欄位，從 `caller` 推斷
- semgrep 掃描跳過 `data/semgrep-rules` 目錄（規則檔非原始碼）
- Gateway UI — 巢狀 template literal 衝突導致白頁，改為 static HTML 檔案
- 移除 `.mjs` 檔案中的 TypeScript 泛型語法（`Set<string>` → `Set`）
- 移除多餘閉括號 + TypeScript 型別註解（`(f: any)` → `(f)`）
- `agent-loop maxTurns` 回退 — `runAgentLoop` 和 `runAgentLoopStream` 統一使用 `effectiveMaxTurns`

### Changed
- Gateway 預設密碼改為 `changeme`

### Removed
- **Gateway 提取為獨立 repo**（`LoveFleming/tpaaw-gateway`），不再內建於此專案

### Commits
- `aaa62fc` feat: EM dispatch prompts now include full finding details
- `31c7fc6` feat: P0 anti-breakage — dependency context injection + auto test verification
- `ea088dd` fix: remove TypeScript generic syntax from .mjs file (Set → Set)
- `56b07e7` fix: remove stray closing brace + TypeScript type annotations in .mjs files
- `f9f9a1c` fix: LLM log agentId 'unknown' — fallback to caller field for old logs
- `14417b1` feat: PAAW Gateway — independent DevOps management platform
- `d86586c` fix: Gateway UI — move HTML to static file, fix template literal conflict
- `c4aa545` chore: gateway default password → changeme
- `f8019d0` fix: CodingIDE — showArchivePanel used before declaration (TDZ error)
- `106c359` fix: semgrep scan skip data/semgrep-rules directory
- `78473de` refactor: extract gateway to standalone repo (LoveFleming/tpaaw-gateway)
- `93dbf0e` fix: hide stale night-shift last-run timestamp from panel
- `99e04c7` fix: hide (上次 night-shift: 07-16) from EM Dashboard
- `9c8c299` fix: EM Dashboard model selector — give it own model state
- `82fe698` fix: batch bug fixes from code audit
- `8a5fcd8` fix: EM auto-dispatch shows nothing — SSE event format mismatch + better logging
- `33a8c69` fix: EM chat style matches CodingIDE — left-aligned with avatars
- `66c6b29` fix: EM auto-dispatch root cause — callLLM returns parsed object not fetch Response
- `9556e54` fix: _readBody not defined in coding.mjs em-run route
- `2ecb9b6` fix: agent loop maxTurns fallback — use effectiveMaxTurns in both runAgentLoop and runAgentLoopStream

---

## 2026-07-16

### Added
- LLM API logging — all calls logged to `data/llm-logs/` with `GET /api/llm-logs`, `GET /api/llm-logs/stats`, `DELETE /api/llm-logs`
- 🔍 Context Debug button to AI agent chat headers
- AI agents can now CRUD project issues (new tool: create/update/delete/list issues)
- Security Console — instant diagnostic panel showing full semgrep scan command
- Startup import check (`import-check.mjs`) — catches missing exports before runtime
- Bundled local semgrep rules (offline) in `data/semgrep-rules/`
- `.env` file support — `PAAW_PORT`, `PAAW_WS_PORT`, `VITE_PORT` configurable via `.env`
- Env var fast path for semgrep — `SEMGREP_PATH`/`PYTHON_PATH` skip all detection

### Fixed
- AI chat now remembers full conversation session (persistent across tab switches)
- Greeting message no longer counted as conversation message
- Cannot set headers after they are sent — fixed response race condition
- Preserve scroll position when switching tabs (keep tool tabs mounted)
- Duplicate `});` in coding.mjs that caused syntax error
- A2A architect now uses coding project path (cwd) for context injection
- Inject Feature Map + Code Intelligence + Security Scan into coding AI chat
- Semgrep: write JSON output to file instead of stdout — no truncation on Windows
- Semgrep: use temp script file to avoid Windows newline/truncation issues
- Semgrep: use semgrep.exe directly, local rules first, short commands
- `PAAW_ROOT` path was wrong — 3 levels up instead of 4
- Flatten semgrep-rules directory (remove duplicate layer)
- Show CU modal on deleted .paaw but don't auto-start — let user decide
- Don't auto-popup CU modal if Code Understanding already done
- Silence registry PATH read error in semgrep runner
- Vite reads .env from repo root, not `packages/ui` CWD
- Security scan Windows double-quote issue — cmd.exe treats quoted commands as string

---

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

---

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
- `4e0b70a` feat: Coding App 對話紀錄持久化 + 智慧 context window 管理

---

## 2026-07-09

### Added
- 自建 `paaw-agent-loop.mjs`（取代外部 CLI agent）
- `domain-agent-registry.mjs`（Crew 載入 + system prompt 組裝）
- 20 個 AI 工具（read_file, write_file, edit_file, glob, grep, diff, git, bash, ask_user, browser_test, record_decision, update_changelog, update_docs, action_log_add/list, agent_memory_save/load）
- Code Understanding 9 步驟專案掃描
- 5-category Health Scores
- EM 大總管 Dashboard

### Commits
- `dafec3c` cleanup: finalize Code Understanding rename
- `2210354` feat: 5-category health scores + Code Understanding can re-run
- `d9cbaf5` feat: rewrite Code Understanding prompts
- `63b5c79` feat: EM 大總管 Landing Page
