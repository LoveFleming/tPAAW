---
id: techcrunch-digest
name: TechCrunch Digest
version: 1.0.0
description: 抓取 TechCrunch 當日新聞 RSS，產出結構化中文摘要報告
category: generation
tags:
  - news
  - digest
  - techcrunch
  - rss
userInputs:
  - id: limit
    label: 文章數量
    description: 最多抓取幾篇文章
    placeholder: "10"
    required: false
    type: text
---

@@@purpose@@@
自動抓取 TechCrunch 當日最新新聞，分類整理成中文摘要報告，節省逐一瀏覽的時間。

@@@steps@@@
### Tool Access
- `run_script`：可執行 skill 目錄內的 `fetch_rss.py`，抓 TechCrunch RSS feed

### Execution Steps
1. **抓取新聞**：呼叫 `run_script`，執行 `fetch_rss.py`，取得當日 TechCrunch 文章列表
   - 參數：`{"script": "fetch_rss.py", "args": ["{{limit}}"]}`
   - 如果 `{{limit}}` 為空，傳 `["10"]`
2. **分類**：根據標題和描述將文章分類（AI、Startup、Space、Hardware、Crypto、Policy、EV 等）
3. **逐篇摘要**：為每篇文章寫 1-2 句中文重點摘要
4. **趨勢分析**：總結今天新聞的整體趨勢和重點主題
5. **輸出格式**：

```
# 📰 TechCrunch 每日新聞摘要 — [日期]

## 今日重點
- （3-5 個重點趨勢）

## 分類新聞

### 🤖 AI
| 標題 | 摘要 |
|---|---|
| ... | ... |

### 🚀 Startup
...

## 📊 統計
- 總文章數：X
- 分類分佈：AI X篇, Startup X篇, ...
```

### Business Rules
- 摘要用中文撰寫
- 標題保留原文（英文）
- 只根據 script 抓回的真實資料摘要，不編造內容
- 保留原文連結

@@@guardrails@@@
- 必須先呼叫 `run_script` 取得真實資料，不憑空捏造新聞
- 只摘要 script 回傳的文章，不自行新增

@@@output@@@
Markdown 格式的新聞摘要報告
