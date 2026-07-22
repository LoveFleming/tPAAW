# Skill AI Generate

請根據以下需求，產出完整的 SKILL.md。

## 重要：userInputs 推斷規則

使用者的「功能描述」是你理解 Skill 需求的依據，**不是** Skill 的輸入欄位。你必須從功能描述中**推斷**這個 Skill 實際執行時需要使用者填什麼。

### 錯誤做法 ❌
使用者說「食譜產生器：輸入食材，自動產出食譜」→ 你把「食譜產生器」當 input label
```
userInputs:
  - id: desc
    label: 食譜產生器功能描述    ← ❌ 這是使用者給你的需求，不是 Skill 的 input
```

### 正確做法 ✅
使用者說「食譜產生器：輸入食材，自動產出食譜」→ 你推斷實際需要的 input
```
userInputs:
  - id: ingredients
    label: 食材                  ← ✅ 這是執行時使用者要填的
    description: 輸入你手邊有的食材
    placeholder: "例：雞胸肉、洋蔥、番茄"
    required: true
    type: textarea
    multiline: true
  - id: servings
    label: 份量
    description: 幾人份
    placeholder: "2"
    required: false
    type: text
    multiline: false
  - id: output_path
    label: 輸出路徑（留空則僅顯示）
    description: 留空 = 結果直接顯示；填入絕對路徑 = 存成檔案
    placeholder: "例：{{PAAW_ROOT}}/data/output/recipe.md"
    required: false
    type: text
    multiline: false
```

## 完整範例

使用者輸入：
```
Skill 名稱：食譜產生器
功能描述：輸入食材，自動產出食譜，包含步驟和營養資訊
```

你應該產出（以下是部分示範，實際產出要完整）：

```yaml
---
id: recipe-generator
name: 食譜產生器
version: 1.0.0
description: 輸入食材，自動產出包含步驟和營養資訊的食譜
category: generation
tags:
  - recipe
  - cooking
userInputs:
  - id: ingredients
    label: 食材
    description: 輸入你手邊有的食材，用逗號或換行分隔
    placeholder: "例：雞胸肉、洋蔥、番茄、大蒜"
    required: true
    type: textarea
    multiline: true
  - id: servings
    label: 份量
    description: 幾人份
    placeholder: "2"
    required: false
    type: text
    multiline: false
  - id: dietary
    label: 飲食限制
    description: 素食、低碳、無麩質等
    placeholder: "例：低碳"
    required: false
    type: text
    multiline: false
  - id: output_path
    label: 輸出路徑（留空則僅顯示）
    description: 留空 = 結果直接顯示；填入絕對路徑 = 存成 .md 檔案
    placeholder: "例：{{PAAW_ROOT}}/data/output/recipe.md"
    required: false
    type: text
    multiline: false
---

# 食譜產生器

## Purpose
根據使用者提供的食材，自動產出一份完整的食譜，包含烹飪步驟、所需時間和營養資訊。

## Inputs
- **食材** (`ingredients`, required)：手邊有的食材，用逗號或換行分隔
- **份量** (`servings`, optional)：幾人份，預設 2 人份
- **飲食限制** (`dietary`, optional)：素食、低碳、無麩質等特殊需求
- **輸出路徑** (`output_path`, optional)：留空僅顯示，填入路徑則存檔

## Deterministic Script

### Tool Access
- `/api/workspace/write` — 將食譜寫入指定的 markdown 檔案

### Execution Steps
1. **解析輸入**
   - 從 `ingredients` 取得食材清單
   - 從 `servings` 取得份量，預設 2 人份
   - 從 `dietary` 取得飲食限制
   - 從 `output_path` 取得輸出路徑
...
```

記住：**使用者的描述是「需求」，不是「填入的值」**。你要從需求推斷出 Skill 實際需要哪些 input 欄位。
