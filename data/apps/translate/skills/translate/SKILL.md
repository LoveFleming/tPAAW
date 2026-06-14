---
id: translate
name: 我的翻譯機
version: 1.0.0
description: 將輸入文字翻譯為目標語言（預設中→英），產出含翻譯、詞彙、句型、常見錯誤的 Translation Learning Output markdown 檔案
category: generation
tags:
  - translate
  - english
  - learning
  - vocabulary
userInputs:
  - id: output_path
    label: 輸出路徑
    description: Skill 執行結果的儲存路徑
    placeholder: "例：output/report.html"
    required: true
    type: text
    multiline: false
  - id: _
    label: 輸入要翻譯的內容
    description: 要翻譯的文字
    placeholder: "例：我想做一個可以幫助我學英文的翻譯 App"
    required: true
    type: textarea
    multiline: true
---

# 我的翻譯機

## Purpose
將使用者輸入的文字翻譯為目標語言（預設中→英），同時識別特殊詞彙（成語、俚語、專業術語），產出一份完整的 Translation Learning Output markdown 檔案。

## Inputs
- `output_path` (必填)：Skill 執行結果的儲存路徑
- `_` (必填)：輸入要翻譯的內容

## Deterministic Script

### Tool Access
- LLM 翻譯能力（直接用 AI model）
- 檔案寫入（write markdown to `output_path`）

### Execution Steps

1. **解析輸入**
   - 取得原文 `_`、目標語言（預設 en）、來源語言（預設 zh-TW）
   - 取得 `output_path`，確認輸出位置

2. **翻譯**
   - 產出兩種翻譯版本：
     - **Natural Translation**：自然流暢，保留語氣和情感，專有名詞保留原文
     - **Simple Translation**：用更簡單的詞彙重新表達同一意思，適合初學者

3. **識別特殊詞彙**
   - 從原文中找出關鍵詞彙（動詞、名詞片語、成語、俚語、專業術語）
   - 為每個詞彙產生：Meaning（中文意思）+ Example Sentence（含該詞彙的英文例句）

4. **產生學習內容**
   - **Useful Sentence Pattern**：從原文提取一個可套用的句型，用 `___` 標示替換位置，附替換範例
   - **Speaking Version**：口語化的改寫版本，模擬母語者的日常說法
   - **Common Mistake**：中文母語者常犯的錯誤，附 Don't say / Say 對比
   - **One Sentence to Remember**：從翻譯結果中選一句最精華、最值得記住的句子

5. **寫入檔案**
   - 按照 Output Format 組合完整 markdown 內容
   - 寫入 `output_path` 指定的路徑
   - 只輸出 markdown 檔案，不產生 Output Format 以外的內容

### Business Rules
- Natural Translation 必須保留原文語境和情感色彩，不可直譯
- Simple Translation 用更基礎的詞彙表達，幫助初學者理解兩者差異
- Key Vocabulary 至少列出 2 個詞彙，每個都要有獨立的例句
- Sentence Pattern 的 `___` 要清楚標示可替換的位置
- Common Mistake 必須是中文母語者學英文時實際會犯的錯誤
- 如果輸入是單字或極短句，仍照格式輸出但內容相應精簡
- 專有名詞保留原文，旁附翻譯

### Error Handling
- **空白輸入** → 回報「請提供要翻譯的文字內容」，不寫入檔案
- **output_path 無效或不可寫** → 回報路徑錯誤，建議正確的路徑格式（例：`output/translation.md`）
- **翻譯結果與原文相同（同語言）** → 回報可能為同一語言，建議確認來源語言

## Guardrails
- 不翻譯違法或有害內容
- 翻譯品質：寧可保守也不要過度意譯導致失真
- 文化敏感：避免冒犯性翻譯
- 不要產出 Output Format 以外的內容

## Output Contract

輸出為一份 markdown 檔案，寫入 `output_path`，結構如下：

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

## Examples

```markdown
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
```

## Validation
- 翻譯結果不為空
- 翻譯不是原文照搬（來源與目標語言不同）
- Key Vocabulary 的例句確實包含對應詞彙
- markdown 格式完整，包含全部 8 個 section
- 檔案成功寫入 `output_path`
