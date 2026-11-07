# API Contract — tPAAW Server

> Code Understanding api-spec output — regenerated 2026-10-02 (W40) from actual route scan (52 route files, 52+ HTTP handlers, ~250 method+path combinations).
> Previous version (2026-07-13) was a template with placeholder endpoints. This version lists endpoints extracted from source.

## General Conventions

| Aspect | Convention |
|--------|-----------|
| Base URL | `http://localhost:4097` (default dev; see server bootstrap) |
| Content type | `application/json` unless noted (uploads: multipart; streams: `text/event-stream`) |
| Success | `2xx` + resource JSON (no envelope) |
| Error | `res.writeHead(status)` + `{"error": "<human-readable message>"}` — see `specs/error-codes.md` |
| Streaming | SSE (`/stream` endpoints): `data: {...}\n\n` frames, `data: [DONE]` terminator |
| Path params | Regex captures, e.g. `/api/skills/{skillId}`, `/api/coding-evidence/task/{taskId}`, `/api/coding-reports/{date}` |
| Routing | Raw Node HTTP, string/regex matching per route file — **no framework**. 4 matching patterns documented below |

## Endpoint Catalog

### A2A Protocol (F-030) — `routes/a2a.mjs`
| Method | Path | Description |
|--------|------|-------------|
| GET | `/.well-known/agent.json` | Agent card discovery |
| POST | `/a2a` | A2A message send (JSON-RPC style) |
| GET | `/api/a2a/agent-card` | Agent card (API form) |
| POST | `/api/a2a/interrupt` | Interrupt running A2A task |
| GET | `/api/a2a/tasks` | List A2A tasks |

### Agent Runs & Cron (F-039) — `scheduler/cron-jobs.mjs`
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/cron-jobs` | Cron job CRUD (action-based) |
| POST | `/api/agent-run` | Run agent once (non-stream) |
| POST | `/api/agent-run/stream` | Run agent (SSE stream) |

### Agent Logs (F-041) — `routes/agent-logs.mjs`, `routes/llm-logs.mjs`, `routes/log-retention.mjs`, `routes/janitor.mjs`
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/agent-logs` | Query agent execution logs |
| POST | `/api/agent-logs/purge` | Purge agent logs |
| GET | `/api/agent-logs/ru-debug` | Debug view per release unit |
| GET | `/api/agent-logs/ru-summary` | Summary per release unit |
| GET | `/api/llm-logs` | Query LLM JSONL logs (ADR-010) |
| GET | `/api/llm-logs/stats` | Aggregate usage by model/agent |
| DELETE | `/api/llm-logs` | Delete LLM logs |
| GET | `/api/logs/retention` | Retention config |
| PUT | `/api/logs/retention` | Update retention config |
| POST | `/api/logs/purge` | Purge per retention policy |
| GET | `/api/logs/console` | Console log tail (janitor) |
| GET | `/api/janitor` · PUT · POST `/api/janitor/run` | Janitor config & manual run |

### AI Settings & Providers (F-037) — `routes/ai-settings.mjs`
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/ai-settings` | Read AI settings |
| GET/PUT | `/api/ai-settings/agent-config` | Agent config read/update |
| POST | `/api/ai-settings/generic-preview` | Generic provider preview |
| GET/PUT | `/api/ai-settings/providers` | Providers read/update |
| POST | `/api/ai-settings/skill-builder/build` | Skill builder build |
| POST | `/api/ai-settings/skill-builder/preview` | Skill builder preview |
| GET/PUT | `/api/user/preferences` | User preferences |
| GET/POST | `/api/workspaces` | Workspace list/add |

### API Tester (F-048) — `routes/api-tester.mjs`
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/api-tester/proxy` | Proxy external request |
| POST | `/api/api-tester/save` | Save request payload |
| POST | `/api/api-tester/stream` | Streaming test (SSE) |
| POST | `/api/api-tester/collections` | Collection management |

