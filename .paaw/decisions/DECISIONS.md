# Decision Records

> Architecture Decision Records (ADR). Each record explains WHY a decision was made.

## ADR-001: File-based Knowledge Store (.paaw/ directory)

**Date:** project inception
**Status:** Accepted

### Context
The platform needs a persistent, version-controllable knowledge base that both humans and AI agents can read/write. Traditional databases would add operational complexity and create a dependency that conflicts with the goal of making the project self-contained and portable.

### Decision
Store all project knowledge (architecture, decisions, feature maps, issue tracking) as markdown and JSON files in a `.paaw/` directory at the project root. This directory serves as the canonical knowledge store.

### Consequences
- Positive: No database setup required; files are naturally version-controlled with git
- Positive: Both humans and AI agents can read/write using standard file operations
- Negative: No built-in query language; must parse files manually
- Neutral: Directory structure conventions must be strictly followed to remain machine-parseable

### Alternatives Considered
- SQLite database: Rejected because it adds a binary dependency and is harder to inspect/diff
- Cloud API: Rejected because it requires network access and external service setup

---

## ADR-002: Structured Agent Communication via .paaw/ API Tools

**Date:** d4c6caf (from git log)
**Status:** Accepted

### Context
AI agents were using raw `read_file` to access project knowledge, leading to inconsistent parsing and brittle behavior. Agents need a structured, predictable interface to read/write knowledge.

### Decision
Replace raw file access with structured `.paaw/` API tools. Agents use dedicated tools (e.g., `read_feature_map`, `write_decision`) that enforce schema and validation, rather than directly manipulating files.

### Consequences
- Positive: Agents produce consistent, valid knowledge entries
- Positive: Easier to add validation and error handling
- Negative: Additional abstraction layer to maintain
- Neutral: Tools must be documented for both human and AI consumption

### Alternatives Considered
- Continue with raw `read_file`: Rejected due to inconsistent agent output
- GraphQL endpoint: Overkill for file-based knowledge store

---

## ADR-003: Multi-Agent Crew Architecture with EM Lead

**Date:** 2bc67c8 (from git log)
**Status:** Accepted

### Context
Complex development tasks require coordinated work across multiple concerns (code understanding, feature mapping, testing, issue tracking). A single agent is insufficient for parallel work and specialized expertise.

### Decision
Implement a crew-based architecture where an Engineering Manager (EM) agent leads a team of specialized agents (up to 6). The EM delegates tasks, monitors progress, and synthesizes results. This is used in "Night Shift" mode for overnight autonomous work.

### Consequences
- Positive: Parallel execution of specialized tasks
- Positive: EM provides oversight and quality control
- Negative: Increased LLM token usage and latency
- Neutral: Requires careful prompt engineering for role definitions

### Alternatives Considered
- Single monolithic agent: Rejected due to context window limits and lack of specialization
- Fully autonomous swarm: Rejected due to coordination complexity

---

## ADR-004: Feature-Centric Code Understanding

**Date:** 1fd0e0e (from git log)
**Status:** Accepted

### Context
Traditional code understanding tools focus on files and modules, but developers think in terms of features. The platform needs to map code to features to make agent reasoning more aligned with human mental models.

### Decision
Implement a feature-centric code understanding system that:
1. Automatically generates a Feature Map as step 10 of code understanding
2. Injects the Feature Map summary into every agent's system prompt
3. Maintains bidirectional Feature↔File mapping (both agent and UI can update)

### Consequences
- Positive: Agents reason in feature terms, producing more relevant results
- Positive: Feature Map stays current through automatic maintenance
- Negative: Additional processing step in code understanding pipeline
- Neutral: Requires careful naming conventions for features

### Alternatives Considered
- File-centric understanding: Rejected because it doesn't align with developer mental models
- Manual feature mapping: Rejected because it becomes stale quickly

---

## ADR-005: Lightweight Issue Tracking Embedded in IDE

**Date:** 5035343 (from git log)
**Status:** Accepted

### Context
Developers need to track issues without leaving the coding environment. External issue trackers (Jira, GitHub Issues) create context-switching overhead and require network access.

