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

### 3. Backward-compatible data format changes
When changing how data is stored or parsed (e.g. switching `highlights` from a flat `"word (type) → translation | ..."` string to a JSON array), you **must** write a dual-format parser so existing records aren't lost:

```js
function parseHighlights(raw) {
  if (!raw) return [];
  // Try new format first (JSON array)
  try { const a = JSON.parse(raw); if (Array.isArray(a)) return a; } catch {}
  // Fall back to legacy flat format
  return raw.split(' | ').filter(Boolean).map(seg => {
    const m = seg.match(/^(.+?)\s*\((.+?)\)\s*→\s*(.+)$/);
    return m ? { word: m[1].trim(), type: m[2].trim(), translation: m[3].trim() } : null;
  }).filter(Boolean);
}
```

The same principle applies when renaming JSON keys in the Output Contract — use fallback patterns:
```js
const sent = cs.sentence || cs.en || '';
const trans = cs.translation || cs.zh || '';
```

**Why this matters:** The translate app stores history on the server. Old records persist with the old format. If `JSON.parse` is the only path and it fails on legacy strings, all existing vocabulary content silently disappears from history cards. Always parse both formats.

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
- **Changing stored data format without backward-compatible parsing** — old server records will silently lose content. Always write a dual-format parser (try new format, fall back to legacy format).
