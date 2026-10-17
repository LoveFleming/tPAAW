# Changelog

## 2026-10-17
### changed
- code changes (1 new file)



> 每次重大變更後更新。AI 完成任務後可呼叫 `update_changelog` 自動追加。

### changed
- +188141 −87732 lines across 50 files

### changed
- code changes (1 modified)

### changed
- +188398 −87749 lines across 52 files

### changed
- code changes (1 new file) (1 modified)

### changed
- +188624 −87770 lines across 53 files

### changed
- code changes (1 new file)

### changed
- +188753 −87770 lines across 53 files

### changed
- code changes (1 new file)

### changed
- +188868 −87770 lines across 53 files

### changed
- code changes (1 new file)

### changed
- +189017 −87770 lines across 54 files

### changed
- code changes (1 new file) (1 modified)

### changed
- +189955 −87846 lines across 56 files

### changed
- code changes (1 new file) (1 modified)

### changed
- +190163 −87854 lines across 58 files

### changed
- code changes (1 modified)

### changed
- +191270 −87860 lines across 59 files

### changed
- code changes (1 new file) (3 modified)

### changed
- +191849 −87928 lines across 60 files

### changed
- code changes (1 modified)

### changed
- +192135 −87968 lines across 63 files

### changed
- code changes (1 new file)

### changed
- +192275 −87968 lines across 63 files

### changed
- code changes (1 new file) (1 modified)

### changed
- +192946 −88003 lines across 66 files

### changed
- code changes (1 new file)

### changed
- +193117 −88003 lines across 66 files

### changed
- code changes (1 new file)

### changed
- +193567 −88003 lines across 66 files

### changed
- code changes (1 new file)

### changed
- +193869 −88003 lines across 66 files

### changed
- code changes (1 new file) (10 modified)

### changed
- +194661 −88092 lines across 68 files

### changed
- code changes (1 new file)

### changed
- +194778 −88092 lines across 68 files

### changed
- code changes (1 modified)

### changed
- +195091 −88136 lines across 69 files

### changed
- code changes (1 new file)

### changed
- +195252 −88136 lines across 69 files

### changed
- code changes (1 new file)

### changed
- +195630 −88168 lines across 70 files

### changed
- code changes (1 new file) (2 modified)

### changed
- +195779 −88179 lines across 74 files

### changed
- code changes (1 new file)

### changed
- +196294 −88179 lines across 74 files

### changed
- code changes (2 modified)

### changed
- +196747 −88179 lines across 74 files

### changed
- code changes (1 new file) (2 modified)

### changed
- +197159 −88197 lines across 78 files

### changed
- code changes (1 new file)

### changed
- +197464 −88197 lines across 78 files

### changed
- code changes (11 modified)

### changed
- +197806 −88197 lines across 78 files

### changed
- code changes (1 modified)

### changed
- +198111 −88220 lines across 84 files

### changed
- code changes (1 new file) (1 modified)

### changed
- +198704 −88301 lines across 95 files

### changed
- code changes (1 modified)

### changed
- +199207 −88343 lines across 101 files

### changed
- code changes (1 new file) (1 modified)

### changed
- +199339 −88355 lines across 104 files

### changed
- code changes (1 modified)

### changed
- +200342 −88375 lines across 108 files

### changed
- code changes (1 modified)

### changed
- +200693 −88480 lines across 111 files

### changed
- code changes (1 modified)

### changed
- +201041 −88549 lines across 112 files

### changed
- code changes (1 new file)

### changed
- +200594 −88542 lines across 113 files

### changed
- code changes (1 modified)

### changed
- +202005 −88543 lines across 113 files

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
- `4e0b70a` feat: Coding App 對話紀錄持久化 + 智慧 context window 管理

## 2026-07-09 (approx)

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
