# PAAW 公司同步清單（2026-08-13 ~ 08-23）

來源：tPAAW dev 分支 e788ff42（0.3.9）。下載路徑基底 = repo 根目錄。

## ① 新增檔案（46 個 — 下載放到對應路徑）
```
A  08-23  .paaw/HANDOVER.md
A  08-23  .paaw/RU-API-TABLE.md
A  08-15  .paaw/gates.json
A  08-23  .paaw/handover-state.json
A  08-23  .paaw/release-unit-model.json
A  08-17  data/config/providers.example.json
A  08-15  data/crews/pic/greta_ops_engineer.png
A  08-15  data/crews/pic/piotr_rm_officer.png
A  08-15  data/crews/pic/zofia_handover_guide.png
A  08-23  packages/server/src/data-home.mjs
A  08-21  packages/server/src/lib/coding-task-cost.mjs
A  08-15  packages/server/src/lib/cu-mechanical.mjs
A  08-15  packages/server/src/lib/release-unit/adapters.mjs
A  08-15  packages/server/src/lib/release-unit/analyze.mjs
A  08-15  packages/server/src/lib/release-unit/apis.mjs
A  08-15  packages/server/src/lib/release-unit/architecture.mjs
A  08-15  packages/server/src/lib/release-unit/ask.mjs
A  08-21  packages/server/src/lib/release-unit/cost.mjs
A  08-15  packages/server/src/lib/release-unit/gates.mjs
A  08-21  packages/server/src/lib/release-unit/handover-state.mjs
A  08-15  packages/server/src/lib/release-unit/impact.mjs
A  08-15  packages/server/src/lib/release-unit/metrics.mjs
A  08-21  packages/server/src/lib/release-unit/qa.mjs
A  08-15  packages/server/src/lib/release-unit/verify.mjs
A  08-22  packages/server/src/lib/stable-hash.mjs
A  08-16  packages/server/src/lib/task-retrofit.mjs
A  08-23  packages/server/src/routes/log-retention.mjs
A  08-23  packages/ui/src/components/FeatureCockpit.tsx
A  08-21  packages/ui/src/components/RuCostSection.tsx
A  08-21  packages/ui/src/components/RuModelSection.tsx
A  08-19  packages/ui/src/components/TabErrorBoundary.tsx
A  08-23  packages/ui/src/components/useRuModel.ts
A  08-23  scripts/pack.mjs
A  08-20  scripts/runtime-guard-scanner.mjs
A  08-23  scripts/seed/MEMORY.md
A  08-23  scripts/seed/apps/bookmarks/app.html
A  08-23  scripts/seed/apps/bookmarks/app.json
A  08-23  scripts/seed/apps/pocket/app.html
A  08-23  scripts/seed/apps/pocket/app.json
A  08-23  scripts/seed/config/agentic-bindings.json
A  08-23  scripts/seed/config/providers.example.json
A  08-23  scripts/seed/ui-state.json
A  08-23  scripts/seed/user.json
A  08-23  scripts/seed/vibe-sessions.json
A  08-14  tests/unit/coding-evidence.test.mjs
A  08-14  tests/unit/repair-loop.test.mjs
```

