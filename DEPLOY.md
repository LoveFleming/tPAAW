# DEPLOY — Git 面板移除 Blame/Review tabs

> 日期：2026-09-18 ｜ 上游 `c1b8ec9f` ｜ 5 檔 + 1 刪
> **UI 變更：蓋檔後要 `npm run build` + 重啟；GitReviewView.tsx 要手動刪**

## 為什麼
Fleming：QA 等 agent 自己能看 git commit — git 面板內嵌的 Blame/Review 冗餘，移除。

## 移除內容
- Git 面板只剩 **Status / Diff** 兩個 tab
- Diff 視圖的「🔬 QA Review」按鈕
- Review 結果徽章 / loadBlame 死碼

## 檔案
| 狀態 | 檔案 |
|---|---|
| M | `packages/ui/src/components/git/GitPanel.tsx` |
| M | `packages/ui/src/components/git/GitDiffView.tsx` |
| M | `packages/ui/src/components/git/GitStatusView.tsx` |
| M | `packages/ui/src/components/git/index.ts` |
| M | `packages/ui/src/pages/CodingIDE.tsx` |
| D | `packages/ui/src/components/git/GitReviewView.tsx`（手動刪除） |

## 步驟
1. 蓋 5 個 M 檔
2. 刪 `packages/ui/src/components/git/GitReviewView.tsx`
3. `npm run build` → 重啟 server
