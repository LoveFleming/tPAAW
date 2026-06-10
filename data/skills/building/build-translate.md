---
id: translate
name: 多國語言翻譯
version: 1.0.0
description: 將輸入文字翻譯為目標語言，預設中翻英，並標注特殊詞彙
runner: prompt
userInputs:
  - id: output_path
    label: 輸出路徑
    description: Skill 執行結果的儲存路徑
    placeholder: "例：output/report.html"
    required: true
    multiline: false
  - id: g
    label: 輸入要翻譯的內容
    required: true
    multiline: true
---

## Purpose
將使用者輸入的文字翻譯為目標語言（預設中→英），同時識別特殊詞彙（成語、俚語、專業術語）。

## Inputs
- **輸出路徑** (required): Skill 執行結果的儲存路徑
- **輸入要翻譯的內容** (required): 

## Steps
1. 解析輸入：取得原文、目標語言（預設 en）、來源語言（預設 zh-TW）
2. 翻譯：自然流暢，保留語氣和情感，專有名詞保留原文
3. 識別特殊詞彙：成語、俚語、雙關語、專業術語
4. 為每個特殊詞彙產生例句和趣味用法
5. 照output格式輸出
6. 輸出markdown format

## Output
# 翻譯結果 Translation Result

## 原文 (Source)

## 譯文 (Translation)

---
## 特殊詞彙 Special Vocabulary

---
## 翻譯筆記 Translation Notes



## Guardrails
- 不翻譯違法或有害內容
- 翻譯品質：寧可保守也不要過度意譯
- 文化敏感：避免冒犯性翻譯

## Validation
- 翻譯結果不為空
- 不是原文照搬
- 特殊詞彙的例句確實包含該詞彙