# PAAW API Test Payloads — Index

> Auto-generated from route source code.
> Total endpoints: **234**

## Usage

Each JSON file contains a test payload with: `method`, `path`, `description`, `query`, `body`, `expectedStatus`, and `notes`.

- `:id`, `:planId`, `:agentId` etc. are path params — replace with real values before testing
- `path` query param defaults to `/Users/steward/App/tPAAW` — change to your project
- ⚠️ in notes = destructive/potentially dangerous endpoint

## coding-health (1)

| Method | Path | Description | File |
|--------|------|-------------|------|
| `GET` | `/api/coding-health` | Coding App 健康檢查（provider, feature map, issues, auto dispatch, security, LLM activity, standards） | [get_api-coding-health.json](./get_api-coding-health.json) |

## coding-auto-dispatch (10)

| Method | Path | Description | File |
|--------|------|-------------|------|
| `GET` | `/api/coding-auto-dispatch/config` | 取得 auto dispatch 設定（mode, schedule, model, tasks, projectPhase） | [get_api-coding-auto-dispatch-config.json](./get_api-coding-auto-dispatch-config.json) |
| `GET` | `/api/coding-auto-dispatch/last-run` | 取得上次 auto dispatch 執行時間與模式 | [get_api-coding-auto-dispatch-last-run.json](./get_api-coding-auto-dispatch-last-run.json) |
| `GET` | `/api/coding-auto-dispatch/prompts` | 取得所有 agent prompts（architect, developer, tester, doc-writer, qa, helpdesk） | [get_api-coding-auto-dispatch-prompts.json](./get_api-coding-auto-dispatch-prompts.json) |
| `GET` | `/api/coding-auto-dispatch/report` | 取得最新 auto dispatch 報告（markdown） | [get_api-coding-auto-dispatch-report.json](./get_api-coding-auto-dispatch-report.json) |
| `GET` | `/api/coding-auto-dispatch/status` | 取得最新 auto dispatch 執行狀態 | [get_api-coding-auto-dispatch-status.json](./get_api-coding-auto-dispatch-status.json) |
| `POST` | `/api/coding-auto-dispatch/config` | 更新 auto dispatch 設定（含 cron 排程註冊/停用） | [post_api-coding-auto-dispatch-config.json](./post_api-coding-auto-dispatch-config.json) |
| `POST` | `/api/coding-auto-dispatch/prompts/reset` | 重置 prompts 為預設值 ⚠️ | [post_api-coding-auto-dispatch-prompts-reset.json](./post_api-coding-auto-dispatch-prompts-reset.json) |
| `POST` | `/api/coding-auto-dispatch/prompts` | 更新 prompt（單一 role 或整包） | [post_api-coding-auto-dispatch-prompts.json](./post_api-coding-auto-dispatch-prompts.json) |
| `POST` | `/api/coding-auto-dispatch/reset` | Force reset 卡住的 auto dispatch status ⚠️ | [post_api-coding-auto-dispatch-reset.json](./post_api-coding-auto-dispatch-reset.json) |
| `POST` | `/api/coding-auto-dispatch/start` | 啟動 Auto Dispatch（EM 或 parallel 模式） ⚠️ | [post_api-coding-auto-dispatch-start.json](./post_api-coding-auto-dispatch-start.json) |

## auto-dispatch (11)

| Method | Path | Description | File |
|--------|------|-------------|------|
| `DELETE` | `/api/auto-dispatch/plan/:planId` | 刪除 plan ⚠️ | [delete_api-auto-dispatch-plan-planId.json](./delete_api-auto-dispatch-plan-planId.json) |
| `GET` | `/api/auto-dispatch/plan/incomplete` | 找出未完成的 plans | [get_api-auto-dispatch-plan-incomplete.json](./get_api-auto-dispatch-plan-incomplete.json) |
| `GET` | `/api/auto-dispatch/plan/latest` | 取得最新 plan | [get_api-auto-dispatch-plan-latest.json](./get_api-auto-dispatch-plan-latest.json) |
| `GET` | `/api/auto-dispatch/plan/list` | 列出所有 plans | [get_api-auto-dispatch-plan-list.json](./get_api-auto-dispatch-plan-list.json) |
| `GET` | `/api/auto-dispatch/plan/:planId/summary` | 取得 plan 摘要 | [get_api-auto-dispatch-plan-planId-summary.json](./get_api-auto-dispatch-plan-planId-summary.json) |
| `GET` | `/api/auto-dispatch/plan/:planId` | 取得完整 plan | [get_api-auto-dispatch-plan-planId.json](./get_api-auto-dispatch-plan-planId.json) |
| `PATCH` | `/api/auto-dispatch/plan/:planId/status` | 更新 plan 狀態 | [patch_api-auto-dispatch-plan-planId-status.json](./patch_api-auto-dispatch-plan-planId-status.json) |
| `PATCH` | `/api/auto-dispatch/plan/:planId/subtask/:subId` | 更新 sub-task | [patch_api-auto-dispatch-plan-planId-subtask-subId.json](./patch_api-auto-dispatch-plan-planId-subtask-subId.json) |
| `POST` | `/api/auto-dispatch/plan/create` | 建立執行計畫 | [post_api-auto-dispatch-plan-create.json](./post_api-auto-dispatch-plan-create.json) |
| `POST` | `/api/auto-dispatch/plan/:planId/execute` | 開始執行 plan | [post_api-auto-dispatch-plan-planId-execute.json](./post_api-auto-dispatch-plan-planId-execute.json) |
| `POST` | `/api/auto-dispatch/plan/:planId/resume` | 恢復中斷的 plan | [post_api-auto-dispatch-plan-planId-resume.json](./post_api-auto-dispatch-plan-planId-resume.json) |

