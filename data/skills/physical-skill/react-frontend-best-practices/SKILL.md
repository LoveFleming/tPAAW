---
id: react-frontend-best-practices
name: React 前端最佳實踐
version: 1.0.0
description: React 元件效能與組合模式 — 33 條規則（re-render 優化、bundle 瘦身、渲染效能、常見陷阱），寫/審/refactor React 元件時遵循
category: coding
tags:
  - react
  - frontend
  - performance
source: JOHNadonis/claude-code-skills (frontend-react-best-practices)
---

# React Best Practices

Performance optimization and composition patterns for React components. Contains 33 rules across 6 categories focused on reducing re-renders, optimizing bundles, component composition, and avoiding common React pitfalls.

## When to Apply

Reference these guidelines when:

- Writing new React components
- Reviewing code for performance issues
- Refactoring existing React code
- Optimizing bundle size
- Working with hooks and state

## Rules Summary

### Bundle Size Optimization (CRITICAL)

#### bundle-barrel-imports

Import directly from source, avoid barrel files.

```tsx
// Bad: loads entire library (200-800ms)
import { Check, X } from "lucide-react";

// Good: loads only what you need
import Check from "lucide-react/dist/esm/icons/check";
import X from "lucide-react/dist/esm/icons/x";
```

#### bundle-conditional

Load modules only when feature is activated.

```tsx
useEffect(() => {
  if (enabled && typeof window !== "undefined") {
    import("./heavy-module").then((mod) => setModule(mod));
  }
}, [enabled]);
```

#### bundle-preload

Preload on hover/focus for perceived speed.

```tsx
<button
  onMouseEnter={() => import("./editor")}
  onFocus={() => import("./editor")}
  onClick={openEditor}
>
  Open Editor
</button>
```

### Re-render Optimization (MEDIUM)

#### rerender-functional-setstate

Use functional setState for stable callbacks.

```tsx
// Bad: stale closure risk, recreates on items change
const addItem = useCallback(
  (item) => {
    setItems([...items, item]);
  },
  [items],
);

// Good: always uses latest state, stable reference
const addItem = useCallback((item) => {
  setItems((curr) => [...curr, item]);
}, []);
```

#### rerender-derived-state-no-effect

Derive state during render, not in effects.

```tsx
// Bad: extra state and effect, extra render
const [fullName, setFullName] = useState("");
useEffect(() => {
  setFullName(firstName + " " + lastName);
}, [firstName, lastName]);

// Good: derived directly during render
const fullName = firstName + " " + lastName;
```

#### rerender-lazy-state-init

Pass function to useState for expensive initial values.

```tsx
// Bad: runs expensiveComputation() on every render
const [data] = useState(expensiveComputation());

// Good: runs only on initial render
const [data] = useState(() => expensiveComputation());
```

#### rerender-dependencies

Use primitive dependencies in effects.

```tsx
// Bad: runs on any user field change
useEffect(() => {
  console.log(user.id);
}, [user]);

// Good: runs only when id changes
useEffect(() => {
  console.log(user.id);
}, [user.id]);
```

#### rerender-derived-state

Subscribe to derived booleans, not raw values.

```tsx
// Bad: re-renders on every pixel change
const width = useWindowWidth();
const isMobile = width < 768;

// Good: re-renders only when boolean changes
const isMobile = useMediaQuery("(max-width: 767px)");
```

#### rerender-memo

Extract expensive work into memoized components.

```tsx
// Good: skips computation when loading
const UserAvatar = memo(function UserAvatar({ user }) {
  let id = useMemo(() => computeAvatarId(user), [user]);
  return <Avatar id={id} />;
});

function Profile({ user, loading }) {
  if (loading) return <Skeleton />;
  return <UserAvatar user={user} />;
}
```

#### rerender-memo-with-default-value

Hoist default non-primitive props to constants.

```tsx
// Bad: breaks memoization (new function each render)
const Button = memo(({ onClick = () => {} }) => ...)

// Good: stable default value
const NOOP = () => {}
const Button = memo(({ onClick = NOOP }) => ...)
```

