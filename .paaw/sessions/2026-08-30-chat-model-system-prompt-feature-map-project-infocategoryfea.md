# 我要改 chat 頁面 model 下拉選單的樣式（圓角+寬度）。憑你 system prompt 裡的 Feature Map 判斷：用 project_info(category=feature_detail) 查一次相關 feature，然後直接列出『要改哪些檔案』。禁止 read_file / bash / grep — 這在測你的專案地圖，不是測你讀檔。

**日期**: 2026-08-30
**耗時**: 27s
**結果**: ✅ 成功
**分支**: `dev`

## 任務

我要改 chat 頁面 model 下拉選單的樣式（圓角+寬度）。憑你 system prompt 裡的 Feature Map 判斷：用 project_info(category=feature_detail) 查一次相關 feature，然後直接列出『要改哪些檔案』。禁止 read_file / bash / grep — 這在測你的專案地圖，不是測你讀檔。

## Git 變更分析

### Status
```
M .DS_Store
 M .paaw/HANDOVER.md
 M .paaw/auto-dispatch/report.md
 M .paaw/auto-dispatch/status.json
 M .paaw/changes/change-intelligence.json
 M .paaw/code-intelligence/api-function-map.json
 M .paaw/code-intelligence/call-graph.json
 M .paaw/code-intelligence/dependency-graph.json
 M .paaw/code-intelligence/file-map.json
 M .paaw/code-intelligence/status-cache.json
 M .paaw/code-intelligence/summary.json
 M .paaw/code-intelligence/symbol-index.json
 M .paaw/code-intelligence/test-code-map.json
 M .paaw/code-intelligence/test-intelligence.json
 M .paaw/coding-memory/actions.jsonl
 M .paaw/coding-memory/conversations/coding.em/active.json
 M .paaw/coding-memory/dispatch-log.jsonl
 M .paaw/cu-debug.log
 M .paaw/cu-status.json
 M .paaw/features/FEATURES.json
 M .paaw/features/FILE-FEATURES.json
 M .paaw/features/tree-sitter-analysis.txt
 M .paaw/handover-state.json
 M .paaw/release-unit-model.json
 M .paaw/scan.json
 M data/api-tester-history.json
 M data/config/backup.json
 M data/config/user.json
 M data/notes/notebooks.json
 M logs/cron/system-daily-backup/history.jsonl
 M logs/cron/system-daily-log-purge/history.jsonl
 M packages/ui/tsconfig.tsbuildinfo
?? .paaw/agent-memory/rm.md
?? .paaw/auto-dispatch/reports/2026-08-29.md
?? .paaw/logs/
?? .paaw/sessions/2026-08-30-11.md
?? .paaw/sessions/2026-08-30-browser-navigate-http1270014097-browser-screenshot-sidebar-d.md
?? .paaw/test-runs/
?? data/browser-profile/
?? data/config/release-units.json
?? data/downloads/
?? logs/vibe-sessions/pty-1787012630984-xzvi.json
?? logs/vibe-sessions/pty-1787012630984-xzvi.log
?? logs/vibe-sessions/pty-1787013087131-bvy9.json
?? logs/vibe-sessions/pty-1787013087131-bvy9.log
?? logs/vibe-sessions/pty-1787013123307-9o0y.json
?? logs/vibe-sessions/pty-1787013123307-9o0y.log
?? logs/vibe-sessions/pty-1787013171388-h13h.json
?? logs/vibe-sessions/pty-1787013171388-h13h.log
?? logs/vibe-sessions/pty-1787013276486-ogxx.json
?? logs/vibe-sessions/pty-1787013276486-ogxx.log
?? logs/vibe-sessions/pty-1787013310691-okg9.json
?? logs/vibe-sessions/pty-1787013310691-okg9.log
?? logs/vibe-sessions/pty-1787013450262-by6w.json
?? logs/vibe-sessions/pty-1787013450262-by6w.log
```