## coding-tasks (18)

| Method | Path | Description | File |
|--------|------|-------------|------|
| `DELETE` | `/api/coding-tasks/:id` | 刪除 task ⚠️ | [delete_api-coding-tasks-id.json](./delete_api-coding-tasks-id.json) |
| `GET` | `/api/coding-tasks/:id/git/diff` | 取得 task 相關 git diff | [get_api-coding-tasks-id-git-diff.json](./get_api-coding-tasks-id-git-diff.json) |
| `GET` | `/api/coding-tasks/:id` | 取得單一 task | [get_api-coding-tasks-id.json](./get_api-coding-tasks-id.json) |
| `GET` | `/api/coding-tasks/overnight-queue/results` | 上次夜間執行結果 | [get_api-coding-tasks-overnight-queue-results.json](./get_api-coding-tasks-overnight-queue-results.json) |
| `GET` | `/api/coding-tasks/overnight-queue` | 今晚的夜間佇列 | [get_api-coding-tasks-overnight-queue.json](./get_api-coding-tasks-overnight-queue.json) |
| `GET` | `/api/coding-tasks/pipeline/overview` | Pipeline 概覽（所有 task 的 phase 分布） | [get_api-coding-tasks-pipeline-overview.json](./get_api-coding-tasks-pipeline-overview.json) |
| `GET` | `/api/coding-tasks/stats` | Task 統計數據 | [get_api-coding-tasks-stats.json](./get_api-coding-tasks-stats.json) |
| `GET` | `/api/coding-tasks` | 列出所有 tasks（支援 filter: status, type, priority, assignee, parentId, pipeline, search） | [get_api-coding-tasks.json](./get_api-coding-tasks.json) |
| `POST` | `/api/coding-tasks/decompose` | 拆分 task 為子任務 | [post_api-coding-tasks-decompose.json](./post_api-coding-tasks-decompose.json) |
| `POST` | `/api/coding-tasks/:id/dispatch` | EM dispatch task 給 agent | [post_api-coding-tasks-id-dispatch.json](./post_api-coding-tasks-id-dispatch.json) |
| `POST` | `/api/coding-tasks/:id/git/commit` | Git commit task files（含 auto push） ⚠️ | [post_api-coding-tasks-id-git-commit.json](./post_api-coding-tasks-id-git-commit.json) |
| `POST` | `/api/coding-tasks/:id/git/restore` | Restore task files（git checkout） ⚠️ | [post_api-coding-tasks-id-git-restore.json](./post_api-coding-tasks-id-git-restore.json) |
| `POST` | `/api/coding-tasks/:id/git/stage` | Git add task files | [post_api-coding-tasks-id-git-stage.json](./post_api-coding-tasks-id-git-stage.json) |
| `POST` | `/api/coding-tasks/:id/notes` | 新增 task note | [post_api-coding-tasks-id-notes.json](./post_api-coding-tasks-id-notes.json) |
| `POST` | `/api/coding-tasks/:id/pipeline/advance` | 推進 pipeline phase | [post_api-coding-tasks-id-pipeline-advance.json](./post_api-coding-tasks-id-pipeline-advance.json) |
| `POST` | `/api/coding-tasks/:id/pipeline/reject` | 退回 pipeline phase | [post_api-coding-tasks-id-pipeline-reject.json](./post_api-coding-tasks-id-pipeline-reject.json) |
| `POST` | `/api/coding-tasks` | 建立新 task | [post_api-coding-tasks.json](./post_api-coding-tasks.json) |
| `PUT` | `/api/coding-tasks/:id` | 更新 task | [put_api-coding-tasks-id.json](./put_api-coding-tasks-id.json) |

## coding-features (14)

| Method | Path | Description | File |
|--------|------|-------------|------|
| `DELETE` | `/api/coding-features/:id` | 刪除 feature ⚠️ | [delete_api-coding-features-id.json](./delete_api-coding-features-id.json) |
| `GET` | `/api/coding-features/file-map` | 取得 FILE-FEATURES.json（file→feature 反向索引） | [get_api-coding-features-file-map.json](./get_api-coding-features-file-map.json) |
| `GET` | `/api/coding-features/:id` | 取得單一 feature 詳情 | [get_api-coding-features-id.json](./get_api-coding-features-id.json) |
| `GET` | `/api/coding-features/stats` | Feature 統計 | [get_api-coding-features-stats.json](./get_api-coding-features-stats.json) |
| `GET` | `/api/coding-features/validate` | Layer 3 feature map 驗證 | [get_api-coding-features-validate.json](./get_api-coding-features-validate.json) |
| `GET` | `/api/coding-features` | 列出所有 features | [get_api-coding-features.json](./get_api-coding-features.json) |
| `POST` | `/api/coding-features/discover` | AI 從孤兒檔案發現新 features ⚠️ | [post_api-coding-features-discover.json](./post_api-coding-features-discover.json) |
| `POST` | `/api/coding-features/:id/link-issue` | 關聯 issue 到 feature | [post_api-coding-features-id-link-issue.json](./post_api-coding-features-id-link-issue.json) |
| `POST` | `/api/coding-features/:id/understand` | AI 生成/更新 feature understanding | [post_api-coding-features-id-understand.json](./post_api-coding-features-id-understand.json) |
| `POST` | `/api/coding-features/:id/unlink-issue` | 取消關聯 issue | [post_api-coding-features-id-unlink-issue.json](./post_api-coding-features-id-unlink-issue.json) |
| `POST` | `/api/coding-features/refresh-mapping` | AI 重新掃描並更新所有 feature file mappings ⚠️ | [post_api-coding-features-refresh-mapping.json](./post_api-coding-features-refresh-mapping.json) |
| `POST` | `/api/coding-features` | 建立 feature | [post_api-coding-features.json](./post_api-coding-features.json) |
| `PUT` | `/api/coding-features/:id/docs` | 更新 feature 文件（markdown） | [put_api-coding-features-id-docs.json](./put_api-coding-features-id-docs.json) |
| `PUT` | `/api/coding-features/:id` | 更新 feature | [put_api-coding-features-id.json](./put_api-coding-features-id.json) |

