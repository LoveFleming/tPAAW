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

# AI News Digest

## Purpose

幫使用者快速掌握科技新聞網站當天的重點報導。自動抓取指定新聞來源的首頁文章，篩選出與關注關鍵字相關的內容，產出一份結構化的每日新聞摘要，節省逐一瀏覽網站的時間。

## Inputs

- **新聞來源網址** (`source_url`, 必填)：要摘要的新聞網站 URL，例如 `https://techcrunch.com/`
- **關鍵字篩選** (`focus_keywords`, 選填)：只關注包含這些關鍵字的新聞，以逗號分隔。留空則不篩選，回傳全部文章。例如 `AI, LLM, startup`
- **最大文章數** (`max_articles`, 選填)：最多摘要幾篇文章，預設為 10
- **輸出路徑** (`output_path`, 選填)：留空則結果直接顯示；填入絕對路徑則存成 Markdown 檔案。支援 `{{PAAW_ROOT}}` 作為專案根目錄代稱

## Deterministic Script

### Tool Access

- LLM 內建網頁瀏覽能力 — 讀取新聞來源首頁及各文章頁面
- `file_write` (PAAW Tool) — 當 `output_path` 有值時，將結果寫入指定路徑

### Execution Steps

#### 步驟一：參數預設與正規化

1. 若 `source_url` 為空，使用預設值 `https://techcrunch.com/`
2. 正規化 `source_url`：確保以 `http://` 或 `https://` 開頭；若無協定前綴則自動補上 `https://`
3. 解析 `focus_keywords`：若有值則以逗號分隔拆分為陣列，去除前後空白，轉為小寫供比對；若為空則設為空陣列 `[]`
4. 解析 `max_articles`：若為空或非正整數，使用預設值 `10`；若為有效正整數則使用該值
5. 解析 `output_path`：若非空，將 `{{PAAW_ROOT}}` 代換為實際專案根目錄路徑

#### 步驟二：讀取來源首頁

1. 前往 `source_url`，擷取首頁內容
2. 從首頁中辨識所有新聞文章項目，每篇提取：
   - `title`：文章標題
   - `url`：文章連結（相對路徑需轉為絕對 URL）
   - `snippet`：首頁可見的簡述或副標題（若有）
   - `date`：發布日期（若有顯示）
3. 將所有文章集合成 `articles_raw` 清單
4. 記錄 `total_fetched = len(articles_raw)`

#### 步驟三：關鍵字篩選

1. 若 `focus_keywords` 為空陣列，跳過篩選，`articles_filtered = articles_raw`
2. 若 `focus_keywords` 非空，逐一比對每篇文章的 `title` 和 `snippet`：
   - 比對邏輯：不區分大小寫，檢查是否包含任一關鍵字
   - 為每篇符合的文章記錄 `matched_keywords`（符合了哪些關鍵字）
3. `articles_filtered` = 通過篩選的文章
4. **Fallback 機制**：若篩選後 `articles_filtered` 為空，回歸 `articles_raw`，並在輸出中標註「沒有找到包含關鍵字 [{keywords}] 的文章，已改為顯示全部文章摘要」

#### 步驟四：數量限制

1. 從 `articles_filtered` 取前 `max_articles` 篇
2. 若文章總數不足 `max_articles`，取全部
3. 記錄 `total_summarized = len(最終清單)`

#### 步驟五：逐篇深入摘要

1. 針對清單中每篇文章，逐一前往其 `url` 讀取原文
2. 基於原文內容，產出 2-3 句重點摘要，聚焦：
   - **做了什麼**：事件或產品的核心事實
   - **為什麼重要**：產業影響或技術突破
   - **影響誰**：受影響的族群或市場
3. 每篇摘要控制在 50-200 字（中文計算）
4. 若文章發布日期可從原文頁面確認，更新 `date`；若無法判斷，標註「日期未確認」
5. 若單篇文章無法讀取（404、付費牆、連線錯誤等），跳過深入摘要，改為：
   - `summary` = "⚠️ 原文無法讀取，僅提供標題"
   - 保留 `title` 和 `url`

#### 步驟六：組裝 Markdown 輸出

1. 組裝文件標頭：
   ```
   # 📰 AI News Digest — {YYYY-MM-DD}

   **來源**：{source_url}
   **擷取文章數**：{total_fetched} | **摘要文章數**：{total_summarized}
   **關鍵字篩選**：{focus_keywords 以逗號連接，或「無」}
   ```