### Decision
Build a lightweight issue tracking system directly into the Coding IDE panel. Issues are stored as structured data in the `.paaw/` knowledge store, with a dedicated UI panel for viewing and managing them.

### Consequences
- Positive: No context switching; issues are visible alongside code
- Positive: Issues are version-controlled and portable
- Negative: Limited features compared to dedicated trackers (no advanced filtering, no email notifications)
- Neutral: Must integrate with agent system so agents can create/update issues

### Alternatives Considered
- GitHub Issues API integration: Rejected because it requires network and authentication
- Jira integration: Rejected due to complexity and external dependency

---

## ADR-006: Code Health with Real Test Execution

**Date:** dd1825d (from git log)
**Status:** Accepted

### Context
Static analysis alone cannot determine code health. The platform needs to actually run unit tests and E2E tests to measure coverage and detect regressions.

### Decision
Implement Code Health analysis that executes real unit tests and E2E tests, reporting actual coverage metrics and test results. This goes beyond linting and static analysis.

### Consequences
- Positive: Accurate, actionable health metrics
- Positive: Can detect regressions automatically
- Negative: Requires test infrastructure and longer execution time
- Neutral: Test results are stored in `.paaw/` for historical tracking

### Alternatives Considered
- Static analysis only: Rejected because it misses runtime issues
- Coverage estimation: Rejected because it's inaccurate

---

## ADR-007: IME Guard and fileURLToPath Conventions

**Date:** project inception (inferred from code patterns)
**Status:** Accepted

### Context
The platform must handle internationalized input (IME composition) correctly and work reliably across different environments (Node.js, bundlers). Without guards, IME input can cause partial state updates, and `__dirname` is unavailable in ES modules.

### Decision
- Use `fileURLToPath` and `path.dirname` instead of `__dirname` for ES module compatibility
- Implement IME composition guards on text inputs to prevent partial character submission

### Consequences
- Positive: Correct handling of CJK and other IME input
- Positive: Works in both CommonJS and ES module contexts
- Negative: Slightly more verbose code for path resolution
- Neutral: Must be consistently applied across all input handlers

### Alternatives Considered
- `__dirname` with CommonJS: Rejected because project uses ES modules
- No IME guard: Rejected because it causes data corruption with CJK input

---

## ADR-008: Agent Memory Panel with Crew Visualization

**Date:** 7565038 (from git log)
**Status:** Accepted

### Context
When multiple agents work together, developers need visibility into what each agent is doing, their memory state, and their relationships. Without this, the crew is a black box.

### Decision
Build an Agent Memory panel that shows:
- All crew agents with avatars and names
- Each agent's current task and memory state
- Communication flow between agents

### Consequences
- Positive: Developers can monitor and debug agent behavior
- Positive: Builds trust in autonomous agent operations
- Negative: UI complexity increases with panel count
- Neutral: Memory data is stored in `.paaw/` for persistence

### Alternatives Considered
- Log-only monitoring: Rejected because it's not real-time or visual
- No monitoring: Rejected because it's a black box

---

## ADR-009: Write File Path Restriction (and Subsequent Relaxation)

**Date:** 6c0adb3 (from git log)
**Status:** Superseded by ADR-009b

### Context
AI agents writing to arbitrary file paths could accidentally overwrite critical system files or the `.paaw/` knowledge store itself. Initial implementation restricted writes to a safe subset of paths.

### Decision
Initially restrict AI agent `write_file` to only allow writes within the project's source directories, excluding `.paaw/` and system files.

### Consequences
- Positive: Prevents accidental corruption of knowledge store
- Negative: Agents couldn't write to project codebase when needed (e.g., creating new source files)
- Neutral: Required a fix (ffdc794) to relax the restriction

### Alternatives Considered
- No restriction: Rejected as too dangerous
- Full sandboxing: Too complex for initial implementation

---

## ADR-009b: Relaxed Write File Path Restriction

**Date:** 6c0adb3 (from git log)
**Status:** Accepted (supersedes ADR-009)

### Context
The initial path restriction was too strict — AI agents couldn't write new source files to the project codebase, which is a core requirement for autonomous development.