### Apps & Reports (F-033) — `routes/apps.mjs`
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/apps` | App CRUD (action-based) |
| POST | `/api/report-publish` | Publish report app |
| POST | `/api/report-train` | Train report app |

### Assistant & User (F-037) — `routes/assistant.mjs`, `routes/chat.mjs`
| Method | Path | Description |
|--------|------|-------------|
| GET/PUT | `/api/paaw/app-rules` | App rules |
| GET | `/api/paaw/app-skills` | App skills |
| POST | `/api/paaw/apps/import` | Import app |
| POST | `/api/paaw/avatar` | Upload user avatar |
| GET | `/api/paaw/avatar/assistant` | Assistant avatar |
| POST | `/api/paaw/chat` | Main chat (non-stream) |
| POST | `/api/paaw/chat/stream` | Main chat (SSE, tool-calling loop) |
| GET/POST | `/api/paaw/chats` | Conversation list/create |
| POST | `/api/paaw/file-write` | File write from assistant |
| GET | `/api/paaw/knowledge-paths` | Knowledge paths |
| GET/PUT | `/api/paaw/providers` | Assistant providers |
| GET/PATCH/PUT | `/api/paaw/ui-state` | UI state persistence |
| GET/POST | `/api/paaw/user` | User profile |
| POST | `/api/paaw/workflow-output-chat` | Workflow output to chat |
| POST | `/api/paaw/workflow-trigger` | Trigger workflow |
| GET | `/api/version` | Version info |

### Backup (F-040) — `routes/backup.mjs`
| Method | Path | Description |
|--------|------|-------------|
| GET/PUT | `/api/backup/config` | Backup config |
| POST | `/api/backup/run` | Create tar.gz backup |
| POST | `/api/backup/restore` | Restore from backup |
| GET | `/api/backup/list` | List backups |
| DELETE | `/api/backup/delete` | Delete backup |

### Browser Session (F-043) — `routes/browser.mjs`
| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/api/browser/tabs` | Tab list/manage |
| POST | `/api/browser/navigate` | Navigate |
| POST | `/api/browser/input` | Input/click |
| POST | `/api/browser/dialog` | Dialog handling |
| GET | `/api/browser/downloads` | Downloads |
| GET | `/api/browser/clipboard` | Clipboard read |
| POST | `/api/browser/capture` | Capture state |
| POST | `/api/browser/screenshot` · GET `/api/browser/shot` | Screenshots |
| GET | `/api/browser/status` | Session status |
| POST | `/api/browser/setup` | Playwright install setup |
| GET | `/api/browser/actions` | Action history |
| POST | `/api/browser/resize` | Viewport resize |
| GET | `/api/browser/stream` | Screencast stream (SSE) |
| POST | `/api/browser/visual` | Visual automation |

### Coding IDE — Files, Git, Sessions (F-012, F-013, F-047) — `routes/vibe-fs.mjs`, `routes/vibe-sessions.mjs`
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/vibe-fs/list` | Directory listing |
| GET | `/api/vibe-fs/read` | File read |
| PUT | `/api/vibe-fs/write` | File write |
| GET | `/api/vibe-fs/search` | Content search |
| GET | `/api/pick-directory` | Native directory picker |
| GET/POST | `/api/vibe-sessions` | Vibe session persistence |
| POST | `/api/vibe-chat` | Vibe chat |
| GET | `/api/vibe-git/status` · POST `add` · POST `commit` · GET `log` · GET `diff` | Git basics |
| GET | `/api/vibe-git/blame` · GET `unpushed` · POST `unstage` | Git inspection |
| POST | `/api/vibe-git/push` · POST `pull` | Git remote ops |
| GET | `/api/vibe-git/changes-since` | Changes since ref |
| GET | `/api/vibe-git/reviews` · POST `ai-comment` · POST `ai-commit-msg` | AI-assisted git |

### Coding Crew & EM (F-023, F-024, F-012) — `routes/coding.mjs`
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/coding-crew/chat` | Coding agent chat (context injection per ADR-012) |
| POST | `/api/coding-crew/dispatch` | Dispatch task to agent |
| POST | `/api/coding-crew/interrupt` | Interrupt running agent |
| POST | `/api/coding-crew/em-plan` | EM planning session (ADR-016) |
| POST | `/api/coding-crew/em-execute` | EM execution session |
| POST | `/api/coding-crew/context-window` | Context window config |
| GET/POST | `/api/coding-crew/qa-results` | QA results read/record |
| GET | `/api/coding-crew/running` | Running agents |
| GET | `/api/coding-project/ru-log` | Release unit log |

