---
id: translate
name: 我的翻譯
version: 1.0.0
description: 將文字翻譯為目標語言，同時識別特殊詞彙（成語、俚語、專業術語），產出學習筆記
category: generation
tags:
  - translate
  - learning
  - vocabulary
userInputs:
  - id: output_path
    label: 輸出路徑
    description: Skill 執行結果的儲存路徑
    placeholder: "例：/Users/xxx/App/tAgent/data/output/translation.md"
    required: true
    type: text
    multiline: false
  - id: _
    label: 輸入你要翻譯的內容
    description: 要翻譯的原文文字
    placeholder: "貼上你想翻譯的內容"
    required: true
    type: textarea
    multiline: true
---

# 我的翻譯

## Purpose
將使用者輸入的文字翻譯為目標語言（預設中→英），同時識別特殊詞彙（成語、俚語、專業術語），產出一份完整的 Translation Learning Output markdown 學習筆記。

## Inputs
- **輸出路徑** (`output_path`, required)：Skill 執行結果的儲存路徑（絕對路徑），指向一個 `.md` 檔案。例如 `{{PAAW_ROOT}}/data/output/translation.md`
- **輸入你要翻譯的內容** (`_`, required)：要翻譯的原文文字，支援多行

## Deterministic Script

### Tool Access
- `/api/workspace/write` — 將翻譯結果寫入指定的 markdown 檔案
- 不需要其他外部 API 或網路連線

### Execution Steps
1. **解析輸入內容**
   - 從 `_` 取得原文
   - 偵測原文語言（若含中文字元則來源語言為 `zh-TW`，否則為 `en`）
   - 目標語言固定為 `en`（若原文為英文則目標語言改為 `zh-TW`）
   - 從 `output_path` 取得輸出檔案路徑

2. **執行翻譯**
   - 將原文翻譯成目標語言，保持自然流暢
   - 保留原文語氣和情感
   - 專有名詞（人名、地名、品牌名）保留原文不翻譯
   - 同時產生兩個版本：
     - **Natural Translation**：自然流暢的翻譯
     - **Simple Translation**：用更簡單的字彙和句型重述

3. **識別特殊詞彙**
   - 掃描原文和譯文中出現的特殊詞彙：
     - 成語／慣用語（如「畫蛇添足」→ "gild the lily"）
     - 俚語／口語（如「超夯」→ "trending"）
     - 雙關語
     - 專業術語（法律、醫學、科技等領域）
   - 每個詞彙標註：詞彙本身、中文釋義、英文對應

4. **產生學習輔助內容**
   - 為每個特殊詞彙撰寫一個例句（必須包含該詞彙）
   - 從原文中抽取一個實用句構（Sentence Pattern）
   - 撰寫 Speaking Version：更口語、更自然的說法
   - 指出一個常見錯誤（Common Mistake），包含錯誤用法和修正
   - 撰寫一句值得記住的句子（One Sentence to Remember）

5. **組裝輸出**
   - 按照 Output 格式組裝完整的 markdown 內容
   - 表格格式正確，欄位對齊
   - 確保所有 placeholder 都被實際內容取代

6. **寫入檔案**
   - 將完整 markdown 寫入 `output_path` 指定的路徑（必須是絕對路徑）
   - 若目錄不存在則自動建立
   - 回覆使用者「已產生翻譯學習筆記：{output_path}」

### Business Rules
- 目標語言與來源語言不可相同（若相同則自動切換為中英互譯）
- Key Vocabulary 至少列出 3 個詞彙
- 例句必須是真實包含該詞彙的完整句子
- Sentence Pattern 必須從原文或譯文中抽取，不可憑空捏造
- Speaking Version 必須是口語自然的版本，不可與 Natural Translation 完全相同

### Error Handling
1. **輸入為空或過短**：原文少於 2 個字元時，回覆錯誤訊息「原文內容過短，請提供至少 2 個字以上的文字」，不產生輸出檔案
2. **輸出路徑無效**：路徑包含非法字元（如 `* ? < > |`）時，回覆錯誤訊息「輸出路徑包含非法字元，請使用有效的檔案路徑」，並建議使用絕對路徑格式（例如 `{{PAAW_ROOT}}/data/output/translation.md`）
3. **寫入失敗**：若目標目錄無法寫入（權限不足或磁碟空間不足），回覆錯誤訊息「無法寫入指定路徑，請檢查目錄權限或磁碟空間」

## Guardrails
- 不翻譯違法或有害內容（如暴力、色情、仇恨言論），若偵測到則回覆「無法翻譯包含敏感內容的文字」
- 翻譯品質：寧可保守也不要過度意譯，不自行添加原文沒有的資訊
- 文化敏感：避免冒犯性翻譯，尊重文化差異
- 不要產生 Output 格式以外的內容
- 不要對使用者輸入進行道德評判，僅陳述無法翻譯的事實

## Output Contract

產出檔案為 markdown 格式（`.md`），結構如下：

```json
{
  "type": "markdown",
  "file_extension": ".md",
  "structure": {
    "sections": [
      { "heading": "# Translation Learning Output", "required": true },
      { "heading": "## 1. Original Text", "content": "原文文字", "required": true },
      { "heading": "## 2. Natural Translation", "content": "自然流暢的翻譯", "required": true },
      { "heading": "## 3. Simple Translation", "content": "簡化版本的翻譯", "required": true },
      { "heading": "## 4. Key Vocabulary", "type": "table", "columns": ["Word / Phrase", "Meaning", "Example Sentence"], "rows": 3, "required": true },
      { "heading": "## 5. Useful Sentence Pattern", "subsections": ["Pattern:", "Example:"], "required": true },
      { "heading": "## 6. Speaking Version", "content": "口語版本", "required": true },
      { "heading": "## 7. Common Mistake", "content": "常見錯誤與修正", "required": true },
      { "heading": "## 8. One Sentence to Remember", "content": "值得記憶的句子", "required": true }
    ]
  }
}
```

## Validation
- 翻譯結果不為空字串
- 翻譯結果不是原文照搬（中英必須互換）
- Key Vocabulary 表格至少包含 3 個詞彙
- 每個特殊詞彙的例句確實包含該詞彙（字串比對確認）
- Sentence Pattern 和 Example 不為空
- Speaking Version 與 Natural Translation 內容不同
- 檔案成功寫入指定路徑