### Decision
Relax the `write_file` path restriction to allow writes to the entire project codebase, while maintaining protections for system files outside the project root.

### Consequences
- Positive: Agents can now create and modify source files as needed
- Positive: Enables autonomous feature implementation
- Negative: Increased risk of accidental overwrites within the project
- Neutral: Requires careful prompt engineering to prevent misuse

### Alternatives Considered
- Whitelist approach: Too maintenance-heavy as the codebase grows
- Human approval for every write: Too slow for autonomous operation

## ADR-010: LLM API Logging to File-based JSONL Store
- **日期**: 2026-07-16
- **狀態**: Proposed
- **背景**: LLM observability was previously non-existent — developers had no visibility into which models were being called, how many tokens were consumed, or where errors occurred. Without this, debugging AI agent behavior was nearly impossible (you couldn't tell if a failure was due to an LLM error, a tool error, or a prompt issue). The logging system needed to be lightweight (no external dependencies), file-based (consistent with ADR-001), and have minimal runtime overhead (never fail an LLM call for a logging error).
- **決定**: All LLM API calls (both streaming and non-streaming) are now logged to `data/llm-logs/{date}.jsonl` as structured JSON entries. Each log entry captures: request phase (model, message count, tool names, caller), response phase (duration, finish reason, content length, usage, error), and a shared call ID for pairing. A dedicated API route (`GET /api/llm-logs`, `GET /api/llm-logs/stats`, `DELETE /api/llm-logs`) provides querying, aggregation by model/agent, and cleanup.
- **後果**: Positive: Full observability into LLM usage — developers can see which agents use which models, token consumption, error rates, and latency. The data is useful for cost tracking and prompt optimization. Positive: `_writeLlmLog` is centralized in `llm-utils.mjs` and used by both `callLLMWithRetry` and streaming paths, ensuring consistent logging. Positive: File-based storage is consistent with ADR-001 — no external dependencies. Negative: JSONL files grow unboundedly; cleanup is manual or via the DELETE API. Could be addressed with a future retention policy. Neutral: The log writer silently catches errors — never breaks an LLM call.

## ADR-011: Startup Import Validation Check
- **日期**: 2026-07-16
- **狀態**: Proposed
- **背景**: The project uses dynamic imports extensively (e.g., `await import(...)` in route handlers). This means a missing export or renamed function is only caught at runtime when the endpoint is actually hit, not at startup. This led to bugs like `trimMessagesToFit` not being exported (commit 268107a) — the syntax was valid but the import failed at runtime. The team needed a way to catch these errors before users encounter them.
- **決定**: A new `import-check.mjs` module validates all critical imports at server startup. It loads each module dynamically, checks that expected exports exist and are not undefined, and prints a report. It also checks dynamic imports used in route files (e.g., coding.mjs imports from semgrep-runner.mjs). The check is non-fatal by default (prints warnings) but can be run with `--strict` to exit with a non-zero code.
- **後果**: Positive: Catches missing exports, wrong function names, and broken imports at server startup — before any user request hits the endpoint. Positive: The `--strict` mode can be used in CI/CD pipelines to prevent deployment of broken imports. Positive: Also checks dynamic imports (the ones most likely to fail silently). Neutral: Adds ~100ms to startup time. Not a concern for development. Neutral: The check is non-fatal by default — startup continues even if imports fail (warnings only).

## ADR-012: Context Injection into AI Agent Chat Prompts
- **日期**: 2026-07-16
- **狀態**: Proposed
- **背景**: AI agents were operating with limited context — they knew about the project structure but had no understanding of features, code relationships, or security issues. The Feature Map, Code Intelligence, and Security Scan results were generated by the Code Understanding pipeline but were not being injected into agent prompts. Agents had to discover these things themselves through tools, wasting time and tokens. The A2A agent loop already had similar injection; the coding chat needed to be aligned.
- **決定**: The coding AI chat (`POST /api/coding-crew/chat`) now injects three sources of project intelligence into the agent's system prompt: (1) Feature Map — from `.paaw/features/FEATURES.json`, including file→feature reverse index, (2) Code Intelligence — from `.paaw/code-intelligence/code-intelligence.json`, showing file exports and imports, (3) Security Scan — from `.paaw/security/scan-results.json`, showing last scan findings summary. This is in addition to the existing Action Log and Agent Memory injection. The context is built by reading generated `.paaw/` files, not by re-running analysis.
- **後果**: Positive: AI agents now have immediate awareness of features, code structure, and security issues — no need to discover these through tool calls. Positive: Alignment between coding.mjs and a2a.mjs — both use the same context injection logic. Positive: The injection is lightweight (reads pre-generated JSON files, no re-analysis). Negative: System prompt size increases significantly — could push agents closer to context window limits. Mitigated by trimMessagesToFit (262K budget). Negative: If the .paaw/ files are stale, the injected context is misleading. Mitigated by auto-refresh on code changes.

## ADR-013: Semgrep Runner — Temp Script File + JSON Output File Architecture
- **日期**: 2026-07-16
- **狀態**: Proposed
- **背景**: The semgrep runner had persistent cross-platform issues. On Windows, cmd.exe truncates long commands, interprets newlines differently, and has double-quote escaping issues (commit b0aa2b9). The `--json` output via stdout was unreliable on Windows due to encoding issues. The `python -m semgrep` fallback added complexity and was removed (commit 478c5b5). Binary detection previously used exec which was slow and fragile. The team needed a robust solution that works on all three platforms.
- **決定**: The semgrep runner now uses a two-file strategy for cross-platform reliability: (1) The full scan command is written to a temp script file (`.bat` on Windows, `.sh` on macOS/Linux) and executed via `cmd /c` or `sh`. (2) JSON output is written to a temp file (via `--json-output`) instead of parsed from stdout. The script file avoids cmd.exe command-line length limits and newline handling issues on Windows. The JSON output file avoids stdout encoding/truncation issues. Both temp files are cleaned up after execution. Additionally, binary detection is now a pure filesystem scan (no exec) with a fast path via `SEMGREP_PATH` env var, and Windows PATH is augmented by reading the registry `HKCU\Environment\Path` key.
- **後果**: Positive: Reliable semgrep execution on all three platforms (Windows, macOS, Linux). No more cmd.exe truncation or encoding issues. Positive: Binary detection is fast (pure fs, no exec except for version verification). Positive: SEMGREP_PATH env var provides a zero-exec fast path for power users. Positive: Registry PATH augmentation ensures semgrep.exe is found even if PATH is incomplete. Negative: Temp file management adds complexity (must clean up on success and error). Negative: Temp script files could be a security concern if the project is running in a shared environment (the command is written to disk). Mitigated by using the system temp directory with random UUID filenames.

## ADR-014: Pre-edit Dependency Context Injection for AI Agent Loop
- **日期**: 2026-07-18
- **狀態**: Proposed
- **背景**: AI agents modifying files in the agent loop need awareness of which files depend on the file being changed, which functions call its exports, and which tests cover it — to prevent "改東壞西" (fix one thing, break another). Previously, agents had no structured way to discover these relationships before making edits; they relied on manually running grep or reading Code Intelligence output. A new module `dependency-context.mjs` was introduced to answer this by loading pre-computed Code Intelligence JSON files (.paaw/code-intelligence/) and injecting dependency context into the write_file/edit_file tool responses.
- **決定**: Adopt the Pre-edit Dependency Context Injection pattern where: (1) Before every write_file or edit_file, getDependencyContext() is called to load CI data and format it as a human-readable string; (2) The context string is appended to the tool result, making it visible to the LLM in the same turn; (3) After the agent loop completes (both regular and stream mode), getAffectedTests() auto-runs the relevant test suite. This pattern is implemented consistently in both paaw-agent-loop.mjs and tool-engine/index.mjs. The output format includes four sections: importedBy (who depends on this file), callersOf (who calls functions in this file), imports (what this file depends on), and test files.
- **後果**: Positive: LLM can make informed decisions about impact before modifying code; post-edit test auto-run reduces regression risk; dual integration (agent-loop + tool-engine) ensures coverage regardless of execution path. Negative: Performance concern — getDependencyContext re-reads and re-parses 4 JSON files from disk on every call (no cache); impact information is appended as text after the write result, which can make the tool response very long. Neutral: Requires Code Intelligence data to exist in .paaw/code-intelligence/ — if data doesn't exist, the module gracefully returns empty string (but doesn't auto-trigger CI build). Corrective: Three issues identified as tech debt — (1) brittle path normalization violating cross-platform standards, (2) missing cache layer causing repeated I/O, (3) dead code in getImpactSummary (unused) and convention-based test detection in getAffectedTests (logic never reaches return).

