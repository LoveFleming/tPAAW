# 修 `server/conversation.mjs` 的 path traversal（TASK-005）。現況：檔案 5 個入口（loadConversation l24、saveConversation l37、archiveConversation l44、listArchives l62、loadArchive l85）都用 `join(CONV_DIR, crewId)` 直接拼接用戶

**日期**: 2026-08-03
**耗時**: 400s
**結果**: ✅ 成功
**分支**: `dev`

## 任務

修 `server/conversation.mjs` 的 path traversal（TASK-005）。現況：檔案 5 個入口（loadConversation l24、saveConversation l37、archiveConversation l44、listArchives l62、loadArchive l85）都用 `join(CONV_DIR, crewId)` 直接拼接用戶輸入的 crewId，無任何 sanitize，可路徑穿越（如 crewId=`../..`）。

請實作一個 `sanitizeId(id)` helper：只允許安全的 identifier 字元（建議 `/^[a-zA-Z0-9_-]+$/`），不合法就 throw `Error("Invalid crew id")`。然後 5 個入口在 join 前都先呼叫 `sanitizeId(crewId)`。sessionId（loadArchive 的 sessionId 參數）也一併 sanitize。做法：複用或仿照 tool-loader 的 safeResolve pattern 亦可，但最簡潔是 sanitizeId regex。

完工後跑 `node --test server/conversation.test.mjs`（若無此測試檔就建立，覆蓋正常 id 與穿越 id 被擋）；跑 `npm run build`（如果有）；確認無 uncommitted 殘留。commit message 用 Conventional Commits（type: fix, scope: conversation），`fix(conversation): sanitize crew/session id against path traversal`。禁止 push。

## AI 操作步驟

2× glob
20× bash
4× read_file
1× grep
1× task_list
1× ask_user
3× write_file
1× edit_file

### 變更檔案
- `packages/server/src/lib/coding-security.mjs`
- `packages/server/src/routes/coding.mjs`
- `tests/unit/conversation-sanitize.test.mjs`

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
 M packages/server/src/routes/coding.mjs
?? .paaw/auto-dispatch/plans/ns-2026-08-03-tPAAW.json
?? .paaw/sessions/2026-08-03-serverconversationmjs-path-traversal-critical-semgrep-crewid.md
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
?? logs/vibe-sessions/pty-1785760988717-apc3.json
?? logs/vibe-sessions/pty-1785760988717-apc3.log
?? logs/vibe-sessions/pty-1785761603032-zj0c.json
?? logs/vibe-sessions/pty-1785761603032-zj0c.log
?? logs/vibe-sessions/pty-1785762709321-ifin.json
?? logs/vibe-sessions/pty-1785762709321-ifin.log
?? packages/server/src/lib/coding-security.mjs
?? packages/server/test.txt
?? tests/unit/conversation-sanitize.test.mjs
```

### Diff Stat
```
.paaw/CHANGELOG.md                                    | 11 +++++++++++
 .paaw/coding-memory/actions.jsonl                     |  1 +
 .paaw/staged-changes.json                             | 18 ++++++++++--------
 data/config/backup.json                               |  2 +-
 data/config/recent-projects.json                      |  2 +-
 .../physical-skill/translate/.paaw/CHANGELOG.md       |  9 +++++++++
 data/workspaces.json                                  |  4 +++-
 logs/cron/cron-1782007179382/history.jsonl            |  2 ++
 logs/cron/cron-ai-daily-digest/history.jsonl          |  2 ++
 logs/cron/system-daily-backup/history.jsonl           |  4 ++++
 logs/cron/system-daily-log-purge/history.jsonl        |  4 ++++
 logs/cron/test/history.jsonl                          |  2 ++
 packages/server/src/routes/coding.mjs                 | 19 ++-----------------
 13 files changed, 52 insertions(+), 28 deletions(-)
```
