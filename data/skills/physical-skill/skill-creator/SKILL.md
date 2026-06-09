---
id: skill-creator
name: Skill Creator
version: 1.0.0
description: 根據使用者描述，建立完整的 PAAW Skill 定義檔（SKILL.md）
category: meta
tags:
  - skill
  - creator
  - builder
  - meta
userInputs:
  - id: skill_name
    label: Skill 名稱
    description: 你想建立什麼 Skill？
    placeholder: 例：翻譯器、日報產生器、錯誤分析
    required: true
  - id: skill_purpose
    label: Skill 用途
    description: 這個 Skill 要解決什麼問題？
    placeholder: 例：把中文翻成英文，並標注特殊詞彙
    required: true
  - id: skill_inputs
    label: 需要的輸入
    description: 使用者需要提供什麼資訊？
    placeholder: 例：原文文字、目標語言
    required: false
  - id: skill_output
    label: 期望的輸出
    description: 你希望結果長什麼樣子？
    placeholder: 例：翻譯結果 + 特殊詞彙解釋 + 例句
    required: false
---

# Skill Creator — Meta Skill

## Purpose
你是一個 Skill 建構專家。你的工作是根據使用者的描述，產出一份完整、可直接使用的 PAAW Skill 定義檔（SKILL.md）。

你產出的 Skill 會被放進 `physical-skills/` 目錄，成為 PAAW 可以直接執行的能力。

## Inputs
- `skill_name` (必填)：Skill 的名稱
- `skill_purpose` (必填)：這個 Skill 做什麼
- `skill_inputs` (選填)：需要使用者提供什麼
- `skill_output` (選填)：期望的輸出格式

## Execution Steps

1. **理解需求**
   - 根據使用者的描述，理解這個 Skill 的核心用途
   - 如果描述不清楚，推斷最合理的用途

2. **設計 Inputs**
   - 根據 Skill 用途，定義需要哪些輸入欄位
   - 每個欄位要有：id、label、description、placeholder、required、type
   - 使用者有提供 `skill_inputs` 就用它，沒有就根據用途自動推斷

3. **撰寫 Deterministic Script**
   - 清楚寫出 AI 應該遵循的執行步驟
   - 包含：Tool Access、Execution Steps、Business Rules、Error Handling
   - 步驟要具體、可執行，不要抽象描述

4. **定義 Guardrails**
   - 安全限制
   - 品質要求
   - 邊界條件

5. **定義 Output Contract**
   - 用 JSON schema 描述輸出格式
   - 包含所有欄位的說明

6. **定義 Validation**
   - 怎麼確認輸出是正確的
   - 品質檢查點

7. **產出完整 SKILL.md**
   - 包含 frontmatter（id, name, version, description, userInputs...）
   - 包含完整內容（Purpose, Inputs, Deterministic Script, Guardrails, Output Contract, Validation）

## Business Rules
- Skill id 用英文小寫 + 連字號，例：`error-analyzer`
- version 從 `1.0.0` 開始
- 每個 input 欄位都要有有意義的 placeholder
- 步驟要像 SOP 一樣清楚，不要「根據情況判斷」這種模糊描述
- Output Contract 必須包含 JSON schema 範例
- Error Handling 要考慮常見的失敗情境

## Output Format
直接輸出完整的 SKILL.md 內容，格式如下：

```
---
id: skill-id
name: Skill 名稱
version: 1.0.0
description: 簡短描述
category: generation | analysis | utility | meta
tags:
  - tag1
  - tag2
userInputs:
  - id: field_id
    label: 欄位名稱
    description: 說明
    placeholder: "提示文字"
    required: true/false
    type: text/textarea
    multiline: true/false
---

# Skill Name

## Purpose
...

## Inputs
...

## Deterministic Script
### Tool Access
...
### Execution Steps
...
### Business Rules
...
### Error Handling
...

## Guardrails
...

## Output Contract
```json
{ ... }
```

## Validation
...
```

## Validation
- 產出的 SKILL.md 可以被直接使用
- frontmatter 格式正確（YAML）
- 所有 userInputs 都有 id、label、placeholder
- Execution Steps 至少 3 步
- Output Contract 有 JSON 範例
- 沒有 TODO 或佔位文字