## ADR-015: L3 Deterministic Validation Layer for AI-Generated Feature Maps
- **日期**: 2026-07-18
- **狀態**: Proposed
- **背景**: AI agents generate feature-to-file mappings by analyzing the codebase with LLMs. LLMs can hallucinate — referencing files that don't exist, missing files, or fabricating API endpoints. Without validation, these errors silently propagate into the feature map and mislead all downstream agents (Night Shift, EM, code understanding).

A new module `feature-map-validator.mjs` was introduced that performs deterministic (zero-AI) validation:
1. **Mapping validation**: every codeFile/API/test referenced in FEATURES.json must exist on disk
2. **Coverage check**: find orphan source files not mapped to any feature
3. **Understanding validation**: check AI-generated text for hallucinated filenames and functions

This runs as Phase 0 in both Night Shift and EM sessions, after AI refresh but before work dispatch.
- **決定**: Adopt a "Layer 3" validation pattern: AI generates output (Layer 1), AI self-corrects (Layer 2, future), and deterministic code validates against ground truth (Layer 3). The validation layer uses filesystem scanning and regex extraction — no LLM calls — so it's fast, reliable, and immune to AI hallucination.

The validator module (`feature-map-validator.mjs`) exports:
- `scanAllSourceFiles()` — walk the project tree deterministically
- `extractApiRoutes()` — regex-scan route files for HTTP method + path patterns
- `validateFeatureMapping()` — cross-check FEATURES.json against disk
- `checkCoverage()` — find unmapped files
- `validateUnderstanding()` — detect hallucinated references in AI text
- `runFullValidation()` — combined report
- **後果**: - Positive: AI hallucinations in feature maps are caught before they propagate
- Positive: Coverage gaps are quantified (orphan files, features without tests/understanding)
- Positive: Fully deterministic, no additional LLM cost
- Negative: Regex-based API extraction may miss dynamic routes (mitigated with wildcard matching)
- Negative: File-existence checks don't verify semantic correctness, only physical presence
- Neutral: Validation runs on every EM/Night Shift Phase 0, adding ~1-2 seconds

