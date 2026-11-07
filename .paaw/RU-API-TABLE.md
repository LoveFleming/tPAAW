# Release Unit Model — API 總表（251）

> 產生：2026-08-22 · model headSha 9080cedf · 來源：RU model × change-intelligence（30d git log）
> 認領：**176/251 有 feature 認領**，75 ⌀ 未認領 · last change = 該 API handler 檔案的最近 commit（30 天窗口，更早顯示 —）

| # | Method | Path | Handler 檔案 | Feature 認領 | 最近變更 |
|---|--------|------|--------------|--------------|----------|
| 1 | `GET` | `/.well-known/agent-card.json` | routes/a2a.mjs | F-002, F-016 | —  |
| 2 | `POST` | `/a2a` | routes/a2a.mjs | F-002, F-016 | —  |
| 3 | `GET` | `/api/a2a/agent-card` | routes/a2a.mjs | F-002, F-016 | —  |
| 4 | `POST` | `/api/a2a/interrupt` | routes/a2a.mjs | F-002, F-016 | —  |
| 5 | `GET` | `/api/a2a/tasks` | routes/a2a.mjs | F-002, F-016 | —  |
| 6 | `GET` | `/api/agent-logs` | tests/e2e/05-api.spec.ts | F-043 | —  |
| 7 | `POST` | `/api/agent-run` | scheduler/cron-jobs.mjs | F-015, F-014 | —  |
| 8 | `POST` | `/api/agent-run/stream` | scheduler/cron-jobs.mjs | F-015, F-014 | —  |
| 9 | `GET` | `/api/ai-settings` | routes/ai-settings.mjs | F-003, F-033, F-016 | —  |
| 10 | `GET` | `/api/ai-settings` | tests/e2e/05-api.spec.ts | F-043 | —  |
| 11 | `GET` | `/api/ai-settings/agent-config` | routes/ai-settings.mjs | F-003, F-033, F-016 | —  |
| 12 | `PUT` | `/api/ai-settings/agent-config` | routes/ai-settings.mjs | F-003, F-033, F-016 | —  |
| 13 | `GET` | `/api/ai-settings/providers` | routes/ai-settings.mjs | F-003, F-033, F-016 | —  |
| 14 | `PUT` | `/api/ai-settings/providers` | routes/ai-settings.mjs | F-003, F-033, F-016 | —  |
| 15 | `POST` | `/api/api-tester/proxy` | routes/api-tester.mjs | F-004, F-016 | —  |
| 16 | `POST` | `/api/api-tester/save` | routes/api-tester.mjs | F-004, F-016 | —  |
| 17 | `POST` | `/api/api-tester/stream` | routes/api-tester.mjs | F-004, F-016 | —  |
| 18 | `POST` | `/api/apps` | routes/apps.mjs | F-001, F-005, F-016 | —  |
| 19 | `GET` | `/api/apps` | tests/e2e/05-api.spec.ts | F-043 | —  |
| 20 | `GET` | `/api/backup/config` | routes/backup.mjs | F-007, F-016 | —  |
| 21 | `PUT` | `/api/backup/config` | routes/backup.mjs | F-007, F-016 | —  |
| 22 | `DELETE` | `/api/backup/delete` | routes/backup.mjs | F-007, F-016 | —  |
| 23 | `GET` | `/api/backup/list` | routes/backup.mjs | F-007, F-016 | —  |
| 24 | `POST` | `/api/backup/restore` | routes/backup.mjs | F-007, F-016 | —  |
| 25 | `POST` | `/api/backup/run` | routes/backup.mjs | F-007, F-016 | —  |
| 26 | `POST` | `/api/cli-run` | routes/crew.mjs | F-014, F-001 | —  |
| 27 | `GET` | `/api/coding-features` | routes/coding-features.mjs | F-009, F-002 | —  |
| 28 | `POST` | `/api/coding-features` | routes/coding-features.mjs | F-009, F-002 | —  |
| 29 | `POST` | `/api/coding-features/discover` | routes/coding-features.mjs | F-009, F-002 | —  |
| 30 | `GET` | `/api/coding-features/file-map` | routes/coding-features.mjs | F-009, F-002 | —  |
| 31 | `POST` | `/api/coding-features/refresh-mapping` | routes/coding-features.mjs | F-009, F-002 | —  |
| 32 | `GET` | `/api/coding-features/stats` | routes/coding-features.mjs | F-009, F-002 | —  |
| 33 | `GET` | `/api/coding-features/validate` | routes/coding-features.mjs | F-009, F-002 | —  |
| 34 | `GET` | `/api/coding-issues` | routes/coding-issues.mjs | F-010, F-003 | —  |
| 35 | `POST` | `/api/coding-issues` | routes/coding-issues.mjs | F-010, F-003 | —  |
| 36 | `POST` | `/api/coding-issues/import-known` | routes/coding-issues.mjs | F-010, F-003 | —  |
| 37 | `GET` | `/api/coding-issues/stats` | routes/coding-issues.mjs | F-010, F-003 | —  |
| 38 | `GET` | `/api/coding-memory` | routes/coding-memory.mjs | F-011, F-001 | —  |
| 39 | `GET` | `/api/context/chat` | tests/e2e/05-api.spec.ts | F-043 | —  |
| 40 | `GET` | `/api/context/coding` | tests/e2e/05-api.spec.ts | F-043 | —  |
| 41 | `GET` | `/api/context/mindmap` | tests/e2e/05-api.spec.ts | F-043 | —  |
| 42 | `GET` | `/api/context/notes` | tests/e2e/05-api.spec.ts | F-043 | —  |
| 43 | `GET` | `/api/context/project` | tests/e2e/05-api.spec.ts | F-043 | —  |
| 44 | `GET` | `/api/crew` | tests/e2e/05-api.spec.ts | F-043 | —  |
| 45 | `POST` | `/api/cron-jobs` | scheduler/cron-jobs.mjs | F-015, F-014 | —  |
| 46 | `GET` | `/api/cron-jobs` | tests/e2e/05-api.spec.ts | F-043 | —  |
| 47 | `POST` | `/api/cron-jobs` | tests/e2e/05-api.spec.ts | F-043 | —  |
| 48 | `GET` | `/api/distill/config` | routes/distill.mjs | F-015, F-016 | —  |
| 49 | `PUT` | `/api/distill/config` | routes/distill.mjs | F-015, F-016 | —  |
| 50 | `GET` | `/api/distill/knowledge` | routes/distill.mjs | F-015, F-016 | —  |
| 51 | `GET` | `/api/distill/logs` | routes/distill.mjs | F-015, F-016 | —  |
| 52 | `POST` | `/api/distill/record` | routes/distill.mjs | F-015, F-016 | —  |
| 53 | `POST` | `/api/distill/run` | routes/distill.mjs | F-015, F-016 | —  |
| 54 | `GET` | `/api/distill/sources` | routes/distill.mjs | F-015, F-016 | —  |
| 55 | `POST` | `/api/helpdesk/ask` | routes/helpdesk.mjs | F-016 | —  |
| 56 | `GET` | `/api/helpdesk/knowledge` | routes/helpdesk.mjs | F-016 | —  |
| 57 | `GET` | `/api/helpdesk/models` | routes/helpdesk.mjs | F-016 | —  |
| 58 | `GET` | `/api/helpdesk/tickets` | routes/helpdesk.mjs | F-016 | —  |
| 59 | `PUT` | `/api/helpdesk/tickets` | routes/helpdesk.mjs | F-016 | —  |
| 60 | `GET` | `/api/llm-logs` | routes/llm-logs.mjs | F-016 | —  |
| 61 | `DELETE` | `/api/llm-logs` | routes/llm-logs.mjs | F-016 | —  |
| 62 | `GET` | `/api/llm-logs` | tests/e2e/05-api.spec.ts | F-043 | —  |
| 63 | `POST` | `/api/llm-logs/purge` | routes/llm-logs.mjs | F-016 | —  |
| 64 | `GET` | `/api/llm-logs/stats` | routes/llm-logs.mjs | F-016 | —  |
| 65 | `GET` | `/api/mindmap/list` | tests/e2e/05-api.spec.ts | F-043 | —  |
| 66 | `GET` | `/api/models` | tests/e2e/05-api.spec.ts | F-043 | —  |
| 67 | `GET` | `/api/nonexistent-endpoint-12345` | tests/e2e/05-api.spec.ts | F-043 | —  |
| 68 | `POST` | `/api/notes/ai-write` | routes/notes.mjs | F-018, F-016 | —  |
| 69 | `GET` | `/api/notes/by-tag` | routes/notes.mjs | F-018, F-016 | —  |
| 70 | `POST` | `/api/notes/create` | routes/notes.mjs | F-018, F-016 | —  |
| 71 | `POST` | `/api/notes/create` | packages/ui/src/pages/Notes.tsx | F-018 | —  |
| 72 | `POST` | `/api/notes/create` | packages/ui/src/pages/Notes.tsx | F-018 | —  |
| 73 | `DELETE` | `/api/notes/delete` | routes/notes.mjs | F-018, F-016 | —  |
| 74 | `GET` | `/api/notes/get` | routes/notes.mjs | F-018, F-016 | —  |
| 75 | `GET` | `/api/notes/get` | tests/e2e/05-api.spec.ts | F-043 | —  |
| 76 | `GET` | `/api/notes/images//*` | routes/notes.mjs | F-018, F-016 | —  |
| 77 | `GET` | `/api/notes/list` | routes/notes.mjs | F-018, F-016 | —  |
| 78 | `GET` | `/api/notes/list?notebook=nonexistent-notebook-12345` | tests/e2e/05-api.spec.ts | F-043 | —  |
| 79 | `PUT` | `/api/notes/move` | routes/notes.mjs | F-018, F-016 | —  |
| 80 | `GET` | `/api/notes/notebooks` | routes/notes.mjs | F-018, F-016 | —  |
| 81 | `POST` | `/api/notes/notebooks` | routes/notes.mjs | F-018, F-016 | —  |
| 82 | `PUT` | `/api/notes/notebooks` | routes/notes.mjs | F-018, F-016 | —  |
| 83 | `DELETE` | `/api/notes/notebooks` | routes/notes.mjs | F-018, F-016 | —  |
| 84 | `GET` | `/api/notes/notebooks` | packages/ui/src/pages/Notes.tsx | F-018 | —  |
| 85 | `POST` | `/api/notes/notebooks` | packages/ui/src/pages/Notes.tsx | F-018 | —  |
| 86 | `GET` | `/api/notes/notebooks` | packages/ui/src/pages/Notes.tsx | F-018 | —  |
| 87 | `GET` | `/api/notes/notebooks` | tests/e2e/05-api.spec.ts | F-043 | —  |
| 88 | `POST` | `/api/notes/notebooks` | tests/e2e/05-api.spec.ts | F-043 | —  |
| 89 | `PUT` | `/api/notes/pin` | routes/notes.mjs | F-018, F-016 | —  |
| 90 | `GET` | `/api/notes/recent` | routes/notes.mjs | F-018, F-016 | —  |
| 91 | `GET` | `/api/notes/recent?limit=5` | tests/e2e/05-api.spec.ts | F-043 | —  |
| 92 | `GET` | `/api/notes/search` | routes/notes.mjs | F-018, F-016 | —  |
| 93 | `GET` | `/api/notes/search` | tests/e2e/05-api.spec.ts | F-043 | —  |
| 94 | `GET` | `/api/notes/search?q=test` | tests/e2e/05-api.spec.ts | F-043 | —  |
| 95 | `GET` | `/api/notes/sections` | routes/notes.mjs | F-018, F-016 | —  |
| 96 | `POST` | `/api/notes/sections` | routes/notes.mjs | F-018, F-016 | —  |
| 97 | `PUT` | `/api/notes/sections` | routes/notes.mjs | F-018, F-016 | —  |
| 98 | `DELETE` | `/api/notes/sections` | routes/notes.mjs | F-018, F-016 | —  |
| 99 | `POST` | `/api/notes/sections` | packages/ui/src/pages/Notes.tsx | F-018 | —  |
| 100 | `GET` | `/api/notes/tags` | routes/notes.mjs | F-018, F-016 | —  |
| 101 | `GET` | `/api/notes/tags` | packages/ui/src/pages/Notes.tsx | F-018 | —  |
| 102 | `GET` | `/api/notes/tags` | tests/e2e/05-api.spec.ts | F-043 | —  |
| 103 | `PUT` | `/api/notes/update` | routes/notes.mjs | F-018, F-016 | —  |
| 104 | `POST` | `/api/notes/upload-image` | routes/notes.mjs | F-018, F-016 | —  |
| 105 | `GET` | `/api/paaw-root` | routes/workflow.mjs | F-001, F-023, F-016 | —  |
| 106 | `GET` | `/api/paaw-root` | tests/e2e/05-api.spec.ts | F-043 | —  |
| 107 | `GET` | `/api/paaw/app-rules` | routes/assistant.mjs | F-006, F-042, F-016 | —  |
| 108 | `PUT` | `/api/paaw/app-rules` | routes/assistant.mjs | F-006, F-042, F-016 | —  |
| 109 | `GET` | `/api/paaw/app-skills` | routes/assistant.mjs | F-006, F-042, F-016 | —  |
| 110 | `POST` | `/api/paaw/apps/import` | routes/assistant.mjs | F-006, F-042, F-016 | —  |
| 111 | `POST` | `/api/paaw/avatar` | routes/assistant.mjs | F-006, F-042, F-016 | —  |
| 112 | `GET` | `/api/paaw/avatar/assistant` | routes/assistant.mjs | F-006, F-042, F-016 | —  |
| 113 | `POST` | `/api/paaw/chat` | routes/chat.mjs | F-001, F-008, F-016 | 2026-08-19 741133d |
| 114 | `GET` | `/api/paaw/chats` | routes/chat.mjs | F-001, F-008, F-016 | 2026-08-19 741133d |
| 115 | `POST` | `/api/paaw/chats` | routes/chat.mjs | F-001, F-008, F-016 | 2026-08-19 741133d |
| 116 | `GET` | `/api/paaw/chats//*` | routes/chat.mjs | F-001, F-008, F-016 | 2026-08-19 741133d |
| 117 | `PUT` | `/api/paaw/chats//*` | routes/chat.mjs | F-001, F-008, F-016 | 2026-08-19 741133d |
| 118 | `DELETE` | `/api/paaw/chats//*` | routes/chat.mjs | F-001, F-008, F-016 | 2026-08-19 741133d |
| 119 | `POST` | `/api/paaw/file-write` | routes/assistant.mjs | F-006, F-042, F-016 | —  |
| 120 | `POST` | `/api/paaw/file-write` | routes/workflow.mjs | F-001, F-023, F-016 | —  |
| 121 | `GET` | `/api/paaw/knowledge-paths` | routes/assistant.mjs | F-006, F-042, F-016 | —  |
| 122 | `GET` | `/api/paaw/providers` | routes/assistant.mjs | F-006, F-042, F-016 | —  |
| 123 | `PUT` | `/api/paaw/providers` | routes/assistant.mjs | F-006, F-042, F-016 | —  |
| 124 | `GET` | `/api/paaw/providers` | tests/e2e/05-api.spec.ts | F-043 | —  |
| 125 | `GET` | `/api/paaw/skill-config` | routes/crew.mjs | F-014, F-001 | —  |
| 126 | `POST` | `/api/paaw/skill-config` | routes/crew.mjs | F-014, F-001 | —  |
| 127 | `POST` | `/api/paaw/skill-exec` | routes/workflow.mjs | F-001, F-023, F-016 | —  |
| 128 | `POST` | `/api/paaw/tool-exec` | routes/workflow.mjs | F-001, F-023, F-016 | —  |
| 129 | `GET` | `/api/paaw/tools` | routes/workflow.mjs | F-001, F-023, F-016 | —  |
| 130 | `GET` | `/api/paaw/ui-state` | routes/assistant.mjs | F-006, F-042, F-016 | —  |
| 131 | `PUT` | `/api/paaw/ui-state` | routes/assistant.mjs | F-006, F-042, F-016 | —  |
| 132 | `PATCH` | `/api/paaw/ui-state` | routes/assistant.mjs | F-006, F-042, F-016 | —  |
| 133 | `GET` | `/api/paaw/ui-state` | tests/e2e/05-api.spec.ts | F-043 | —  |
| 134 | `PATCH` | `/api/paaw/ui-state` | tests/e2e/05-api.spec.ts | F-043 | —  |
| 135 | `GET` | `/api/paaw/user` | routes/assistant.mjs | F-006, F-042, F-016 | —  |
| 136 | `POST` | `/api/paaw/user` | routes/assistant.mjs | F-006, F-042, F-016 | —  |
| 137 | `GET` | `/api/paaw/user` | tests/e2e/05-api.spec.ts | F-043 | —  |
| 138 | `POST` | `/api/paaw/workflow-output-chat` | routes/assistant.mjs | F-006, F-042, F-016 | —  |
| 139 | `POST` | `/api/paaw/workflow-output-chat` | routes/workflow.mjs | F-001, F-023, F-016 | —  |
| 140 | `POST` | `/api/paaw/workflow-trigger` | routes/workflow.mjs | F-001, F-023, F-016 | —  |
| 141 | `GET` | `/api/paaw/workflows` | routes/assistant.mjs | F-006, F-042, F-016 | —  |
| 142 | `POST` | `/api/paaw/workflows` | routes/assistant.mjs | F-006, F-042, F-016 | —  |
| 143 | `GET` | `/api/paaw/workflows` | routes/workflow.mjs | F-001, F-023, F-016 | —  |
| 144 | `POST` | `/api/paaw/workflows` | routes/workflow.mjs | F-001, F-023, F-016 | —  |
| 145 | `GET` | `/api/paaw/workspaces` | routes/assistant.mjs | F-006, F-042, F-016 | —  |
| 146 | `POST` | `/api/paaw/workspaces` | routes/assistant.mjs | F-006, F-042, F-016 | —  |
| 147 | `DELETE` | `/api/paaw/workspaces` | routes/assistant.mjs | F-006, F-042, F-016 | —  |
| 148 | `GET` | `/api/paaw/workspaces` | tests/e2e/05-api.spec.ts | F-043 | —  |
| 149 | `GET` | `/api/pick-directory` | routes/vibe-fs.mjs | F-037, F-016 | —  |
| 150 | `GET` | `/api/plugins` | tests/e2e/05-api.spec.ts | F-043 | —  |
| 151 | `GET` | `/api/projects` | routes/projects.mjs | F-020, F-016 | —  |
| 152 | `POST` | `/api/projects` | routes/projects.mjs | F-020, F-016 | —  |
| 153 | `GET` | `/api/projects` | packages/ui/src/pages/ProjectBoard.tsx | F-020 | —  |
| 154 | `POST` | `/api/projects` | packages/ui/src/pages/ProjectBoard.tsx | F-020 | —  |
| 155 | `GET` | `/api/projects` | tests/e2e/05-api.spec.ts | F-043 | —  |
| 156 | `POST` | `/api/report-publish` | routes/apps.mjs | F-001, F-005, F-016 | —  |
| 157 | `POST` | `/api/report-train` | routes/apps.mjs | F-001, F-005, F-016 | —  |
| 158 | `POST` | `/api/skill-test/run` | routes/crew.mjs | F-014, F-001 | —  |
| 159 | `GET` | `/api/skills` | tests/e2e/05-api.spec.ts | F-043 | —  |
| 160 | `POST` | `/api/sync/approve//*` | lib/bridge/paaw-bridge.mjs | F-038, F-014 | —  |
| 161 | `GET` | `/api/sync/diff//*` | lib/bridge/paaw-bridge.mjs | F-038, F-014 | —  |
| 162 | `GET` | `/api/sync/pending` | lib/bridge/paaw-bridge.mjs | F-038, F-014 | —  |
| 163 | `POST` | `/api/sync/reject//*` | lib/bridge/paaw-bridge.mjs | F-038, F-014 | —  |
| 164 | `POST` | `/api/sync/request` | lib/bridge/paaw-bridge.mjs | F-038, F-014 | —  |
| 165 | `GET` | `/api/system-prompts` | routes/chat.mjs | F-001, F-008, F-016 | 2026-08-19 741133d |
| 166 | `POST` | `/api/tool/proxy` | lib/bridge/paaw-bridge.mjs | F-038, F-014 | —  |
| 167 | `GET` | `/api/tool/tokens` | lib/bridge/paaw-bridge.mjs | F-038, F-014 | —  |
| 168 | `POST` | `/api/update//*` | lib/bridge/paaw-bridge.mjs | F-038, F-014 | —  |
| 169 | `GET` | `/api/update/status` | lib/bridge/paaw-bridge.mjs | F-038, F-014 | —  |
| 170 | `GET` | `/api/user/preferences` | routes/ai-settings.mjs | F-003, F-033, F-016 | —  |
| 171 | `PUT` | `/api/user/preferences` | routes/ai-settings.mjs | F-003, F-033, F-016 | —  |
| 172 | `GET` | `/api/user/preferences` | tests/e2e/05-api.spec.ts | F-043 | —  |
| 173 | `PUT` | `/api/vibe-fs/write` | routes/vibe-fs.mjs | F-037, F-016 | —  |
| 174 | `POST` | `/api/vibe-sessions` | routes/vibe-sessions.mjs | F-037, F-016 | —  |
| 175 | `GET` | `/api/workspaces` | routes/ai-settings.mjs | F-003, F-033, F-016 | —  |
| 176 | `GET` | `/health` | lib/bridge/paaw-bridge.mjs | F-038, F-014 | —  |
| 177 | `GET` | `/api/agent-logs` | routes/agent-logs.mjs | ⌀ 無認領 | 2026-08-18 200b5f7 |
| 178 | `POST` | `/api/agent-logs/purge` | routes/agent-logs.mjs | ⌀ 無認領 | 2026-08-18 200b5f7 |
| 179 | `GET` | `/api/agent-logs/ru-debug` | routes/agent-logs.mjs | ⌀ 無認領 | 2026-08-18 200b5f7 |
| 180 | `GET` | `/api/agent-logs/ru-summary` | routes/agent-logs.mjs | ⌀ 無認領 | 2026-08-18 200b5f7 |
| 181 | `GET` | `/api/agentic-bindings` | routes/agentic-bindings.mjs | ⌀ 無認領 | —  |
| 182 | `POST` | `/api/agentic-bindings` | routes/agentic-bindings.mjs | ⌀ 無認領 | —  |
| 183 | `POST` | `/api/auto-dispatch/plan/create` | routes/execution-plan-routes.mjs | ⌀ 無認領 | —  |
| 184 | `GET` | `/api/auto-dispatch/plan/incomplete` | routes/execution-plan-routes.mjs | ⌀ 無認領 | —  |
| 185 | `GET` | `/api/auto-dispatch/plan/latest` | routes/execution-plan-routes.mjs | ⌀ 無認領 | —  |
| 186 | `GET` | `/api/auto-dispatch/plan/list` | routes/execution-plan-routes.mjs | ⌀ 無認領 | —  |
| 187 | `GET` | `/api/coding-auto-dispatch/config` | routes/coding-auto-dispatch-config.mjs | ⌀ 無認領 | —  |
| 188 | `POST` | `/api/coding-auto-dispatch/config` | routes/coding-auto-dispatch-config.mjs | ⌀ 無認領 | —  |
| 189 | `GET` | `/api/coding-auto-dispatch/last-run` | routes/coding-auto-dispatch.mjs | ⌀ 無認領 | —  |
| 190 | `GET` | `/api/coding-auto-dispatch/prompts` | routes/coding-auto-dispatch-prompts.mjs | ⌀ 無認領 | —  |
| 191 | `POST` | `/api/coding-auto-dispatch/prompts` | routes/coding-auto-dispatch-prompts.mjs | ⌀ 無認領 | —  |
| 192 | `POST` | `/api/coding-auto-dispatch/prompts/reset` | routes/coding-auto-dispatch-prompts.mjs | ⌀ 無認領 | —  |
| 193 | `GET` | `/api/coding-auto-dispatch/report` | routes/coding-auto-dispatch.mjs | ⌀ 無認領 | —  |
| 194 | `POST` | `/api/coding-auto-dispatch/reset` | routes/coding-auto-dispatch.mjs | ⌀ 無認領 | —  |
| 195 | `POST` | `/api/coding-auto-dispatch/start` | routes/coding-auto-dispatch.mjs | ⌀ 無認領 | —  |
| 196 | `GET` | `/api/coding-auto-dispatch/status` | routes/coding-auto-dispatch.mjs | ⌀ 無認領 | —  |
| 197 | `GET` | `/api/coding-doc/coverage` | routes/coding-doc-coverage.mjs | ⌀ 無認領 | —  |
| 198 | `POST` | `/api/coding-doc/coverage` | routes/coding-doc-coverage.mjs | ⌀ 無認領 | —  |
| 199 | `GET` | `/api/coding-doc/undocumented` | routes/coding-doc-coverage.mjs | ⌀ 無認領 | —  |
| 200 | `GET` | `/api/coding-em/config` | routes/coding-em-config.mjs | ⌀ 無認領 | —  |
| 201 | `PATCH` | `/api/coding-em/config` | routes/coding-em-config.mjs | ⌀ 無認領 | —  |
| 202 | `POST` | `/api/coding-em/config/reset` | routes/coding-em-config.mjs | ⌀ 無認領 | —  |
| 203 | `GET` | `/api/coding-handover/bundle` | routes/coding-handover.mjs | ⌀ 無認領 | 2026-08-21 166c36b |
| 204 | `POST` | `/api/coding-handover/generate` | routes/coding-handover.mjs | ⌀ 無認領 | 2026-08-21 166c36b |
| 205 | `GET` | `/api/coding-handover/state` | routes/coding-handover.mjs | ⌀ 無認領 | 2026-08-21 166c36b |
| 206 | `GET` | `/api/coding-ops/runbook` | routes/coding-ops.mjs | ⌀ 無認領 | —  |
| 207 | `POST` | `/api/coding-ops/runbook/save` | routes/coding-ops.mjs | ⌀ 無認領 | —  |
| 208 | `GET` | `/api/coding-ops/status` | routes/coding-ops.mjs | ⌀ 無認領 | —  |
| 209 | `GET` | `/api/coding-releases/list` | routes/coding-releases.mjs | ⌀ 無認領 | —  |
| 210 | `GET` | `/api/coding-releases/pending` | routes/coding-releases.mjs | ⌀ 無認領 | —  |
| 211 | `GET` | `/api/coding-releases/quality-debt` | routes/coding-releases.mjs | ⌀ 無認領 | —  |
| 212 | `POST` | `/api/coding-releases/reject` | routes/coding-releases.mjs | ⌀ 無認領 | —  |
| 213 | `POST` | `/api/coding-releases/retrofit` | routes/coding-releases.mjs | ⌀ 無認領 | —  |
| 214 | `GET` | `/api/coding-staged/changes` | routes/coding-staged-changes.mjs | ⌀ 無認領 | —  |
| 215 | `POST` | `/api/coding-staged/changes` | routes/coding-staged-changes.mjs | ⌀ 無認領 | —  |
| 216 | `DELETE` | `/api/coding-staged/changes` | routes/coding-staged-changes.mjs | ⌀ 無認領 | —  |
| 217 | `GET` | `/api/coding-tasks` | routes/coding-tasks.mjs | ⌀ 無認領 | 2026-08-21 166c36b |
| 218 | `POST` | `/api/coding-tasks` | routes/coding-tasks.mjs | ⌀ 無認領 | 2026-08-21 166c36b |
| 219 | `POST` | `/api/coding-tasks/decompose` | routes/coding-tasks.mjs | ⌀ 無認領 | 2026-08-21 166c36b |
| 220 | `POST` | `/api/coding-tasks/health-fix` | routes/coding-tasks.mjs | ⌀ 無認領 | 2026-08-21 166c36b |
| 221 | `GET` | `/api/coding-tasks/overnight-queue` | routes/coding-tasks.mjs | ⌀ 無認領 | 2026-08-21 166c36b |
| 222 | `GET` | `/api/coding-tasks/overnight-queue/results` | routes/coding-tasks.mjs | ⌀ 無認領 | 2026-08-21 166c36b |
| 223 | `GET` | `/api/coding-tasks/pipeline/overview` | routes/coding-tasks.mjs | ⌀ 無認領 | 2026-08-21 166c36b |
| 224 | `GET` | `/api/coding-tasks/project/loop-mode` | routes/coding-tasks.mjs | ⌀ 無認領 | 2026-08-21 166c36b |
| 225 | `PUT` | `/api/coding-tasks/project/loop-mode` | routes/coding-tasks.mjs | ⌀ 無認領 | 2026-08-21 166c36b |
| 226 | `GET` | `/api/coding-tasks/stats` | routes/coding-tasks.mjs | ⌀ 無認領 | 2026-08-21 166c36b |
| 227 | `GET` | `/api/plugins` | routes/plugins.mjs | ⌀ 無認領 | —  |
| 228 | `POST` | `/api/plugins` | routes/plugins.mjs | ⌀ 無認領 | —  |
| 229 | `GET` | `/api/ru` | routes/release-unit.mjs | ⌀ 無認領 | 2026-08-21 580a52d |
| 230 | `GET` | `/api/ru/analyze` | routes/release-unit.mjs | ⌀ 無認領 | 2026-08-21 580a52d |
| 231 | `GET` | `/api/ru/apis` | routes/release-unit.mjs | ⌀ 無認領 | 2026-08-21 580a52d |
| 232 | `GET` | `/api/ru/architecture` | routes/release-unit.mjs | ⌀ 無認領 | 2026-08-21 580a52d |
| 233 | `GET` | `/api/ru/ask` | routes/release-unit.mjs | ⌀ 無認領 | 2026-08-21 580a52d |
| 234 | `GET` | `/api/ru/changes` | routes/release-unit.mjs | ⌀ 無認領 | 2026-08-21 580a52d |
| 235 | `GET` | `/api/ru/context` | routes/release-unit.mjs | ⌀ 無認領 | 2026-08-21 580a52d |
| 236 | `GET` | `/api/ru/cost` | routes/release-unit.mjs | ⌀ 無認領 | 2026-08-21 580a52d |
| 237 | `GET` | `/api/ru/dependencies` | routes/release-unit.mjs | ⌀ 無認領 | 2026-08-21 580a52d |
| 238 | `GET` | `/api/ru/evidence` | routes/release-unit.mjs | ⌀ 無認領 | 2026-08-21 580a52d |
| 239 | `GET` | `/api/ru/features` | routes/release-unit.mjs | ⌀ 無認領 | 2026-08-21 580a52d |
| 240 | `GET` | `/api/ru/gates` | routes/release-unit.mjs | ⌀ 無認領 | 2026-08-21 580a52d |
| 241 | `POST` | `/api/ru/impact-analysis` | routes/release-unit.mjs | ⌀ 無認領 | 2026-08-21 580a52d |
| 242 | `GET` | `/api/ru/metrics` | routes/release-unit.mjs | ⌀ 無認領 | 2026-08-21 580a52d |
| 243 | `GET` | `/api/ru/model/query` | routes/release-unit.mjs | ⌀ 無認領 | 2026-08-21 580a52d |
| 244 | `GET` | `/api/ru/overview` | routes/release-unit.mjs | ⌀ 無認領 | 2026-08-21 580a52d |
| 245 | `GET` | `/api/ru/qa` | routes/release-unit.mjs | ⌀ 無認領 | 2026-08-21 580a52d |
| 246 | `GET` | `/api/ru/releases` | routes/release-unit.mjs | ⌀ 無認領 | 2026-08-21 580a52d |
| 247 | `GET` | `/api/ru/runbooks` | routes/release-unit.mjs | ⌀ 無認領 | 2026-08-21 580a52d |
| 248 | `GET` | `/api/ru/specs` | routes/release-unit.mjs | ⌀ 無認領 | 2026-08-21 580a52d |
| 249 | `GET` | `/api/ru/tests` | routes/release-unit.mjs | ⌀ 無認領 | 2026-08-21 580a52d |
| 250 | `POST` | `/api/ru/verify` | routes/release-unit.mjs | ⌀ 無認領 | 2026-08-21 580a52d |
| 251 | `GET` | `/api/ru/verify` | routes/release-unit.mjs | ⌀ 無認領 | 2026-08-21 580a52d |