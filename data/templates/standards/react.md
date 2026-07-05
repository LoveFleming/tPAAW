# React 規範

## Component 原則

1. **函數式 Components only** — 不用 class components
2. **一檔一 Component** — 除非是緊密耦合的 sub-components
3. **Props 以上的不寫在 component 裡** — 抽出去做 util

## Hooks

- **自訂 Hook 用 `use` 前綴**: `useDebounce`, `useLocalStorage`
- **Hook 放 `hooks/` 目錄** — 命名 `use-X.ts`
- **Side effects 只在 `useEffect` 裡** — 不要在 render 階段做 mutation

## State 管理

- **能局部就局部** — 不需要全域 state 的就不要用
- **prop drilling 超過 3 層才考慮 context**
- **`useState` functional update**: `setX(prev => prev + 1)` 不要 `setX(x + 1)`

## 效能

- **`useMemo` / `useCallback` 只在需要時用** — 不要無腦加
- **List render 必須有 stable key** — 不要用 index
- **Heavy component 用 `React.memo`** — 但先量測

## ⚠️ IME 中文輸入 Enter 問題

**所有有 Enter 送出的 textarea/input 必須處理 IME composition:**

```tsx
const composingRef = useRef(false);

<textarea
  onCompositionStart={() => { composingRef.current = true; }}
  onCompositionEnd={() => { composingRef.current = false; }}
  onKeyDown={(e) => {
    if (composingRef.current || e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }}
/>
```

三層保護：`composingRef` → `isComposing` → `keyCode 229`

## 條件 Render

```tsx
// ✅ Good — 短且清楚
{show && <Component />}

// ✅ Good — 多行
{show ? (
  <Component />
) : (
  <Fallback />
)}

// ❌ Bad
{show ? <Component /> : null}
```

## 禁止

- ❌ `dangerouslySetInnerHTML` — 除非有 sanitize
- ❌ inline style 處理 theme — 用 CSS variable 或 tailwind class
- ❌ 直接操作 DOM — 用 ref + useEffect
