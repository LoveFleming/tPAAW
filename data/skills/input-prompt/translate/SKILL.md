---
id: translate
name: 我的翻譯機
examples: |
  # Translation Learning Output

  ## 1. Original Text
  我想做一個可以幫助我學英文的翻譯 App。

  ## 2. Natural Translation
  I want to build a translation app that can help me learn English.

  ## 3. Simple Translation
  I want to make an app to help me learn English.

  ## 4. Key Vocabulary

  | Word / Phrase | Meaning | Example Sentence |
  |---|---|---|
  | build | 建立、製作 | I want to build a small app. |
  | translation app | 翻譯 App | This translation app helps me learn new words. |
  | help me learn | 幫助我學習 | Reading every day helps me learn English. |

  ## 5. Useful Sentence Pattern

  **Pattern:**
  I want to build a ___ that can help me ___.

  **Example:**
  I want to build a tool that can help me practice speaking.

  ## 6. Speaking Version

  I want to make a translation app to help me learn English better.

  ## 7. Common Mistake

  Don't say: "help me to learning English."
  Say: "help me learn English" or "help me to learn English."

  ## 8. One Sentence to Remember

  I want to build a translation app that can help me learn English.
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

# 我的翻譯機

## Purpose
將使用者輸入的文字翻譯為目標語言（預設中→英），同時識別特殊詞彙（成語、俚語、專業術語），產出一份完整的 Translation Learning Output markdown 學習筆記。

## Inputs
- `output_path` (必填): Skill 執行結果的儲存路徑，例：`output/translate-note.md`
- `_` (必填): 要翻譯的原文內容

## Deterministic Script

### Tool Access
- 檔案寫入：將產出的 markdown 內容寫入 `output_path` 指定的路徑

### Execution Steps

1. **解析輸入**
   - 從 `_` 取得原文
   - 來源語言預設 zh-TW，目標語言預設 en
   - 若原文偵測為英文，反轉方向（en → zh-TW）

2. **產生 Natural Translation**
   - 自然流暢的翻譯，保留語氣、情感與文體
   - 專有名詞、品牌名稱保留原文

3. **產生 Simple Translation**
   - 用更簡單的句型重新表達同一段內容
   - 適合初學者理解的用字與結構

4. **萃取 Key Vocabulary**
   - 從原文中挑選 3–8 個值得學習的詞彙或片語
   - 每個詞彙提供：中文釋義 + 例句（例句必須包含該詞彙）

5. **推導 Useful Sentence Pattern**
   - 從原文中萃取一個可遷移的句型
   - 將關鍵詞替換為 `___`，並提供一個不同主題的例句

6. **產生 Speaking Version**
   - 將翻譯改寫成口語、自然的說話版本
   - 使用日常對話中更常見的表達方式

7. **標注 Common Mistake**
   - 指出一個與此翻譯相關的常見文法或用字錯誤
   - 提供 Don't say → Say 的對照

8. **產出 One Sentence to Remember**
   - 從翻譯中挑選一句最值得記住的完整句子

9. **組裝 Markdown 並寫入檔案**
   - 將上述結果按照 Output Format 的 8 段結構組裝為單一 markdown 字串
   - 將內容寫入 `output_path`

### Business Rules
- 翻譯方向：偵測原文語言，自動決定目標語言
- 專有名詞（人名、地名、品牌）保留原文不翻譯
- Key Vocabulary 的例句必須包含該詞彙本身
- 輸出內容只允許 Output Format 定義的 8 個段落，不加入額外段落

### Error Handling

1. **輸入為空**
   - `_` 為空字串或只有空白時，不執行翻譯，回傳錯誤：`輸入內容為空，請提供要翻譯的文字。`

2. **output_path 無效**
   - 路徑不存在或無寫入權限時，回傳錯誤：`無法寫入 {output_path}，請確認路徑與權限。`

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
