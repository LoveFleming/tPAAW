## Purpose

幫使用者快速掌握科技新聞網站當天的重點報導。自動抓取指定新聞來源的首頁文章，篩選出與關注關鍵字相關的內容，產出一份結構化的每日新聞摘要，節省逐一瀏覽網站的時間。

## Inputs

| 欄位 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `source_url` | string | ✅ | 要摘要的新聞網站 URL。若使用者未主動提供，預設為 `https://techcrunch.com/` |
| `focus_keywords` | string[] | — | 關注關鍵字清單（可選）。用於篩選標題或簡述包含任一關鍵字的文章；若未提供則保留全部文章。支援逗號分隔輸入 |
| `max_articles` | number | — | 最大摘要篇數（可選）。預設 10 篇；若文章總數不足則取全部 |
| `output_path` | string | — | 檔案輸出路徑（可選）。若有值，將最終 Markdown 摘要寫入該路徑；否則以對話形式直接輸出 |

## Deterministic Script

### Tool Access

- 無外部工具依賴；使用 LLM 內建的網頁瀏覽能力讀取新聞來源。
- 若 `output_path` 有值，需具備 `/api/workspace/write` 或同等檔案寫入能力以輸出檔案。

### Execution Steps

1. **讀取來源首頁**
   1.1. 以 `source_url` 為目標，使用瀏覽工具讀取網站首頁 HTML。
   1.2. 從首頁 DOM 結構中擷取當天（或最近）可見的新聞文章清單，欄位至少包含：`title`（標題）、`url`（文章連結）、`excerpt`（簡述，若無則為空字串）、`published_date`（發布日期，若頁面有提供）。
   1.3. 若 `source_url` 為空，使用預設值 `https://techcrunch.com/`。

2. **關鍵字篩選**
   2.1. 若 `focus_keywords` 為空或未定義，跳至步驟 3，保留全部文章。
   2.2. 將 `focus_keywords` 統一轉為小寫，逐一檢查每篇文章的標題與簡述（皆轉小寫後比對）。
   2.3. 保留至少包含任一關鍵字的文章，記錄該篇文章命中的關鍵字至 `matched_keywords`。
   2.4. 若篩選後結果為零，觸發 **Error Handling — 關鍵字篩選後無符合文章**：回傳提示訊息，並將結果 fallback 為未篩選前的全部文章清單。

3. **數量限制**
   3.1. 以 `max_articles` 為上限（預設 10），取篩選後文章清單的前 N 篇。
   3.2. 若總數不足 N，則取全部。

4. **逐篇摘要**
   4.1. 對步驟 3 產生的每篇文章，依序使用瀏覽工具讀取原文內容。
   4.2. 產出一段式中文摘要，篇幅約 3–5 句，聚焦以下核心資訊：
     - **做了什麼**：事件或產品是什麼。
     - **為什麼重要**：該事件在產業或技術上的意義。
     - **影響誰**：潛在受眾或後續效益。
   4.3. **重點標示規則**：摘要中必須以 `**粗體**` 標示核心重點、值得特別注意或與其他新聞不同的關鍵資訊（例如關鍵數據、獨家消息、重要人物發言、技術突破等）。每篇摘要至少標示 1 處，至多 3 處。
   4.4. 摘要需忠於原文，不加入個人觀點或推測。
   4.5. 若單篇文章無法讀取，觸發 **Error Handling — 單篇文章無法讀取**：標註該篇 `read_status` 為 `failed`，`summary` 顯示「⚠️ 原文無法讀取，僅提供標題」，結束該篇處理並繼續下一篇。

5. **組裝輸出**
   5.1. 收集當天日期（YYYY-MM-DD 格式）與來源網站網址。
   5.2. 將所有文章摘要組裝成 Markdown 文件，結構如下：
     - 標題 `# AI News Digest — {YYYY-MM-DD}`
     - 來源：`{source_url}`
     - 統計：共找到 {total_found} 篇，本次摘要 {filtered_count} 篇（若 `focus_keywords` 有值，顯示關鍵字：{keywords}）
     - 分隔線 `---`
     - 每篇文章區塊：
       - `## {title}`
       - 連結：`{url}`
       - 發布日期（若有）：`{published_date}`（若無法判斷則標註「日期未確認」）
       - 命中關鍵字（若 `matched_keywords` 非空）：`🎯 {keywords}`
       - 摘要內容（Markdown 段落）
   5.3. 若 `output_path` 有值，將 Markdown 內容寫入該路徑，結束後向使用者回覆檔案路徑與簡短統計。
   5.4. 若 `output_path` 無值，直接在對話中輸出完整 Markdown 內容。

### Business Rules