2. 若步驟三觸發了 fallback，額外加上：
   ```
   ⚠️ 沒有找到包含關鍵字 [{keywords}] 的文章，已改為顯示全部文章摘要
   ```
3. 加入分隔線 `---`
4. 逐一列出每篇文章，格式：
   ```
   ## {序號}. {文章標題}
   🔗 {文章 url}
   📅 {發布日期} | 🏷️ {matched_keywords 以逗號連接，或留空}

   {摘要內容}
   ```
5. 同時組裝 JSON 結構（見 Output Contract）

#### 步驟七：輸出結果

1. 若 `output_path` 為空：
   - 將 Markdown 內容直接顯示給使用者
   - 同時回傳 JSON 結構供程式化使用
2. 若 `output_path` 非空：
   - 將 Markdown 內容寫入 `output_path` 指定的檔案
   - 確認檔案寫入成功，回傳確認訊息：「✅ 已儲存至 {output_path}」
   - 若寫入失敗，回傳錯誤：「❌ 無法寫入 {output_path}：{錯誤原因}」並改為直接顯示結果

### Business Rules

1. **只摘要當天文章**：優先篩選發布日期為當日的文章；若無法判斷日期則保留但標註「日期未確認」
2. **摘要忠於原文**：不加入個人觀點、評價或推測；只陳述事實
3. **關鍵字比對不區分大小寫**：`AI` 可匹配 `ai`、`Ai`、`AI` 等
4. **付費牆處理**：若文章受付費牆限制，不嘗試繞過；標註「⚠️ 付費牆限制，僅提供標題與可見片段」
5. **URL 正規化**：首頁上的相對連結（如 `/article/123`）一律轉為絕對 URL
6. **最小讀取原則**：只讀取首頁和通過篩選的文章頁面，不遞迴爬取其他頁面

### Error Handling

#### 情境一：來源網址無法存取

- **偵測條件**：前往 `source_url` 時連線失敗、DNS 解析錯誤、或 HTTP 狀態碼 ≥ 400
- **處理方式**：立即終止流程，回傳錯誤訊息「❌ 無法存取 {source_url}，請確認網址是否正確或網站是否可達」
- **回傳結構**：
  ```json
  {
    "date": "{today}",
    "source_url": "{source_url}",
    "total_fetched": 0,
    "total_summarized": 0,
    "focus_keywords": [],
    "articles": [],
    "error": "無法存取 {source_url}，請確認網址是否正確或網站是否可達"
  }
  ```

#### 情境二：首頁無文章或結構無法解析

- **偵測條件**：成功存取 `source_url` 但無法辨識任何文章項目（首頁結構不包含常見的文章標題/連結模式）
- **處理方式**：回傳「❌ 無法從 {source_url} 擷取文章清單，網站結構可能已變更」
- **回傳結構**：
  ```json
  {
    "date": "{today}",
    "source_url": "{source_url}",
    "total_fetched": 0,
    "total_summarized": 0,
    "focus_keywords": [],
    "articles": [],
    "error": "無法從 {source_url} 擷取文章清單，網站結構可能已變更"
  }
  ```

#### 情境三：關鍵字篩選後無符合文章（已內建於步驟三）

- **偵測條件**：`articles_filtered` 為空但 `articles_raw` 非空
- **處理方式**：Fallback 到未篩選結果，在輸出中標註「⚠️ 沒有找到包含關鍵字 [{keywords}] 的文章，已改為顯示全部文章摘要」

#### 情境四：單篇文章無法讀取（已內建於步驟五）

- **偵測條件**：前往文章 URL 時回傳 404、連線逾時、或其他讀取錯誤
- **處理方式**：跳過深入摘要，以 `⚠️ 原文無法讀取，僅提供標題` 作為 summary，保留 title 和 url

#### 情境五：輸出路徑寫入失敗

- **偵測條件**：`file_write` 回傳錯誤（路徑不存在、權限不足等）
- **處理方式**：回傳「❌ 無法寫入 {output_path}：{錯誤原因}」並改為直接顯示結果，確保使用者仍可取得摘要

## Guardrails