## ADR-016: Untitled Decision
- **日期**: 2026-07-18
- **狀態**: Proposed
- **背景**: The Night Shift and EM orchestration systems need to plan and execute multi-agent tasks. Pure-LLM approaches (planning + execution by LLM) are expensive and non-deterministic. Pure-deterministic approaches can't understand semantic context (what work needs doing).

The codebase now uses a hybrid pattern in two places:
1. **overnight-manager.mjs (EM session)**: Phase 1 deterministic context gathering (git status, diff, action log, .paaw/ files) → Phase 2 LLM planning (reads summary, outputs JSON work list) → Phase 3 deterministic execution (A2A message/send to each agent) → Phase 4 deterministic reporting
2. **coding-night-shift.mjs**: Phase 0 feature map refresh (LLM) + L3 validation (deterministic) → parallel agent dispatch (deterministic) → report generation (deterministic)

The key principle: **deterministic code handles collection and execution; LLM only does planning/understanding.** This is stated in the overnight-manager comment: "收集和執行用決定性程式，規劃用 LLM prompt".
- **決定**: Adopt the Hybrid Deterministic+LLM Orchestration pattern as the standard for all multi-agent workflow systems. The pattern has strict phase boundaries:
- **Deterministic phases** (collection, execution, reporting): shell commands, file reads, JSON parsing, A2A dispatch — reproducible, debuggable, zero LLM cost
- **LLM phases** (planning, understanding): single LLM call with structured JSON output — handles ambiguity, prioritization, semantic understanding
- **Boundary contract**: LLM output is always validated by a deterministic layer before use (e.g., JSON parse + L3 validation)

