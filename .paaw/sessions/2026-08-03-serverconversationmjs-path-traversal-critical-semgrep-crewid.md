# 修復 server/conversation.mjs 的 path traversal 漏洞（Critical）。

Semgrep 報告：crewId / sessionId 用戶輸入直接傳入 path.join()，可能導致 path traversal 攻擊。

要做的事：
1. 在 conversation.mjs 新增 sanitizeId(id) 工具函數，用白名單正則 `^[a-zA

**日期**: 2026-08-03
**耗時**: 377s
**結果**: ✅ 成功
**分支**: `dev`

## 任務

修復 server/conversation.mjs 的 path traversal 漏洞（Critical）。

Semgrep 報告：crewId / sessionId 用戶輸入直接傳入 path.join()，可能導致 path traversal 攻擊。

要做的事：
1. 在 conversation.mjs 新增 sanitizeId(id) 工具函數，用白名單正則 `^[a-zA-Z0-9_-]+$` 驗證 crewId / sessionId
2. 在 loadConversation、saveConversation、archiveConversation、listArchives、loadArchive 的入口處呼叫 sanitizeId 驗證 crewId
3. 在 loadArchive 的入口處額外驗證 sessionId（sessionId 也是用戶輸入）
4. 非法輸入時拋出明確的 Error（例如 `Invalid crewId: <id>` / `Invalid sessionId: <id>`）

注意：目前檔案裡完全沒有 sanitizeId，請先 read_file 確認現況再改。改完後可考慮為 sanitizeId 補一個簡短單元測試（server/conversation.test.mjs，用 Vitest，參考 server/tool-loader.test.mjs 的寫法）。

驗收：semgrep conversation.mjs path-traversal findings = 0；合法 crewId/sessionId 仍正常運作；非法輸入（../、絕對路徑、空白）拋 Error。

改完後 commit（conventional commits，type=fix）。不要 push。

## AI 操作步驟

25× bash
1× glob
1× grep
3× read_file
2× task_list

## Git 變更分析

### Status
```
M .paaw/CHANGELOG.md
 M .paaw/coding-memory/actions.jsonl
 M .paaw/staged-changes.json
 M data/config/backup.json
 M data/config/recent-projects.json
 M data/skills/physical-skill/translate/.paaw/CHANGELOG.md
 M data/workspaces.json
 M logs/cron/cron-1782007179382/history.jsonl
 M logs/cron/cron-ai-daily-digest/history.jsonl
 M logs/cron/system-daily-backup/history.jsonl
 M logs/cron/system-daily-log-purge/history.jsonl
 M logs/cron/test/history.jsonl
?? .paaw/auto-dispatch/plans/ns-2026-08-03-tPAAW.json
?? .paaw/sessions/2026-08-03-serverconversationmjs-path-traversal-semgrep-finding-1-sanit.md
?? .paaw/sessions/2026-08-03-task-005-serverconversationmjs-path-traversal-sanitizeid-1-s.md
?? data/distill/knowledge/vibe/2026-08-01.md
?? data/knowledge/test.txt
?? data/skills/physical-skill/ai-news-digest/.paaw/sessions/2026-08-02-please-use-skill-ai-news-digest-with-user-inputs-from-cron-i.md
?? data/skills/physical-skill/translate/.paaw/sessions/2026-08-02-please-use-skill-translate-with-user-inputs-from-cron-inputs.md
?? logs/cron-results/cron-ai-daily-digest/2026-08-02T00-00-16.txt
?? logs/cron-results/test/2026-08-02T01-00-14.txt
?? logs/cron/auto-dispatch-2f6167656e742d737265/
?? logs/cron/night-shift-2f4170702f7450414157/
?? logs/cron/night-shift-2f6167656e742d737265/
?? logs/cron/night-shift-bootstrap/
?? logs/vibe-sessions/pty-1785653115691-crdi.json
?? logs/vibe-sessions/pty-1785653115691-crdi.log
?? logs/vibe-sessions/pty-1785664404435-tau1.json
?? logs/vibe-sessions/pty-1785664404435-tau1.log
?? logs/vibe-sessions/pty-1785664485857-t5oh.json
?? logs/vibe-sessions/pty-1785664485857-t5oh.log
?? logs/vibe-sessions/pty-1785664695021-7s6l.json
?? logs/vibe-sessions/pty-1785664695021-7s6l.log
?? logs/vibe-sessions/pty-1785665592085-00kz.json
?? logs/vibe-sessions/pty-1785665592085-00kz.log
?? logs/vibe-sessions/pty-1785675807966-2ju4.json
?? logs/vibe-sessions/pty-1785675807966-2ju4.log
?? logs/vibe-sessions/pty-1785676016621-4cxb.json
?? logs/vibe-sessions/pty-1785676016621-4cxb.log
?? logs/vibe-sessions/pty-1785676021610-8pgj.json
?? logs/vibe-sessions/pty-1785676021610-8pgj.log
?? logs/vibe-sessions/pty-1785676231263-xzq9.json
?? logs/vibe-sessions/pty-1785676231263-xzq9.log
?? logs/vibe-sessions/pty-1785677044612-lg8r.json
?? logs/vibe-sessions/pty-1785677044612-lg8r.log
?? logs/vibe-sessions/pty-1785677931111-cst4.json
?? logs/vibe-sessions/pty-1785677931111-cst4.log
?? logs/vibe-sessions/pty-1785679555892-sp5a.json
?? logs/vibe-sessions/pty-1785679555892-sp5a.log
?? logs/vibe-sessions/pty-1785680459254-nuig.json
?? logs/vibe-sessions/pty-1785680459254-nuig.log
?? logs/vibe-sessions/pty-1785681009404-ao48.json
?? logs/vibe-sessions/pty-1785681009404-ao48.log
?? logs/vibe-sessions/pty-1785714075564-0qor.json
?? logs/vibe-sessions/pty-1785714075564-0qor.log
?? logs/vibe-sessions/pty-1785715109459-8a14.json
?? logs/vibe-sessions/pty-1785715109459-8a14.log
?? logs/vibe-sessions/pty-1785716525153-2lgy.json
?? logs/vibe-sessions/pty-1785716525153-2lgy.log
?? logs/vibe-sessions/pty-1785717031517-v9f8.json
?? logs/vibe-sessions/pty-1785717031517-v9f8.log
?? logs/vibe-sessions/pty-1785717284549-95ag.json
?? logs/vibe-sessions/pty-1785717284549-95ag.log
?? logs/vibe-sessions/pty-1785720324352-gd11.json
?? logs/vibe-sessions/pty-1785720324352-gd11.log
?? logs/vibe-sessions/pty-1785749165441-uyba.json
?? logs/vibe-sessions/pty-1785749165441-uyba.log
?? logs/vibe-sessions/pty-1785749622330-usl1.json
?? logs/vibe-sessions/pty-1785749622330-usl1.log
?? logs/vibe-sessions/pty-1785749988013-8tgj.json
?? logs/vibe-sessions/pty-1785749988013-8tgj.log
?? logs/vibe-sessions/pty-1785757524524-9q4n.json
?? logs/vibe-sessions/pty-1785757524524-9q4n.log
?? logs/vibe-sessions/pty-1785759852664-4gi4.json
?? logs/vibe-sessions/pty-1785759852664-4gi4.log
?? logs/vibe-sessions/pty-1785760145541-7xwn.json
?? logs/vibe-sessions/pty-1785760145541-7xwn.log
?? packages/server/test.txt
```

### Diff Stat
```
.paaw/CHANGELOG.md                                     | 11 +++++++++++
 .paaw/coding-memory/actions.jsonl                      |  1 +
 .paaw/staged-changes.json                              | 18 ++++++++++--------
 data/config/backup.json                                |  2 +-
 data/config/recent-projects.json                       |  2 +-
 .../skills/physical-skill/translate/.paaw/CHANGELOG.md |  9 +++++++++
 data/workspaces.json                                   |  4 +++-
 logs/cron/cron-1782007179382/history.jsonl             |  2 ++
 logs/cron/cron-ai-daily-digest/history.jsonl           |  2 ++
 logs/cron/system-daily-backup/history.jsonl            |  4 ++++
 logs/cron/system-daily-log-purge/history.jsonl         |  4 ++++
 logs/cron/test/history.jsonl                           |  2 ++
 12 files changed, 50 insertions(+), 11 deletions(-)
