---
id: translate
name: 我的翻譯
description: 將中文翻譯為英文，同時產出包含翻譯、詞彙、句型、常見錯誤的完整學習筆記 markdown
category: generation
tags:
  - translation
  - learning
  - english
examples: "# Translation Learning Output\n\n## 1. Original Text\n我想做一個可以幫助我學英文的翻譯 App。\n\n## 2. Natural Translation\nI want to build a translation app that can help me learn English.\n\n## 3. Simple Translation\nI want to make an app to help me learn English.\n\n## 4. Key Vocabulary\n\n| Word / Phrase | Meaning | Example Sentence |\n|---|---|---|\n| build | 建立、製作 | I want to build a small app. |\n| translation app | 翻譯 App | This translation app helps me learn new words. |\n| help me learn | 幫助我學習 | Reading every day helps me learn English. |\n\n## 5. Useful Sentence Pattern\n\n**Pattern:**  \nI want to build a ___ that can help me ___.\n\n**Example:**  \nI want to build a tool that can help me practice speaking.\n\n## 6. Speaking Version\n\nI want to make a translation app to help me learn English better.\n\n## 7. Common Mistake\n\nDon't say: \"help me to learning English.\"  \nSay: \"help me learn English\" or \"help me to learn English.\"\n\n## 8. One Sentence to Remember\n\nI want to build a translation app that can help me learn English."
userInputs:
  - id: output_path
    label: 輸出路徑
    description: Skill 執行結果的儲存路徑
    placeholder: "例：output/translation.md"
    required: true
    multiline: false
  - id: _
    label: 請輸入要翻譯的內容
    description: 想要翻譯並學習的文字內容
    placeholder: "例：我想做一個可以幫助我學英文的翻譯 App。"
    required: true
    multiline: true
---

# 我的翻譯

## Purpose
將使用者輸入的中文文字翻譯為英文，同時識別特殊詞彙（成語、俚語、專業術語），產出一份包含 8 個 section 的完整 Translation Learning Output markdown 檔案，幫助使用者從翻譯中學習英文。

## Inputs
- **output_path** (required): Skill 執行結果的儲存路徑，markdown 檔案
- **_** (required): 要翻譯的中文內容

## Deterministic Script

### Tool Access
- `fs PUT` — 將翻譯結果寫入 `output_path`

### Execution Steps

1. **解析輸入**
   - 從 `_` 取得原文
   - 從 `output_path` 取得目標檔案路徑
   - 來源語言預設 zh-TW，目標語言預設 en

2. **翻譯**
   - **Natural Translation**：自然流暢的翻譯，保留語氣和情感，專有名詞保留原文
   - **Simple Translation**：用更基礎的單字和句型重新表達同樣語意

3. **識別 Key Vocabulary**
   - 找出值得學習的詞彙：動詞搭配、片語、成語、俚語、專業術語
   - 每個詞彙提供：Word / Phrase、中文 Meaning、Example Sentence
   - 至少列出 2 個詞彙

4. **萃取 Sentence Pattern**
   - 從 Natural Translation 中找出一個可重複使用的句型
   - 將句型用 `___` 填空呈現
   - 提供一個不同的 Example 展示句型用法

5. **產生學習輔助內容**
   - **Speaking Version**：將翻譯改寫為更口語、自然的說法
   - **Common Mistake**：指出一個與此翻譯相關的常見文法錯誤，提供正確說法
   - **One Sentence to Remember**：用一句話總結這次翻譯最值得記住的表達

6. **組裝 Markdown**
   - 按照下方 Output Format 的 8 個 section 順序組裝
   - 不加入 format 以外的任何內容（不加開頭語、結語、解釋文字）

7. **寫入檔案**
   - 使用 `fs PUT` 將完整 markdown 寫入 `output_path`
   - 回覆寫入成功與檔案路徑

### Business Rules
- Natural Translation 與 Simple Translation 必須語意相同但用字/句型不同
- 每個 Key Vocabulary 的 Example Sentence 必須實際包含該詞彙
- Sentence Pattern 的 Example 必須與原文不同，展示句型的通用性
- 輸出嚴格遵循 8-section 格式，section 標題不可更改
- 不在 markdown 中加入任何 meta 說明或過程描述

### Error Handling
1. **輸入為空或過短**（少於 2 個字元）→ 停止執行，回覆：`輸入內容太短，請提供完整的句子或段落。`
2. **output_path 無效**（路徑格式錯誤、副檔名非 .md、或寫入失敗）→ 停止執行，回覆：`output_path 無效，請提供有效的 .md 檔案路徑。`

## Guardrails
- 不翻譯違法或有害內容
- 翻譯品質：寧可保守也不要過度意譯
- 文化敏感：避免冒犯性翻譯
- 不產出 Output Format 以外的任何內容

## Output Contract

```json
{
  "type": "object",
  "properties": {
    "original_text": { "type": "string", "description": "使用者輸入的原文" },
    "natural_translation": { "type": "string", "description": "自然流暢的英文翻譯" },
    "simple_translation": { "type": "string", "description": "用簡單句型重新表達的翻譯" },
    "key_vocabulary": {
      "type": "array",
      "minItems": 2,
      "items": {
        "type": "object",
        "properties": {
          "word": { "type": "string" },
          "meaning": { "type": "string" },
          "example": { "type": "string" }
        },
        "required": ["word", "meaning", "example"]
      }
    },
    "sentence_pattern": { "type": "string", "description": "用 ___ 填空的可重複句型" },
    "pattern_example": { "type": "string", "description": "與原文不同的句型範例" },
    "speaking_version": { "type": "string", "description": "口語化版本" },
    "common_mistake": { "type": "string", "description": "常見錯誤用法及正確說法" },
    "sentence_to_remember": { "type": "string", "description": "一句話摘要" }
  },
  "required": [
    "original_text", "natural_translation", "simple_translation",
    "key_vocabulary", "sentence_pattern", "pattern_example",
    "speaking_version", "common_mistake", "sentence_to_remember"
  ]
}
```

上述資料組裝為以下 markdown 格式，寫入 `output_path`：

```markdown
# Translation Learning Output

## 1. Original Text
{{original_text}}

## 2. Natural Translation
{{natural_translation}}

## 3. Simple Translation
{{simple_translation}}

## 4. Key Vocabulary

| Word / Phrase | Meaning | Example Sentence |
|---|---|---|
| {{word_1}} | {{meaning_1}} | {{example_1}} |
| {{word_2}} | {{meaning_2}} | {{example_2}} |

## 5. Useful Sentence Pattern

**Pattern:**  
{{sentence_pattern}}

**Example:**  
{{pattern_example}}

## 6. Speaking Version

{{speaking_version}}

## 7. Common Mistake

{{common_mistake}}

## 8. One Sentence to Remember

{{sentence_to_remember}}
```

## Validation
- 翻譯結果不為空
- Natural Translation 與 Simple Translation 語意相同但用字不同，不是原文照搬
- Key Vocabulary 每筆的 Example Sentence 確實包含該詞彙
- 輸出包含全部 8 個 section，無多餘內容
- Sentence Pattern 的 Example 與原文不同