## coding-issues (8)

| Method | Path | Description | File |
|--------|------|-------------|------|
| `DELETE` | `/api/coding-issues/:id` | 刪除 issue ⚠️ | [delete_api-coding-issues-id.json](./delete_api-coding-issues-id.json) |
| `GET` | `/api/coding-issues/:id` | 取得單一 issue | [get_api-coding-issues-id.json](./get_api-coding-issues-id.json) |
| `GET` | `/api/coding-issues/stats` | Issue 統計 | [get_api-coding-issues-stats.json](./get_api-coding-issues-stats.json) |
| `GET` | `/api/coding-issues` | 列出所有 issues（filter: status, priority, label, type, search） | [get_api-coding-issues.json](./get_api-coding-issues.json) |
| `POST` | `/api/coding-issues/:id/notes` | 新增 issue note | [post_api-coding-issues-id-notes.json](./post_api-coding-issues-id-notes.json) |
| `POST` | `/api/coding-issues/import-known` | 從 KNOWN-ISSUES.md 匯入 issues | [post_api-coding-issues-import-known.json](./post_api-coding-issues-import-known.json) |
| `POST` | `/api/coding-issues` | 建立 issue | [post_api-coding-issues.json](./post_api-coding-issues.json) |
| `PUT` | `/api/coding-issues/:id` | 更新 issue | [put_api-coding-issues-id.json](./put_api-coding-issues-id.json) |

## coding-reports (3)

| Method | Path | Description | File |
|--------|------|-------------|------|
| `DELETE` | `/api/coding-reports/:date` | 刪除報告 ⚠️ | [delete_api-coding-reports-date.json](./delete_api-coding-reports-date.json) |
| `GET` | `/api/coding-reports/:date` | 取得單一日期報告內容 | [get_api-coding-reports-date.json](./get_api-coding-reports-date.json) |
| `GET` | `/api/coding-reports/list` | 列出所有 auto dispatch 報告 | [get_api-coding-reports-list.json](./get_api-coding-reports-list.json) |

## coding-memory (5)

| Method | Path | Description | File |
|--------|------|-------------|------|
| `DELETE` | `/api/coding-memory/:agentId` | 刪除 agent memory ⚠️ | [delete_api-coding-memory-agentId.json](./delete_api-coding-memory-agentId.json) |
| `GET` | `/api/coding-memory/:agentId` | 讀取特定 agent memory | [get_api-coding-memory-agentId.json](./get_api-coding-memory-agentId.json) |
| `GET` | `/api/coding-memory` | 列出所有 agent memory 檔案 | [get_api-coding-memory.json](./get_api-coding-memory.json) |
| `POST` | `/api/coding-memory/:agentId/append` | 附加內容到 agent memory | [post_api-coding-memory-agentId-append.json](./post_api-coding-memory-agentId-append.json) |
| `PUT` | `/api/coding-memory/:agentId` | 寫入/更新 agent memory | [put_api-coding-memory-agentId.json](./put_api-coding-memory-agentId.json) |

## coding-em (3)

| Method | Path | Description | File |
|--------|------|-------------|------|
| `GET` | `/api/coding-em/config` | 讀取 EM 設定 | [get_api-coding-em-config.json](./get_api-coding-em-config.json) |
| `PATCH` | `/api/coding-em/config` | 更新 EM 設定（partial merge） | [patch_api-coding-em-config.json](./patch_api-coding-em-config.json) |
| `POST` | `/api/coding-em/config/reset` | 重置 EM 設定為預設值 ⚠️ | [post_api-coding-em-config-reset.json](./post_api-coding-em-config-reset.json) |

## coding-doc (3)

| Method | Path | Description | File |
|--------|------|-------------|------|
| `GET` | `/api/coding-doc/coverage` | 讀取文件覆蓋率 | [get_api-coding-doc-coverage.json](./get_api-coding-doc-coverage.json) |
| `GET` | `/api/coding-doc/undocumented` | 取得未記錄的 commits | [get_api-coding-doc-undocumented.json](./get_api-coding-doc-undocumented.json) |
| `POST` | `/api/coding-doc/coverage` | 更新文件覆蓋率（寫文件後呼叫） | [post_api-coding-doc-coverage.json](./post_api-coding-doc-coverage.json) |

## coding-staged (3)

| Method | Path | Description | File |
|--------|------|-------------|------|
| `DELETE` | `/api/coding-staged/changes` | 清除 staged-changes.json（commit 後呼叫） ⚠️ | [delete_api-coding-staged-changes.json](./delete_api-coding-staged-changes.json) |
| `GET` | `/api/coding-staged/changes` | 讀取 staged-changes.json | [get_api-coding-staged-changes.json](./get_api-coding-staged-changes.json) |
| `POST` | `/api/coding-staged/changes` | 寫入 staged-changes.json | [post_api-coding-staged-changes.json](./post_api-coding-staged-changes.json) |

