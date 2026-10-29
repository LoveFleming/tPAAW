# Code Understanding — Generate Feature Map

You are a senior code analyst. Your job is to identify ALL features in this project and map each feature to its code files, API endpoints, tests, runbooks, and issues.

## What You Receive
- **Source Analysis (Tree-sitter)**: Structured per-file summary with exports, imports, functions, classes, routes, and React components
- Project scan results (file tree, modules)
- Architecture map (already generated)
- API contract (already generated)
- Error mapping + runbooks (already generated)
- package.json

## ⭐⭐⭐ USE THE SOURCE ANALYSIS — THIS IS YOUR PRIMARY SIGNAL ⭐⭐⭐

The **Source Analysis** section contains Tree-sitter parsed data for every source file. This is the MOST important input — it tells you:
- What each file **exports** (↑) — what it provides to other files
- What each file **imports** (↓) — what it depends on
- **Routes** (⚡) — HTTP endpoints defined in the file
- **React components** (⚛) — UI components defined in the file  
- **Functions** (ƒ) — top-level functions in the file
- **Classes** (⊕) — classes with their methods

**Use this data to:**
1. Identify features by what files export and import (dependency clusters = features)
2. Map routes to features (each route group = a feature)
3. Map React components to features (each UI page = a feature)
4. Understand file relationships (imports/exports show the dependency graph)

## CRITICAL: Be Comprehensive

You MUST identify ALL features in the project. A typical project has 15-50+ features.

**Do NOT merge multiple features into one.** Each distinct functional area is its own feature.

Follow this rule: **1 route file → at least 1 feature. 1 UI page/component → at least 1 feature. 1 major module → 1 feature.**

If the project has:
- 20 route files → expect ~20+ features (one per route, or one per functional group)
- 10 UI pages → expect ~10+ features
- 5 major modules → expect ~5+ features

**Common mistake:** Producing only 5-8 features for a project with 30+ routes. This is WRONG.

**Anti-patterns to avoid:**
- ❌ Grouping "all API routes" as one feature called "API"
- ❌ Grouping "all UI pages" as one feature called "Frontend"
- ❌ Grouping "all server logic" as one feature called "Backend"
- ❌ Omitting features because they seem "minor"

**Good patterns:**
- ✅ Each route file or route group = its own feature
- ✅ Each distinct UI page/panel = its own feature
- ✅ Each core module (auth, data, AI, real-time, etc.) = its own feature
- ✅ Cross-cutting concerns (logging, config, error handling) = separate features

## What to Produce

Output a JSON array of features. Each feature object MUST have this exact structure:

```json
[
  {
    "name": "Authentication",
    "description": "User login, registration, JWT token management",
    "status": "active",
    "codeFiles": ["src/auth/login.ts", "src/auth/token.ts"],
    "apis": [
      { "method": "POST", "path": "/api/login", "file": "src/routes/auth.mjs" },
      { "method": "POST", "path": "/api/register", "file": "src/routes/auth.mjs" }
    ],
    "tests": ["tests/auth.test.ts"],
    "runbooks": ["runbook/auth-recovery.md"],
    "tags": ["security", "core"]
  }
]
```

## Rules

1. **Identify features by analyzing:**
   - **Source Analysis data** — dependency clusters, route groups, component groups
   - Directory structure (e.g., `src/auth/` → Authentication feature)
   - Route files (e.g., `src/routes/auth.mjs` → Authentication)
   - API endpoints from the API contract — **each endpoint group = a feature**
   - UI pages/components — **each page = a feature**
   - Test files and what they test
   - Runbooks and what they cover
   - Core modules (data layer, config, utilities, shared code)

2. **Feature granularity:** Each feature should be a meaningful functional unit:
   - ✅ Good: "Authentication", "Issue Tracking", "Agent Loop", "Chat Interface", "Notes App", "File Browser", "Model Selector"
   - ❌ Bad: "login.ts", "API", "Backend", "Frontend", "Utils"

3. **Map code files:** List ALL source files that implement this feature (both server and client files)

4. **Map APIs:** List all HTTP endpoints that belong to this feature, with the file that defines them

5. **Map tests:** List test files that test this feature

6. **Map runbooks:** List runbook files that cover this feature (from error mapping step)

7. **Tags:** Add 1-3 tags per feature (e.g., "core", "security", "ui", "api", "data")

8. **Status:** Use "active" for features currently in use, "deprecated" for old ones, "planned" for stubs/TODOs

9. Output ONLY the JSON array, no markdown fences, no explanation

10. **JSON 硬規則（違反 = 整份被丟棄）：**
    - Key 一律是雙引號字串：`"tags"` ✅，`["tags"]` ❌ 絕對禁止括號包 key
    - 禁止尾逗號（trailing comma）：`"a",
  }` ❌
    - 只能用上方範例的欄位名，禁止發明新欄位（如 `tagsFinal`、`runbooksPlaceholder` ❌）
    - 沒資料就給空陣列 `[]`，不要給 null、不要省略欄位
    - 輸出會直接被程式 `JSON.parse`，任何語法錯誤都會導致結果作廢重來

## Systematic Approach

1. **First**, read the Source Analysis — identify dependency clusters and route groups
2. **Then**, scan ALL route files — each one (or each logical group) is a feature
3. **Then**, scan ALL UI pages/components — each major page is a feature
4. **Then**, scan ALL core modules — each is a feature
5. **Then**, scan API endpoints — ensure each endpoint is mapped to a feature
6. **Finally**, cross-check: is every source file accounted for in at least one feature?

## Example Output (comprehensive, not minimal)

```json
[
  {
    "name": "Agent Loop",
    "description": "Self-owned AI runtime with tool-calling loop for coding tasks",
    "status": "active",
    "codeFiles": ["packages/server/src/lib/paaw-agent-loop.mjs"],
    "apis": [],
    "tests": [],
    "runbooks": [],
    "tags": ["core", "ai"]
  },
  {
    "name": "Chat Interface",
    "description": "Main chat UI with SSE streaming, tool call display, and model selection",
    "status": "active",
    "codeFiles": ["packages/ui/src/pages/Chat.tsx", "packages/server/src/routes/chat.mjs"],
    "apis": [
      { "method": "POST", "path": "/api/chat", "file": "packages/server/src/routes/chat.mjs" }
    ],
    "tests": [],
    "runbooks": [],
    "tags": ["ui", "ai"]
  },
  {
    "name": "Issue Tracking",
    "description": "Lightweight issue tracking stored in .paaw/issues/ISSUES.json",
    "status": "active",
    "codeFiles": ["packages/server/src/routes/coding-issues.mjs", "packages/ui/src/components/IssueTracker.tsx"],
    "apis": [
      { "method": "GET", "path": "/api/coding-issues", "file": "packages/server/src/routes/coding-issues.mjs" },
      { "method": "POST", "path": "/api/coding-issues", "file": "packages/server/src/routes/coding-issues.mjs" }
    ],
    "tests": [],
    "runbooks": [],
    "tags": ["coding-ide", "tooling"]
  },
  {
    "name": "Notes App",
    "description": "Notebook and section-based note management with AI create",
    "status": "active",
    "codeFiles": ["packages/server/src/routes/notes.mjs", "packages/ui/src/pages/Notes.tsx"],
    "apis": [
      { "method": "GET", "path": "/api/notes", "file": "packages/server/src/routes/notes.mjs" }
    ],
    "tests": [],
    "runbooks": [],
    "tags": ["app", "productivity"]
  }
]
```
