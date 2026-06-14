# Skill Definition 格式（SKILL.md）

Skill 是最小的能力單元，每個 Skill 定義在 `data/skills/input-prompt/{id}/SKILL.md` 中。

## 完整格式

```markdown
# Skill

## Purpose
這個 Skill 做什麼（一句話）

## Inputs
- input_name: type — 說明
- output_path: string — 輸出路徑（固定欄位，用於 CLI 執行結果）

## Deterministic Script

### Tool Access
這個 Skill 需要什麼工具

### Execution Steps
1. 步驟一
2. 步驟二
3. ...

### Business Rules
- 規則一
- 規則二

### Error Handling
- 錯誤情境 → 處理方式

## Guardrails
- 安全限制
- 品質限制

## Output Contract
輸出的 JSON 結構定義

## Validation
如何驗證輸出正確
```

## Frontmatter

SKILL.md 支援 frontmatter（YAML header）來定義 metadata：

```yaml
---
id: my-skill
name: My Skill
version: 1.0.0
description: 一句話描述
runner: prompt
tags: skill, example
visibility: private
userInputs:
  - id: input_text
    label: 輸入文字
    description: 使用者要輸入的內容
    placeholder: "請輸入..."
    required: true
    multiline: false
  - id: output_path
    label: 輸出路徑
    description: 輸出檔案的路徑
    placeholder: "output/report.html"
    required: true
    multiline: false
---
```

## 關鍵規則

- **output_path** 是固定欄位，所有 skill 都應該有
- userInputs 定義使用者在執行前要填寫的表單欄位
- Purpose + Steps 是核心，缺少任一會讓 skill 無法正確執行
- Skill 必須有明確的 Output Contract，否則 CLI 無法知道輸出格式