1. **僅摘要公開內容**：不嘗試繞過付費牆、登入限制、或任何存取控制
2. **不虛構新聞**：若原文無法讀取則如實標註，絕不編造新聞內容或細節
3. **不快取原文全文**：僅保留 2-3 句摘要，不儲存或暫存原文完整內容
4. **不表態立場**：摘要保持中立客觀，不對新聞內容做價值判斷或立場表態
5. **遵守網站規範**：尊重來源網站的 robots.txt 與使用條款，不做高頻率請求
6. **單次執行限制**：每次執行最多讀取 `max_articles` 篇文章原文，不超量爬取
7. **敏感資訊排除**：若文章內容涉及個人隱私資料，摘要中不包含可識別的個資

## Output Contract

**輸出模式：both**（直接顯示 + 可選寫入檔案）

```json
{
  "mode": "both",
  "formats": {
    "display": "markdown",
    "file": "markdown"
  },
  "schema": {
    "type": "object",
    "properties": {
      "date": {
        "type": "string",
        "description": "摘要日期 (YYYY-MM-DD)"
      },
      "source_url": {
        "type": "string",
        "description": "新聞來源網址"
      },
      "total_fetched": {
        "type": "integer",
        "description": "首頁擷取到的文章總數"
      },
      "total_summarized": {
        "type": "integer",
        "description": "實際摘要的文章數"
      },
      "focus_keywords": {
        "type": "array",
        "items": { "type": "string" },
        "description": "使用的篩選關鍵字；未篩選時為空陣列"
      },
      "articles": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "title": {
              "type": "string",
              "description": "文章標題"
            },
            "url": {
              "type": "string",
              "description": "文章連結（絕對 URL）"
            },
            "summary": {
              "type": "string",
              "description": "2-3 句重點摘要（50-200 字）"
            },
            "date": {
              "type": "string",
              "description": "文章發布日期 (YYYY-MM-DD)，無法確認則標註「日期未確認」"
            },
            "matched_keywords": {
              "type": "array",
              "items": { "type": "string" },
              "description": "符合的關鍵字；未使用篩選時為空陣列"
            }
          },
          "required": ["title", "url", "summary"]
        }
      },
      "error": {
        "type": "string",
        "description": "錯誤訊息（僅在發生錯誤時出現）"
      },
      "fallback_note": {
        "type": "string",
        "description": "Fallback 提示（僅在關鍵字篩選無結果時出現）"
      },
      "file_path": {
        "type": "string",
        "description": "寫入的檔案路徑（僅在 output_path 有值且寫入成功時出現）"
      }
    },
    "required": ["date", "source_url", "total_fetched", "total_summarized", "articles"]
  }
}
```

**Markdown 輸出範例**：

```
# 📰 AI News Digest — 2026-07-22

**來源**：https://techcrunch.com/
**擷取文章數**：25 | **摘要文章數**：8
**關鍵字篩選**：AI, LLM, startup

---

## 1. OpenAI 推出 GPT-5 Turbo
🔗 https://techcrunch.com/2026/07/22/openai-gpt5-turbo/
📅 2026-07-22 | 🏷️ AI, LLM

OpenAI 今日發布 GPT-5 Turbo，推理速度較前代提升 3 倍，成本降低 40%。該模型首次支援原生多模態串流輸出，預計下週開放 API 測試。

## 2. Anthropic 完成 $5B 新一輪融資
🔗 https://techcrunch.com/2026/07/22/anthropic-5b-funding/
📅 2026-07-22 | 🏷️ AI, startup

Anthropic 宣布完成 50 億美元 D 輪融資，估值突破 $100B。資金將用於擴大 Claude 企業版佈署及安全研究團隊，被視為 AI 安全賽道的最大單筆投資。
```

## Validation

1. **至少 1 篇摘要**：`articles` 陣列長度 ≥ 1（除非來源確實無文章，此時須有 `error` 欄位說明）
2. **摘要長度**：每篇 `summary` 在 50-200 字之間（中文字數計算）；超出或不足應調整
3. **URL 格式**：每篇文章的 `url` 必須為有效的 `http://` 或 `https://` 開頭的絕對 URL
4. **日期格式**：`date` 欄位符合 `YYYY-MM-DD` 格式，或標註「日期未確認」
5. **關鍵字一致性**：`matched_keywords` 僅可包含 `focus_keywords` 中的項目；`focus_keywords` 為空時 `matched_keywords` 必須為空陣列
6. **必填欄位完整**：每篇 article 必須包含 `title`、`url`、`summary` 三個 required 欄位
7. **數字一致性**：`total_summarized` 必須等於 `articles` 陣列長度；`total_fetched` 必須 ≥ `total_summarized`
8. **max_articles 上限**：`total_summarized` 不得超過 `max_articles` 的值