## coding-project (22)

| Method | Path | Description | File |
|--------|------|-------------|------|
| `DELETE` | `/api/coding-project/agent-memory` | 清除 agent memory ⚠️ | [delete_api-coding-project-agent-memory.json](./delete_api-coding-project-agent-memory.json) |
| `GET` | `/api/coding-project/agent-memory` | 讀取 agent memory（query: agentId） | [get_api-coding-project-agent-memory.json](./get_api-coding-project-agent-memory.json) |
| `GET` | `/api/coding-project/changelog` | 讀取 changelog | [get_api-coding-project-changelog.json](./get_api-coding-project-changelog.json) |
| `GET` | `/api/coding-project/context` | 取得 .paaw/ 專案 context | [get_api-coding-project-context.json](./get_api-coding-project-context.json) |
| `GET` | `/api/coding-project/crew-export` | 匯出 crew 設定 + memories | [get_api-coding-project-crew-export.json](./get_api-coding-project-crew-export.json) |
| `GET` | `/api/coding-project/decisions` | 讀取 decisions | [get_api-coding-project-decisions.json](./get_api-coding-project-decisions.json) |
| `GET` | `/api/coding-project/file` | 讀取任意 .paaw/ 檔案 | [get_api-coding-project-file.json](./get_api-coding-project-file.json) |
| `GET` | `/api/coding-project/security-scan/results` | 載入上次 scan 結果 | [get_api-coding-project-security-scan-results.json](./get_api-coding-project-security-scan-results.json) |
| `GET` | `/api/coding-project/security-scan` | 執行 Semgrep security scan ⚠️ | [get_api-coding-project-security-scan.json](./get_api-coding-project-security-scan.json) |
| `GET` | `/api/coding-project/sessions/:filename` | 讀取特定 session | [get_api-coding-project-sessions-filename.json](./get_api-coding-project-sessions-filename.json) |
| `GET` | `/api/coding-project/sessions` | 列出 sessions | [get_api-coding-project-sessions.json](./get_api-coding-project-sessions.json) |
| `GET` | `/api/coding-project/skills` | 列出所有可用 skills | [get_api-coding-project-skills.json](./get_api-coding-project-skills.json) |
| `GET` | `/api/coding-project/standards/:name` | 讀取 standard | [get_api-coding-project-standards-name.json](./get_api-coding-project-standards-name.json) |
| `GET` | `/api/coding-project/standards` | 列出 standards | [get_api-coding-project-standards.json](./get_api-coding-project-standards.json) |
| `GET` | `/api/coding-project/tree` | 取得 .paaw/ 目錄樹 | [get_api-coding-project-tree.json](./get_api-coding-project-tree.json) |
| `POST` | `/api/coding-project/create` | 建立新專案目錄 + .paaw/ init + git init ⚠️ | [post_api-coding-project-create.json](./post_api-coding-project-create.json) |
| `POST` | `/api/coding-project/decisions` | 新增 decision | [post_api-coding-project-decisions.json](./post_api-coding-project-decisions.json) |
| `POST` | `/api/coding-project/generate-overview` | AI 自動生成 PROJECT.md | [post_api-coding-project-generate-overview.json](./post_api-coding-project-generate-overview.json) |
| `POST` | `/api/coding-project/init` | 初始化 .paaw/ 目錄結構 | [post_api-coding-project-init.json](./post_api-coding-project-init.json) |
| `PUT` | `/api/coding-project/agent-memory` | 儲存 agent memory | [put_api-coding-project-agent-memory.json](./put_api-coding-project-agent-memory.json) |
| `PUT` | `/api/coding-project/file` | 寫入任意 .paaw/ 檔案 | [put_api-coding-project-file.json](./put_api-coding-project-file.json) |
| `PUT` | `/api/coding-project/standards/:name` | 寫入 standard | [put_api-coding-project-standards-name.json](./put_api-coding-project-standards-name.json) |

## coding-crew (17)