### Diff Stat
```
.DS_Store                                          |   Bin 6148 -> 8196 bytes
 .paaw/HANDOVER.md                                  |    40 +-
 .paaw/auto-dispatch/report.md                      |   498 +-
 .paaw/auto-dispatch/status.json                    |    50 +-
 .paaw/changes/change-intelligence.json             |  1873 +-
 .paaw/code-intelligence/api-function-map.json      |  1204 +-
 .paaw/code-intelligence/call-graph.json            | 20586 +++++++------
 .paaw/code-intelligence/dependency-graph.json      |  1932 +-
 .paaw/code-intelligence/file-map.json              | 18796 ++++++------
 .paaw/code-intelligence/status-cache.json          |    18 +-
 .paaw/code-intelligence/summary.json               |    48 +-
 .paaw/code-intelligence/symbol-index.json          | 28980 +++++++++++--------
 .paaw/code-intelligence/test-code-map.json         |   187 +-
 .paaw/code-intelligence/test-intelligence.json     |   446 +-
 .paaw/coding-memory/actions.jsonl                  |     4 +
 .../conversations/coding.em/active.json            |    34 +-
 .paaw/coding-memory/dispatch-log.jsonl             |   224 +
 .paaw/cu-debug.log                                 |    21 +
 .paaw/cu-status.json                               |    23 +-
 .paaw/features/FEATURES.json                       |  2306 +-
 .paaw/features/FILE-FEATURES.json                  |  2952 +-
 .paaw/features/tree-sitter-analysis.txt            |  2760 +-
 .paaw/handover-state.json                          |   104 +-
 .paaw/release-unit-model.json                      |  9602 +++---
 .paaw/scan.json                                    |   209 +-
 data/api-tester-history.json                       |    34 +
 data/config/backup.json                            |     2 +-
 data/config/user.json                              |     3 +-
 data/notes/notebooks.json                          |     7 +
 logs/cron/system-daily-backup/history.jsonl        |    12 +
 logs/cron/system-daily-log-purge/history.jsonl     |    12 +
 packages/ui/tsconfig.tsbuildinfo                   |     2 +-
 32 files changed, 55813 insertions(+), 37156 deletions(-)
```

## AI 回覆

先講清楚一件事：這個 session 的可呼叫工具裡沒有 `project_info`（我有的只有 read/write/edit/glob/grep/diff/git/bash/reference_read 等），所以查不了 `feature_detail`。但這題其實不用查 — System prompt 的 Feature Map 已經足夠定位。

## 判斷：F-011 Chat Interface

Map 中 F-011 的檔案清單：`ChatView.tsx`、`ChatMessages.tsx`、`MarkdownText.tsx`、`chat.mjs`、`ModelSelector.tsx`。「model 下拉選單」明確對應 **`ModelSelector.tsx`**。

## 要改的檔案

| 檔案 | 為什麼 |
|---|---|
| `packages/ui/src/components/ModelSelector.tsx` | **主要修改點**。下拉選單本体的 `borderRadius`（含 Select 的 `MuiSelect-outlined` / `notchedOutline`）和寬度（`width` / `minWidth` / `maxWidth`）都在這個 component 的 sx/style 裡 |
| `packages/ui/src/pages/ChatView.tsx` | **條件性修改**。如果寬度是由放置 ModelSelector 的外層 container（Grid item、flex、Toolbar 區塊）控制，改外層比改 component 內部死寬度更乾淨 — 動手前先確認寬度來源在哪層 |

## 明確不用動的（同 feature 但無關）

- `ChatMessages.tsx` / `MarkdownText.tsx` — 訊息渲染，與輸入區樣式無關
- `packages/server/src/routes/chat.mjs` — server route，純樣式改動不碰後端

## 邊界外提醒

- 如果圓角是要做成「全系統一致的 dropdown 圓角」，那會升級成 **F-058（`packages/ui/src/theme.tsx`）** 的全域 theme override — 但那是全域改動，會影響所有 Select，不建議為單一下拉選單這樣做。

**一句話結論：預設只改 `ModelSelector.tsx`；寬度若被外層 layout 限制才加改 `ChatView.tsx`。**