## ② 修改檔案（122 個 — 下載覆蓋）
```
M  08-15  .gitignore
M  08-17  data/config/backup.json
M  08-17  data/config/recent-projects.json
M  08-15  data/crews/coding.architect.json
M  08-15  data/crews/coding.developer.json
M  08-15  data/crews/coding.em.json
M  08-15  data/crews/coding.handover.json
M  08-15  data/crews/coding.ops.json
M  08-15  data/crews/coding.qa.json
M  08-15  data/crews/coding.rm.json
M  08-15  data/crews/coding.tester.json
M  08-17  data/projects/agent-sre.json
M  08-17  data/projects/paaw.json
M  08-15  data/workspaces.json
M  08-17  package.json
M  08-17  packages/server/package.json
M  08-23  packages/server/src/context-engine.mjs
M  08-17  packages/server/src/lib/agent-exec-logger.mjs
M  08-23  packages/server/src/lib/agentic-binding.mjs
M  08-16  packages/server/src/lib/auto-dispatch-manager.mjs
M  08-16  packages/server/src/lib/auto-dispatch-shared.mjs
M  08-23  packages/server/src/lib/bridge/paaw-bridge.mjs
M  08-22  packages/server/src/lib/change-intelligence.mjs
M  08-22  packages/server/src/lib/code-intelligence.mjs
M  08-23  packages/server/src/lib/context-providers.mjs
M  08-15  packages/server/src/lib/domain-agent-registry.mjs
M  08-16  packages/server/src/lib/execution-plan.mjs
M  08-20  packages/server/src/lib/feature-boundary.mjs
M  08-22  packages/server/src/lib/feature-map-validator.mjs
M  08-19  packages/server/src/lib/llm-utils.mjs
M  08-15  packages/server/src/lib/paaw-agent-loop.mjs
M  08-20  packages/server/src/lib/paaw-project.mjs
M  08-23  packages/server/src/lib/project-crew.mjs
M  08-15  packages/server/src/lib/release-unit/dependencies.mjs
M  08-21  packages/server/src/lib/release-unit/model.mjs
M  08-21  packages/server/src/lib/review-boundary.mjs
M  08-17  packages/server/src/lib/ru-resolver.mjs
M  08-23  packages/server/src/lib/semgrep-runner.mjs
M  08-22  packages/server/src/lib/test-intelligence.mjs
M  08-23  packages/server/src/lib/test-runner.mjs
M  08-23  packages/server/src/lib/tool-engine/provider.mjs
M  08-22  packages/server/src/lib/tree-sitter-parser.mjs
M  08-14  packages/server/src/paaw-server.mjs
M  08-23  packages/server/src/routes/a2a.mjs
M  08-17  packages/server/src/routes/agent-logs.mjs
M  08-23  packages/server/src/routes/agentic-bindings.mjs
M  08-23  packages/server/src/routes/ai-settings.mjs
M  08-23  packages/server/src/routes/apps.mjs
M  08-23  packages/server/src/routes/assistant.mjs
M  08-23  packages/server/src/routes/backup.mjs
M  08-19  packages/server/src/routes/chat.mjs
M  08-14  packages/server/src/routes/coding-evidence.mjs
M  08-23  packages/server/src/routes/coding-features.mjs
M  08-15  packages/server/src/routes/coding-handover.mjs
M  08-15  packages/server/src/routes/coding-ops.mjs
M  08-15  packages/server/src/routes/coding-releases.mjs
M  08-14  packages/server/src/routes/coding-tasks.mjs
M  08-15  packages/server/src/routes/coding.mjs
M  08-23  packages/server/src/routes/context.mjs
M  08-23  packages/server/src/routes/crew.mjs
M  08-23  packages/server/src/routes/distill.mjs
M  08-23  packages/server/src/routes/llm-logs.mjs
M  08-23  packages/server/src/routes/mindmap.mjs
M  08-23  packages/server/src/routes/notes.mjs
M  08-23  packages/server/src/routes/plugins.mjs
M  08-23  packages/server/src/routes/pocket.mjs
M  08-23  packages/server/src/routes/projects.mjs
M  08-15  packages/server/src/routes/release-unit.mjs
M  08-23  packages/server/src/routes/shared.mjs
M  08-23  packages/server/src/routes/skills-api.mjs
M  08-16  packages/server/src/routes/vibe-fs.mjs
M  08-23  packages/server/src/routes/vibe-sessions.mjs
M  08-23  packages/server/src/routes/workflow.mjs
M  08-23  packages/server/src/scheduler/cron-jobs.mjs
M  08-15  packages/server/src/tools/index.mjs
M  08-18  packages/server/src/websocket/ws-handler.mjs
M  08-17  packages/ui/package.json
M  08-23  packages/ui/src/App.tsx
M  08-18  packages/ui/src/components/AgentConsole.tsx
M  08-17  packages/ui/src/components/AgentLogs.tsx
M  08-15  packages/ui/src/components/AgentSideChat.tsx
M  08-23  packages/ui/src/components/ApiMapSidebar.tsx
M  08-18  packages/ui/src/components/AutoDispatchPanel.tsx
M  08-15  packages/ui/src/components/ChatMessages.tsx
M  08-23  packages/ui/src/components/CodeIntelPage.tsx
M  08-15  packages/ui/src/components/EMDashboard.tsx
M  08-14  packages/ui/src/components/EvidenceCard.tsx
M  08-20  packages/ui/src/components/FeatureMap.tsx
M  08-15  packages/ui/src/components/HandoverPanel.tsx
M  08-18  packages/ui/src/components/MarkdownText.tsx
M  08-20  packages/ui/src/components/ModelSelector.tsx
M  08-15  packages/ui/src/components/ReleaseManagerPanel.tsx
M  08-15  packages/ui/src/components/ReleaseUnitPanel.tsx
M  08-21  packages/ui/src/components/RuQaSection.tsx
M  08-22  packages/ui/src/components/RuTree.tsx
M  08-22  packages/ui/src/components/RuView.tsx
M  08-14  packages/ui/src/components/TaskBoard.tsx
M  08-23  packages/ui/src/components/TestsPage.tsx
M  08-15  packages/ui/src/components/TroubleshootingPanel.tsx
M  08-16  packages/ui/src/components/git/GitPanel.tsx
M  08-16  packages/ui/src/components/git/GitStatusView.tsx
M  08-16  packages/ui/src/components/ui/shared.tsx
M  08-14  packages/ui/src/i18n/locales/en.json
M  08-14  packages/ui/src/i18n/locales/ja.json
M  08-14  packages/ui/src/i18n/locales/zh-mix.json
M  08-14  packages/ui/src/i18n/locales/zh.json
M  08-15  packages/ui/src/pages/A2APlayground.tsx
M  08-15  packages/ui/src/pages/AppBuilder.tsx
M  08-23  packages/ui/src/pages/BackupSettings.tsx
M  08-15  packages/ui/src/pages/ChatView.tsx
M  08-15  packages/ui/src/pages/CodingIDE.tsx
M  08-18  packages/ui/src/pages/HelpDesk.tsx
M  08-23  packages/ui/src/pages/OnboardingPage.tsx
M  08-23  packages/ui/src/pages/ProjectBoard.tsx
M  08-23  packages/ui/src/pages/SettingsPage.tsx
M  08-21  packages/ui/src/pages/WorkflowExec.tsx
M  08-15  packages/ui/src/utils/index.ts
M  08-20  packages/ui/vite.config.ts
M  08-23  scripts/seed/config/backup.json
M  08-23  scripts/seed/config/plugins.json
M  08-23  scripts/seed/config/providers.json
M  08-23  scripts/seed/workspaces.json
```

