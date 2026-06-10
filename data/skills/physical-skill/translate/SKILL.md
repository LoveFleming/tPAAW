---
id: translate
name: 多國語言翻譯
version: 1.0.0
description: 將輸入文字翻譯為目標語言，預設中翻英，並標注特殊詞彙
runner: prompt
category: generation
tags:
  - translate
  - i18n
  - english
  - chinese
userInputs:
  - id: output_path
    label: 輸出路徑
    description: Skill 執行結果的儲存路徑
    placeholder: "例：output/translate-result.md"
    required: true
    type: text
    multiline: false
  - id: g
    label: 輸入要翻譯的內容
    description: 輸入任何語言的文字，AI 會自動偵測來源語言並翻譯
    placeholder: 例：這個功能對我們來說非常重要
    required: true
    type: textarea
    multiline: true
    rows: 4
useSkills:
  - idiom-packaging
---

# 多國語言翻譯

## Purpose
將使用者輸入的文字翻譯為目標語言（預設中→英），同時識別特殊詞彙（成語、俚語、專業術語），交由 idiom-packaging skill 包裝成經典例句或趣味用法，幫助使用者記憶。結果以 Markdown 格式輸出至指定路徑。

## Inputs
- `output_path` (必填)：執行結果的儲存路徑
- `g` (必填)：要翻譯的原文，支援任何語言

## Deterministic Script

### Tool Access
- LLM 翻譯能力（直接用 AI model）
- idiom-packaging skill（處理特殊詞彙）
- 檔案寫入（將結果寫入 `output_path`）

### Execution Steps

1. **解析輸入**
   - 取得 `g`（原文）與 `output_path`（輸出路徑）
   - 設定 `target_lang` = `en`、`source_lang` = `auto`（根據文字內容自動偵測）
   - 如果 `g` 是單一單字或短詞（≤ 5 字元且不含標點），切換至「單字翻譯模式」
   - 如果 `g` 包含指令性文字（如「幫我翻譯...」「translate...」），自動提取實際文字內容

2. **執行翻譯**
   - 使用 AI 進行翻譯，遵循以下原則：
     - 自然流暢，不直譯，保留原文語氣與情感色彩
     - 專有名詞保留原文並在括號內附上翻譯
     - 雙關語或文化特定表達，附上直譯與意譯兩種版本
   - 單字翻譯模式額外產出：音標、詞性、常見用法、反義詞

3. **識別特殊詞彙**
   - 掃描原文，找出以下類型的詞彙：
     - 成語（idiom）
     - 俚語（slang）
     - 專業術語（jargon）
     - 文化特定詞（culture）
     - 雙關語（pun）
   - 每個特殊詞彙標註類型與對應翻譯
   - 呼叫 `idiom-packaging` skill 為每個詞彙產出包裝內容（經典例句 + 趣味用法）

4. **組合 Markdown 輸出**
   - 按以下格式組合結果：

   ```markdown
   # 翻譯結果 Translation Result

   ## 原文 (Source)
   {原文}

   ## 譯文 (Translation)
   {翻譯結果}

   ---

   ## 特殊詞彙 Special Vocabulary
   {每個特殊詞彙：原文 → 翻譯（類型）、經典例句、趣味用法}

   ---

   ## 翻譯筆記 Translation Notes
   {翻譯決策說明、保留原文的專有名詞、文化背景註解}
   ```

5. **寫入檔案**
   - 將組合後的 Markdown 寫入 `output_path` 指定的路徑
   - 回傳 JSON 結構（含 `output_path`、翻譯摘要）

### Business Rules
- 翻譯必須保留原文語境，不可失去情感色彩
- 單字翻譯模式觸發條件：`g` 長度 ≤ 5 字元且不含標點符號
- 支援語言：zh-TW, zh-CN, en, ja, ko, fr, de, es, it, pt, ru, th, vi, id
- 不支援的語言代碼 → 回傳錯誤訊息並列出支援語言
- `output_path` 必須以 `.md` 結尾；若無副檔名，自動補上 `.md`

### Error Handling
- `g` 為空或純空白 → 回傳 `{ "error": "SYS_TRANSLATE_EMPTY_INPUT", "message": "請提供要翻譯的文字" }`
- `output_path` 為空 → 回傳 `{ "error": "SYS_TRANSLATE_NO_OUTPUT_PATH", "message": "請提供輸出路徑" }`
- 翻譯失敗 → 回傳原文 + 錯誤原因，建議使用者換個說法重試
- idiom-packaging 呼叫失敗 → 仍回傳翻譯結果，特殊詞彙僅保留基本翻譯不附包裝內容
- 檔案寫入失敗 → 回傳 `{ "error": "SYS_TRANSLATE_WRITE_FAILED", "message": "無法寫入 {output_path}" }`，附上翻譯內容供手動儲存

## Guardrails
- 不翻譯違法、仇恨、暴力或色情內容 → 回傳拒絕訊息
- 不洩漏翻譯內容中的個人敏感資訊（身分證號、信用卡號等）
- 翻譯品質：寧可保守也不過度意譯導致失真
- 文化敏感：避免產生冒犯性或帶有偏見的翻譯
- 輸入超過 5000 字 → 截斷並提示「文字過長，僅翻譯前 5000 字」

## Output Contract

```json
{
  "output_path": "output/translate-result.md",
  "translation": "翻譯結果文字",
  "source_lang": "zh-TW",
  "target_lang": "en",
  "source_text": "原文",
  "special_words": [
    {
      "word": "特殊詞彙原文",
      "translation": "目標語言翻譯",
      "type": "idiom|slang|jargon|culture|pun",
      "meaning": "該詞彙的解釋",
      "packaged": {
        "classic_sentence": "包含該詞彙的經典例句",
        "fun_fact_or_joke": "趣味用法或記憶技巧"
      }
    }
  ],
  "pronunciation": {
    "phonetic": "音標（目標語言為英文時提供）",
    "tip": "發音小提示"
  }
}
```

單字翻譯模式額外欄位：
```json
{
  "word_detail": {
    "part_of_speech": "詞性（noun, verb, adj...）",
    "definitions": ["釋義1", "釋義2"],
    "examples": ["例句1", "例句2"],
    "antonyms": ["反義詞1"],
    "synonyms": ["同義詞1"]
  }
}
```

## Validation
- `output_path` 不為空且以 `.md` 結尾
- `translation` 不為空且不為原文照搬
- `special_words` 陣列中每個物件的 `type` 必須是 idiom|slang|jargon|culture|pun 之一
- `special_words[].packaged.classic_sentence` 必須包含該詞彙
- Markdown 檔案成功寫入 `output_path`
- JSON 格式正確，無缺漏欄位
