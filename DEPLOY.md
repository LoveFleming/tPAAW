# DEPLOY — 熱修：git push 紅❌無錯誤訊息

> 日期：2026-09-18 ｜ 上游 `3dbcce8d` ｜ 2 檔
> **含 UI 變更：蓋檔後要 `npm run build` + 重啟 server**

## 症狀
GitPanel 按 push，失敗時只顯示紅 ❌，後面沒有任何錯誤訊息。

## 根因
- runGit 沒設 `GIT_TERMINAL_PROMPT=0`：認證缺失時 git **靜默掛起**等輸入 → 15s timeout
  殺掉 → stderr 空 → API 回 `{error:""}` → UI 顯示「❌ 」後面空白
- push 只給 15s timeout，慢網/大 repo 會被誤殺

## 修復
1. `runGit`：env 加 `GIT_TERMINAL_PROMPT=0` + `GIT_ASKPASS=echo`（認證問題立即報錯帶 stderr）；
   timeout 改可調；SIGTERM 殺掉時組出 `git push timed out after Nms` 訊息 — errorText 永不空白
2. push/pull timeout 15s → 60s；vibe-fs 全部 route 的 error return 都加 errorText fallback
3. GitPanel push 顯示：error 空白時 fallback（output → message → HTTP status），前綴「push:」

## 檔案清單

| 狀態 | 檔案 |
|---|---|
| M | `packages/server/src/routes/vibe-fs.mjs` |
| M | `packages/ui/src/components/git/GitPanel.tsx` |

## 步驟
1. 蓋 2 檔 → `npm run build` → 重啟 server
2. 測：push 一個會失敗的 remote（如沒權限的 repo）→ ❌ 後面應該有完整 git 錯誤訊息
