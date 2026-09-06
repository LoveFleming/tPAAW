# 修復 server/conversation.mjs 的 path traversal 漏洞（Semgrep finding 歸零）：

1. 新增 sanitizeId(id) 工具函數，用白名單正則 ^[a-zA-Z0-9_-]+$ 驗證 crewId / sessionId
2. 在 loadConversation、saveConversation、archiveConversation、

**日期**: 2026-08-03
**耗時**: 229s
**結果**: ✅ 成功
**分支**: `dev`

## 任務

修復 server/conversation.mjs 的 path traversal 漏洞（Semgrep finding 歸零）：

1. 新增 sanitizeId(id) 工具函數，用白名單正則 ^[a-zA-Z0-9_-]+$ 驗證 crewId / sessionId
2. 在 loadConversation、saveConversation、archiveConversation、listArchives、loadArchive 入口處呼叫 sanitizeId 驗證 crewId
3. 在 loadArchive 入口處驗證 sessionId
4. 非法輸入時拋出明確的 Error（帶 code，例如 PATH_TRAVERSAL）

先 read_file server/conversation.mjs 確認現有結構再改。改完 commit，message 用 Conventional Commits（fix(security): ...）。

## AI 操作步驟

19× bash
1× project_info
4× grep
8× read_file
1× ask_user
2× edit_file

### 變更檔案
- `/Users/steward/App/tPAAW/packages/server/src/routes/coding.mjs`
- `packages/server/src/routes/coding.mjs`

## Git 變更分析

### Status
```
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
?? packages/server/test.txt
```

### Diff Stat
```
data/config/backup.json                            |  2 +-
 data/config/recent-projects.json                   |  2 +-
 .../physical-skill/translate/.paaw/CHANGELOG.md    |  9 ++
 data/workspaces.json                               |  4 +-
 logs/cron/cron-1782007179382/history.jsonl         |  2 +
 logs/cron/cron-ai-daily-digest/history.jsonl       |  2 +
 logs/cron/system-daily-backup/history.jsonl        |  4 +
 logs/cron/system-daily-log-purge/history.jsonl     |  4 +
 logs/cron/test/history.jsonl                       |  2 +
 packages/server/src/routes/coding.mjs              | 96 +++++++++++++++++++---
 10 files changed, 113 insertions(+), 14 deletions(-)
```