#### rerender-simple-expression-in-memo

Don't wrap simple primitive expressions in useMemo.

```tsx
// Bad: useMemo overhead > expression cost
const isLoading = useMemo(() => a.loading || b.loading, [a.loading, b.loading]);

// Good: just compute it
const isLoading = a.loading || b.loading;
```

#### rerender-move-effect-to-event

Put interaction logic in event handlers, not effects.

```tsx
// Bad: effect re-runs on theme change
useEffect(() => {
  if (submitted) post("/api/register");
}, [submitted, theme]);

// Good: in handler
const handleSubmit = () => post("/api/register");
```

#### rerender-transitions

Use startTransition for non-urgent updates.

```tsx
// Good: non-blocking scroll tracking
const handler = () => {
  startTransition(() => setScrollY(window.scrollY));
};
```

#### rerender-use-ref-transient-values

Use refs for transient frequent values.

```tsx
// Good: no re-render, direct DOM update
const lastXRef = useRef(0);
const dotRef = useRef<HTMLDivElement>(null);

useEffect(() => {
  let onMove = (e) => {
    lastXRef.current = e.clientX;
    dotRef.current?.style.transform = `translateX(${e.clientX}px)`;
  };
  window.addEventListener("mousemove", onMove);
  return () => window.removeEventListener("mousemove", onMove);
}, []);
```

### Rendering Performance (MEDIUM)

#### rendering-conditional-render

Use ternary, not && for conditionals with numbers.

```tsx
// Bad: renders "0" when count is 0
{
  count && <Badge>{count}</Badge>;
}

// Good: renders nothing when count is 0
{
  count > 0 ? <Badge>{count}</Badge> : null;
}
```

#### rendering-hoist-jsx

Extract static JSX outside components.

```tsx
// Good: reuses same element, especially for large SVGs
const skeleton = <div className="animate-pulse h-20 bg-gray-200" />;

function Container({ loading }) {
  return loading ? skeleton : <Content />;
}
```

#### rendering-content-visibility

Use content-visibility for long lists.

```css
.list-item {
  content-visibility: auto;
  contain-intrinsic-size: 0 80px;
}
```

#### rendering-animate-svg-wrapper

Animate wrapper div, not SVG element (for GPU acceleration).

```tsx
// Good: hardware accelerated
<div className="animate-spin">
  <svg>...</svg>
</div>
```

#### rendering-svg-precision

Reduce SVG coordinate precision with SVGO.

```bash
npx svgo --precision=1 --multipass icon.svg
```

#### rendering-hydration-no-flicker

Use inline script for client-only data to prevent flicker.

```tsx
<div id="theme-wrapper">{children}</div>
<script dangerouslySetInnerHTML={{ __html: `
  var theme = localStorage.getItem('theme') || 'light';
  document.getElementById('theme-wrapper').className = theme;
` }} />
```

#### rendering-hydration-suppress-warning

Suppress expected hydration mismatches.

```tsx
<span suppressHydrationWarning>{new Date().toLocaleString()}</span>
```

#### rendering-client-only

Render browser-only components with ClientOnly and a fallback.

```tsx
<ClientOnly fallback={<Skeleton />}>
  {() => <Map />}
</ClientOnly>
```

#### rendering-use-hydrated

Use `useHydrated` for SSR/CSR divergence.

```tsx
let hydrated = useHydrated();
return hydrated ? <Widget /> : <Skeleton />;
```

#### rendering-usetransition-loading

Prefer useTransition over manual loading states.

```tsx
const [isPending, startTransition] = useTransition();

let handleSearch = (value) => {
  startTransition(async () => {
    let data = await fetchResults(value);
    setResults(data);
  });
};
```

#### fault-tolerant-error-boundaries

Place error boundaries at feature boundaries.

```tsx
<ErrorBoundary fallback={<SidebarError />}>
  <Sidebar />
</ErrorBoundary>
```

### Client Patterns (MEDIUM)

#### client-passive-event-listeners

Use passive listeners for scroll/touch.

```tsx
document.addEventListener("wheel", handler, { passive: true });
document.addEventListener("touchstart", handler, { passive: true });
```

