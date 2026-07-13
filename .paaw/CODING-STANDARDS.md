# Coding Standards

> 本專案的 Coding 規範。AI 在寫碼時必須遵守。

## 通用原則

1. 改完碼一定要 commit + push，不留 uncommitted local change
2. 新字串必須用 t() + 加 locale key（如適用）
3. 永遠處理 IME composition（useRef，不要用 useState）

## ⚠️ 跨平台路徑處理（Windows / macOS / Linux）

### 絕對禁止
- ❌ `new URL(import.meta.url).pathname` — Windows 上會產生 `/C:/path`（多一個 `/`），導致路徑重複磁碟機代號
- ❌ `import.meta.url.replace("file://", "")` — 不處理 Windows 的 `/C:` 前綴
- ❌ `pathname.replace(/^\//, "")` — hack，只治標

### 正確做法
- ✅ 一律用 `fileURLToPath(import.meta.url)` 取得 `__filename`/`__dirname`
- ✅ 用 `shared.mjs` 已導出的 `PAAW_ROOT` 常數，不要自己算
- ✅ 所有回傳前端的 path 一律經 `normalizePath()`（`shared.mjs` 導出）把 `\` 轉 `/`
- ✅ 路徑切割用 `split(/[\\/]/)` 不要硬寫 `split("/")`

### 為什麼重要
- Mac 開發時路徑全用 `/` 不會出錯，但 Windows 上 Node.js 的 `resolve/join` 產生 `\`
- `new URL(import.meta.url).pathname` 在 Windows 回傳 `/C:/path`，`resolve()` 把它當相對路徑拼出 `C:\C:\path`
- 前端收到 `C:\path` 放進 URL query string，反斜線可能被吃掉

### 檢查清單（每次動到路徑相關 code）
1. 新增 `import.meta.url` 用法？→ 必須走 `fileURLToPath`
2. 回傳 path 給前端？→ 必須 `normalizePath()`
3. 用 `split("/")` 切路徑？→ 改 `split(/[\\/]/)`
4. 需要 PAAW_ROOT？→ import from `shared.mjs`，不要自己算
5. 新增 route 檔案？→ 確認 `__filename`/`__dirname` 用 `fileURLToPath`

## 規範子目錄

將各語言/框架的規範放在 `standards/` 子目錄：

- `standards/typescript.md` — TypeScript 規範
- `standards/react.md` — React 規範
- `standards/naming.md` — 命名規範
- `standards/git-commit.md` — Commit message 規範

> 可透過 Coding IDE 的 Standards Editor 編輯，或點「Import」匯入範本。
