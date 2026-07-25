---
id: news-summarizer
name: News Summarizer
version: 1.0.0
description: 將抓取的新聞資料整理成結構化摘要報告
category: generation
tags:
  - news
  - summary
  - digest
userInputs:
  - id: news_data
    label: 新聞資料
    description: Tool 抓取的新聞 JSON 資料
    required: true
    type: text
    multiline: true
  - id: source_name
    label: 來源名稱
    description: 新聞來源
    placeholder: "TechCrunch"
    required: false
    type: text
---

@@@purpose@@@
將已抓取的新聞資料（JSON 格式）整理成易讀的摘要報告，包含每篇新聞的重點、分類和整體趨勢分析。

@@@input@@@
來源：{{source_name}}

新聞資料：
```
{{news_data}}
```

@@@steps@@@
### Tool Access
- 無外部工具依賴

### Execution Steps
1. **解析輸入**：讀取上面的「新聞資料」，裡面包含 articles 陣列（每篇有 title, link, pubDate, description）
2. **分類**：根據標題和描述將文章分類（AI、Startup、Hardware、Crypto、Policy 等）
3. **逐篇摘要**：為每篇文章寫 1-2 句中文重點摘要
4. **趨勢分析**：總結今天新聞的整體趨勢和重點主題
5. **輸出格式**：

```
# 📰 [來源] 每日新聞摘要 — [日期]

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
- 如果文章少於 3 篇，提示資料不足

@@@output@@@
Markdown 格式的新聞摘要報告

@@@guardrails@@@
- 只根據提供的新聞資料摘要，不自行編造內容
- 保留原文連結供使用者點擊查看全文