### Coding Auto Dispatch & EM Config (F-023) — `routes/coding-auto-dispatch*.mjs`, `routes/coding-em-config.mjs`, `routes/coding-reports.mjs`
| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/api/coding-auto-dispatch/*` | Auto dispatch status/plans/run (action-based) |
| GET/POST | `/api/coding-auto-dispatch-config` | Dispatch config |
| GET/PUT | `/api/coding-auto-dispatch-prompts` | Dispatch prompts |
| GET | `/api/coding-em/config` | EM config read |
| PATCH | `/api/coding-em/config` | EM config partial update |
| POST | `/api/coding-em/config/reset` | EM config reset |
| GET | `/api/coding-reports/list` | List auto-dispatch reports |
| GET/DELETE | `/api/coding-reports/{date}` | Report by date |

### Coding Tasks & Plans (F-015, F-024) — `routes/coding-tasks.mjs`, `routes/execution-plan-routes.mjs`
| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/api/coding-tasks` | Task board CRUD |
| POST | `/api/coding-tasks/decompose` | LLM task decomposition |
| GET | `/api/coding-tasks/stats` | Task stats |
| GET/POST/PATCH/DELETE | `/api/execution-plans/*` | Plan/subtask lifecycle (create, resume, complete, interrupted) |

### Coding Features & CU (F-016, F-060, F-028) — `routes/coding-features.mjs`, `routes/coding-doc-coverage.mjs`
| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/api/coding-features` | Feature map CRUD |
| POST | `/api/coding-features/refresh-mapping` | AI refresh feature↔file mapping |
| POST | `/api/coding-features/discover` | AI feature discovery (ADR-017) |
| GET | `/api/coding-features/file-map` | File→feature reverse index |
| GET | `/api/coding-features/stats` | Coverage stats |
| GET | `/api/coding-features/validate` | L3 validation (ADR-015) |
| GET/POST | `/api/coding-doc/coverage` | Doc coverage status/update |
| GET | `/api/coding-doc/undocumented` | Undocumented commits |

### Coding Intelligence Views (F-018, F-020, F-026, F-027, F-019)
| Method | Path | Route file | Description |
|--------|------|-----------|-------------|
| GET | `/api/coding-health` | coding-health.mjs | Code health score |
| GET | `/api/coding-memory` | coding-memory.mjs | Agent memory |
| GET/POST | `/api/coding-handover/bundle` `generate` `state` | coding-handover.mjs | Handover bundle |
| GET | `/api/coding-ops/status` · GET/POST `runbook(/save)` | coding-ops.mjs | Ops & runbooks |
| GET | `/api/coding-project/c4-model` · POST `rescan` | coding-c4-model.mjs | C4 model view |
| GET | `/api/coding-project/error-codes` · POST `rescan` | coding-error-codes.mjs | Error code view |
| GET | `/api/coding-project/ru-skills` · POST `add` `sync` | coding-ru-skills.mjs | RU skill binding |
| GET | `/api/coding-project/skill-suggest` · POST `annotate` | coding-skill-suggest.mjs | Skill suggestion |
| GET | `/api/coding-evidence/task/{taskId}` | coding-evidence.mjs | Task evidence bundle |
| GET | `/api/coding-evidence/plan/{planId}` | coding-evidence.mjs | Plan evidence overview |
| GET | `/api/coding-staged/changes` · POST · DELETE | coding-staged-changes.mjs | Staged changes store |
| GET/POST | `/api/coding-releases/*` | coding-releases.mjs | Release mgmt: `list`, `pending`, `approve`, `request(s)`, `readiness`, `quality-debt`, `baseline-candidates`, `test-run(s)`, `retrofit` (13 endpoints) |

### Coding Issues (F-014) — `routes/coding-issues.mjs`
| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/api/coding-issues` | Issue CRUD |
| GET | `/api/coding-issues/stats` | Issue stats |
| POST | `/api/coding-issues/import-known` | Import known issues |

### Release Unit Intelligence (F-018) — `routes/release-unit.mjs`
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/ru` · `/api/ru/overview` · `/api/ru/context` | RU list/overview/context |
| GET | `/api/ru/analyze` · `/api/ru/apis` · `/api/ru/architecture` · `/api/ru/features` | RU analysis views |
| GET | `/api/ru/code-intel` · `/api/ru/dependencies` · `/api/ru/metrics` | RU intelligence |
| GET | `/api/ru/cost` · `/api/ru/evidence` · `/api/ru/gates` · `/api/ru/qa` | RU quality views |
| GET | `/api/ru/ask` · POST `/api/ru/impact-analysis` | RU Q&A / impact |
| GET/POST/DELETE | `/api/ru/verify` | Verification runs |
| GET/POST/DELETE | `/api/ru/workspaces` · POST `/api/ru/clone` | RU workspaces |
| GET | `/api/ru/releases` · `/api/ru/runbooks` · `/api/ru/specs` · `/api/ru/tests` · `/api/ru/changes` | RU artifacts |

### Crews & Skills (F-031, F-032) — `routes/crew.mjs`, `routes/skill.mjs`, `routes/skills-api.mjs`
| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/api/crew/*` | Crew CRUD, agent editor (action-based) |
| POST | `/api/skill-test/run` | Skill test run |
| GET/POST | `/api/skills` | List/create skills |
| GET/PUT/DELETE | `/api/skills/{skillId}` | Skill by ID |
| GET/POST | `/api/paaw/skill-config` | Skill config |
| POST | `/api/skill-lab/build-files` · `/api/skill-builder/build-files` | Skill file generation |
| POST | `/api/paaw/skill-exec` | Execute skill directly |
| GET | `/api/system-prompts` | System prompt files (F-038) |

### Workflow Engine (F-034) — `routes/workflow.mjs`
| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/api/workflow/*` | Workflow CRUD & topological execution |
| GET | `/api/paaw/tools` | Tool listing |
| POST | `/api/paaw/tool-exec` | Tool execution |
| GET | `/api/paaw-root` | PAAW root path |

### Platform Apps (F-035, F-036, F-042, F-044, F-045, F-049, F-055)
| Method | Path | Route file | Description |
|--------|------|-----------|-------------|
| GET/POST/PUT/DELETE | `/api/notes/*` (notebooks, sections, notes, tags, search, ai-write, pin, upload-image...) | notes.mjs | Notes app (F-035, 24 endpoints) |
| GET | `/api/notes` (pocket) | pocket.mjs | Pocket notes (F-055) |
| POST | `/api/helpdesk/ask` · GET `knowledge` `models` `tickets` · PUT `tickets` | helpdesk.mjs | Help desk (F-036) |
| GET/PUT/POST | `/api/distill/*` (config, knowledge, logs, record, run, sources) | distill.mjs | Distillation (F-042) |
| POST | `/api/mindmap/generate` `from-text` `chat` `save` `preview` · GET `list` `get` | mindmap.mjs | Mind maps (F-044) |
| GET/POST | `/api/projects/*` | projects.mjs | Project board (F-045) |
| GET/POST | `/api/plugins` | plugins.mjs | Plugins (F-049) |
| GET/POST | `/api/agentic-bindings` | agentic-bindings.mjs | Agentic bindings (F-049) |
| POST | `/api/uploads` · `/api/uploads/text` | uploads.mjs | File uploads |

## Routing Implementation Patterns (for developers)

All route files export `async (req, res) => boolean`. The server iterates handlers until one returns `true`. Four matching patterns coexist:

```js
// Pattern A — negated string compare (most common)
if (cleanUrl !== "/api/coding-health") return false;

// Pattern B — positive compare + method check
if (req.method === "GET" && path === "/api/coding-doc/coverage") { ... }

// Pattern C — regex (path params)
const m = pathname.match(/^\/api\/coding-evidence\/task\/([^/?]+)$/);

// Pattern D — URL helper / startsWith
const urlObj = new URL(req.url, "http://localhost");
if (urlObj.pathname === "/api/coding-staged/changes") { ... }
if (path.startsWith("/api/mindmap/")) { ... }
```

**Adding an endpoint:** create/extend handler in `packages/server/src/routes/<name>.mjs` → return `true` when handled → register in server bootstrap → update this file + feature mapping (`project_edit feature_update_mapping`).

## Documentation Maintenance

- This file is a CU artifact tracked by `.paaw/cu-status.json` (`api-spec` step)
- Regenerate via Code Understanding pipeline or update manually after API changes
- Companion docs: `project/ARCHITECTURE.md` (system design), `specs/error-codes.md` (error mapping), `RU-API-TABLE.md` (release-unit view)

---
*Generated: 2026-10-02 (ISO week 40) · Endpoint count: ~250 method+path combinations across 52 route files · Source of truth: `packages/server/src/routes/`*
