# TypeScript 規範

## 型別

1. **永遠使用嚴格型別** — 不允許 `any`，必要時用 `unknown` + type guard
2. **優先使用 `interface`** — 只有需要 union/intersection 時才用 `type`
3. **Props 定義** — 每個 component 獨立定義 `Props` interface，不要 inline

```typescript
// ✅ Good
interface Props {
  title: string;
  onClose: () => void;
}

// ❌ Bad
function Comp({ title, onClose }: { title: string; onClose: () => void }) {}
```

## 命名

- **PascalCase**: Components, Interfaces, Types, Enums
- **camelCase**: variables, functions, methods
- **UPPER_SNAKE_CASE**: constants
- **kebab-case**: file names (except components, which use PascalCase)

## Import 順序

1. React / Next / framework
2. Third-party libraries
3. Internal imports (components, hooks, utils)
4. Type imports (`import type { ... }`)
5. CSS / assets

## 錯誤處理

- 所有 async function 必須 try/catch
- API response 統一用 `Result<T>` type: `{ ok: true, data: T } | { ok: false, error: string }`
- 不要吞 error，至少 `console.error`

##禁止

- ❌ `// @ts-ignore` — 修好型別，不要忽略
- ❌ `as any` — 用 `as unknown as X` 並加註解
- ❌ `var` — 用 `const` 或 `let`
- ❌ `==` — 永遠用 `===`