#### client-localstorage-schema

Version and minimize localStorage data.

```typescript
const VERSION = "v2";

function saveConfig(config: Config) {
  try {
    localStorage.setItem(`config:${VERSION}`, JSON.stringify(config));
  } catch {} // Handle incognito/quota exceeded
}
```

### Hooks (HIGH)

#### hooks-limit-useeffect

Use useEffect only when absolutely necessary. Prefer derived state or event handlers.

```tsx
// Bad: useEffect to derive state
let [filtered, setFiltered] = useState(items);
useEffect(() => {
  setFiltered(items.filter((i) => i.active));
}, [items]);

// Good: derive during render
let filtered = items.filter((i) => i.active);

// Good: useMemo if expensive
let filtered = useMemo(() => items.filter((i) => i.active), [items]);
```

#### hooks-useeffect-named-functions

Use named function declarations in useEffect for better debugging and self-documentation.

```tsx
// Bad: anonymous arrow function
useEffect(() => {
  document.title = title;
}, [title]);

// Good: named function
useEffect(
  function syncDocumentTitle() {
    document.title = title;
  },
  [title],
);

// Good: also name cleanup functions
useEffect(function subscribeToOnlineStatus() {
  window.addEventListener("online", handleOnline);
  return function unsubscribeFromOnlineStatus() {
    window.removeEventListener("online", handleOnline);
  };
}, []);
```

### Composition Patterns (HIGH)

#### composition-avoid-boolean-props

Don't add boolean props to customize behavior. Use composition instead.

```tsx
// Bad: boolean prop explosion
<Composer isThread isEditing={false} showAttachments />

// Good: explicit variants
<ThreadComposer channelId="abc" />
<EditComposer messageId="xyz" />
```

#### composition-compound-components

Structure complex components as compound components with shared context.

```tsx
// Good: compound components
<Composer.Provider state={state} actions={actions}>
  <Composer.Frame>
    <Composer.Input />
    <Composer.Footer>
      <Composer.Submit />
    </Composer.Footer>
  </Composer.Frame>
</Composer.Provider>
```

#### composition-state-provider

Lift state into provider components for cross-component access.

```tsx
// Good: state in provider, accessible anywhere inside
<ForwardMessageProvider>
  <Dialog>
    <Composer.Input />
    <MessagePreview /> {/* Can read state */}
    <ForwardButton /> {/* Can call submit */}
  </Dialog>
</ForwardMessageProvider>
```

#### composition-explicit-variants

Create explicit variant components instead of prop combinations.

```tsx
// Good: self-documenting variants
function ThreadComposer({ channelId }) {
  return (
    <ThreadProvider channelId={channelId}>
      <Composer.Frame>
        <Composer.Input />
        <AlsoSendToChannelField />
        <Composer.Submit />
      </Composer.Frame>
    </ThreadProvider>
  );
}
```

#### composition-children-over-render-props

Prefer children for composition. Use render props only when passing data back.

```tsx
// Good: children for structure
<Card>
  <Card.Header>Title</Card.Header>
  <Card.Body>Content</Card.Body>
</Card>

// OK: render props when passing data
<List renderItem={({ item }) => <Item {...item} />} />
```

#### composition-avoid-overabstraction

Avoid rigid configuration props; prefer composable children APIs.

```tsx
<Select value="abc" onChange={...}>
  <Option value="abc">ABC</Option>
  <Option value="xyz">XYZ</Option>
</Select>
```

#### composition-typescript-namespaces

Use TypeScript namespaces to combine component and its types for single-import access.

```tsx
// components/button.tsx
export namespace Button {
  export type Variant = "solid" | "ghost" | "outline";
  export interface Props {
    variant?: Variant;
    children: React.ReactNode;
  }
}

export function Button({ variant = "solid", children }: Button.Props) {
  // ...
}

// Usage: single import
import { Button } from "~/components/button";

<Button variant="ghost">Click</Button>
function wrap(props: Button.Props) { ... }
```

**Important:** Namespaces should only contain types, never runtime code.
