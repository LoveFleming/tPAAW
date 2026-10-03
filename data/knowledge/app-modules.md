# App Module 開發指南 — 可組裝底座

> 2026-10-03 上線（S1-S5 完工，commit 7062c35b）。PAAW = 單一底座，persona app 以模組掛載。
> 第一個模組：`learning`（小元寶學習空間，從 learning-space fork 搬入）。

## 一句話

一個 App Module = `installed-apps/<id>/` 一個目錄（server routes + UI 頁面 + manifest），掛進 4097 單一 server，資料隔離在 `data/installed-apps/<id>/`。

## 目錄結構

```
installed-apps/<id>/
  manifest.json          # id/name/version/enabled/nav{label,emoji,page}/server{entry}
  server/
    entry.mjs            # 依序 try 各 route，return true 表示已處理
    routes/*.mjs         # route 檔（default export async (req,res)=>boolean）
    routes/shared.mjs    # shim：re-export tPAAW readBody；PAAW_ROOT 重指模組資料根
    data-home.mjs        # shim：DATA_HOME 指模組資料根（模組自帶 providers.json）
    lib/*.mjs            # 需要時 re-export tPAAW lib（stable-hash 等）
  ui/
    pages/*.tsx          # 頁面檔名 = manifest.nav.page；import.meta.glob 自動發現
    components/          # 模組專屬元件（相對 import）
data/installed-apps/<id>/  # 模組資料根（gitignored，不進 git）
```

## 開發新模組：四步

1. **Scaffold**：UI「📦 App 模組」頁填 id/name/emoji，或 `POST /api/apps/modules {"id","name","emoji"}`。骨架即刻生成（manifest + entry + Main.tsx + 資料根），nav 不用重啟就會出現。
2. **UI**：寫 `ui/pages/*.tsx`。共用元件走 `@paaw-ui/...` alias（指 packages/ui/src），模組內部相對 import。新字串 i18n 四檔都要加（zh/en/ja/zh-mix）。
3. **Server**：route 檔放 `server/routes/`，entry.mjs 依序註冊，URL 建議統一 `/api/<id>/...` 前綴。**搬既有 route 時原封不動**，只靠 shim 層重指資料根。
4. **資料**：放 `data/installed-apps/<id>/`，用 `import { PAAW_ROOT } from "./routes/shared.mjs"` 拿模組資料根。⚠️ 絕不自己算 PAAW_ROOT（少爬一層的地雷踩過）。

## 開發循環與鐵律

- **改 UI → `npm run build` → 瀏覽器刷新**。半模組（vite 編入 bundle），build ~3s。
- **改 server route → 必須重啟 PAAW**（掛載在 boot，import 有 cache）。⚠️ **agent 不可自行重啟 PAAW**（shell-guard 鐵律，port 4097/4098/4100/5173 永不可啟停）— 請 Fleming 或管家代重啟。
- **module 碼進 git；`data/installed-apps/` gitignored**（DB/上傳/考古題等資料不進版控）。
- manifest `enabled:false` 可停用模組（UI/api 皆隱藏），刪目錄即解除安裝。
- 壞模組（entry 炸/manifest 壞）大聲報錯，不會炸 PAAW 主體。

## 慣例與地雷（踩過的）

1. **shim 是唯一注入點**：route 碼零改動，資料根從 shim 進。學 learning 模組的 `routes/shared.mjs`（4 層上爬指到模組資料根）。
2. **React #426**：lazy 模組頁在同步事件中懸掛會炸 — 開模組頁的 setOpenTabs+setActivePage 都包 `startTransition`（App.tsx openAppModule 已處理；模組內部切 lazy 頁同理）。
3. **feedback API**：主 UI 是 `uiFeedback.ts`（uiAlert/uiAlertError/uiConfirm/uiPrompt），沒有 showToast/confirmDialog。
4. **i18n 加法合併**：只加 key 不改既有；learning 模組帶了 684 個 key 進來。
5. **smoke 測試**：側欄 SidebarSection 預設折疊，點 nav 前先展開 section（模組 nav 在 EXECUTION 區）。

## 參考實例

`installed-apps/learning/` — 3 條 server route（exam-vault/quiz-session/learning-practice）+ LearningSpace.tsx（3.2k 行）+ 6 元件 + quiz/，完整展示 shim 層、資料隔離（learning.db + 202 檔考古題 495MB）、i18n 合併。新模組照抄結構即可。
