---
id: translate
name: 多國語言翻譯
version: 1.0.0
description: 將輸入文字翻譯為目標語言，預設中翻英，並標注特殊詞彙
category: generation
suggestedRoles:
  - AI Factory Assistant
  - AI Skill Creator
tags:
  - translate
  - i18n
  - english
  - chinese
userInputs:
  - id: source_text
    label: 原文
    description: 要翻譯的文字內容
    placeholder: 例：這個功能對我們來說非常重要
    required: true
    type: textarea
    multiline: true
    rows: 4
    group: 📝 翻譯輸入
  - id: target_lang
    label: 目標語言
    description: 要翻譯成什麼語言
    placeholder: 例：en, ja, ko, fr, de
    required: false
    type: text
    default: en
    group: 📝 翻譯輸入
  - id: source_lang
    label: 來源語言
    description: 原文是什麼語言（留空自動偵測）
    placeholder: 例：zh-TW, en, ja
    required: false
    type: text
    default: zh-TW
    group: 📝 翻譯輸入
useSkills:
  - idiom-packaging
---

# Translate Skill

## Purpose
將使用者輸入的文字翻譯為目標語言（預設中→英），同時識別特殊詞彙（成語、俚語、專業術語），交由 idiom-packaging skill 包裝成經典例句或笑話。

## Inputs
- `source_text` (必填)：要翻譯的原文
- `target_lang` (選填，預設 `en`)：目標語言代碼
- `source_lang` (選填，預設 `zh-TW`)：來源語言代碼

## Deterministic Script

### Tool Access
- LLM 翻譯能力（直接用 AI model）
- idiom-packaging skill（處理特殊詞彙）

### Execution Steps

1. **解析輸入**
   - 取得 `source_text`、`target_lang`（預設 en）、`source_lang`（預設 zh-TW）
   - 如果 `source_text` 是單一單字（≤ 5 字），走「單字翻譯模式」

2. **翻譯**
   - 使用 AI 進行翻譯
   - 翻譯要求：
     - 自然流暢，不要直譯
     - 保留原文語氣和情感
     - 專有名詞保留原文（附翻譯）

3. **識別特殊詞彙**
   - 從原文中找出：成語、俚語、雙關語、專業術語、文化特定詞
   - 對每個特殊詞彙，呼叫 `idiom-packaging` skill 產出包裝內容

4. **組合輸出**
   - 翻譯結果
   - 特殊詞彙列表（附例句/笑話）
   - 發音提示（如為英文）

### Business Rules
- 翻譯必須保留原文語境，不可失去情感色彩
- 單字翻譯模式需額外提供：音標、詞性、常見用法、反義詞
- 如果偵測到使用者輸入的是「幫我翻譯 [text]」或「help me translate [text]」，自動提取 [text] 部分
- 目標語言不支援時，回報錯誤並建議可用的語言

### Error Handling
- 空白輸入 → 回傳「請提供要翻譯的文字」
- 語言不支援 → 回傳支援語言清單
- 翻譯失敗 → 回傳原文 + 錯誤原因，建議換個說法試試

## Guardrails
- 不翻譯違法或有害內容
- 不洩漏個人敏感資訊
- 翻譯品質：寧可保守也不要過度意譯導致失真
- 文化敏感：避免冒犯性翻譯

## Output Contract

```json
{
  "translation": "翻譯結果文字",
  "source_lang": "zh-TW",
  "target_lang": "en",
  "source_text": "原文",
  "special_words": [
    {
      "word": "特殊詞彙",
      "translation": "英文翻譯",
      "type": "idiom|slang|jargon|culture",
      "packaged": {
        "classic_sentence": "經典例句",
        "joke": "相關笑話或趣味用法"
      }
    }
  ],
  "pronunciation": {
    "phonetic": "音標",
    "audio_url": null
  }
}
```

## Validation
- 翻譯結果不為空
- 翻譯語言正確（不是原文照搬）
- 特殊詞彙的例句確實包含該詞彙
- JSON 格式正確
