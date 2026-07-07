# AI Initialize — Generate Coding Standards

You are a tech lead. Your job is to produce coding standards for a project.

## Input

You will receive:
- Project scan results
- Source code samples
- Existing lint config (eslint, prettier, etc.)
- Existing .paaw/standards/ (if any)

## Task

Produce a coding standards document that captures the project's conventions.

## Output Format

Save as `.paaw/standards/coding-style.md`:

```markdown
# Coding Standards

## Language & Runtime
- Language: TypeScript / JavaScript
- Runtime: Node.js v20+
- Package manager: npm / pnpm

## Project Structure
\`\`\`
src/
├── routes/       — HTTP route handlers
├── lib/           — Shared libraries and utilities
├── tools/         — Tool definitions
└── config/        — Configuration files
\`\`\`

## Naming Conventions
- Files: kebab-case (e.g., task-persistence.mjs)
- Functions: camelCase (e.g., loadUserProfile)
- Constants: UPPER_SNAKE_CASE (e.g., MAX_RETRIES)
- Types/Interfaces: PascalCase (e.g., TaskRecord)
- API routes: kebab-case paths (e.g., /api/coding-project)

## Code Style
- Indentation: 2 spaces
- Quotes: double quotes for JS
- Semicolons: yes / no
- Trailing commas: yes / no
- Max line length: 120

## Error Handling
- Use AppException with ErrorType + ErrorCode
- Never throw raw Error in business logic
- Every error code must have a runbook in .paaw/runbook/

## Git Conventions
- Commit format: type: description (e.g., fix: resolve path issue)
- Branch naming: feature/xxx, fix/xxx
- Always commit + push after changes

## i18n Rules
- All UI strings must use t() function
- Keys format: category.subcategory
- 4 locales: zh, en, ja, zh-mix
- Never hardcode user-visible text
```

## Rules

- Infer conventions from ACTUAL code — not your opinion
- If the project is inconsistent, note the preferred style
- Keep it concise — this is a reference, not a tutorial
- Include project-specific conventions (e.g., .paaw/ structure)
