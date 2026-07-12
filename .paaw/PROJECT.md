```markdown
# PAAW

> Internal web application for engineering managers to dispatch and monitor AI agent crews, review code health, and browse historical conversations.

## Quick Facts
| | |
|---|---|
| Language | TypeScript |
| Framework | React |
| Runtime | Node.js / browser |
| Package Manager | npm |
| Last Updated | 2025-03-25 |

## What This Project Does
PAAW lets engineering managers assign tasks (code analysis, handover checks) to AI agent crews, view results in real time, and revisit past agent conversations. It runs locally, uses the filesystem for storage, and talks to LLM APIs for agent reasoning.

## Architecture at a Glance
```
Browser (React) ──HTTP──→ Express API Server ──→ Business Logic (lib/)
                              │                      ├── AgentLoop
                              │                      ├── ToolExecutor
                              │                      └── CrewConfig
                              │
                              ▼
                         File System (.paaw/, temp/)
                         LLM API (OpenAI)
```
Full architecture: → `ARCHITECTURE.md`

## Key Entry Points
| Entry | Path | Description |
|-------|------|-------------|
| Main | `packages/server/src/index.mjs` | Server bootstrap |
| API | `packages/server/src/routes/` | HTTP endpoints (handover, code-health, chat) |
| UI | `packages/ui/src/` | React frontend |

## API Summary
| Method | Path | Description |
|--------|------|-------------|
| (to be documented) | /api/... | See API contract |

Full contract: → `specs/api-contract.md`

## Knowledge Base Index
| Document | Path | What's Inside |
|----------|------|---------------|
| 🏗️ Architecture | `ARCHITECTURE.md` | Module graph, data flow, design decisions |
| 📋 API Contract | `specs/api-contract.md` | All endpoints with schemas |
| 🐛 Error Map | `specs/error-codes.md` | Error codes + runbooks |
| 🧪 Test Payloads | `test-payloads/` | JSON test cases per endpoint |
| 📏 Standards | `standards/coding-style.md` | Coding conventions |
| 🏛️ Decisions | `DECISIONS.md` | ADR — why things are the way they are |

## Quick Start
```bash
npm install
npm run dev
npm run build
```

## Project Health
- Knowledge completeness: **66%** (4 of 6 .paaw/ files exist)
- Test coverage: **not measured** (no test files detected)
- Tech debt items: **3** (source visibility, temp clutter, missing directories)
```