---
name: vanilla-js-innerhtml-empty-state
description: How to avoid null-reference crashes when a placeholder/empty-state element lives inside a container that gets re-rendered via innerHTML in single-file vanilla JS app.html apps
source: auto-skill
extracted_at: '2026-06-17T13:37:23.847Z'
---

# Avoid null.style crashes in innerHTML-re-rendered containers

## The bug class
In this project's single-file `app.html` apps (under `data/apps/*/app.html`), rendering is done
with vanilla JS: a `render()` function calls `container.innerHTML = ...` to redraw the list.

A common crash:

```
Uncaught (in promise) TypeError: Cannot read properties of null (reading 'style')
    at renderMain
    at render
    at loadBookmarks
```

**Root cause:** a placeholder/empty-state element (e.g. `#emptyState`) is declared **inside** the
same container that `render()` wipes with `innerHTML`. On the first render, `main.innerHTML = ""`
(or any new HTML) destroys that element. On the next render, `getElementById("emptyState")`
returns `null`, and `null.style.display = ...` throws.

This typically surfaces only on the *second* render — e.g. after a delete that empties the list,
or after a search/filter — so it passes a quick manual smoke test and fails later.

## Fix pattern
**Do NOT keep a persistent placeholder element inside the re-rendered container.** Render the
empty state inline as part of the container's innerHTML instead.

Bad:
```html
<main id="mainContent">
  <div class="empty-state" id="emptyState">No items</div>  <!-- wiped on render -->
</main>
```
```js
function renderMain() {
  const empty = document.getElementById("emptyState"); // null after first render
  if (items.length === 0) { empty.style.display = "flex"; ... } // 💥 crash
}
```

Good:
```html
<main id="mainContent"></main>
```
```js
function renderMain() {
  const main = document.getElementById("mainContent");
  if (items.length === 0) {
    main.innerHTML = `<div class="empty-state">No items</div>`;
    return;
  }
  main.innerHTML = items.map(...).join("");
}
```

## How to apply
- When editing any `data/apps/*/app.html` render function, check every `getElementById(...)` it
  calls: the target must live **outside** any container that the same function wipes with
  `innerHTML`. If it lives inside, inline it into the rendered output instead.
- If a crash trace shows `Cannot read properties of null (reading 'X')` originating from a
  `render*` function, suspect exactly this — look for a hardcoded child element of a
  re-rendered container.
- Generalizes to any persistent control/indicator inside a re-rendered region (counters,
  banners, skeletons) — move them outside the wiped container or regenerate them in the template.
