---
name: normalize-api-field-mismatches
description: When two consumers (API tools vs UI) read/write the same data file but use different field names, add a normalization layer at both server and client to bridge the gap.
source: auto-skill
extracted_at: '2026-06-12T13:40:16.568Z'
---

# Normalize API Field Mismatches Between Tools and UI

## When to apply
- A data file is shared between an AI tool API (e.g. `/api/app-data/:id`) and a UI-facing compatibility API (e.g. `/api/notes`).
- The UI renders nothing despite data existing in the store.
- Field names differ between what tools write and what the UI expects.

## Pattern

### 1. Identify the mismatch
- Check the actual data file (e.g. `data/app-data/pocket.json`) for field names.
- Check the UI code for which fields it reads (e.g. `h.content` vs `h.text`).
- Check filter logic that might hide data (e.g. `status === "done"` filtered out by default).

### 2. Add server-side normalization in the compatibility API
Insert a normalization function in the GET handler that maps old/alternate field names to what the UI expects:

```js
function normalizeNote(n) {
  return {
    ...n,
    content: n.content || n.text || n.title || "",
    status: n.status || (n.done ? "done" : "active"),
  };
}
// In GET handler:
const notes = rawArray.map(normalizeNote);
```

### 3. Add client-side normalization as a safety net
In the fetch handler, map the response array the same way:

```js
t((P.notes||[]).map(n=>({
  ...n,
  content: n.content||n.text||n.title||"",
  status: n.status||(n.done?"done":"active")
})))
```

### 4. Why both layers
- Server-side ensures all clients get normalized data.
- Client-side guards against cached or stale server responses.
- Neither layer breaks if the other is present — they're idempotent.

## Gotchas
- Also check default filter states (e.g. "hide completed" toggles) that may hide all existing data even after normalization.
- The `||` chaining (`n.content || n.text || n.title`) provides a fallback chain for multiple legacy field names.
- For minified bundled HTML (React app.html), use targeted string replacement on the minified JS rather than rebuilding the entire bundle.
