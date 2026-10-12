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
