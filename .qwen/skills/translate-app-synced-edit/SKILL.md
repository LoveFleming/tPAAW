---
name: translate-app-synced-edit
description: How to make consistent changes across the translate app's dual-directory structure (apps/ and data/), including SKILL.md, _api_prompt.txt, and app.html sync
source: auto-skill
extracted_at: '2026-06-07T13:49:43.604Z'
---

# Translate App Synced Edit

## When to use
When modifying the translate app's skill definitions, output contracts, rendering logic, or any behavior that spans the dual-directory structure.

## Directory structure
The translate app lives in two places that must stay in sync:
- `apps/translate/` — source of truth for app code
- `data/apps/translate/` — runtime copy used by the skill engine

Each contains:
- `skills/translate/SKILL.md`
- `skills/idiom-packaging/SKILL.md`
- `app.html`
- (data/ only) `_api_prompt.txt` — combined prompt assembling both skills into one execution prompt

## Procedure

### 1. Identify all files referencing the concept
Before editing, read:
- Both SKILL.md copies (`apps/translate/skills/*/SKILL.md` and `data/apps/translate/skills/*/SKILL.md`)
- `data/apps/translate/_api_prompt.txt` (contains inline copies of both skill definitions)
- `apps/translate/app.html` (rendering logic)

### 2. Edit in order
1. **SKILL.md files** — update the deterministic script steps, business rules, and Output Contract JSON example
2. **`_api_prompt.txt`** — contains the same skill definitions pasted inline; apply identical changes
3. **`app.html`** — update rendering code to match new output schema

### 3. Backward-compatible schema changes
When renaming JSON keys in the Output Contract (e.g. `en` → `sentence`, `zh` → `translation`), update the HTML rendering to accept both old and new keys using fallback patterns:
```js
const sent = cs.sentence || cs.en || '';
const trans = cs.translation || cs.zh || '';
```

### 4. Sync app.html
After all edits to `apps/translate/app.html`, copy it to the runtime location:
```bash
cp apps/translate/app.html data/apps/translate/app.html
```

### 5. Verify consistency
Use `grep` or targeted reads to confirm the same rule text appears in all relevant files. Missing `_api_prompt.txt` is the most common oversight — it duplicates both skill definitions and will drift if not updated alongside the SKILL.md files.

## Common pitfalls
- Forgetting to update `_api_prompt.txt` — it's the file the LLM actually reads at execution time
- Updating `apps/` SKILL.md but not `data/` SKILL.md (or vice versa)
- Changing Output Contract JSON keys without updating app.html rendering
- Not syncing app.html to data/ after edits
