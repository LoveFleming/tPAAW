# ---
id: ai-news-digest
name: AI News Digest
description: 摘要指定科技新聞網站當天的重點新聞
userInputs:
  - id: source_url
    label: 新聞來源網址
    description: 要摘要的新聞網站 URL
    placeholder: "https://techcrunch.com/"
   

**日期**: 2026-07-29
**耗時**: 321s
**結果**: ✅ 成功
**分支**: `dev`

## 任務

---
id: ai-news-digest
name: AI News Digest
description: 摘要指定科技新聞網站當天的重點新聞
userInputs:
  - id: source_url
    label: 新聞來源網址
    description: 要摘要的新聞網站 URL
    placeholder: "https://techcrunch.com/"
    required: true
    multiline: false
---

@@@purpose@@@
幫使用者快速掌握科技新聞網站當天的重點報導。自動抓取指定新聞來源的首頁文章，篩選出與關注關鍵字相關的內容，產出一份結構化的每日新聞摘要，節省逐一瀏覽網站的時間。

@@@inputs@@@
- **新聞來源網址** (required): 要摘要的新聞網站 URL

@@@steps@@@
### Tool Access
- 無外部工具依賴；使用 LLM 內建的網頁瀏覽能力讀取新聞來源

### Execution Steps
1. **讀取來源首頁**：前往 `source_url`（預設 https://techcrunch.com/），擷取當天首頁可見的新聞文章清單（標題、連結、簡述）
2. **關鍵字篩選**（若 `focus_keywords` 有值）：從清單中篩選標題或簡述包含任一關鍵字的文章；若無填寫則保留全部
3. **數量限制**：取前 `max_articles` 篇（預設 10 篇）；若文章總數不足則取全部
4. **逐篇摘要**：針對每篇篩選出的文章，深入讀取原文內容，產出 2-3 句重點摘要
5. **組裝輸出**：將所有摘要組裝成結構化的 Markdown 文件，包含日期、來源、文章數統計，以及每篇文章的標題、連結、摘要
6. **輸出結果**：若 `output_path` 有值則寫入檔案；否則直接顯示

### Business Rules
- 只摘要當天發布的文章；若無法判斷日期則保留但標註「日期未確認」
- 每篇摘要控制在 2-3 句，聚焦核心資訊（做了什麼、為什麼重要、影響誰）
- 關鍵字比對採不區分大小寫
- 若新聞來源無法存取或首頁無文章，回傳明確錯誤訊息
- 摘要內容忠於原文，不加入個人觀點或推測

### Error Handling
- 來源網址無法存取：回傳錯誤訊息「無法存取 {source_url}，請確認網址是否正確或網站是否可達」
- 首頁無文章或結構無法解析：回傳「無法從 {source_url} 擷取文章清單，網站結構可能已變更」
- 關鍵字篩選後無符合文章：回傳「沒有找到包含關鍵字 [{keywords}] 的文章，已改為顯示全部文章摘要」並 fallback 到未篩選結果
- 單篇文章無法讀取：跳過該篇，在摘要中標註「⚠️ 原文無法讀取，僅提供標題」

@@@output@@@


@@@guardrails@@@
- 僅摘要公開可存取的新聞文章，不嘗試繞過付費牆或登入限制
- 不產生虛構的新聞內容；若原文無法讀取則如實標註
- 不儲存或快取原文全文，僅保留摘要
- 不對新聞內容做評價或立場表態
- 遵守來源網站的 robots.txt 與使用條款

@@@validation@@@
- 確認輸出包含至少 1 篇文章摘要（除非來源確實無文章）
- 每篇摘要長度在 50-200 字之間（中文計算）
- 每篇文章的 url 為有效 HTTP/HTTPS 連結格式
- 日期欄位符合 YYYY-MM-DD 格式
- 關鍵字篩選邏輯正確：matched_keywords 僅包含 focus_keywords 中的項目
- 若 focus_keywords 為空，則 matched_keywords 陣列為空

@@@examples@@@


@@@build_log@@@
## v1 — 2026-07-22 (AI Generate)
- 初始產出：根據「摘要 TechCrunch 當天新聞」需求產生
- 推斷 userInputs：source_url、focus_keywords、max_articles、output_path
- 支援關鍵字篩選與 fallback 機制
## v2
- 摘要內容多一點 要標示 重點 特別 的地方

## AI 操作步驟

3× read_file
2× bash
1× write_file
2× edit_file
1× action_log_add

### 變更檔案
- `package/SKILL.md`
- `skill-source.md`

## Git 變更分析

