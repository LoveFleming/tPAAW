# Skill 定義格式

Skill 是 PAAW 的最小能力單元。每個 Skill 用一份 SKILL.md 定義。

## SKILL.md 結構

```markdown
---
id: skill-id（英文小寫 + 連字號）
name: Skill 顯示名稱
description: 一句話說明這個 Skill 做什麼
userInputs:
  - id: field_id
    label: 欄位名稱
    description: 欄位說明
    placeholder: "輸入提示"
    required: true
    multiline: false
---

## Purpose
這個 Skill 做什麼？為誰解決什麼問題？

## Inputs
- **欄位名**（必填/選填）：說明

## Deterministic Script

### Execution Steps
1. 具體可執行的步驟
2. 每步都要明確，不要「根據情況判斷」

### Business Rules
- 規則 1
- 規則 2

### Error Handling
- 失敗情境 A → 怎麼處理
- 失敗情境 B → 怎麼處理

## Guardrails
- 安全限制
- 品質要求

## Output Contract
```json
{
  "field": "說明"
}
```

## Validation
- 怎麼確認輸出正確
```

## 重要規則

1. **id 用英文小寫 + 連字號**，例：`error-analyzer`
2. **userInputs 的每個欄位都要有 id、label**
3. **output_path 欄位固定保留**，用來指定輸出儲存路徑
4. **Execution Steps 至少 3 步**，要像 SOP 一樣清楚
5. **Output Contract 必須有 JSON 範例**
6. **不要有 TODO 或佔位文字**
