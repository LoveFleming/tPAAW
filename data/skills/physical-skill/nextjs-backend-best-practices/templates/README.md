# Templates — 使用與複製指引

本目錄收錄 Next.js 16 後端最佳實務的**教學範本檔**。它們不是可執行的應用程式，而是供 AI agent 或開發者參照、複製的參考素材。**複製時請遵循本頁規則，直接整檔搬移是錯誤用法。**

## 目錄

| 範本 | 示範主題 |
|------|----------|
| `server-actions-form.tsx` | Server Actions 表單完整寫法（8 個範例）— 本目錄最完整的表單參考 |
| `server-action-form.tsx` | Server Action CRUD 精簡版（action 檔範本） |
| `app-router-async-params.tsx` | Next.js 16 非同步 params/cookies/headers/draftMode |
| `async-params-page.tsx` | 非同步 params 頁面骨架 |
| `route-handler-api.ts` | Route Handler API 端點寫法 |
| `cache-component-use-cache.tsx` | 「use cache」快取指令 8 段示範 |
| `parallel-routes-with-default.tsx` | Parallel Routes 與 default.tsx |
| `proxy-migration.ts` | middleware.ts → proxy.ts 遷移 |

## 複製規則（重要）

### 1. 一檔一指令（module-level directive）

每個範例屬於**不同的目標檔案**。範本本體刻意不帶任何 directive：

- action 檔（如 `app/posts/actions.ts`）→ 首行加 `'use server'`
- client 元件檔（如 `app/posts/CreatePostForm.tsx`）→ 首行加 `'use client'`
- server component 檔（如 `app/subscribe/SubscribeForm.tsx`）→ **不加** directive

每個範例上方的 `File:` 註解標示了歸屬檔案與應加的 directive。一個檔案只允許一個 module-level directive，混用多個會導致編譯失敗（這正是範本早期版本的缺陷，已於 TASK-167 修復）。

### 2. 只取所需

範本檔把所有 imports 集中置頂，是為了讓本參考檔本身能通過型別檢查。**複製單一範例時，只帶走該範例用到的 imports**，不要整段照搬。

### 3. React 19 API 規則

React 19 已移除 `useFormState`（from `react-dom`）：

- ✅ 正確：`import { useActionState } from 'react'`
- ❌ 錯誤：`import { useFormState } from 'react-dom'`

本目錄的 `server-actions-form.tsx` 與 `SKILL.md`/references 已更新至 `useActionState`。

> ⚠️ **已知狀態（2026-10-17）**：`server-action-form.tsx`（單數檔）L103/L116 仍使用已移除的 `useFormState`，待修復（ISS-043）。在修復前，表單互動範例請以複數檔 `server-actions-form.tsx` 為準。

### 4. 範本中的佔位符

範本內的 API URL（`https://api.example.com/...`）與資料庫呼叫為佔位符，複製後替換為你的實際端點。`templates/package.json` 為範本宣稱的目標環境（Next.js 16.2 / React 19.2 / TS 5.9+），非本技能包的執行依賴。

## 已知限制（server-actions-form.tsx）

Example 5（Subscribe）存在 2 個 React 19 型別契約違規（ISS-042），已由測試紅燈斷言釘住：

| 位置 | 問題 | 錯誤碼 |
|------|------|--------|
| L434 | `useActionState(subscribe, null)` — `subscribe` 簽章 `(formData) => Promise<{success, message}>` 不符 `(state, payload) => state` 契約 | TS2769 |
| L415 | `<form action={subscribe}>` — 回傳值非 `void \| Promise<void>` | TS2322 |

複製 Example 5 時，請改用同範例中 `EnhancedSubscribeForm` 的寫法，或將 `subscribe` 改為 `(prevState, formData)` 雙參數簽章。其餘 7 個範例型別契約乾淨。

## 測試

範本的行為契約由以下測試守護（專案根執行）：

```bash
npx vitest run tests/unit/server-actions-form-template.test.mjs tests/unit/server-actions-form-compile.test.mjs
```

- `server-actions-form-template.test.mjs`（37 tests）— 靜態契約掃描 + 語意重現
- `server-actions-form-compile.test.mjs`（4 tests）— esbuild 語法層 + TS API 權威 stub 型別層（含 C1/C2 紅燈斷言）

> 測試以行號斷言（L415/L434）。修改範本時若增刪行，須同步更新測試行號。
