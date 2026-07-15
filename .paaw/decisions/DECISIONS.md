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