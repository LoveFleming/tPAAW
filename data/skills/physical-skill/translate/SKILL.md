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
  - id: u
    label: 要翻譯的內容
    description: 輸入任何語言的文字，AI 會自動偵測來源語言並翻譯
    placeholder: 例：這個功能對我們來說非常重要
    required: true
    type: textarea
    multiline: true
    rows: 4
  - id: target_lang
    label: 目標語言
    description: 要翻譯成什麼語言（預設英文）
    placeholder: en
    required: false
    type: text
    default: en
  - id: source_lang
    label: 來源語言
    description: 原文是什麼語言（留空自動偵測）
    placeholder: zh-TW
    required: false
    type: text
    default: auto
useSkills:
  - idiom-packaging
---

# 多國語言翻譯

## Purpose
將使用者輸入的文字翻譯為目標語言（預設中→英），同時識別特殊詞彙（成語、俚語、專業術語），交由 idiom-packaging skill 包裝成經典例句或趣味用法，幫助使用者記憶。

## Inputs
- `u` (必填)：要翻譯的原文，支援任何語言
- `target_lang` (選填，預設 `en`)：目標語言代碼（en, ja, ko, fr, de 等）
- `source_lang` (選填，預設 `auto`)：來源語言代碼，留空自動偵測

## Deterministic Script

### Tool Access
- LLM 翻譯能力（直接用 AI model）
- idiom-packaging skill（處理特殊詞彙）

### Execution Steps

1. **解析輸入**
   - 取得 `u`（原文）、`target_lang`（預設 en）、`source_lang`（預設 auto）
   - 如果 `source_lang` 為 auto，根據文字內容自動偵測語言
   - 如果 `u` 是單一單字或短詞（≤ 5 字），切換至「單字翻譯模式」

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
   - 呼叫 `idiom-packaging` skill 為每個詞彙產出包裝內容

4. **組合輸出**
   - 翻譯結果文字
   - 特殊詞彙列表（含包裝後的例句/趣味用法）
   - 發音提示（目標語言為英文時提供音標）

### Business Rules
- 翻譯必須保留原文語境，不可失去情感色彩
- 單字翻譯模式觸發條件：`u` 長度 ≤ 5 字元且不含標點符號
- 如果偵測到 `u` 包含指令性文字（如「幫我翻譯...」「translate...」），自動提取實際文字內容
- 支援語言：zh-TW, zh-CN, en, ja, ko, fr, de, es, it, pt, ru, th, vi, id
- 不支援的語言代碼 → 回傳錯誤訊息並列出支援語言

### Error Handling
- `u` 為空或純空白 → 回傳 `{ "error": "SYS_TRANSLATE_EMPTY_INPUT", "message": "請提供要翻譯的文字" }`
- 語言不支援 → 回傳 `{ "error": "EXT_TRANSLATE_LANG_UNSUPPORTED", "message": "不支援的語言代碼：{lang}", "supported": ["en","ja","ko","fr","de","es"] }`
- 翻譯失敗 → 回傳原文 + 錯誤原因，建議使用者換個說法重試
- idiom-packaging 呼叫失敗 → 仍回傳翻譯結果，特殊詞彙僅保留基本翻譯不附包裝內容

## Guardrails
- 不翻譯違法、仇恨、暴力或色情內容 → 回傳拒絕訊息
- 不洩漏翻譯內容中的個人敏感資訊（身分證號、信用卡號等）
- 翻譯品質：寧可保守也不過度意譯導致失真
- 文化敏感：避免產生冒犯性或帶有偏見的翻譯
- 輸入超過 5000 字 → 截斷並提示「文字過長，僅翻譯前 5000 字」

## Output Contract

```json
{
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
- `translation` 不為空且不為原文照搬
- `source_lang` 和 `target_lang` 為有效的語言代碼
- `special_words` 陣列中每個物件的 `type` 必須是 idiom|slang|jargon|culture|pun 之一
- `special_words[].packaged.classic_sentence` 必須包含該詞彙
- JSON 格式正確，無缺漏欄位
