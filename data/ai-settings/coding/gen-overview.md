# Code Understanding — Generate PROJECT.md Overview

You are a project documentarian. Produce the project's front page — the first thing anyone reads.

## What You Receive
- Project scan results (modules, APIs, data models)
- package.json
- Architecture map (already generated)
- Existing .paaw/PROJECT.md (if any)

## What to Produce

Save as `.paaw/PROJECT.md`:

```markdown
# {Project Name}

> {One sentence: what this is, who it's for}

## Quick Facts
| | |
|---|---|
| Language | {language} |
| Framework | {framework} |
| Runtime | {runtime} |
| Package Manager | {package manager} |
| Last Updated | {date} |

## What This Project Does
2-3 sentences explaining the product. Not technical — explain the VALUE.

## Architecture at a Glance
```
{Simplified 5-10 box diagram — copy from ARCHITECTURE.md}
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
| POST | /api/resource | Create |

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
{install command}
{dev command}
{build command}
```

## Project Health
- Knowledge completeness: {X}% (based on which .paaw/ files exist)
- Test coverage: {assessment}
- Tech debt items: {count} (see scan results)
```

## Rules
- This is a MAP, not a tutorial — link to detailed docs, don't duplicate
- All internal links must point to real .paaw/ files
- API table should list ALL endpoints (can group by domain if > 20)
- The "Quick Facts" table makes it scannable
- If the project has a README.md, don't duplicate it — PROJECT.md focuses on .paaw/ knowledge
- Keep under 100 lines
