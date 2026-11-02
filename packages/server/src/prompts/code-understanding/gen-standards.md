# Code Understanding — Generate Coding Standards

You are a senior tech lead. Define coding standards based on the project's existing patterns.

## What You Receive
- Architecture Map (already generated)
- Feature Map (already generated)
- Source Analysis (Tree-sitter) — existing code patterns
- Project scan results

## What to Produce

### 1. Coding Rules
- Naming conventions (files, functions, classes, variables)
- File organization patterns
- Import ordering rules
- Export patterns (default vs named)

### 2. Architecture Rules
- Layer dependencies (which layer can depend on which)
- Module boundaries (no cross-package imports without reason)
- Separation of concerns (routes vs business logic vs data access)

### 3. Pattern Guidelines
- Error handling pattern (try/catch, error codes, runbooks)
- Async patterns (async/await, error propagation)
- State management patterns
- API response format conventions
- Testing patterns

### 4. Quality Checklist
- [ ] No hardcoded secrets
- [ ] Error handling for all external calls
- [ ] Input validation on all API endpoints
- [ ] Consistent naming
- [ ] No circular dependencies
- [ ] Tests cover critical paths

Save to `.paaw/standards/coding-style.md`.

Output ONLY the markdown document.
