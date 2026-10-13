# DEPLOY.md — PAAW 公司更新包（deploy6）

- 來源：`dev`（Mac mini）＝公司單一來源
- Baseline：`company-baseline-20261005`（`9ee918d2`，2026-10-04）→ `dev` HEAD `47a8a589`
- 檔案清單**由 git diff 產生**（非人工整理），保證與 commit 一致
- 內容：**純更新包** —— 只放「當次要蓋的檔案」；不含公司自有資料、不含 `data/semgrep-rules`
- ⚠️ 這個 branch **不是**用來 clone 跑的，是給你**逐一開檔下載**用（路徑即 tPAAW 相對路徑）

## 步驟（手動逐一覆蓋）
1. 逐檔下載 → 照相同相對路徑覆蓋 tPAAW
2. 「刪除清單」的檔案**真的刪掉**
3. 「搬移」：把公司自己舊位置的資料搬到新位置
4. **清乾淨再裝**：`npm run clean`（全刪 node_modules 含 packages/*）→ `npm install`
   ⚠️ 只 `rm -rf node_modules` 不夠！子目錄殘留會害 `rollup` 沒裝 → build 失敗
5. `npm run build`
6. 重啟 server（`npm start`）
7. 裝完自檢 MXC：`bash scripts/check-mxc-linux.sh`（紅綠結論）

## ⚠️ 必裝依賴
新增：`@anthropic-ai/sandbox-runtime`（必需）、`@microsoft/mxc-sdk`（optional，公司 Linux/Windows=MXC 後端）、`tree-sitter-rust`、`adm-zip`

## 📦 新增檔（73）
- `data/assistant-skills.json`
- `data/assistant-skills/atlassian-mcp/SKILL.md`
- `data/assistant-skills/atlassian-mcp/_paaw.json`
- `data/assistant-skills/atlassian-mcp/references/authentication-patterns.md`
- `data/assistant-skills/atlassian-mcp/references/common-workflows.md`
- `data/assistant-skills/atlassian-mcp/references/confluence-operations.md`
- `data/assistant-skills/atlassian-mcp/references/jira-queries.md`
- `data/assistant-skills/atlassian-mcp/references/mcp-server-setup.md`
- `data/config/network-whitelist.json`
- `data/crew-conversations/_default/coding.architect/saved-inputs.json`
- `data/crew-conversations/_default/my.assistant/saved-inputs.json`
- `data/crew-conversations/coding.architect/work-log.json`
- `data/crew-conversations/my.assistant/work-log.json`
- `data/crew-pictures/conversation_rainy_assistant.png`
- `data/crew-pictures/divya_qa_engineer.png`
- `data/crew-pictures/ethan_em.png`
- `data/crew-pictures/greta_ops_engineer.png`
- `data/crew-pictures/kamil_health_checker.png`
- `data/crew-pictures/koharu_skill_designer.png`
- `data/crew-pictures/megan_troubleshooting_engineer.png`
- `data/crew-pictures/piotr_rm_officer.png`
- `data/crew-pictures/priya_node_developer.png`
- `data/crew-pictures/xiaowei_spec_architect.png`
- `data/crew-pictures/zofia_handover_guide.png`
- `data/crew-preferences.json`
- `data/knowledge/coding-security.md`
- `packages/modules/assistant/crews/my.assistant.json`
- `packages/modules/assistant/module.json`
- `packages/modules/coding/crews/coding.architect.json`
- `packages/modules/coding/crews/coding.developer.json`
- `packages/modules/coding/crews/coding.doc-writer.json`
- `packages/modules/coding/crews/coding.em.json`
- `packages/modules/coding/crews/coding.handover.json`
- `packages/modules/coding/crews/coding.helpdesk.json`
- `packages/modules/coding/crews/coding.ops.json`
- `packages/modules/coding/crews/coding.qa.json`
- `packages/modules/coding/crews/coding.rm.json`
- `packages/modules/coding/crews/coding.tester.json`
- `packages/modules/coding/module.json`
- `packages/server/src/lib/asset-log-migrate.mjs`
- `packages/server/src/lib/assistant-skills.mjs`
- `packages/server/src/lib/audit-log.mjs`
- `packages/server/src/lib/env-exec-tool.mjs`
- `packages/server/src/lib/exec-approvals.mjs`
- `packages/server/src/lib/feature-risk-scan.mjs`
- `packages/server/src/lib/module-registry.mjs`
- `packages/server/src/lib/paaw-sandbox.mjs`
- `packages/server/src/lib/project-md.mjs`
- `packages/server/src/lib/release-evidence.mjs`
- `packages/server/src/lib/script-guard.mjs`
- `packages/server/src/lib/test-report-reader.mjs`
- `packages/server/src/routes/assistant-skills.mjs`
- `packages/server/src/routes/audit-log.mjs`
- `packages/server/src/routes/coding-review-board.mjs`
- `packages/server/src/routes/coding-trouble.mjs`
- `packages/ui/src/components/AssistantProfileModal.tsx`
- `packages/ui/src/components/AssistantSkillsModal.tsx`
- `packages/ui/src/components/AuditLogPanel.tsx`
- `packages/ui/src/components/ChatInputBar.tsx`
- `packages/ui/src/components/CodeReviewBoardPanel.tsx`
- `packages/ui/src/components/ColResizer.tsx`
- `packages/ui/src/components/ProjectMdPage.tsx`
- `scripts/check-mxc-linux.sh`
- `tests/unit/audit-log.test.mjs`
- `tests/unit/coding-handover.test.mjs`
- `tests/unit/coding-trouble.test.mjs`
- `tests/unit/feature-merge.test.mjs`
- `tests/unit/feature-risk-scan.test.mjs`
- `tests/unit/paaw-sandbox-mxc.test.mjs`
- `tests/unit/release-evidence.test.mjs`
- `tests/unit/script-guard.test.mjs`
- `tests/unit/severity-auto-scan.test.mjs`
- `tests/unit/test-report-reader.test.mjs`

## ✏️ 修改檔（80）
- `data/config/providers.example.json`
- `installed-apps/learning/manifest.json`
- `installed-apps/pm/manifest.json`
- `installed-apps/secret/manifest.json`
- `package.json`
- `packages/server/src/context-engine.mjs`
- `packages/server/src/data-home.mjs`
- `packages/server/src/lib/agent-exec-logger.mjs`
- `packages/server/src/lib/browser-session.mjs`
- `packages/server/src/lib/coding-review-runner.mjs`
- `packages/server/src/lib/cu-mechanical.mjs`
- `packages/server/src/lib/domain-agent-registry.mjs`
- `packages/server/src/lib/em-config.mjs`
- `packages/server/src/lib/error-code-scan.mjs`
- `packages/server/src/lib/es-shipper.mjs`
- `packages/server/src/lib/feature-map-v2.mjs`
- `packages/server/src/lib/feature-registry.mjs`
- `packages/server/src/lib/janitor.mjs`
- `packages/server/src/lib/llm-utils.mjs`
- `packages/server/src/lib/paaw-agent-loop.mjs`
- `packages/server/src/lib/proc-ledger.mjs`
- `packages/server/src/lib/project-crew.mjs`
- `packages/server/src/lib/release-requests.mjs`
- `packages/server/src/lib/release-unit/cost.mjs`
- `packages/server/src/lib/release-unit/handover-state.mjs`
- `packages/server/src/lib/ru-resolver.mjs`
- `packages/server/src/lib/semgrep-runner.mjs`
- `packages/server/src/lib/test-intelligence.mjs`
- `packages/server/src/lib/tool-engine/provider.mjs`
- `packages/server/src/paaw-server.mjs`
- `packages/server/src/routes/a2a.mjs`
- `packages/server/src/routes/ai-settings.mjs`
- `packages/server/src/routes/assistant.mjs`
- `packages/server/src/routes/chat.mjs`
- `packages/server/src/routes/coding-features.mjs`
- `packages/server/src/routes/coding-handover.mjs`
- `packages/server/src/routes/coding-health.mjs`
- `packages/server/src/routes/coding-memory.mjs`
- `packages/server/src/routes/coding-ops.mjs`
- `packages/server/src/routes/coding-releases.mjs`
- `packages/server/src/routes/coding.mjs`
- `packages/server/src/routes/context.mjs`
- `packages/server/src/routes/crew.mjs`
- `packages/server/src/routes/llm-logs.mjs`
- `packages/server/src/routes/log-retention.mjs`
- `packages/server/src/routes/release-unit.mjs`
- `packages/server/src/routes/shared.mjs`
- `packages/server/src/routes/vibe-sessions.mjs`
- `packages/server/src/scheduler/cron-jobs.mjs`
- `packages/server/src/tools/index.mjs`
- `packages/server/src/websocket/ws-handler.mjs`
- `packages/ui/src/App.tsx`
- `packages/ui/src/components/AgentConsole.tsx`
- `packages/ui/src/components/AgentSideChat.tsx`
- `packages/ui/src/components/ChatMessages.tsx`
- `packages/ui/src/components/CodeIntelPage.tsx`
- `packages/ui/src/components/CrewManager.tsx`
- `packages/ui/src/components/DecisionLog.tsx`
- `packages/ui/src/components/EMDashboard.tsx`
- `packages/ui/src/components/FeatureMap.tsx`
- `packages/ui/src/components/HandoverPanel.tsx`
- `packages/ui/src/components/ProjectAiPanel.tsx`
- `packages/ui/src/components/ReleaseManagerPanel.tsx`
- `packages/ui/src/components/ReleaseRequests.tsx`
- `packages/ui/src/components/RuQaSection.tsx`
- `packages/ui/src/components/SecurityTab.tsx`
- `packages/ui/src/components/TestsPage.tsx`
- `packages/ui/src/components/TroubleshootingPanel.tsx`
- `packages/ui/src/components/git/GitPanel.tsx`
- `packages/ui/src/i18n/locales/en.json`
- `packages/ui/src/i18n/locales/ja.json`
- `packages/ui/src/i18n/locales/zh-mix.json`
- `packages/ui/src/i18n/locales/zh.json`
- `packages/ui/src/pages/ChatView.tsx`
- `packages/ui/src/pages/CodingIDE.tsx`
- `packages/ui/src/pages/Notes.tsx`
- `packages/ui/src/pages/ProjectBoard.tsx`
- `packages/ui/src/pages/SettingsPage.tsx`
- `scripts/pack.mjs`
- `tests/e2e/11-nav-comprehensive.spec.ts`

## 🗑️ 刪除清單（54）
- `data/ai-settings/distill/chat.md`
- `data/ai-settings/distill/cron.md`
- `data/ai-settings/distill/system-prompt.md`
- `data/ai-settings/distill/vibe-coding.md`
- `data/ai-settings/distill/vibe.md`
- `data/distill/knowledge/chat/2026-06-13.md`
- `data/distill/knowledge/chat/2026-06-15.md`
- `data/distill/knowledge/chat/2026-06-16.md`
- `data/distill/knowledge/chat/2026-06-17.md`
- `data/distill/knowledge/chat/2026-06-18.md`
- `data/distill/knowledge/chat/2026-06-19.md`
- `data/distill/knowledge/chat/2026-06-21.md`
- `data/distill/knowledge/chat/2026-06-22.md`
- `data/distill/knowledge/chat/2026-06-26.md`
- `data/distill/knowledge/chat/2026-06-27.md`
- `data/distill/knowledge/chat/2026-06-28.md`
- `data/distill/knowledge/chat/2026-06-29.md`
- `data/distill/knowledge/chat/2026-06-30.md`
- `data/distill/knowledge/chat/2026-07-01.md`
- `data/distill/knowledge/chat/2026-07-06.md`
- `data/distill/knowledge/vibe-coding/2026-06-23.md`
- `data/distill/knowledge/vibe-coding/2026-06-26.md`
- `data/distill/knowledge/vibe/2026-06-12.md`
- `data/distill/knowledge/vibe/2026-06-14.md`
- `data/distill/knowledge/vibe/2026-06-17.md`
- `data/distill/knowledge/vibe/2026-06-18.md`
- `data/distill/knowledge/vibe/2026-06-24.md`
- `data/distill/knowledge/vibe/2026-06-25.md`
- `data/distill/knowledge/vibe/2026-08-01.md`
- `data/distill/knowledge/vibe/2026-09-12.md`
- `data/distill/raw/chat/2026-06-13.jsonl`
- `data/distill/raw/chat/2026-06-15.jsonl`
- `data/distill/raw/chat/2026-06-16.jsonl`
- `data/distill/raw/chat/2026-06-17.jsonl`
- `data/distill/raw/chat/2026-06-18.jsonl`
- `data/distill/raw/chat/2026-06-19.jsonl`
- `data/distill/raw/chat/2026-06-21.jsonl`
- `data/distill/raw/chat/2026-06-22.jsonl`
- `data/distill/raw/chat/2026-06-26.jsonl`
- `data/distill/raw/chat/2026-06-27.jsonl`
- `data/distill/raw/vibe-coding/2026-06-23.jsonl`
- `data/distill/raw/vibe-coding/2026-06-26.jsonl`
- `data/distill/raw/vibe/2026-06-12.jsonl`
- `data/distill/raw/vibe/2026-06-14.jsonl`
- `data/distill/raw/vibe/2026-06-17.jsonl`
- `data/distill/raw/vibe/2026-06-18.jsonl`
- `data/distill/raw/vibe/2026-06-24.jsonl`
- `data/distill/raw/vibe/2026-06-25.jsonl`
- `packages/server/src/routes/distill.mjs`
- `packages/ui/src/components/CrewEditor.tsx`
- `packages/ui/src/pages/AICrew.tsx`
- `packages/ui/src/pages/AppModules.tsx`
- `packages/ui/src/pages/EmployeeWorkspace.tsx`
- `scripts/seed/distill/.gitkeep`

## 🔀 搬移（舊位置刪、新位置放本包的檔）
- 舊 `data/crews/conversation/_default/coding.architect/saved-inputs.json`（刪）→ 新 `data/crew-conversations/_default/coding.architect/saved-inputs.json`（已含本包，放這）
- 舊 `data/crews/conversation/_default/my.assistant/saved-inputs.json`（刪）→ 新 `data/crew-conversations/_default/my.assistant/saved-inputs.json`（已含本包，放這）
- 舊 `data/crews/conversation/coding.architect/work-log.json`（刪）→ 新 `data/crew-conversations/coding.architect/work-log.json`（已含本包，放這）
- 舊 `data/crews/conversation/my.assistant/work-log.json`（刪）→ 新 `data/crew-conversations/my.assistant/work-log.json`（已含本包，放這）
- 舊 `data/crews/pic/conversation_rainy_assistant.png`（刪）→ 新 `data/crew-pictures/conversation_rainy_assistant.png`（已含本包，放這）
- 舊 `data/crews/pic/divya_qa_engineer.png`（刪）→ 新 `data/crew-pictures/divya_qa_engineer.png`（已含本包，放這）
- 舊 `data/crews/pic/ethan_em.png`（刪）→ 新 `data/crew-pictures/ethan_em.png`（已含本包，放這）
- 舊 `data/crews/pic/greta_ops_engineer.png`（刪）→ 新 `data/crew-pictures/greta_ops_engineer.png`（已含本包，放這）
- 舊 `data/crews/pic/kamil_health_checker.png`（刪）→ 新 `data/crew-pictures/kamil_health_checker.png`（已含本包，放這）
- 舊 `data/crews/pic/koharu_skill_designer.png`（刪）→ 新 `data/crew-pictures/koharu_skill_designer.png`（已含本包，放這）
- 舊 `data/crews/pic/megan_troubleshooting_engineer.png`（刪）→ 新 `data/crew-pictures/megan_troubleshooting_engineer.png`（已含本包，放這）
- 舊 `data/crews/pic/piotr_rm_officer.png`（刪）→ 新 `data/crew-pictures/piotr_rm_officer.png`（已含本包，放這）
- 舊 `data/crews/pic/priya_node_developer.png`（刪）→ 新 `data/crew-pictures/priya_node_developer.png`（已含本包，放這）
- 舊 `data/crews/pic/xiaowei_spec_architect.png`（刪）→ 新 `data/crew-pictures/xiaowei_spec_architect.png`（已含本包，放這）
- 舊 `data/crews/pic/zofia_handover_guide.png`（刪）→ 新 `data/crew-pictures/zofia_handover_guide.png`（已含本包，放這）
- `packages/modules/coding/crews/coding.{architect,handover,qa,rm}.json`：新位置（舊位置是 `.paaw/agents/` 對應檔，已含在上方新增清單）

## 🙅 不要覆蓋（公司自己的 runtime / 個人資料）
- `data/config/{user,backup,providers}.json`
- `data/crews/**`（舊位置；裡面你自己的東西，不要被本包覆蓋）
- `.paaw/**`（公司自己的 release unit 資產）

## ⚠️ 風險提醒
1. 一定要 `npm install`（新依賴）。
2. crew 定義搬到 `packages/modules/*/crews/`；`data/crews/*.json` 的 rolePrompt 覆蓋路徑**已移除 → firmware 永遠權威**，公司自訂 prompt 會被忽略。
3. `providers.json` 不要被覆蓋（含 API key，非版控）。
4. 舊檔（distill 相關、AICrew/AppModules/EmployeeWorkspace/CrewEditor.tsx、routes/distill.mjs、scripts/seed/distill/）留著不影響執行，但建議刪。
5. `data/config/network-whitelist.json` 是出廠預設（builtin 9 網域）；公司自訂在 Settings → 🛡 安全 加。

## 🆕 `1012update/`（2026-10-12 晚 19:00 後 15 檔）
- 基準 `eba314b9`（18:17，公司今天 build 過的版本）→ `a2243f2d`（21:42），**排除** `installed-apps/learning/manifest.json`（learning space），共 **15 檔**。
- 內容：`1012update/` 下照 tPAAW 相對路徑鋪（下載後去掉 `1012update/` 前綴即為覆蓋路徑）。
  - 新增（A）：`packages/ui/src/pages/AppModules.tsx`、`packages/ui/src/components/ModulePageLoader.tsx`、`packages/ui/src/moduleRuntime.ts`、`packages/server/src/lib/module-ui-bundle.mjs`
  - 修改（M）：`.env.example`、`.gitignore`、`package.json`、`packages/server/src/lib/app-modules.mjs`、`packages/server/src/lib/es-shipper.mjs`、`packages/server/src/routes/apps.mjs`、`packages/ui/src/App.tsx`、`packages/ui/src/i18n/locales/{zh,en,ja,zh-mix}.json`
- 做了什麼：App Modules 管理頁還原 + M2（模組 zip 匯入/匯出/移除）+ M3（模組 UI runtime 動態載入，匯入後免 build）+ ES shipper 帳密/index 前綴。
- ⚠️ 家公司步驟：蓋這 15 檔 → `npm install`（新增依賴 `esbuild`）→ `npm run build` → 重啟 server。
- 驗證：`git diff --name-status eba314b9..a2243f2d`

## 🛡 `sandbox-fix/`（2026-10-13 沙箱跨平台修正）
- 目的：修公司 Linux 沙箱卡住 coding app（`bwrap: Can't find source path /private/tmp`）+ 全面跨平台硬化。
- 路徑同 deploy6 規則：`sandbox-fix/` 下照 tPAAW 相對路徑鋪，下載後**去掉 `sandbox-fix/` 前綴**即為覆蓋路徑。
- 內容（9 檔）：
  - `packages/server/src/lib/paaw-sandbox.mjs`　（fs policy 過濾不存在路徑；macOS 路徑只在 darwin；path.join；HOME/USERPROFILE；shell 改 posixShellBin）
  - `packages/server/src/lib/shell-exec.mjs`　（新 `posixShellBin()`：$SHELL→平台預設→/bin/sh）
  - `packages/server/src/lib/env-exec-tool.mjs`（execFile PATH 跨平台）
  - `packages/server/src/lib/dev-server.mjs`　（POSIX shell fallback）
  - `packages/server/src/lib/proc-ledger.mjs`　（同上）
  - `packages/server/src/websocket/ws-handler.mjs`（同上）
  - `packages/server/src/lib/script-guard.mjs`（持久化偵測補 Windows）
  - `packages/server/src/lib/audit-log.mjs`　（沙箱拒絕偵測跨平台：EPERM/EACCES/Access is denied）
  - `data/knowledge/mxc-linux-install.md`　（症狀＋修法文件，選配）
- ⚠️ 覆蓋後**一定要重啟 server**（server code 無 --watch）。本批**無新依賴、無 UI 變動**，不用 npm install、不用 build。
- 來源 dev `ea989d83`；已過 `npx vitest run tests/unit`（815 passed）+ import 檢查。

## 📁 `filemount-fix/`（2026-10-13 File Mounts / reference_read 修正）
- 症狀：coding app agent `reference_read(source="workspace")` 回「(workspace/ directory does not exist yet)」。
- 根因：`data/workspaces.json` 被版控，內容是 Mac 絕對路徑（`/Users/steward/...`）→ 公司 Linux 不存在。
- 路徑同 deploy6 規則：`filemount-fix/` 下照 tPAAW 相對路徑鋪，下載後去掉 `filemount-fix/` 前綴即為覆蓋路徑。
- 內容（5 檔）：
  - `packages/server/src/lib/paaw-agent-loop.mjs`（reference_read / workspaceDirs 只認本機存在的目錄）
  - `packages/server/src/context-engine.mjs`
  - `packages/server/src/tools/index.mjs`
  - `packages/server/src/lib/domain-agent-registry.mjs`
  - `.gitignore`（加 `data/workspaces.json`、`data/config/workspaces.json` — 之後不進版控）
- ⚠️ 覆蓋後**重啟 server**。**另外要手動處理本機的 `data/workspaces.json`**：改成公司本機真實路徑，或直接刪掉再用「設定 → 📁 File Mounts」重新加（這個檔從此不再由更新包提供）。
- 來源 dev `350448e0`；`npx vitest run tests/unit` 817 passed。

## 🛡 `approval-fix/`（2026-10-13 審批卡：按了沒反應 / 一次多張）
- 症狀：按 ♾️ 永遠准許 後卡片原樣留著（不確定有沒有生效）；一次跑出多張審批卡，按一張其他張還掛著。
- 根因：agent 重試同一條被攔指令 → 每次都送新 id（同 command）→ 多張卡；決策只更新被點的那張，且畫面只有小 badge，看不出生效。
- 內容（3 檔，去掉 `approval-fix/` 前綴即覆蓋路徑）：
  - `packages/server/src/lib/exec-approvals.mjs`（決策一次 → 同指令其他待審批一起結案）
  - `packages/ui/src/pages/CodingIDE.tsx`（點下立即回饋 + toast；同指令卡片一起結；失敗明確提示；approval_request 去重）
  - `packages/ui/src/components/ChatMessages.tsx`（已決策整張卡變色 + 「✔ 已生效」）
- ⚠️ 有動 UI → 覆蓋後要 **`npm run build`** 然後**重啟 server**。
- 來源 dev `d2d4f2c7`；822 tests passed。

## 🛠 `devmode-switch/`（2026-10-13 開發模式總開關：趕碼時關沙箱＋關審批）
- 需求：沙箱／安全審批用起來摩擦大，趕碼時想整個跳過，有空再打開來測 → 一個總開關。
- 位置：PAAW → ⚙️ 設定 → 🛡 安全 → 最上方「🛠 開發模式 master switch」。
- 開啟後：AI 的 bash 不進 MXC / srt 沙箱、script-guard 命中也不再跳審批卡（直接放行）。
- 仍保留（刻意不關）：shell-guard（AI 動不了本 RU 以外的 process，尤其 PAAW 自己）、執行入口檔（git hooks / shell rc）寫入攔截。
- ⚠️ 開啟期間的「本應被攔」指令會記到審計（`script_guard_bypassed`），安全 tab 下方的審計報表看得到。
- 設定存在 `data/config/security.json`（每台機器各自設定，不進版控），**切換免重啟**。
- 路徑同 deploy6 規則：`devmode-switch/` 下照 tPAAW 相對路徑鋪，下載後**去掉 `devmode-switch/` 前綴**即為覆蓋路徑。
- 內容（9 檔）：
  - `packages/server/src/lib/security-mode.mjs`　（**新增**：讀寫 data/config/security.json + mtime 快取 + env 覆寫）
  - `packages/server/src/lib/paaw-sandbox.mjs`　（sandboxKillSwitchOn 併入 devMode → 沙箱整組關）
  - `packages/server/src/lib/paaw-agent-loop.mjs`　（devMode 時 script-guard 放行 + 記 script_guard_bypassed 審計）
  - `packages/server/src/routes/assistant.mjs`　（GET/PUT /api/paaw/security-mode）
  - `packages/ui/src/pages/SettingsPage.tsx`　（安全 tab 開關卡）
  - `packages/ui/src/i18n/locales/{zh,en,ja,zh-mix}.json`　（settings.devMode.* 文案）
- ⚠️ 有動 UI → 覆蓋後要 **`npm run build`** 然後**重啟 server**。
- 來源 dev `827e5a9a`；`npx vitest run tests/unit` 834 passed。

## 🧹 `guard-fix/`（2026-10-13 script-guard 誤擋正常開發 ＋ 審批紀錄跑到別的 crew）
- 症狀 1：`grep -n slice(-10) ./monitor.mjs` 之類「只是在找程式」的指令跳審批卡，訊息寫「即將執行的 ./monitor.mjs — 偵測到對外部 URL 的網路請求（外傳通道）」→ 正常開發被擋死。
- 症狀 2：審批紀錄（🛡 審批紀錄清單）在**每個 crew 的聊天視窗**都出現，明明是在 developer 視窗核准的。
- 根因 1：舊規則把「檔案只要是 grep/cat 的參數（前面有空白或 `./`）」當成「即將執行該檔」→ 讀檔掃內容；且內容規則「程式碼裡同時有 fetch/axios/requests + 外部 URL」就擋 —— 原始碼有 API 網址是常態。
- 根因 2：審批紀錄存在 `<RU>/.paaw/exec-approval-log.jsonl`（per-RU），UI 每個 crew 視窗都渲染，且審批事件沒帶 agentId → 無法歸屬。
- 修法 1：逐段判斷「該段第一個指令」——只有直譯器直跑檔（`node x.mjs`）或該段本身就是執行檔（`./x.sh`）才掃檔案內容；`grep/rg/cat/head/sed/awk/find/git/npm…` 等完全不做內容掃描。外傳規則改成「網路工具在指令位置（含 `execSync("curl https://…")`）＋外部 URL」才算。
  - ⚠️ 取捨：原始碼裡的 `fetch("https://…")` 不再由 pattern 擋（改由沙箱 srt 白名單 / MXC deny-by-default ＋執行後輸出審計把關）。持久化、`rm` 家目錄、`curl|sh` 管線、`git push`、機密路徑（`~/.ssh`、`.env`、`providers.json`）一律照舊擋。
- 修法 2：審批加 `agentId`，UI 只在其所屬 crew 的視窗顯示審批卡與審批紀錄（舊紀錄無 agentId 視為 developer）。
- 路徑同 deploy6 規則：`guard-fix/` 下照 tPAAW 相對路徑鋪，下載後**去掉 `guard-fix/` 前綴**即為覆蓋路徑。
- 內容（6 檔）：
  - `packages/server/src/lib/script-guard.mjs`　（主修：逐段判斷 + 外傳規則收斂）
  - `packages/server/src/lib/exec-approvals.mjs`　（審批紀錄/pending 加 agentId）
  - `packages/server/src/lib/paaw-agent-loop.mjs`　（傳 agentId；⚠️ 與 `filemount-fix/`、`approval-fix/` 同一檔，請用本批最新版）
  - `packages/server/src/routes/a2a.mjs`　（SSE approval_request 帶 agentId）
  - `packages/server/src/websocket/ws-handler.mjs`　（同上）
  - `packages/ui/src/pages/CodingIDE.tsx`　（只在自己 crew 顯示審批卡/紀錄；⚠️ 與 `approval-fix/` 同一檔，用本批最新版）
- ⚠️ 有動 UI → 覆蓋後要 **`npm run build`** 然後**重啟 server**。
- 來源 dev `42f6efc9`；`npx vitest run tests/unit` 838 passed。

## ⏳ `approval-wait/`（2026-10-13 審批卡改成「真的暫停 agent」）
- 症狀：按「✅ 准許一次」或「♾️ 永遠准許」UI 沒變化，而且 **agent loop 照跑不停**（還跑去跟你說「我先停在這裡」）。
- 根因：審批卡以前只是「通知卡」—— 被 script-guard 擋下時只登記 pending ＋送卡，bash 工具**立刻**回傳「已送出審批卡」→ agent loop 早就繼續跑、那個 run 早就結束；你按按鈕時已經沒有人在等了。
- 修法（真暫停語意）：
  - server 新增 `waitForDecision()`：送出審批卡後 agent **真的 await 停住**，等你按按鈕；准許 → 當場接續執行這條指令；拒絕/逾時（預設 3 分鐘，`PAAW_APPROVAL_WAIT_MS` 可調）→ 回「指令未執行」。
  - 同指令的多張卡一樣「按一次全部結案」（`alsoIds` 的等待者也一起叫醒）。
  - bash 工具的執行上限自動加上等待預算（否則 120s tool timeout 會在等待中途把 agent 砍掉）。
  - UI 卡片：待決策時顯示「⏳ agent 已暫停，正在等待你的決定（按鈕後才繼續執行）」；決策後顯示「✔ 已生效 — agent 已繼續執行這條指令」。
  - 審計新增 `approval_granted`（核准後真的執行）。
- 內容（4 檔，路徑照 deploy6 規則去掉 `approval-wait/` 前綴）：
  - `packages/server/src/lib/exec-approvals.mjs`　（⚠️ 與 `guard-fix/`，`approval-fix/` 同一檔 → 用本批最新版）
  - `packages/server/src/lib/paaw-agent-loop.mjs`　（⚠️ 同上，用本批最新版）
  - `packages/server/src/lib/audit-log.mjs`
  - `packages/ui/src/components/ChatMessages.tsx`　（⚠️ 與 `approval-fix/` 同一檔，用本批最新版）
- ⚠️ 有動 UI → 覆蓋後 **`npm run build`** 然後**重啟 server**。
- 來源 dev `b5b800bd`；843 tests passed。真 agent 驗證：送審批 → stream 未結束/檔案未產生（真的停住）→ 按永遠准許 → 當場接續執行；按拒絕 → 結束且未執行。

## 🛡 `security-coding/`（2026-10-13 總包 v7：沙箱＋審批＋開發模式＋script-guard＋安全審計紀錄搬家＋MXC 單後端）
> **這一包把今天所有「coding app 安全/開發體驗」的修正合併成一個目錄**，涵蓋並取代前面的
> `sandbox-fix/`、`filemount-fix/`、`approval-fix/`、`devmode-switch/`、`guard-fix/`、`approval-wait/`
> （那些目錄留著當歷史，內容都是較舊版本）。**只要蓋 `security-coding/` 這 25 檔就好。**
- 路徑照 deploy6 規則：`security-coding/` 下載後**去掉前綴**即為覆蓋路徑。
- ⚠️ **有動 UI → 覆蓋後一定要 `npm run build` 然後重啟 server**。
- 內容（25 檔）：
  - **沙箱（Linux bwrap 修復＋跨平台）**：`packages/server/src/lib/paaw-sandbox.mjs`、`shell-exec.mjs`、`env-exec-tool.mjs`、`dev-server.mjs`、`proc-ledger.mjs`、`packages/server/src/websocket/ws-handler.mjs`、`packages/server/src/lib/audit-log.mjs`、`data/knowledge/mxc-linux-install.md`
  - **script-guard（誤擋正常開發修正）**：`packages/server/src/lib/script-guard.mjs`
  - **審批卡（agentId 歸屬＋真的暫停等待）**：`packages/server/src/lib/exec-approvals.mjs`、`packages/server/src/lib/paaw-agent-loop.mjs`、`packages/server/src/routes/a2a.mjs`、`packages/ui/src/components/ChatMessages.tsx`、`packages/ui/src/pages/CodingIDE.tsx`
  - **🛠 開發模式總開關**：`packages/server/src/lib/security-mode.mjs`、`packages/server/src/routes/assistant.mjs`、`packages/ui/src/pages/SettingsPage.tsx`、`packages/ui/src/i18n/locales/{zh,en,ja,zh-mix}.json`
  - **File Mounts / believed workspace 修復**：`packages/server/src/lib/context-engine.mjs`、`packages/server/src/lib/domain-agent-registry.mjs`、`packages/server/src/tools/index.mjs`、`.gitignore`
- 來源 dev `b5b800bd`（843 tests passed）。
- 蓋完可驗證：① `grep -n slice(-10) ./monitor.mjs` 不再跳審批卡 ② 審批卡只出現在發起的那個 crew 視窗、按鈕後 agent 會接續執行 ③ 設定 → 🛡 安全 看到「開發模式」開關 ④ coding app 在 Linux 能正常寫檔。

### 🆕 v2 追加（2026-10-13 晚，來源 dev `6eeaab88`）
- **審批卡不再擋正常開發**：對外網路請求降級為「通知」（記 audit `network_notice` + 畫面告知），不再跳審批卡 — 守門交給沙箱（srt 白名單 / MXC deny-by-default）；`curl|sh`／`iwr|iex` 下載即執行仍硬擋。
- **RU 內檔案視為信任範圍**：`~/.ssh` 永遠擋；`.env` / `providers.json` 只在「專案（RU）之外」才擋 → **installed-apps 下的目錄預設准許，不會一直問**。
- **安全審計紀錄搬家**：從 設定 → 🛡 安全 移到 **報表 → 🛡️ 安全審計紀錄**（新頁面）。
- 追加/更新檔（在原本 25 檔上再加 3）：`packages/ui/src/App.tsx`、`packages/ui/src/components/AuditLogPanel.tsx`、`packages/ui/src/components/ui/shared.tsx`；並更新 `script-guard.mjs`、`paaw-agent-loop.mjs`、`audit-log.mjs`、`SettingsPage.tsx`、4 個 locale。
- 現共 **28 檔**；844 tests passed。

### 🆕 v3 追加（2026-10-13 晚二，來源 dev `58225185`）
- **MXC 單後端（移除 srt）**：macOS 也改走 MXC（seatbelt），Linux bwrap / Windows ProcessContainer 不變 → 一套 sandbox 邏輯。
  - `paaw-sandbox.mjs` 移除 srt 路徑；`activeBackend()` 一律 `mxc`（`PAAW_SANDBOX_BACKEND=off` 仍可關）。
  - **`package.json` 移除 `@anthropic-ai/sandbox-runtime`** → 公司請在覆蓋後跑 `npm install`（或 `npm prune`），讓舊的 srt 從 node_modules 移除（不裝也無害）。
  - ⚠️ 公司端**必須有 `@microsoft/mxc-sdk`**（deploy6 `vendor/mxc-offline/` 有離線包＋`scripts/install-mxc-offline.sh`）。
- 追加/更新檔（在 28 檔上再加 2）：`package.json`、`data/knowledge/coding-security.md`；並更新 `paaw-sandbox.mjs`、`paaw-agent-loop.mjs`、`audit-log.mjs`、`env-exec-tool.mjs`、`security-mode.mjs`、`routes/assistant.mjs`、`SettingsPage.tsx`、4 個 locale。
- 現共 **30 檔**；844 tests passed；Mac mini 實測 MXC deny → 外連失敗、寫 RU 外被拒、寫 RU 內 OK。

### 🆕 v4 追加（2026-10-13 晚三，來源 dev `370c49f4`）— 兩個「假安全」修正
1. **誠實回報沙箱狀態**：`GET/PUT /api/paaw/security-mode` 原本回 `sandboxBackend`＝設定值（MXC 套件沒裝也顯示 mxc）→ 改成用「真的能跑嗎」判，回 `"mxc"` 或 `"none"`，並新增 `sandboxUsable`。
2. **MXC 啟動失敗不再安靜**：`execSandboxed` 的 catch 原本什麼都不說（會出現「以為有沙箱、其實原樣執行」）→ 現在印一次 `console.warn`。
3. **Settings 徽章**：`sandboxUsable=false` 時轉紅 + ⚠️，一眼看出沙箱沒生效。
- 更新檔（仍在 30 檔內）：`packages/server/src/lib/paaw-sandbox.mjs`、`packages/server/src/routes/assistant.mjs`、`packages/ui/src/pages/SettingsPage.tsx`。
- 844 tests passed；GET security-mode → `{sandboxBackend:"mxc", sandboxUsable:true}`。

### ✅ 明天套用後請確認（開 MXC 安全寫程式）
1. `設定 → 🛡 Security` 的徽章顯示 **MXC**（不是紅字 ⚠️ → 代表 sandbox 真的可用）
2. 隨手叫 coding agent 下一行 bash（如 `echo hi > t.txt; cat t.txt`）→ 輸出結尾要有 **🛡沙箱內（MXC）**
3. 試 `echo x > ~/pwned.txt` → 應被拒（Operation not permitted）
4. `curl https://example.com` → 應該 **不會跳審批卡**（只記 network_notice），沙箱照常把關
5. ⚠️ 若徽章顯示 `none` 或紅字 → 代表公司端 `@microsoft/mxc-sdk` 沒裝好，用 `vendor/mxc-offline/` + `scripts/install-mxc-offline.sh` 補。

### ⚠️ 未納入本包的 dev 改動（跟 sandbox 無關，先不動）
- `packages/server/src/routes/crew.mjs`（SRE module 的 `data/crews` fallback，commit `2a8afa2e`）— 只有要用 SRE app module 才需要；deploy6 root 有一份較舊的。

### 🆕 v5 追加（2026-10-13 晚四，來源 dev `HEAD`）
- **MXC 可寫清單補上 `$PAAW_LOG_HOME`**（= `<PAAW_ROOT>/log`，含 `$PAAW_APP_CONSOLE_DIR`）：
  agent 從 bash 把輸出導到 app-console / log 目錄時不會再被 EPERM（舊 srt allowWrite 也沒含它）。
- 更新檔：`packages/server/src/lib/paaw-sandbox.mjs`。844 tests passed。

### 📌 pww tool 與沙箱的關係（2026-10-13 Fleming 問）
- **走 MXC（會被沙箱管）**：`bash`、`grep`、`glob`、`diff`、`git`、`test_run`、`env_exec`
  → RU 內一律正常（實測 git commit / npm install / node / python 都 OK）；RU 外讀寫/外連會被拒（本來就該拒）。
- **不走 MXC（在 PAAW server process 內跑）**：`read_file`、`write_file`、`edit_file`、`reference_read`、
  `dossier_*`、`sheet_*`、`browser_*`、`project_*` → 這些由 PAAW 自己的 `isPathAllowed`（cwd / PAAW root /
  workspaces / knowledge）+ `persistentEntryBlock` 管，MXC 管不到（也不會被它卡）。

### 🆕 v6 追加（2026-10-13 晚五，來源 dev `858b9fc3`）— 第 4 個 bug（實測抓到）
- **沙箱標記污染結構化輸出**：MXC 模式下 `runShell` 對每個回傳都附 `🛡沙箱內（MXC）`，但
  `glob` / `grep` / `diff` / `git` / `test_run` 是**把 stdout 當資料解析**的 →
  glob 會多一個假檔名、grep 多一行。修法：標記只給 user 可見的 `bash` tool（`opts.marker`）。
- 真 agent 實測（MXC 開）：glob `a.js\nsub/b.js` ✓、grep `a.js:1:hello fetch` ✓、
  無匹配 `(no files found)` ✓、bash `hi\n\n🛡沙箱內（MXC）` ✓
- 更新檔：`packages/server/src/lib/paaw-agent-loop.mjs`。844 tests passed。

### 🆕 v7 追加（2026-10-13 晚六，來源 dev `e1d73d15`）— 給你自己驗，不用相信我
- **新增 `scripts/check-sandbox.mjs`**：沙箱自我檢查，跑一次印 12 項 PASS/FAIL。
  ```
  node scripts/check-sandbox.mjs          # 離開碼 0=全過
  node scripts/check-sandbox.mjs --verbose
  ```
  檢查：後端可用 / RU 內可寫 / 家目錄寫入被擋 / ~/.ssh 被擋 / log 根可寫 / TMPDIR 可寫 /
  git / node / python / curl 放行 / 一般指令斷網 / 沙箱標記守門。
  **公司 Linux 也照跑**（這是唯一能真正驗 Linux/bwrap 的東西，Mac 上只有 seatbelt）。
- `tests/unit/paaw-sandbox-mxc.test.mjs` 加「標記守門」回歸測試（bug #4 不會再回來）。845 tests passed。
- ⚠️ 已知設計取捨：RU 路徑若落在 `~/.ssh` / `~/.openclaw` 內 → denied 優先於可寫，整個 RU 都寫不了
  （腳本會自動避開；你把專案放那兩個目錄下才會遇到）。
