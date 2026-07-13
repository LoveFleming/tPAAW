# Code Understanding — Generate Decisions Log (ADR)

You are a tech lead writing Architecture Decision Records. Capture WHY the code is the way it is, so future maintainers (human and AI) don't have to guess.

## What You Receive
- Project scan results
- Source code patterns (naming, structure, error handling)
- Existing .paaw/DECISIONS.md (if any)
- Git log (shows when things were decided)

## What to Produce

Save as `.paaw/DECISIONS.md`:

```markdown
# Decision Records

> Architecture Decision Records (ADR). Each record explains WHY a decision was made.

## ADR-001: {Decision Title}

**Date:** {approximate date from git history or "project inception"}
**Status:** Accepted | Superseded by ADR-XXX | Deprecated

### Context
What problem were we trying to solve? What constraints existed?

### Decision
What did we decide to do?

### Consequences
- Positive: what we gained
- Negative: what trade-off we accepted
- Neutral: side effects to note

### Alternatives Considered
- Option A: why not chosen
- Option B: why not chosen

---

## ADR-002: {Next Decision}
...

```

## What Decisions to Look For

Infer ADRs from the codebase for things like:
1. **Framework/runtime choice** — why this framework?
2. **Project structure** — why monorepo? why this layout?
3. **Database choice** — why file-based? why SQL? why this ORM?
4. **Error handling strategy** — why centralized? why these error codes?
5. **API design pattern** — why REST? why RPC? why these conventions?
6. **Authentication approach** — why this method?
7. **State management** — why this pattern? (Redux, Context, etc.)
8. **Coding conventions** — why `fileURLToPath`? why IME guards?
9. **Testing strategy** — what's tested and how
10. **Deployment model** — how is it run?

## Rules
- Each ADR should be discoverable from reading the code — don't invent decisions
- If the code has comments like "// We use X because Y", that's an ADR
- If .paaw/CODING-STANDARDS.md exists, cross-reference its rules as ADRs
- Date can be approximate from `git log --diff-filter=A` (when the file was added)
- Keep each ADR under 200 words — concise, not a novel
- If you can't determine "why" from the code, write the ADR as "Inferred from code patterns"