- **日期原則**：優先只摘要當天發布的文章；若網站未標示日期或無法判斷，則保留該篇但標註「日期未確認」。
- **摘要篇幅**：每篇摘要為一段式，約 3–5 句中文，聚焦「做了什麼、為什麼重要、影響誰」。
- **重點標示**：摘要中必須以 `**粗體**` 標示核心重點或特別值得注意之處，每篇至少 1 處、至多 3 處。
- **關鍵字比對**：採不區分大小寫的比對方式。
- **內容忠實**：摘要內容必須忠於原文，**禁止加入個人觀點、推測或虛構內容**。
- **數量限制**：最大摘要篇數以 `max_articles` 為準（預設 10 篇），不足則取全部。
- **Fallback 機制**：若關鍵字篩選後無符合文章，**必須**回傳提示並 fallback 顯示全部文章，不可直接回傳空結果。

### Error Handling

| 情境 | 處理方式 |
|------|----------|
| **來源網址無法存取** | 停止執行，回傳錯誤訊息：「無法存取 {source_url}，請確認網址是否正確或網站是否可達」。不嘗試重試超過 1 次。 |
| **首頁無文章或結構無法解析** | 停止執行，回傳錯誤訊息：「無法從 {source_url} 擷取文章清單，網站結構可能已變更」。 |
| **關鍵字篩選後無符合文章** | 回傳提示訊息：「沒有找到包含關鍵字 [{keywords}] 的文章，已改為顯示全部文章摘要」，並將結果 fallback 為未篩選前的全部文章清單後續續執行。 |
| **單篇文章無法讀取** | **不**停止整體流程。跳過該篇，在輸出中標註 `⚠️ 原文無法讀取，僅提供標題`，繼續處理下一篇文章。 |

## Guardrails

- 僅摘要公開可存取的新聞文章，不嘗試繞過付費牆或登入限制。
- 不產生虛構的新聞內容；若原文無法讀取則如實標註，而非自行推測填補。
- 不儲存或快取原文全文，僅保留摘要結果。
- 不對新聞內容做評價或立場表態，保持中立。
- 遵守來源網站的 `robots.txt` 與使用條款；若網站明確禁止爬取，應停止並通知使用者。

## Output Contract

### 輸出模式

- 若 `output_path` 未提供：直接在對話中回覆 Markdown 格式的每日新聞摘要。
- 若 `output_path` 有提供：將 Markdown 內容寫入指定檔案路徑，並在對話中回覆檔案路徑與簡短統計資訊。

### JSON Schema（適用於需要結構化輸出的場景）

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["date", "source", "total_found", "filtered_count", "articles"],
  "properties": {
    "date": {
      "type": "string",
      "format": "date",
      "description": "摘要日期，YYYY-MM-DD 格式"
    },
    "source": {
      "type": "string",
      "format": "uri",
      "description": "新聞來源網址"
    },
    "total_found": {
      "type": "integer",
      "minimum": 0,
      "description": "首頁擷取到的文章總數"
    },
    "filtered_count": {
      "type": "integer",
      "minimum": 0,
      "description": "本次實際摘要的文章數量"
    },
    "focus_keywords": {
      "type": "array",
      "items": { "type": "string" },
      "description": "使用者提供的篩選關鍵字；若未提供則為空陣列"
    },
    "articles": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["title", "url", "summary", "read_status"],
        "properties": {
          "title": {
            "type": "string",
            "description": "文章標題"
          },
          "url": {
            "type": "string",
            "format": "uri",
            "description": "文章原始連結（HTTP/HTTPS）"
          },
          "summary": {
            "type": "string",
            "minLength": 50,
            "maxLength": 400,
            "description": "文章重點摘要，包含粗體標示的重點"
          },
          "published_date": {
            "type": "string",
            "format": "date",
            "description": "文章發布日期（YYYY-MM-DD）；若無法判斷則為 null 或標註為日期未確認"
          },
          "matched_keywords": {
            "type": "array",
            "items": { "type": "string" },
            "description": "該篇文章命中 focus_keywords 的項目；若 focus_keywords 為空則為空陣列"
          },
          "read_status": {
            "type": "string",
            "enum": ["success", "failed"],
            "description": "原文讀取狀態：success 表示成功摘要；failed 表示原文無法讀取"
          }
        }
      }
    }
  }
}
```

## Validation

- [ ] 確認輸出包含至少 1 篇文章摘要，除非來源首頁確實無任何文章（此時應觸發 Error Handling）。
- [ ] 每篇摘要長度在 50–400 字之間（中文計算），且至少包含 1 處 `**粗體**` 重點標示。
- [ ] 每篇文章的 `url` 為有效的 `http://` 或 `https://` 連結格式。
- [ ] `date` 欄位符合 `YYYY-MM-DD` 格式。
- [ ] `published_date`（若有值）符合 `YYYY-MM-DD` 格式；若無法判斷則標註為「日期未確認」。
- [ ] 關鍵字篩選邏輯正確：`matched_keywords` 僅包含 `focus_keywords` 中的項目，且不區分大小寫。
- [ ] 若 `focus_keywords` 為空或未提供，則所有文章的 `matched_keywords` 皆為空陣列。
- [ ] 摘要內容不得包含虛構資訊或個人評價，必須忠於原文。
