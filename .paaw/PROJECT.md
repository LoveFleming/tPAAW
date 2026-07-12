# tPAAW

> An AI agent management platform with a coding IDE for feature mapping, issue tracking, and code health analysis — designed for developers working with AI agents to manage and evolve their codebase.

## Quick Facts
| | |
|---|---|
| Language | TypeScript |
| Framework | React/Next.js |
| Runtime | Node.js |
| Package Manager | npm |
| Last Updated | 2025-01-15 |

## What This Project Does

tPAAW provides a unified coding IDE where developers collaborate with AI agents to map features to source files, track issues, analyze code health, and manage multi-agent workflows. It includes a "Night Shift" mode where an Engineering Manager leads a 6-agent team for overnight work, and maintains all project knowledge in a version-controllable `.paaw/` directory.

## Architecture at a Glance

```
┌─────────────────────────────────────────────────────────────┐
│                    Browser (React/Next.js)                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │
│  │  Coding   │ │ Feature  │ │  Issue   │ │ Agent Memory │  │
│  │   IDE     │ │ Mapping  │ │ Tracker  │ │    Panel     │  │
│  └─────┬─────┘ └─────┬────┘ └────┬─────┘ └──────┬───────┘  │
└────────┼──────────────┼───────────┼──────────────┼──────────┘
         │              │           │              │
         ▼              ▼           ▼              ▼
┌─────────────────────────────────────────────────────────────┐
│                    API Server (Node.js)                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │
│  │  Routes  │ │  Tools   │ │  Skills  │ │ Agent Engine │  │
│  └─────┬────┘ └─────┬────┘ └─────┬────┘ └──────┬───────┘  │
└────────┼──────────────┼───────────┼──────────────┼──────────┘
         │              │           │              │
         ▼              ▼           ▼              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Data & Knowledge Layer                     │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────┐    │
│  │  .paaw/      │ │  Project     │ │  LLM API         │    │
│  │  Knowledge   │ │  Filesystem  │ │  (External)      │    │
│  └──────────────┘ └──────────────┘ └──────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

Full architecture: → `ARCHITECTURE.md`

## Key Entry Points
| Entry | Path | Description |
|-------|------|-------------|
| Main | `src/index.mjs` | Server bootstrap |
| API | `src/routes/` | HTTP endpoints |
| UI | `packages/ui/` | Frontend |

## API Summary
| Method | Path | Description |
|--------|------|-------------|
| POST | /api/v1/agents/crew/assign | Assign a task to an AI crew |
| GET | /api/v1/agents/crew/{crewId}/status | Get crew execution status |
| POST | /api/v1/agents/crew/{crewId}/cancel | Cancel a running crew |
| GET | /api/v1/agents/memory | Retrieve agent memory state |
| GET | /api/v1/features | Retrieve feature-to-file mapping |
| POST | /api/v1/features/sync | Manually refresh feature mapping |
| GET | /api/v1/issues | Retrieve tracked issues |
| POST | /api/v1/issues | Create a new issue |
| PATCH | /api/v1/issues/{issueId} | Update an existing issue |
| GET | /api/v1/code-health | Retrieve code health analysis |
| POST | /api/v1/code-health/run | Trigger code health analysis |
| GET | /api/v1/code-health/run/{runId} | Get analysis run status |

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
- Knowledge completeness: 33% (2 of 6 .paaw/ files exist: ARCHITECTURE.md, DECISIONS.md)
- Test coverage: Not yet assessed (no test files found)
- Tech debt items: 1 (source code not provided in file tree for analysis)