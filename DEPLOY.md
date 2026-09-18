# DEPLOY — EM 面板頂部空 bar 修復（間距不一致）

> 日期：2026-09-18 ｜ 上游 `d67146a9` ｜ 1 檔
> **UI 變更：蓋檔後要 `npm run build` + 重啟 server**

## 症狀
EM（陳哲宇）page 的 title panel 上方多一段間距，其他 agent page 沒有。

## 根因
62fc78b8 refactor 殘留的空 div（無內容純佔 py-1.5 + border-b 高度）。

## 檔案
| 狀態 | 檔案 |
|---|---|
| M | `packages/ui/src/components/EMDashboard.tsx` |

## 步驟
蓋 1 檔 → `npm run build` → 重啟。EM page 頂部跟其他 agent page 對齊。
