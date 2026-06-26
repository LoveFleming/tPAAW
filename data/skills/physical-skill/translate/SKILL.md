## Purpose
將使用者輸入的文字翻譯為目標語言（預設中→英），同時識別特殊詞彙（成語、俚語、專業術語），產出一份完整的 Translation Learning Output markdown 學習筆記。

## Inputs
- **輸出路徑** (`output_path`, required)：Skill 執行結果的儲存路徑，指向一個 `.md` 檔案
- **輸入你要翻譯的內容** (`_`, required)：要翻譯的原文文字

## Steps
1. 解析輸入：取得原文、目標語言（預設 `en`）、來源語言（預設 `zh-TW`）
2. 翻譯：自然流暢，保留語氣和情感，專有名詞保留原文
3. 識別特殊詞彙：成語、俚語、雙關語、專業術語
4. 為每個特殊詞彙產生例句和趣味用法
5. 照 Output 格式輸出
6. 輸出一個 markdown file 就好

## Output
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

## Guardrails
- 不翻譯違法或有害內容
- 翻譯品質：寧可保守也不要過度意譯
- 文化敏感：避免冒犯性翻譯
- 不要產生出 Output format 以外的內容

## Error Handling
1. **輸入為空或過短**：原文少於 2 個字時，回覆錯誤訊息提示使用者提供更完整的文字
2. **輸出路徑無效**：路徑包含非法字元或目錄不存在時，回覆錯誤訊息並建議有效路徑

## Examples
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

## Validation
- 翻譯結果不為空
- 不是原文照搬
- 特殊詞彙的例句確實包含該詞彙