## ③ 刪除檔案（19 個 — 公司機器要刪）
```
D  08-17  data/skills/building/ai-news-digest/.paaw/CHANGELOG.md
D  08-17  data/skills/building/ai-news-digest/.paaw/coding-memory/actions.jsonl
D  08-17  data/skills/building/ai-news-digest/.paaw/sessions/2026-07-29--id-ai-news-digest-name-ai-news-digest-description-userinput.md
D  08-17  data/skills/building/ai-news-digest/data/skills/building/ai-news-digest/test-output/ai-news-digest-2026-07-29.md
D  08-17  data/skills/building/ai-news-digest/package/SKILL.md
D  08-17  data/skills/building/ai-news-digest/skill-source.md
D  08-17  data/skills/building/help-desk/package/SKILL.md
D  08-17  data/skills/building/help-desk/skill-source.md
D  08-17  data/skills/input-prompt/ai-news-digest/inputs.json
D  08-17  data/skills/input-prompt/help-desk/inputs.json
D  08-17  data/skills/physical-skill/ai-news-digest/.paaw/coding-memory/actions.jsonl
D  08-17  data/skills/physical-skill/ai-news-digest/.paaw/sessions/2026-08-01-please-use-skill-ai-news-digest-with-user-inputs-from-cron-i.md
D  08-17  data/skills/physical-skill/ai-news-digest/.paaw/sessions/2026-08-02-please-use-skill-ai-news-digest-with-user-inputs-from-cron-i.md
D  08-17  data/skills/physical-skill/ai-news-digest/SKILL.md
D  08-17  data/skills/physical-skill/ai-news-digest/_cron_inputs.json
D  08-17  data/skills/physical-skill/help-desk/SKILL.md
D  08-17  data/skills/physical-skill/skill-creator/SKILL.md
D  08-17  data/skills/physical-skill/techcrunch-digest/SKILL.md
D  08-17  data/skills/physical-skill/techcrunch-digest/fetch_rss.py
```

## ④ 可略過（runtime 產物，會自動重建：19 個）
`.paaw/code-intelligence/*`（掃描快取 — 進 Coding 頁重掃即可）、`.paaw/coding-memory/*`、`.paaw/tasks/TASKS.json`、`.paaw/changes/*`、`logs/cron/*`

## ⑤ .gitkeep 佔位（17 個 — git clone/pull 會自動帶，手動下載的話建空檔）
```
scripts/seed/a2a-tasks/.gitkeep
scripts/seed/api-registry/.gitkeep
scripts/seed/app-data/.gitkeep
scripts/seed/apps/.gitkeep
scripts/seed/chats/.gitkeep
scripts/seed/crews/.gitkeep
scripts/seed/cron/.gitkeep
scripts/seed/distill/.gitkeep
scripts/seed/helpdesk/.gitkeep
scripts/seed/knowledge/.gitkeep
scripts/seed/mindmaps/.gitkeep
scripts/seed/notes/.gitkeep
scripts/seed/projects/.gitkeep
scripts/seed/prompts/.gitkeep
scripts/seed/skills/.gitkeep
scripts/seed/tools/.gitkeep
scripts/seed/workflows/.gitkeep
```

## ⚠️ 下載完記得
```bash
npm install   # 新依賴：tree-sitter-go（Go 支援）+ 其他
```