| Method | Path | Description | File |
|--------|------|-------------|------|
| `DELETE` | `/api/coding-crew/conversations/:crewId/sessions/:sessionId` | 刪除 history session ⚠️ | [delete_api-coding-crew-conversations-crewId-sessions-sessionId.json](./delete_api-coding-crew-conversations-crewId-sessions-sessionId.json) |
| `DELETE` | `/api/coding-crew/conversations/:crewId` | 清除 active conversation ⚠️ | [delete_api-coding-crew-conversations-crewId.json](./delete_api-coding-crew-conversations-crewId.json) |
| `GET` | `/api/coding-crew/action-log` | 讀取 action log（跨 agent 交接紀錄） | [get_api-coding-crew-action-log.json](./get_api-coding-crew-action-log.json) |
| `GET` | `/api/coding-crew/conversations/:crewId/sessions/:sessionId` | 載入特定 session | [get_api-coding-crew-conversations-crewId-sessions-sessionId.json](./get_api-coding-crew-conversations-crewId-sessions-sessionId.json) |
| `GET` | `/api/coding-crew/conversations/:crewId/sessions` | 列出所有 sessions（active + history） | [get_api-coding-crew-conversations-crewId-sessions.json](./get_api-coding-crew-conversations-crewId-sessions.json) |
| `GET` | `/api/coding-crew/conversations/:crewId` | 載入 active conversation | [get_api-coding-crew-conversations-crewId.json](./get_api-coding-crew-conversations-crewId.json) |
| `GET` | `/api/coding-crew/conversations` | 列出所有 crew conversations | [get_api-coding-crew-conversations.json](./get_api-coding-crew-conversations.json) |
| `GET` | `/api/coding-crew/running` | 列出正在執行的 agents | [get_api-coding-crew-running.json](./get_api-coding-crew-running.json) |
| `POST` | `/api/coding-crew/chat` | 透過 A2A domain agent 進行對話（SSE streaming） | [post_api-coding-crew-chat.json](./post_api-coding-crew-chat.json) |
| `POST` | `/api/coding-crew/context-window` | 建立最佳化 context window | [post_api-coding-crew-context-window.json](./post_api-coding-crew-context-window.json) |
| `POST` | `/api/coding-crew/conversations/:crewId/new-session` | Archive active + start new session | [post_api-coding-crew-conversations-crewId-new-session.json](./post_api-coding-crew-conversations-crewId-new-session.json) |
| `POST` | `/api/coding-crew/conversations/:crewId/switch/:sessionId` | 切換到 history session | [post_api-coding-crew-conversations-crewId-switch-sessionId.json](./post_api-coding-crew-conversations-crewId-switch-sessionId.json) |
| `POST` | `/api/coding-crew/conversations/:crewId` | 儲存 active conversation | [post_api-coding-crew-conversations-crewId.json](./post_api-coding-crew-conversations-crewId.json) |
| `POST` | `/api/coding-crew/dispatch` | EM dispatch: 觸發 agent 執行 task（SSE streaming） | [post_api-coding-crew-dispatch.json](./post_api-coding-crew-dispatch.json) |
| `POST` | `/api/coding-crew/em-execute` | EM Execute（用確認的 workList 執行） | [post_api-coding-crew-em-execute.json](./post_api-coding-crew-em-execute.json) |
| `POST` | `/api/coding-crew/em-plan` | EM Plan（只規劃，不執行） | [post_api-coding-crew-em-plan.json](./post_api-coding-crew-em-plan.json) |
| `POST` | `/api/coding-crew/interrupt` | 中斷正在執行的 agent ⚠️ | [post_api-coding-crew-interrupt.json](./post_api-coding-crew-interrupt.json) |

## a2a (7)