This is the "opposite of fully-autonomous" — agents execute specific tasks, not open-ended exploration.
- **後果**: - Positive: Deterministic phases are debuggable and reproducible
- Positive: LLM cost is minimized — typically 1 planning call + N agent calls
- Positive: Deterministic collection ensures the LLM always has accurate context
- Negative: Phase boundaries add some latency (sequential phases)
- Negative: LLM JSON output parsing can fail (mitigated by recovery logic + L3 validation)
- Neutral: This pattern is now used in both overnight-manager.mjs and coding-night-shift.mjs — there is some code duplication in the Phase 0 feature map refresh logic (see tech debt ISS-002)

## ADR-017: Untitled Decision
- **日期**: 2026-07-18
- **狀態**: Proposed
- **背景**: Feature discovery (finding new features from unmapped source files) was previously a manual process — developers had to run Code Understanding and hope the AI grouped files well. The new `/api/coding-features/discover` endpoint automates this:

1. Run L3 coverage check to find "orphan" files (source files not mapped to any feature)
2. Send orphan list + existing feature names to LLM → LLM groups files into coherent new features
3. Validate LLM output: every file in each new feature must exist on disk (L3 check)
4. Create features with validated file lists

This closes the loop: refresh-mapping updates existing features, discover creates new features from the unmapped remainder. Together they drive coverage toward 100%.
- **決定**: Adopt the AI-Driven Feature Discovery pattern with mandatory L3 pre-write validation. The discover endpoint:
- Uses `checkCoverage()` from feature-map-validator.mjs to find orphans deterministically
- Sends orphans to LLM for semantic grouping into features
- **Validates every file in LLM output against disk before writing** to FEATURES.json — invalid files are silently filtered out

This ensures AI can never create a feature with hallucinated file paths.
- **後果**: - Positive: Feature map coverage improves automatically; no manual intervention needed
- Positive: Hallucinated file paths are filtered before persistence
- Negative: If LLM omits files from its grouping, those files remain as orphans (idempotent — can re-run)
- Neutral: Discovery is a separate call from refresh-mapping — together they form a two-step "update + discover" workflow

## ADR-018: Night Shift 三模組職責邊界與分層策略
- **日期**: 2026-07-19
- **狀態**: Proposed
- **背景**: Night Shift 統一重構將原本散落的邏輯拆分為三個模組：overnight-manager.mjs（引擎層）、night-shift-shared.mjs（共用工具層）、coding-night-shift.mjs（route 層）。需要記錄此分層決策的設計原理，以及審查中發現的 4 項技術債（反向依賴、legacy bypass、重複邏輯、路徑計算違規）。
- **決定**: 採用三層分離架構：

1. **Route 層**（coding-night-shift.mjs）— 只負責 HTTP 處理、status 管理、SSE relay。不包含業務邏輯。
2. **Engine 層**（overnight-manager.mjs）— 排程與執行引擎。EM 模式用 LLM 規劃 + A2A 調度；Parallel 模式用 Promise.allSettled 平行執行。可包含報告生成（因報告格式與模式強耦合）。
3. **Shared 層**（night-shift-shared.mjs）— 純共用工具，無副作用依賴。context 收集、feature map 刷新、驗證、報告存取。

依賴方向必須單向：Route → Engine → Shared。Engine 不可 import Route 層。

主要消費者：
- coding-night-shift.mjs（統一入口）
- coding-reports.mjs（報告 API，只依賴 Shared 層）
- coding.mjs（legacy，應 deprecate）

無循環依賴 — 三模組之間依賴方向嚴格單向。
- **後果**: 正面：
- 職責分離清晰，route/engine/shared 三層各司其職
- 共用邏輯集中（gatherContext、saveNightShiftReport 不再兩邊複製）
- coding-reports.mjs 可單獨依賴 Shared 層而不觸碰 Engine
- 無循環依賴，依賴圖是 DAG

