---
id: translate
name: 我的翻譯機
userInputs:
  - id: output_path
    label: 輸出路徑
    description: Skill 執行結果的儲存路徑
    placeholder: "例：output/report.html"
    required: true
    multiline: false
  - id: _
    label: 輸入要翻譯的內容
    required: true
    multiline: true
---

## Purpose
將使用者輸入的文字翻譯為目標語言（預設中→英），同時識別特殊詞彙（成語、俚語、專業術語），產出一份完整的 Translation Learning Output markdown 學習筆記。

## Inputs
- **輸出路徑** (required): Skill 執行結果的儲存路徑
- **輸入要翻譯的內容** (required): 

## Guardrails
- 不翻譯違法或有害內容
- 翻譯品質：寧可保守也不要過度意譯
- 文化敏感：避免冒犯性翻譯
- 不要產出 Output Format 以外的內容

## Output Format

產出一個 markdown 檔案，包含以下 8 個段落（順序固定）：

    # Translation Learning Output

    ## 1. Original Text
    {原文}

    ## 2. Natural Translation
    {自然翻譯}

    ## 3. Simple Translation
    {簡單翻譯}

    ## 4. Key Vocabulary

    | Word / Phrase | Meaning | Example Sentence |
    |---|---|---|
    | {word} | {meaning} | {example} |

    ## 5. Useful Sentence Pattern

    **Pattern:**
    {sentence_pattern}

    **Example:**
    {pattern_example}

    ## 6. Speaking Version

    {speaking_version}

    ## 7. Common Mistake

    {common_mistake}

    ## 8. One Sentence to Remember

    {sentence_to_remember}

## Output Contract

```json
{
  "type": "object",
  "properties": {
    "output_file": {
      "type": "string",
      "description": "寫入的 markdown 檔案路徑（等同 output_path）"
    },
    "sections": {
      "type": "object",
      "properties": {
        "original_text":      { "type": "string", "description": "原始輸入文字" },
        "natural_translation": { "type": "string", "description": "自然流暢的翻譯" },
        "simple_translation":  { "type": "string", "description": "簡化版翻譯" },
        "key_vocabulary": {
          "type": "array",
          "description": "值得學習的詞彙，3–8 個",
          "items": {
            "type": "object",
            "properties": {
              "word":    { "type": "string" },
              "meaning": { "type": "string" },
              "example": { "type": "string" }
            },
            "required": ["word", "meaning", "example"]
          }
        },
        "sentence_pattern":    { "type": "string", "description": "可遷移的句型（含 ___ 空格）" },
        "pattern_example":     { "type": "string", "description": "句型的不同主題例句" },
        "speaking_version":    { "type": "string", "description": "口語化版本" },
        "common_mistake":      { "type": "string", "description": "Don't say → Say 對照" },
        "sentence_to_remember": { "type": "string", "description": "最值得記住的一句" }
      },
      "required": [
        "original_text",
        "natural_translation",
        "simple_translation",
        "key_vocabulary",
        "sentence_pattern",
        "pattern_example",
        "speaking_version",
        "common_mistake",
        "sentence_to_remember"
      ]
    }
  },
  "required": ["output_file", "sections"]
}
```

## Validation
- 翻譯結果不為空
- Natural Translation 不是原文照搬
- Key Vocabulary 的每個例句確實包含對應詞彙
- 輸出檔案包含完整的 8 個段落