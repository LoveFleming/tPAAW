# 產出 UI Map（前端 route-first）

你在分析一個專案的**前端**程式碼，產出「UI Map」：每個前端進入點（route/頁面）一筆。

## 決定性事實（程式已 parse，以這些為準）

- 前端路由定義（React Router / Next.js pages / 約定式路由）已攤在 context
- 前端檔案清單與 tree-sitter 摘要已附上

## 你要產出的 JSON array（嚴禁其他文字）

每筆：

```json
{
  "category": "分類（依功能域分組，繁中，如：每日練習 / 錯題本 / 帳號設定 / 共用元件）",
  "route": "route path（如 /practice；無 route 的進入點用主要檔案路徑標記）",
  "name": "頁面/進入點名稱（繁中）",
  "description": "一句話：這個頁面做什麼",
  "uiFlow": [
    { "step": "畫面/互動步驟（繁中）", "action": "發生什麼事", "component": "哪個元件" }
  ],
  "components": ["主要元件檔（相對路徑）"],
  "stateMgmt": "state 管理方式一句話（local state / context / store / server state）",
  "apiCalls": ["這個頁面呼叫的後端 API entry，格式與 API Map 的 entry 完全一致（如 POST /api/attempt）"],
  "codeFiles": ["這個 route 相關的**前端**檔案（相對路徑：.tsx/.ts/.css 等）"],
  "backendFiles": ["這個功能垂直切片涉及的**後端**檔案（apiCalls 對到的 route/service/db 檔，相對路徑；純前端功能就空 array）"],
  "tests": ["對應測試檔（相對路徑，沒有就空 array）"],
  "severity": "high|medium|low（壞掉時對使用者影響）"
}
```

## 規則

1. **route 是主鍵**：一個 route 一筆，不同 route 不合併
2. **apiCalls 是前後端的橋**：從 fetch/axios/api client 呼叫點找出該頁面打的後端 endpoint，格式**完全**比照後端 API Map 的 entry（`METHOD /path`）。找不到對應 endpoint 就照實寫呼叫字串，不要猜
3. **分前後端**：codeFiles 只列前端檔（.tsx/.vue/.svelte/.css 等）；backendFiles 列這個功能實際用到的後端檔（apiCalls 對到的 route handler、它引用的 service/repository）；純前端功能（純展示、無後端呼叫）backendFiles 為空
4. **事實靠程式**：uiFlow 從程式碼實際互動讀出來，不發明不存在的畫面
5. 無 route 的共用層（元件庫、hooks、layout）歸類到「共用層」category，route 填主要檔案路徑
6. 檔案路標一律 repo 相對路徑（`packages/web/src/...`）

## 輸出

只輸出 JSON array，無其他文字、無 code fence。