### Status
```
M .paaw/CHANGELOG.md
 M .paaw/coding-memory/actions.jsonl
 M data/agent-logs/index.json
 M data/config/user.json
 D data/llm-logs/2026-07-21.jsonl
 M data/llm-logs/2026-07-29.jsonl
 M data/skills/building/ai-news-digest/package/SKILL.md
 M data/skills/building/ai-news-digest/skill-source.md
 D data/skills/building/translate/package/SKILL.md
 M data/skills/input-prompt/ai-news-digest/inputs.json
 D data/skills/physical-skill/ai-news-digest/.paaw/coding-memory/actions.jsonl
 D data/skills/physical-skill/ai-news-digest/.paaw/sessions/2026-07-23-please-use-skill-ai-news-digest-with-
 D data/skills/physical-skill/ai-news-digest/.paaw/sessions/2026-07-23-please-use-skill-ai-news-digest-with-user-inputs-from-cron-i.md
 D data/skills/physical-skill/ai-news-digest/.paaw/sessions/2026-07-24-please-use-skill-ai-news-digest-with-
 D data/skills/physical-skill/ai-news-digest/.paaw/sessions/2026-07-24-please-use-skill-ai-news-digest-with-user-inputs-from-cron-i.md
 D data/skills/physical-skill/ai-news-digest/.paaw/sessions/2026-07-26-please-use-skill-ai-news-digest-with-
 D data/skills/physical-skill/ai-news-digest/.paaw/sessions/2026-07-26-please-use-skill-ai-news-digest-with-user-inputs-from-cron-i.md
 D data/skills/physical-skill/ai-news-digest/.paaw/sessions/2026-07-27-please-use-skill-ai-news-digest-with-
 D data/skills/physical-skill/ai-news-digest/.paaw/sessions/2026-07-27-please-use-skill-ai-news-digest-with-user-inputs-from-cron-i.md
 D data/skills/physical-skill/ai-news-digest/.paaw/sessions/2026-07-29-please-use-skill-ai-news-digest-with-user-inputs-from-cron-i.md
 M data/skills/physical-skill/ai-news-digest/SKILL.md
 D data/skills/physical-skill/ai-news-digest/_cron_inputs.json
?? .paaw/sessions/2026-07-29-write-file-dataappstest-apphellotxt-hello-from-app-builder-t.md
?? data/agent-logs/task-1785312455196-sljexc.jsonl
?? data/agent-logs/task-1785312473419-i28ham.jsonl
?? data/agent-logs/task-1785312813735-i7sovk.jsonl
?? data/agent-logs/task-1785312994256-nh99c4.jsonl
?? data/agent-logs/task-1785328125176-ht88rg.jsonl
?? data/agent-logs/task-1785329250868-1kcxfc.jsonl
?? data/agent-logs/task-1785329789787-j45dwo.jsonl
?? data/agent-logs/task-1785331031337-rr6p2z.jsonl
?? data/agent-logs/task-1785331308836-ppaoxs.jsonl
?? data/agent-logs/task-1785332038694-7uk77b.jsonl
?? data/agent-logs/task-1785332038719-8qg6es.jsonl
?? data/agent-logs/task-1785332295885-4egucu.jsonl
?? data/apps/sdlc-architect/
?? data/knowledge/Pics/intro20.jpg
?? data/skills/building/ai-news-digest/.paaw/
?? data/skills/building/ai-news-digest/data/
```

### Diff Stat
```
.paaw/CHANGELOG.md                                 |   9 +
 .paaw/coding-memory/actions.jsonl                  |   1 +
 data/agent-logs/index.json                         | 108 +++++++
 data/config/user.json                              |   3 +-
 data/llm-logs/2026-07-21.jsonl                     | 131 --------
 data/llm-logs/2026-07-29.jsonl                     | 333 +++++++++++++++++++++
 .../building/ai-news-digest/package/SKILL.md       | 307 ++++++++++---------
 .../skills/building/ai-news-digest/skill-source.md | 113 +------
 data/skills/building/translate/package/SKILL.md    | 136 ---------
 .../skills/input-prompt/ai-news-digest/inputs.json |  24 --
 .../.paaw/coding-memory/actions.jsonl              |   2 -
 ...026-07-23-please-use-skill-ai-news-digest-with- |  42 ---
 ...-ai-news-digest-with-user-inputs-from-cron-i.md |  42 ---
 ...026-07-24-please-use-skill-ai-news-digest-with- |  95 ------
 ...-ai-news-digest-with-user-inputs-from-cron-i.md |  95 ------
 ...026-07-26-please-use-skill-ai-news-digest-with- |  90 ------
 ...-ai-news-digest-with-user-inputs-from-cron-i.md |  90 ------
 ...026-07-27-please-use-skill-ai-news-digest-with- |  90 ------
 ...-ai-news-digest-with-user-inputs-from-cron-i.md |  90 ------
 ...-ai-news-digest-with-user-inputs-from-cron-i.md |  40 ---
 data/skills/physical-skill/ai-news-digest/SKILL.md | 307 ++++++++++---------
 .../ai-news-digest/_cron_inputs.json               |   4 -
 22 files changed, 782 insertions(+), 1370 deletions(-)
```

## AI 回覆

## ✅ `ai-news-digest` Build 完成

阿明，Skill **v4** 編譯完成！這次是覆蓋重新編譯，確認產物內容完整：

### 編譯概要

| 項目 | 狀態 |
|------|------|
| **package/SKILL.md** | 已覆蓋寫入（~9.7KB） |
| **skill-source.md  build_log** | 已追加 v4 紀錄 |
| **Inputs** | 從 frontmatter 推斷出 4 個欄位（含 focus_keywords、max_articles、output_path） |
| **Execution Steps** | 6 大步驟 + 子步驟，含關鍵字篩選、粗體重點標示、Markdown 組裝 |
| **Error Handling** | 4 種情境（來源無法存取 / 首頁無文章 / 關鍵字 fallback / 單篇失敗不中止） |
| **Output Contract** | JSON Schema + Markdown 雙模式輸出 |
| **Validation** | 8 項 checklist |

### 下次想改什麼？

如果 Test 後需要調整（例如：換個新聞來源測試、改摘要篇幅、加其他輸出格式），直接改 `skill-source.md` 然後再叫我 Build 就行 👍
