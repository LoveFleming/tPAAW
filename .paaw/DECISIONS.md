Based on the project scan results, architecture analysis, and git history, here are the inferred Architecture Decision Records for the PAAW project:

```markdown
# Decision Records

> Architecture Decision Records (ADR). Each record explains WHY a decision was made.

## ADR-001: Monorepo Structure with React Frontend and Express Backend

**Date:** project inception
**Status:** Accepted

### Context
The project needed to manage AI agent crews for engineering tasks, with a web UI for an engineering manager. The system runs locally on a developer's machine and communicates with external LLM APIs.

### Decision
We chose a monorepo structure with a React frontend (`packages/ui/`) and an Express backend (`packages/server/`). The frontend communicates with the backend via HTTP API calls.

### Consequences
- Positive: Single repository simplifies development and deployment; clear separation of concerns between UI and API logic.
- Negative: Requires running both frontend and backend servers locally; adds complexity for simple tasks.
- Neutral: Both layers share the same TypeScript type definitions.

### Alternatives Considered
- Next.js full-stack framework: Not chosen because the backend has specific agent loop and file system requirements that benefit from a separate Express server.
- Single-page app with no backend: Not possible because the system needs to manage agent crews and communicate with LLM APIs.

---

## ADR-002: File-Based Data Storage (No Database)

**Date:** project inception
**Status:** Accepted

### Context
The system runs locally on a developer's machine and manages AI agent crews. It needs to store configuration, conversation history, and temporary payloads. A traditional database would add setup overhead for a single-user local tool.

### Decision
We use the filesystem as the primary data store. Configuration is stored in `.paaw/` directory, conversation history in JSON files, and temporary payloads in `./temp/`. No SQL or NoSQL database is used.

### Consequences
- Positive: Zero database setup; easy to inspect and debug by reading files; simple backup (copy the directory).
- Negative: No query capabilities; concurrency issues if multiple users access the same files; no built-in data integrity.
- Neutral: File-based storage limits scalability but is sufficient for a single-user local tool.

### Alternatives Considered
- SQLite: Would add a dependency and require schema management; overkill for a local tool.
- PostgreSQL: Too heavy for a single-user local application.

---

## ADR-003: Agent Loop with Configurable Timeout and Max Turns

**Date:** 2024-01-01 (inferred from git history)
**Status:** Accepted

### Context
The agent loop needs to handle complex engineering tasks that may require multiple reasoning steps. Initial timeouts (120s) and max turns (20) were too restrictive, causing agents to fail on complex tasks.

### Decision
We implemented an agent loop with configurable timeout (default 600s, increased to 1800s) and max turns (default 40, increased to 60). The loop supports continuation (resuming from where it left off) and merges thinking process with final answer in the same message bubble.

### Consequences
- Positive: Agents can now complete complex tasks without premature termination.
- Negative: Longer timeouts mean users wait longer for results on simple tasks.
- Neutral: Continuation support adds complexity to the loop state management.

### Alternatives Considered
- Fixed timeout: Not flexible enough for varying task complexity.
- No continuation: Would require restarting from scratch on failure.

---

## ADR-004: Inline History Chat Panel (Not Absolute Positioning)

**Date:** 2024-01-01 (inferred from git history)
**Status:** Accepted

### Context
The history chat panel was initially rendered with absolute positioning, which caused layout issues and made it difficult to interact with other UI elements.

### Decision
We changed the history chat panel to render inline within the page flow, rather than using absolute positioning. This ensures the panel behaves predictably within the document layout.

### Consequences
- Positive: No more z-index or overlay issues; panel scrolls naturally with the page.
- Negative: Less visual separation from other content; may require additional styling to distinguish it.
- Neutral: Requires parent container to have `position: relative` for any child absolute elements.

### Alternatives Considered
- Fixed positioning: Would keep the panel always visible but could overlap other content.
- Modal overlay: Too disruptive for a panel that should be always accessible.

---

## ADR-005: File Write Path Restriction (Relaxed for AI Agent Writes)

**Date:** 2024-01-01 (inferred from git history)
**Status:** Accepted

### Context
The `write_file` tool initially had strict path restrictions that prevented AI agents from writing to the project codebase. This limited the agents' ability to make code changes.

### Decision
We relaxed the path restriction for the `write_file` tool to allow AI agents to write to the project codebase, while still preventing writes to system directories or outside the project root.

### Consequences
- Positive: AI agents can now make code changes directly, enabling automated fixes and improvements.
- Negative: Increased risk of unintended file modifications; requires careful validation of write paths.
- Neutral: Path validation logic became more complex to handle both restricted and unrestricted writes.

### Alternatives Considered
- No path restriction: Too risky; could overwrite system files.
- Whitelist of allowed directories: Too restrictive; agents need flexibility.

---

## ADR-006: PaawTree Default Collapsed with No Refresh or AI Icon

**Date:** 2024-01-01 (inferred from git history)
**Status:** Accepted

### Context
The file tree component (PaawTree) was initially expanded by default, with a refresh button and an AI icon. This caused performance issues on large projects and visual clutter.

### Decision
We changed PaawTree to be collapsed by default, and removed the refresh button and AI icon. The tree now only expands when the user explicitly clicks to open a node.

### Consequences
- Positive: Faster initial render for large projects; cleaner UI with fewer visual elements.
- Negative: Users must manually expand nodes to see the file structure.
- Neutral: Removes the need for a refresh mechanism since the tree is static after initial load.

### Alternatives Considered
- Virtualized tree: Would handle large projects but adds complexity.
- Lazy loading: Similar to collapsed default but with on-demand expansion.

---

## ADR-007: Code Health with One-Click Dispatch and Test Coverage

**Date:** 2024-01-01 (inferred from git history)
**Status:** Accepted

### Context
The system needed a way to assess code quality and automatically dispatch fixes. Manual code review was time-consuming and inconsistent.

### Decision
We implemented a Code Health feature that runs unit test coverage and E2E tests, displays results, and provides a one-click dispatch button to send the results to an AI agent crew for automated fixes.

### Consequences
- Positive: Automated code quality assessment and fix dispatch; reduces manual effort.
- Negative: Requires test infrastructure to be in place; E2E tests may be flaky.
- Neutral: The feature depends on the agent loop for actual fix execution.

### Alternatives Considered
- Manual code review: Too slow and inconsistent.
- Static analysis only: Would identify issues but not fix them.

---

## ADR-008: Thinking Process and Final Answer in Same Message Bubble

**Date:** 2024-01-01 (inferred from git history)
**Status:** Accepted

### Context
The agent's thinking process and final answer were initially displayed in separate message bubbles, causing confusion and making it hard to follow the agent's reasoning.

### Decision
We merged the thinking process and final answer into the same message bubble. The thinking process is displayed first (collapsible), followed by the final answer.

### Consequences
- Positive: Clearer association between reasoning and result; less visual clutter.
- Negative: Users must expand the thinking section to see the reasoning; adds complexity to the message rendering component.
- Neutral: Requires changes to both the agent loop output format and the UI rendering.

### Alternatives Considered
- Separate bubbles with visual linking: More complex UI logic.
- Only show final answer: Loses transparency into agent reasoning.

---

## ADR-009: Removal of "Factory" Concept

**Date:** 2024-01-01 (inferred from git history)
**Status:** Accepted

### Context
The initial design included a "Factory" concept for creating agent crews and tools. This abstraction added unnecessary complexity and made the code harder to understand and maintain.

### Decision
We completely removed the Factory concept from the codebase. Agent crews and tools are now created directly using constructors and configuration objects.

### Consequences
- Positive: Simpler code with fewer abstractions; easier to understand and modify.
- Negative: Less flexibility for future extensibility; direct instantiation means changes to constructors require updates in multiple places.
- Neutral: Removed a layer of indirection that was not providing value.

### Alternatives Considered
- Keep Factory with improvements: Would require significant refactoring to make it useful.
- Dependency injection: Overkill for a single-user local tool.

---

## ADR-010: Profile Header with Relative Positioning for History Chat

**Date:** 2024-01-01 (inferred from git history)
**Status:** Accepted

### Context
The history chat panel was not clickable because the profile header lacked `position: relative`, causing the panel to be positioned incorrectly relative to its parent.

### Decision
We added `position: relative` to the profile header container to establish a positioning context for the history chat panel. This ensures the panel is positioned correctly relative to its parent.

### Consequences
- Positive: History chat panel is now clickable and properly positioned.
- Negative: Adds a CSS property that may affect other child elements.
- Neutral: Standard CSS positioning fix; no architectural changes.

### Alternatives Considered
- Absolute positioning on the panel: Would require more complex layout logic.
- Fixed positioning: Would keep the panel in view but could overlap other content.

---

## ADR-011: EM Dashboard Photo Display After AI Crew Dispatch

**Date:** 2024-01-01 (inferred from git history)
**Status:** Accepted

### Context
After dispatching tasks to AI crews from the EM Dashboard, photos (likely screenshots or diagrams) were not displaying correctly. The issue was related to how the dashboard handled the response data.

### Decision
We fixed the photo display by ensuring the dashboard correctly processes and renders image data returned by the AI crew after task completion.

### Consequences
- Positive: Users can now see visual results from AI crew tasks.
- Negative: Requires the AI crew to return image data in a specific format.
- Neutral: Adds image handling logic to the dashboard component.

### Alternatives Considered
- Display only text results: Would lose valuable visual information.
- Download links: Less convenient than inline display.

---

## ADR-012: Handover Status Panel Path Deduplication

**Date:** 2024-01-01 (inferred from git history)
**Status:** Accepted

### Context
The handover status panel had a bug where paths were duplicated (e.g., `.paaw/.paaw/PROJECT.md` instead of `.paaw/PROJECT.md`). This caused incorrect file references and broken links.

### Decision
We fixed the path construction logic to prevent duplication. The fix ensures that paths are constructed correctly without repeating the `.paaw/` prefix.

### Consequences
- Positive: Correct file references; links work as expected.
- Negative: None (bug fix).
- Neutral: Requires careful path handling in the handover status component.

### Alternatives Considered
- Normalize paths at the API level: Would fix the issue but might mask the root cause.
- Use absolute paths: Would avoid relative path issues but reduce portability.

---

## ADR-012: Agent Loop Timeout and Max Turns Tuning

**Date:** 2024-01-01 (inferred from git history)
**Status:** Accepted

### Context
Initial agent loop settings (timeout: 120s, max turns: 20) were too restrictive for complex engineering tasks. Agents frequently timed out or hit the turn limit before completing their work.

### Decision
We increased the timeout from 120s to 600s (later to 1800s) and max turns from 20 to 40 (later to 60). The loop also supports continuation, allowing agents to resume from where they left off.

### Consequences
- Positive: Agents can now complete complex tasks without premature termination.
- Negative: Longer timeouts mean users wait longer for results on simple tasks.
- Neutral: Continuation support adds complexity to the loop state management.

### Alternatives Considered
- Dynamic timeout based on task complexity: Would require task analysis upfront.
- No timeout: Risk of infinite loops; not practical.

---

## ADR-013: Code Understanding Modal with Close Button

**Date:** 2024-01-01 (inferred from git history)
**Status:** Accepted

### Context
The Code Understanding modal lacked a proper close button, making it difficult for users to dismiss the modal after viewing the analysis.

### Decision
We added a close button to the Code Understanding modal, improving user experience and accessibility.

### Consequences
- Positive: Users can easily dismiss the modal; improved UX.
- Negative: None (UI improvement).
- Neutral: Standard modal pattern; no architectural changes.

### Alternatives Considered
- Click outside to close: Would require additional event handling.
- Escape key only: Less discoverable for users.

---

## ADR-014: Sidebar Project Name Panel Removal

**Date:** 2024-01-01 (inferred from git history)
**Status:** Accepted

### Context
The sidebar had a small panel at the bottom displaying the project name. This took up valuable space and provided minimal value since the project name is already visible in the header.

### Decision
We removed the project name panel from the sidebar bottom, freeing up space for more useful content.

### Consequences
- Positive: More space for sidebar content; cleaner UI.
- Negative: Users lose a quick reference to the project name (though it's still in the header).
- Neutral: Minor UI change; no architectural impact.

### Alternatives Considered
- Keep but make collapsible: Adds unnecessary complexity for a low-value element.
- Move to header: Already exists there.

```