負面（技術債，需後續處理）：
- Engine→Route 反向依賴（getPromptsFile），打破分層原則
- coding.mjs legacy route 繞過統一入口，缺少 status/timeout 保護
- callWithFallback 在兩處重複，維護時容易不同步
- Parallel 模組手動計算 PAAW_ROOT 違反跨平台 coding standard

待改進項目（建議優先序）：
1. P1: getPromptsFile 下沉到 lib 層
2. P2: deprecate /api/coding-crew/em-run，統一入口
3. P3: 抽取 callWithFallback 到 llm-utils.mjs
4. P4: Parallel 模組改用 shared.mjs 的 PAAW_ROOT

## ADR-019: Shared Tool Registry (OCP-compliant)
- **日期**: 2026-07-19
- **狀態**: Proposed
- **背景**: Two independent agent loops (Loop A: paaw-agent-loop.mjs with PAAW_TOOLS + executeTool; Loop B: tools/index.mjs with ToolEngine) each maintained their own tool definitions and handlers. Adding a new tool required changes in multiple places, and the two loops had inconsistent tool sets. This violated the Open-Closed Principle: the agent loop code (closed for modification) had to change every time a new tool (open for extension) was added.
- **決定**: Introduce a shared tool registry (tool-registry.mjs) that acts as the single source of truth for tool definitions and handlers. All agent loops read tool definitions via toolRegistry.getDefinitions() and execute via toolRegistry.execute(). New tools are registered once and automatically available to all loops. An adapter layer (tool-registry-init.mjs) bridges existing Loop A (paaw-agent-loop) and Loop B (ToolEngine) tools into the registry during a phased migration (Phase 1: adapter, Phase 2: Loop A reads from registry, Phase 3: Loop B injects via injectRegistryTools).
- **後果**: Positive: New tools need only one registration point; all loops benefit automatically. Aligns with OCP. Reduces duplication of tool definitions. Enables future capability: tools can be dynamically registered by plugins/skills at runtime.
Negative: Two concepts share the name "ToolRegistry" — the shared lib/tool-registry.mjs (Map-based) and lib/tool-engine/tool-registry.mjs (class-based), which can cause confusion. The adapter layer adds indirection. initLoopBTools() and initAllTools() in tool-registry-init.mjs are currently dead code (not wired into startup).
Neutral: Migration is phased — Loop A uses a fallback pattern (registry if initialized, else direct executeTool), and Loop B uses injectRegistryTools to merge registry tools into ToolEngine.

## ADR-020: Constrained Shell Execution for AI Agents (project_run_command)
- **日期**: 2026-07-19
- **狀態**: Proposed
- **背景**: Crew agents (developer, tester, QA) need to run build/test/lint commands to verify their code changes. A raw unrestricted bash tool would allow arbitrary command execution including destructive operations (rm, git push, curl exfiltration). The platform needs a middle ground: agents can run build/test commands but cannot escape the project sandbox or cause damage.
- **決定**: Provide project_run_command as a whitelisted shell execution tool for crew agents (instead of raw bash). The tool enforces: (1) command-prefix whitelist (npm, npx, yarn, pnpm, node, tsc, mvn, gradle, python, cargo, go, make, dotnet), (2) dangerous pattern blocking (rm, del, git push/reset/rebase, sudo, curl, wget, dd, mkfs, and shell metacharacters >, |, ;, &&, ||), (3) max 300s timeout, (4) output truncation at 8000 chars to prevent context overflow.
- **後果**: Positive: Agents can self-verify (run tests, check builds) without human intervention. Defense-in-depth: even if an agent is prompted maliciously, the whitelist prevents most destructive actions. Output truncation prevents context window exhaustion.
Negative: Whitelist is imperfect — node and python can execute arbitrary code via -e flag (e.g., node -e "require('fs').unlinkSync(...)"). The blacklist of metacharacters blocks legitimate piping (e.g., npm test | head). Whitelist requires maintenance as new build tools emerge.
Neutral: The PAAW Agent (developer-facing tool) retains unrestricted bash for interactive use. Crew agents get the constrained version.