| Method | Path | Description | File |
|--------|------|-------------|------|
| `GET` | `/a2a/:agentId/system-prompt` | Debug: 檢視 agent system prompt | [get_a2a-agentId-system-prompt.json](./get_a2a-agentId-system-prompt.json) |
| `GET` | `/a2a/:agentId` | Domain Agent Card | [get_a2a-agentId.json](./get_a2a-agentId.json) |
| `GET` | `/api/a2a/agent-card` | 取得 Agent Card（PAAW UI 用） | [get_api-a2a-agent-card.json](./get_api-a2a-agent-card.json) |
| `GET` | `/api/a2a/tasks` | 列出所有 A2A tasks（PAAW UI 用） | [get_api-a2a-tasks.json](./get_api-a2a-tasks.json) |
| `POST` | `/a2a/:agentId` | Domain Agent JSON-RPC (message/send, message/stream) | [post_a2a-agentId.json](./post_a2a-agentId.json) |
| `POST` | `/a2a` | A2A JSON-RPC endpoint (message/send, message/stream, tasks/*) | [post_a2a.json](./post_a2a.json) |
| `POST` | `/api/a2a/interrupt` | 中斷 A2A running stream ⚠️ | [post_api-a2a-interrupt.json](./post_api-a2a-interrupt.json) |

## well-known (1)

| Method | Path | Description | File |
|--------|------|-------------|------|
| `GET` | `/.well-known/agent.json` | A2A Agent Card discovery | [get_well-known-agent-json.json](./get_well-known-agent-json.json) |

## apps (2)

| Method | Path | Description | File |
|--------|------|-------------|------|
| `GET` | `/api/apps` | 列出所有 apps | [get_api-apps.json](./get_api-apps.json) |
| `POST` | `/api/apps` | 建立/更新 app ⚠️ | [post_api-apps.json](./post_api-apps.json) |

## report-train (1)

| Method | Path | Description | File |
|--------|------|-------------|------|
| `POST` | `/api/report-train` | AI 訓練 report | [post_api-report-train.json](./post_api-report-train.json) |

## report-publish (1)

| Method | Path | Description | File |
|--------|------|-------------|------|
| `POST` | `/api/report-publish` | 發布 report ⚠️ | [post_api-report-publish.json](./post_api-report-publish.json) |

## notes (21)

| Method | Path | Description | File |
|--------|------|-------------|------|
| `DELETE` | `/api/notes/delete` | 刪除筆記 ⚠️ | [delete_api-notes-delete.json](./delete_api-notes-delete.json) |
| `DELETE` | `/api/notes/notebooks` | 刪除 notebook ⚠️ | [delete_api-notes-notebooks.json](./delete_api-notes-notebooks.json) |
| `DELETE` | `/api/notes/sections` | 刪除 section ⚠️ | [delete_api-notes-sections.json](./delete_api-notes-sections.json) |
| `GET` | `/api/notes/by-tag` | 按標籤找筆記 | [get_api-notes-by-tag.json](./get_api-notes-by-tag.json) |
| `GET` | `/api/notes/get` | 取得單一筆記 | [get_api-notes-get.json](./get_api-notes-get.json) |
| `GET` | `/api/notes/list` | 列出筆記 | [get_api-notes-list.json](./get_api-notes-list.json) |
| `GET` | `/api/notes/notebooks` | 列出所有 notebooks | [get_api-notes-notebooks.json](./get_api-notes-notebooks.json) |
| `GET` | `/api/notes/recent` | 最近編輯的筆記 | [get_api-notes-recent.json](./get_api-notes-recent.json) |
| `GET` | `/api/notes/search` | 全文搜尋筆記 | [get_api-notes-search.json](./get_api-notes-search.json) |
| `GET` | `/api/notes/sections` | 列出 sections | [get_api-notes-sections.json](./get_api-notes-sections.json) |
| `GET` | `/api/notes/tags` | 列出所有標籤 | [get_api-notes-tags.json](./get_api-notes-tags.json) |
| `POST` | `/api/notes/ai-write` | AI 寫筆記 | [post_api-notes-ai-write.json](./post_api-notes-ai-write.json) |
| `POST` | `/api/notes/create` | 建立筆記 | [post_api-notes-create.json](./post_api-notes-create.json) |
| `POST` | `/api/notes/notebooks` | 建立 notebook | [post_api-notes-notebooks.json](./post_api-notes-notebooks.json) |
| `POST` | `/api/notes/sections` | 建立 section | [post_api-notes-sections.json](./post_api-notes-sections.json) |
| `POST` | `/api/notes/upload-image` | 上傳圖片 | [post_api-notes-upload-image.json](./post_api-notes-upload-image.json) |
| `PUT` | `/api/notes/move` | 搬移筆記 | [put_api-notes-move.json](./put_api-notes-move.json) |
| `PUT` | `/api/notes/notebooks` | 改名/改顏色 notebook | [put_api-notes-notebooks.json](./put_api-notes-notebooks.json) |
| `PUT` | `/api/notes/pin` | 釘選筆記 | [put_api-notes-pin.json](./put_api-notes-pin.json) |
| `PUT` | `/api/notes/sections` | 改名 section | [put_api-notes-sections.json](./put_api-notes-sections.json) |
| `PUT` | `/api/notes/update` | 更新筆記 | [put_api-notes-update.json](./put_api-notes-update.json) |

## projects (15)

| Method | Path | Description | File |
|--------|------|-------------|------|
| `DELETE` | `/api/projects/:id/categories/:catId` | 刪除分類 ⚠️ | [delete_api-projects-id-categories-catId.json](./delete_api-projects-id-categories-catId.json) |
| `DELETE` | `/api/projects/:id/milestones/:msId` | 刪除里程碑 ⚠️ | [delete_api-projects-id-milestones-msId.json](./delete_api-projects-id-milestones-msId.json) |
| `DELETE` | `/api/projects/:id/tasks/:taskId` | 刪除任務 ⚠️ | [delete_api-projects-id-tasks-taskId.json](./delete_api-projects-id-tasks-taskId.json) |
| `DELETE` | `/api/projects/:id` | 刪除專案 ⚠️ | [delete_api-projects-id.json](./delete_api-projects-id.json) |
| `GET` | `/api/projects/:id/stats` | 專案統計 | [get_api-projects-id-stats.json](./get_api-projects-id-stats.json) |
| `GET` | `/api/projects/:id` | 取得專案詳情 | [get_api-projects-id.json](./get_api-projects-id.json) |
| `GET` | `/api/projects` | 列出所有專案 | [get_api-projects.json](./get_api-projects.json) |
| `POST` | `/api/projects/:id/categories` | 新增分類 | [post_api-projects-id-categories.json](./post_api-projects-id-categories.json) |
| `POST` | `/api/projects/:id/milestones` | 新增里程碑 | [post_api-projects-id-milestones.json](./post_api-projects-id-milestones.json) |
| `POST` | `/api/projects/:id/tasks` | 新增任務 | [post_api-projects-id-tasks.json](./post_api-projects-id-tasks.json) |
| `POST` | `/api/projects` | 新增專案 | [post_api-projects.json](./post_api-projects.json) |
| `PUT` | `/api/projects/:id/categories/:catId` | 更新分類 | [put_api-projects-id-categories-catId.json](./put_api-projects-id-categories-catId.json) |
| `PUT` | `/api/projects/:id/milestones/:msId` | 更新里程碑 | [put_api-projects-id-milestones-msId.json](./put_api-projects-id-milestones-msId.json) |
| `PUT` | `/api/projects/:id/tasks/:taskId` | 更新任務 | [put_api-projects-id-tasks-taskId.json](./put_api-projects-id-tasks-taskId.json) |
| `PUT` | `/api/projects/:id` | 更新專案 | [put_api-projects-id.json](./put_api-projects-id.json) |

## ai-settings (13)

| Method | Path | Description | File |
|--------|------|-------------|------|
| `DELETE` | `/api/ai-settings/:category/:file` | 刪除檔案 ⚠️ | [delete_api-ai-settings-category-file.json](./delete_api-ai-settings-category-file.json) |
| `GET` | `/api/ai-settings/agent-config` | 取得 agent config | [get_api-ai-settings-agent-config.json](./get_api-ai-settings-agent-config.json) |
| `GET` | `/api/ai-settings/:category/:file` | 取得檔案內容 | [get_api-ai-settings-category-file.json](./get_api-ai-settings-category-file.json) |
| `GET` | `/api/ai-settings/:category` | 列出分類內檔案 | [get_api-ai-settings-category.json](./get_api-ai-settings-category.json) |
| `GET` | `/api/ai-settings/providers` | 取得 providers 設定 | [get_api-ai-settings-providers.json](./get_api-ai-settings-providers.json) |
| `GET` | `/api/ai-settings` | 列出所有 AI settings 分類 | [get_api-ai-settings.json](./get_api-ai-settings.json) |
| `POST` | `/api/ai-settings/:category` | 建立新檔案 | [post_api-ai-settings-category.json](./post_api-ai-settings-category.json) |
| `POST` | `/api/ai-settings/generic-preview` | Generic preview | [post_api-ai-settings-generic-preview.json](./post_api-ai-settings-generic-preview.json) |
| `POST` | `/api/ai-settings/skill-builder/build` | 組裝 skill builder context | [post_api-ai-settings-skill-builder-build.json](./post_api-ai-settings-skill-builder-build.json) |
| `POST` | `/api/ai-settings/skill-builder/preview` | 預覽 skill builder | [post_api-ai-settings-skill-builder-preview.json](./post_api-ai-settings-skill-builder-preview.json) |
| `PUT` | `/api/ai-settings/agent-config` | 更新 agent config | [put_api-ai-settings-agent-config.json](./put_api-ai-settings-agent-config.json) |
| `PUT` | `/api/ai-settings/:category/:file` | 更新檔案內容 | [put_api-ai-settings-category-file.json](./put_api-ai-settings-category-file.json) |
| `PUT` | `/api/ai-settings/providers` | 更新 providers 設定 | [put_api-ai-settings-providers.json](./put_api-ai-settings-providers.json) |

## paaw (16)

| Method | Path | Description | File |
|--------|------|-------------|------|
| `DELETE` | `/api/paaw/workspaces` | 刪除 workspace ⚠️ | [delete_api-paaw-workspaces.json](./delete_api-paaw-workspaces.json) |
| `GET` | `/api/paaw/chats/:id` | 取得單一 chat | [get_api-paaw-chats-id.json](./get_api-paaw-chats-id.json) |
| `GET` | `/api/paaw/chats` | 列出所有 chat sessions | [get_api-paaw-chats.json](./get_api-paaw-chats.json) |
| `GET` | `/api/paaw/knowledge-paths` | 取得知識庫路徑 | [get_api-paaw-knowledge-paths.json](./get_api-paaw-knowledge-paths.json) |
| `GET` | `/api/paaw/providers` | 取得 AI providers | [get_api-paaw-providers.json](./get_api-paaw-providers.json) |
| `GET` | `/api/paaw/tools` | 列出可用 tools | [get_api-paaw-tools.json](./get_api-paaw-tools.json) |
| `GET` | `/api/paaw/ui-state` | 取得 UI state | [get_api-paaw-ui-state.json](./get_api-paaw-ui-state.json) |
| `GET` | `/api/paaw/user` | 取得使用者資訊 | [get_api-paaw-user.json](./get_api-paaw-user.json) |
| `GET` | `/api/paaw/workflows` | 列出所有 workflows | [get_api-paaw-workflows.json](./get_api-paaw-workflows.json) |
| `PATCH` | `/api/paaw/ui-state` | 更新 UI state | [patch_api-paaw-ui-state.json](./patch_api-paaw-ui-state.json) |
| `POST` | `/api/paaw/chat` | SSE streaming chat | [post_api-paaw-chat.json](./post_api-paaw-chat.json) |
| `POST` | `/api/paaw/chats` | 建立 chat session | [post_api-paaw-chats.json](./post_api-paaw-chats.json) |
| `POST` | `/api/paaw/user` | 更新使用者資訊 | [post_api-paaw-user.json](./post_api-paaw-user.json) |
| `POST` | `/api/paaw/workflows` | 建立 workflow | [post_api-paaw-workflows.json](./post_api-paaw-workflows.json) |
| `POST` | `/api/paaw/workspaces` | 新增 workspace (legacy) | [post_api-paaw-workspaces.json](./post_api-paaw-workspaces.json) |
| `PUT` | `/api/paaw/providers` | 更新 providers | [put_api-paaw-providers.json](./put_api-paaw-providers.json) |

## skills (5)

| Method | Path | Description | File |
|--------|------|-------------|------|
| `DELETE` | `/api/skills/:kind/:id` | 刪除 skill ⚠️ | [delete_api-skills-kind-id.json](./delete_api-skills-kind-id.json) |
| `GET` | `/api/skills/:kind/:id` | 取得 skill | [get_api-skills-kind-id.json](./get_api-skills-kind-id.json) |
| `GET` | `/api/skills` | 列出所有 skills | [get_api-skills.json](./get_api-skills.json) |
| `POST` | `/api/skills` | 建立 skill | [post_api-skills.json](./post_api-skills.json) |
| `PUT` | `/api/skills/:kind/:id` | 更新 skill | [put_api-skills-kind-id.json](./put_api-skills-kind-id.json) |

## backup (6)

| Method | Path | Description | File |
|--------|------|-------------|------|
| `DELETE` | `/api/backup/delete` | 刪除備份 ⚠️ | [delete_api-backup-delete.json](./delete_api-backup-delete.json) |
| `GET` | `/api/backup/config` | 取得備份設定 | [get_api-backup-config.json](./get_api-backup-config.json) |
| `GET` | `/api/backup/list` | 列出所有備份 | [get_api-backup-list.json](./get_api-backup-list.json) |
| `POST` | `/api/backup/restore` | 從備份還原 ⚠️ | [post_api-backup-restore.json](./post_api-backup-restore.json) |
| `POST` | `/api/backup/run` | 立即執行備份 ⚠️ | [post_api-backup-run.json](./post_api-backup-run.json) |
| `PUT` | `/api/backup/config` | 更新備份設定 | [put_api-backup-config.json](./put_api-backup-config.json) |

## helpdesk (5)

| Method | Path | Description | File |
|--------|------|-------------|------|
| `GET` | `/api/helpdesk/knowledge` | 取得知識庫 | [get_api-helpdesk-knowledge.json](./get_api-helpdesk-knowledge.json) |
| `GET` | `/api/helpdesk/models` | 列出可用 models | [get_api-helpdesk-models.json](./get_api-helpdesk-models.json) |
| `GET` | `/api/helpdesk/tickets` | 列出 tickets | [get_api-helpdesk-tickets.json](./get_api-helpdesk-tickets.json) |
| `POST` | `/api/helpdesk/ask` | HelpDesk 問答 | [post_api-helpdesk-ask.json](./post_api-helpdesk-ask.json) |
| `PUT` | `/api/helpdesk/tickets` | 更新 ticket | [put_api-helpdesk-tickets.json](./put_api-helpdesk-tickets.json) |

## distill (7)

| Method | Path | Description | File |
|--------|------|-------------|------|
| `GET` | `/api/distill/config` | 取得蒸餾器設定 | [get_api-distill-config.json](./get_api-distill-config.json) |
| `GET` | `/api/distill/knowledge` | 列出蒸餾知識 | [get_api-distill-knowledge.json](./get_api-distill-knowledge.json) |
| `GET` | `/api/distill/logs` | 列出蒸餾日誌 | [get_api-distill-logs.json](./get_api-distill-logs.json) |
| `GET` | `/api/distill/sources` | 列出蒸餾來源 | [get_api-distill-sources.json](./get_api-distill-sources.json) |
| `POST` | `/api/distill/record` | 記錄蒸餾結果 | [post_api-distill-record.json](./post_api-distill-record.json) |
| `POST` | `/api/distill/run` | 執行蒸餾 | [post_api-distill-run.json](./post_api-distill-run.json) |
| `PUT` | `/api/distill/config` | 更新蒸餾器設定 | [put_api-distill-config.json](./put_api-distill-config.json) |

## api-tester (3)

| Method | Path | Description | File |
|--------|------|-------------|------|
| `POST` | `/api/api-tester/proxy` | API tester proxy | [post_api-api-tester-proxy.json](./post_api-api-tester-proxy.json) |
| `POST` | `/api/api-tester/save` | 儲存 API test | [post_api-api-tester-save.json](./post_api-api-tester-save.json) |
| `POST` | `/api/api-tester/stream` | API tester streaming | [post_api-api-tester-stream.json](./post_api-api-tester-stream.json) |

## cli-run (1)

| Method | Path | Description | File |
|--------|------|-------------|------|
| `POST` | `/api/cli-run` | 執行 CLI command ⚠️ | [post_api-cli-run.json](./post_api-cli-run.json) |

## skill-test (1)

| Method | Path | Description | File |
|--------|------|-------------|------|
| `POST` | `/api/skill-test/run` | PAAW Agent Loop test | [post_api-skill-test-run.json](./post_api-skill-test-run.json) |

## vibe-sessions (1)

| Method | Path | Description | File |
|--------|------|-------------|------|
| `POST` | `/api/vibe-sessions` | 建立 vibe session | [post_api-vibe-sessions.json](./post_api-vibe-sessions.json) |

## workspaces (2)

| Method | Path | Description | File |
|--------|------|-------------|------|
| `GET` | `/api/workspaces` | 列出 workspaces | [get_api-workspaces.json](./get_api-workspaces.json) |
| `POST` | `/api/workspaces` | 建立 workspace | [post_api-workspaces.json](./post_api-workspaces.json) |

## plugins (2)

| Method | Path | Description | File |
|--------|------|-------------|------|
| `GET` | `/api/plugins` | 列出 plugins | [get_api-plugins.json](./get_api-plugins.json) |
| `POST` | `/api/plugins` | 安裝 plugin | [post_api-plugins.json](./post_api-plugins.json) |

## agentic-bindings (2)

| Method | Path | Description | File |
|--------|------|-------------|------|
| `GET` | `/api/agentic-bindings` | 列出 agentic bindings | [get_api-agentic-bindings.json](./get_api-agentic-bindings.json) |
| `POST` | `/api/agentic-bindings` | 建立/更新 binding | [post_api-agentic-bindings.json](./post_api-agentic-bindings.json) |

## system-prompts (1)

| Method | Path | Description | File |
|--------|------|-------------|------|
| `GET` | `/api/system-prompts` | 取得系統提示 | [get_api-system-prompts.json](./get_api-system-prompts.json) |

## user (1)

| Method | Path | Description | File |
|--------|------|-------------|------|
| `GET` | `/api/user/preferences` | 取得使用者偏好 | [get_api-user-preferences.json](./get_api-user-preferences.json) |

## paaw-root (1)

| Method | Path | Description | File |
|--------|------|-------------|------|
| `GET` | `/api/paaw-root` | 取得 PAAW root 路徑 | [get_api-paaw-root.json](./get_api-paaw-root.json) |

## report-preview (1)

| Method | Path | Description | File |
|--------|------|-------------|------|
| `POST` | `/api/report-preview` | 預覽 report | [post_api-report-preview.json](./post_api-report-preview.json) |

