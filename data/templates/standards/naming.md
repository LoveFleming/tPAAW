# 命名規範

## 通用

- **語意化** — 名字要描述「是什麼」或「做什麼」，不是「怎麼做」
- **不要縮寫** — `getUserData` 不是 `getUD`，除非是公認縮寫（API, URL, ID）
- **布林用 is/has/can/should** — `isLoading`, `hasPermission`, `canEdit`

## 檔案

| 類型 | 規範 | 範例 |
|------|------|------|
| React Component | PascalCase.tsx | `SidebarFileTree.tsx` |
| Utility | camelCase.ts | `formatDate.ts` |
| Hook | use-kebab-case.ts | `use-debounce.ts` |
| Constants | UPPER_SNAKE.ts | `API_ENDPOINTS.ts` |
| CSS Module | camelCase.module.css | `sidebar.module.css` |

## 變數

```typescript
// ✅ Good
const userProfile = await fetchUser(userId);
const isVisible = show && !hidden;
const handleClick = () => {};

// ❌ Bad
const data = await fetchUser(userId);  // 什麼 data？
const flag = show && !hidden;          // 什麼 flag？
const fn = () => {};                   // 什麼 fn？
```

## 函數

- **動詞開頭**: `fetch`, `save`, `update`, `delete`, `get`, `set`, `is`, `has`
- **Async 加 `async` 關鍵字** — 不要 callback hell
- **參數不超過 4 個** — 超過就拆 object

## Interface / Type

```typescript
// ✅ Good — 描述領域概念
interface User {
  id: string;
  name: string;
  role: UserRole;
}

// ❌ Bad — 描述實作細節
interface UserDTO {
  user_id: number;    // 為什麼不直接 id?
  user_name: string;  // 為什麼不直接 name?
}
```

## 常見錯誤

- ❌ `temp`, `tmp`, `foo`, `bar`, `baz` — production code 裡禁止
- ❌ `data1`, `data2` — 用有意義的後綴
- ❌ Hungarian notation (`strName`, `intCount`) — TypeScript 不需要
