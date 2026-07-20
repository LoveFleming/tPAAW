# Changelog

## 2026-07-19

### Added
- **Night Shift 統一系統** — 合併 EM overnight + Night Shift + Reports Tab 為單一系統，報告統一儲存至 `.paaw/night-shift/reports/YYYY-MM-DD.md`
  - `lib/night-shift-shared.mjs`（新檔）— 共享 context gathering、feature map refresh、validation、統一報告儲存
  - `lib/overnight-manager.mjs` 重構 — 支援 `mode='em'` 和 `mode='parallel'`，使用 shared module（移除重複的 feature map refresh）
  - `routes/coding-night-shift.mjs` 簡化為 thin route layer，委派至 `overnight-manager.runNightShift({ mode })`
  - `routes/coding-reports.mjs` 改用 shared module 讀取統一報告目錄
  - `routes/coding-night-shift-config.mjs` 新增 `mode` 欄位（em | parallel）
  - `NightShiftPanel.tsx` 全面重寫 — mode selector（EM / Parallel）、整合 reports list + viewer、config panel
- **EM 大總管專屬 crew + A2A endpoint** — 不再借用 architect endpoint
  - `data/crews/coding.em.json`（武大安 EM）
  - `data/ai-settings/em/system-prompt.md`
  - A2A endpoint `/a2a/em`（domain-agent-registry 註冊）
  - `buildSystemPrompt` 優先讀取 `ai-settings/{agentId}/system-prompt.md`，再 fallback 至 `crew.rolePrompt`
- **EM 新對話功能** — 歸檔當前對話 + session history dropdown
  - `POST /new-session` — 歸檔當前對話並開新 session
  - 📜 (N) dropdown — 顯示所有 sessions（active + history），歷史 session 唯讀
  - active session 自動儲存，歷史 session 不覆寫
- **Night Shift force reset** — `POST /api/coding-night-shift/reset`，狀態卡在 `running` 時可手動重置為 `interrupted`
- **Night Shift 分階段 console.log** — server terminal 顯示 EM / Parallel 每個 phase（Phase 0–4）的執行進度與結果
- **EM work plan structured markdown** — work plan 改為結構化 markdown（`##` + `###` heading + priority/agent icon），透過 ReactMarkdown 渲染
- **night-shift-shared.mjs 單元測試** — 54 個測試涵蓋全部 8 個 exported function（gatherContext、buildSituationReport、saveNightShiftReport、listNightShiftReports、readNightShiftReport、deleteNightShiftReport、refreshFeatureMapping、validateFeatureMap）

### Changed
- **EM Dashboard 大幅簡化** — 移除多個面板，右側僅保留 Code Health + Project Knowledge
  - 移除 date picker、GitChangesPreview panel、last-run info（EM chat 改從 commit changes 直接運作）
  - 移除 Project Status card（含 StatusRow component、git status API call）
  - 移除 Agent Activity panel（action log）+ Overnight Report panel（報告檢視 + dispatch 按鈕）
- **EM auto-dispatch 讀取 night-shift config model** — `coding.mjs` em-run endpoint 原先只使用 UI props model，現改讀 `.paaw/night-shift/config.json` 的 `modelOverride` + `fallbackModels`
- **A2A agent dispatch 傳遞 model override** — `a2aCallAgent()` 透過 `params.metadata.model` 傳遞 model override（原先完全未傳，導致所有 EM dispatched agents 使用 DeepSeek 而非配置的 zai/glm）
- **A2A agent call 失敗重試** — `fetch failed` / `ECONNRESET` 等 transient 錯誤自動重試（最多 2 次，間隔 3 秒）
- **ModelSelector dropdown 向上展開** — Night Shift config panel 位於 sidebar 底部，dropdown 改為 `bottom-full` 避免被裁切

### Removed
- `ReportsTab.tsx` — 功能已合併至 NightShiftPanel
- EM Dashboard — date picker UI、GitChangesPreview panel、Project Status card（含 StatusRow）、Agent Activity panel、Overnight Report panel
- Legacy `overnight-reports` backward compatibility — 移除 `.paaw/overnight-reports/` 雙位置檢查，list/read/delete 只讀 `.paaw/night-shift/reports/`
- EM session list message count badge

### Commits
- `19e1963` feat: unify Night Shift + EM overnight + Reports into single system
- `4c11c19` refactor: remove legacy overnight-reports backward compat
- `89ec3e7` refactor: simplify EM Dashboard — remove date picker, git changes panel, last-run info
- `afe8b0d` refactor: remove Project Status card from EM Dashboard
- `e0815bb` refactor: remove Agent Activity + Overnight Report from EM Dashboard
- `f1851c8` fix: ModelSelector dropdown opens upward (bottom-full) to avoid clipping
- `4b9f16c` fix: EM auto-dispatch now reads night-shift config for model settings
- `7803170` test: add 54 unit tests for night-shift-shared.mjs
- `5d8350c` fix: A2A agent call now retries on fetch failed (up to 2 retries)
- `ea05ec2` feat: add force reset button for stuck Night Shift status
- `1635bc5` feat: add console.log for every Night Shift phase (EM + Parallel)
- `3a8ed8a` fix: A2A agent dispatch now passes model override via metadata
- `f12cb0e` style: EM work plan now renders as structured markdown with icons
- `63c3254` feat: EM 大總管 gets own crew, ai-settings prompt, and A2A endpoint
- `71c3370` feat: EM 新對話 now archives active + sessions history dropdown
- `5b80c26` fix: remove message count badge from EM session list

---

### changed
- code changes (1 new file)

### changed
- +129 −36 lines across 4 files

### changed
- 請使用剛 build 好的 Skill（data/skills/building/translate/package/SKILL.md）執行以下使用者輸入，驗證 (1 new file)

### changed
- +108 −35 lines across 4 files

### fixed
- ## Night Shift Task: Build & Fix

Today's changed files:
- .paaw/CHANGELOG.md
-  (1 new file)

### changed
- +415 −14 lines across 6 files

### changed
- ## Night Shift Task: Documentation Update

Today's changes:
```
ef3345b docs: re (1 modified)

### changed
- +461 −14 lines across 8 files

## 2026-07-18

### Added
- 為 `paaw-agent-loop.mjs` 的 `effectiveMaxTurns` 邏輯新增 25 個單元測試，涵蓋 `runAgentLoop` 和 `runAgentLoopStream` 在 `maxTurns` 未定義、為 null、明確指定、為 0 時的行為

### Changed
- 清理舊備份 (backup-2026-07-13) 並新增備份 (backup-2026-07-17)
- 更新 status-cache、coding-memory 及 config 檔案

### Commits
- `0f868bc` chore: cleanup old backups and add new backup 2026-07-17

---

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