```

## AI 回覆

全部驗證完成。以下是我的調查結論。

## 結論：此任務已被先前 session 完成並 commit

我調查發現這個 path traversal 修復**已經完成並 commit** 到 HEAD（commit `172f950`，2 分鐘前，時間戳匹配 TASK-005 的 session 記錄）。不需要重新實作。

讓我確認所有驗收標準：

| 驗收項目 | 狀態 |
|---|---|
| semgrep path-traversal findings = 0 | ✅ `semgrep --config p/javascript` → **0 findings**（68 rules） |
| sanitizeId 白名單正則 | ✅ `ID_WHITELIST = /^[a-zA-Z0-9._-]+$/` + 額外擋 `..` |
| 所有 conversation handler 呼叫 sanitizeId | ✅ **12 處**：load/save/delete/new-session/sessions-list/load-session/delete-session/switch-session（crewId + sessionId 都已驗證） |
| 非法輸入拋 Error | ✅ 實測 `../`、絕對路徑、空白、`..` 全部拋 `Error(code=PATH_TRAVERSAL)` |
| 合法 id 正常運作 | ✅ `coding.architect`、`s-...` 等通過 |

### 關於檔案路徑
任務寫「server/conversation.mjs」，但實際檔案是 **`packages/server/src/routes/coding.mjs`**（唯一處理 conversation 的檔案，含 sanitizeId 函數在大約 line 577）。git 顯示此檔案**沒有未提交變更**，代表修復已寫入 HEAD。

### 一點澄清
- 任務提到「補 sanitizeId 單元測試（conversation.test.mjs）」是**可選**（"可考慮"）。目前不存在 `conversation.test.mjs`。
- 還有一個地方 line 142（`/api/coding-crew/:crewId` 讀 crew 定義）也用 `decodeURIComponent` 進 `path.join`，但那是**不同功能**（讀 crew 定義檔，非 conversation），不在本任務範圍。我沒有動它，避免超出範圍。

由於修復已經 commit，**沒有新的變更需要 stage/commit**。如果你希望我：
1. 補上 `sanitizeId` 單元測試（`packages/server/src/routes/coding.test.mjs` 或對應測試）
2. 另外把 line 142 的 crew 定義路徑也納入 sanitize

請跟我說，我再動手。目前不需要任何 git 操作。

📋 **Work Summary**
├─ 改了什麼：無（調查後確認 path traversal 修復已於 HEAD commit `172f950` 完成，不需要再改）
├─ 為什麼改：驗證 TASK-005 修復是否已完成
├─ 怎麼測試：
│  1. `semgrep --config p/javascript packages/server/src/routes/coding.mjs` → 0 findings
│  2. 用 node 跑 sanitizeId 範例 → 非法 id 全拋 PATH_TRAVERSAL、合法 id 通過
└─ 風險注意：已 commit，無新變更；line 142 crew 定義路徑未納入 sanitize（不同功能，超出任務範圍）
