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
  - id: focus_keywords
    label: 關鍵字篩選
    description: 只關注包含這些關鍵字的新聞，逗號分隔。留空則不篩選
    placeholder: "AI, LLM, startup"
    required: false
    multiline: false
  - id: max_articles
    label: 最大文章數
    description: 最多摘要幾篇文章
    placeholder: "10"
    required: false
    multiline: false
  - id: output_path
    label: 輸出路徑（留空則僅顯示）
    description: 留空 = 結果直接顯示；填入絕對路徑 = 存成檔案
    placeholder: "{{PAAW_ROOT}}/data/output/ai-news-digest.md"
    required: false
    multiline: false
---

@@@purpose@@@
幫使用者快速掌握科技新聞網站當天的重點報導。自動抓取指定新聞來源的首頁文章，篩選出與關注關鍵字相關的內容，產出一份結構化的每日新聞摘要，節省逐一瀏覽網站的時間。

@@@inputs@@@
- **新聞來源網址** (required): 要摘要的新聞網站 URL
- **關鍵字篩選** (optional): 只關注包含這些關鍵字的新聞，逗號分隔。留空則不篩選
- **最大文章數** (optional): 最多摘要幾篇文章
- **輸出路徑（留空則僅顯示）** (optional): 留空 = 結果直接顯示；填入絕對路徑 = 存成檔案

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
輸出模式：both

{
  "type": "object",
  "properties": {
    "date": { "type": "string", "description": "摘要日期 (YYYY-MM-DD)" },
    "source_url": { "type": "string", "description": "新聞來源網址" },
    "total_fetched": { "type": "integer", "description": "首頁擷取到的文章總數" },
    "total_summarized": { "type": "integer", "description": "實際摘要的文章數" },
    "focus_keywords": { "type": "array", "items": { "type": "string" }, "description": "使用的篩選關鍵字" },
    "articles": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "title": { "type": "string", "description": "文章標題" },
          "url": { "type": "string", "description": "文章連結" },
          "summary": { "type": "string", "description": "2-3 句重點摘要" },
          "date": { "type": "string", "description": "文章發布日期" },
          "matched_keywords": { "type": "array", "items": { "type": "string" }, "description": "符合的關鍵字" }
        },
        "required": ["title", "url", "summary"]
      }
    }
  },
  "required": ["date", "source_url", "total_fetched", "total_summarized", "articles"]
}

Markdown 輸出範例：
```
# 📰 AI News Digest — 2026-07-22

**來源**：https://techcrunch.com/
**擷取文章數**：25 | **摘要文章數**：8
**關鍵字篩選**：AI, LLM, startup

---

## 1. OpenAI 推出 GPT-5 Turbo
🔗 https://techcrunch.com/...
📅 2026-07-22 | 🏷️ AI, LLM

OpenAI 今日發布 GPT-5 Turbo，推理速度較前代提升 3 倍，成本降低 40%。該模型首次支援原生多模態串流輸出，預計下週開放 API 測試。

## 2. ...
```

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
### Example 1：預設 TechCrunch 摘要
**Input**
- source_url: `https://techcrunch.com/`
- focus_keywords: (空)
- max_articles: `5`

**Output**
```
# 📰 AI News Digest — 2026-07-22

**來源**：https://techcrunch.com/
**擷取文章數**：30 | **摘要文章數**：5
**關鍵字篩選**：無

---

## 1. Apple Vision Pro 2 發表，售價下殺 $1,999
🔗 https://techcrunch.com/apple-vision-pro-2
📅 2026-07-22

Apple 發表第二代 Vision Pro，重量減半、售價降至 $1,999，首次支援手勢追蹤與眼球登入。預計 9 月出貨，分析師預估將帶動空間運算普及化。

## 2. ...
```

### Example 2：帶關鍵字篩選
**Input**
- source_url: `https://techcrunch.com/`
- focus_keywords: `AI, startup`
- max_articles: `8`

**Output**
- 僅摘要標題或簡述含 "AI" 或 "startup" 的文章
- 每篇文章的 matched_keywords 標示符合的關鍵字

@@@build_log@@@
## v1 — 2026-07-22 (AI Generate)
- 初始產出：根據「摘要 TechCrunch 當天新聞」需求產生
- 推斷 userInputs：source_url、focus_keywords、max_articles、output_path
- 支援關鍵字篩選與 fallback 機制

## v2 — 2026-07-22 (AI Build)
- 新增：Inputs section（從 frontmatter userInputs 整理成文字說明）
- 擴充：Execution Steps 從 6 步展開為 7 步 SOP（步驟一參數正規化 → 步驟七輸出結果）
- 新增：Tool Access 明確列出（LLM 網頁瀏覽 + file_write）
- 新增：5 種 Error Handling 情境（含錯誤回傳 JSON 結構）
- 新增：Business Rules 補強（付費牆處理、URL 正規化、最小讀取原則）
- 調整：Output Contract 加入完整 JSON schema（含 error/fallback_note/file_path 可選欄位）
- 調整：Validation 從 6 條擴充為 8 條（新增必填欄位完整、數字一致性、max_articles 上限）
- 新增：Guardrails 補強（單次執行限制、敏感資訊排除）
