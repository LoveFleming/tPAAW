# Skill AI Generate — 從需求生成源碼

請根據以下需求，產出完整的 **skill-source.md**（源碼格式，使用 @@@section@@@ 分隔）。

## 重要：你產出的是「源碼」，不是最終 artifact

Skill Builder 的流程是：
```
skill-source.md (源碼/@@@格式) → Build → SKILL.md (artifact/##格式) → Test → Publish
```

你產出的 skill-source.md 會被 UI 表單解析，每個 @@@section@@@ 對應一個編輯欄位。使用者可以在 UI 上修改後再 Build。

## 源碼格式（必須使用 @@@ 分隔）

```
---
id: skill-id
name: Skill 名稱
version: 1.0.0
description: 一句話描述
category: generation|analysis|transform|communication
tags:
  - tag1
  - tag2
userInputs:
  - id: field_id
    label: 欄位標籤
    description: 欄位說明
    placeholder: "範例值"
    required: true|false
    type: text|textarea
    multiline: true|false
  - id: output_path
    label: 輸出路徑（留空則僅顯示）
    description: 留空 = 結果直接顯示；填入絕對路徑 = 存成檔案
    placeholder: "例：{{PAAW_ROOT}}/data/output/result.md"
    required: false
    type: text
    multiline: false
---

@@@purpose@@@
這個 Skill 做什麼，解決什麼問題

@@@steps@@@
### Tool Access
- 工具列表

### Execution Steps
1. 步驟一
2. 步驟二

### Business Rules
- 規則一

### Error Handling
- 情境一：處理方式
- 情境二：處理方式

@@@output@@@
輸出模式：both
JSON schema 範例

@@@guardrails@@@
安全限制

@@@validation@@@
驗證規則

@@@examples@@@
範例（可選）

@@@notes@@@
備註（可選）
```

## 重要：userInputs 推斷規則

使用者的「功能描述」是你理解 Skill 需求的依據，**不是** Skill 的輸入欄位。你必須從功能描述中**推斷**這個 Skill 實際執行時需要使用者填什麼。

### 錯誤做法 ❌
使用者說「食譜產生器：輸入食材，自動產出食譜」→ 你把「食譜產生器」當 input
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
    label: 食材                  ← ✅ 執行時使用者要填的
    description: 輸入你手邊有的食材
    placeholder: "例：雞胸肉、洋蔥、番茄"
    required: true
    type: textarea
    multiline: true
```

## 固定欄位規則

### @@@ 欄位名稱（不可改名）
- `@@@purpose@@@` — Skill 的目的
- `@@@steps@@@` — 執行步驟（含 Tool Access、Execution Steps、Business Rules、Error Handling）
- `@@@output@@@` — 輸出格式（含 JSON schema + 輸出模式）
- `@@@guardrails@@@` — 安全限制
- `@@@validation@@@` — 驗證規則
- `@@@examples@@@` — 範例（可選，可以留空）
- `@@@notes@@@` — 備註（可選，可以留空）

### 固定 userInputs
每個 Skill 都必須包含 `output_path` 欄位（最後一個 input）：
```
  - id: output_path
    label: 輸出路徑（留空則僅顯示）
    description: 留空 = 結果直接顯示；填入絕對路徑 = 存成檔案
    placeholder: "例：{{PAAW_ROOT}}/data/output/result.md"
    required: false
    type: text
    multiline: false
```

### @@@steps@@@ 內必須包含的子標題
- `### Tool Access` — 列出可用工具
- `### Execution Steps` — 有編號、具體可執行的步驟（像 SOP）
- `### Business Rules` — 業務規則
- `### Error Handling` — 至少 2 種失敗情境

## 完整範例

使用者輸入：
```
Skill 名稱：食譜產生器
功能描述：輸入食材，自動產出食譜，包含步驟和營養資訊
```

你應該產出：

```
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
    description: 留空 = 結果直接顯示；填入絕對路徑 = 存成檔案
    placeholder: "例：{{PAAW_ROOT}}/data/output/recipe.md"
    required: false
    type: text
    multiline: false
---

@@@purpose@@@
根據使用者提供的食材，自動產出一份完整的食譜，包含烹飪步驟、所需時間和營養資訊。

@@@steps@@@
### Tool Access
- `/api/workspace/write` — 將食譜寫入指定的 markdown 檔案

### Execution Steps
1. **解析輸入**
   - 從 `ingredients` 取得食材清單，用逗號或換行分隔
   - 從 `servings` 取得份量，預設 2 人份
   - 從 `dietary` 取得飲食限制，無則不限
   - 從 `output_path` 取得輸出路徑，留空則僅顯示
2. **生成食譜**
   - 根據食材和飲食限制，規劃一道菜的菜名和份量
   - 列出所需材料（含份量單位）
   - 撰寫烹飪步驟（有編號、具體操作、預計時間）
   - 計算營養資訊（卡路里、蛋白質、碳水、脂肪）
3. **格式化輸出**
   - 使用 markdown 格式組織食譜內容
   - 包含：菜名、份量、材料、步驟、營養資訊
4. **輸出結果**
   - 若 `output_path` 有值，呼叫 `/api/workspace/write` 寫入檔案
   - 若 `output_path` 為空，直接顯示結果

### Business Rules
- 食材至少 1 項才生成食譜
- 份量預設 2 人份
- 飲食限制為空時不做限制
- 輸出路徑必須是絕對路徑或 {{PAAW_ROOT}} 開頭

### Error Handling
- 食材為空 → 回傳「請至少輸入一項食材」
- 輸出路徑無效（無寫入權限） → 改為僅顯示，並提示路徑無法寫入

@@@output@@@
輸出模式：both
```json
{
  "title": "蒜香雞胸肉",
  "servings": 2,
  "ingredients": ["雞胸肉 300g", "大蒜 4瓣", ...],
  "steps": ["1. 雞胸肉切塊，用鹽和胡椒醃 10 分鐘", ...],
  "nutrition": { "calories": 380, "protein": 42, "carbs": 8, "fat": 18 },
  "duration_minutes": 25
}
```

@@@guardrails@@@
- 不生成含有毒食材的食譜
- 不生成生食食譜（除非使用者明確要求）
- 營養資訊為估算值，不保證精確

@@@validation@@@
- ingredients 不得為空
- servings 若填寫必須是正整數
- output_path 若填寫必須是有效路徑格式

@@@examples@@@

@@@notes@@@
營養資訊為估算值，實際數值可能因食材品牌和烹飪方式而異。
```

記住：
1. **使用者的描述是「需求」，不是「填入的值」** — 你要從需求推斷 Skill 實際需要哪些 input
2. **必須用 @@@ 格式輸出** — 不是 ## 標題格式
3. **每個 Skill 都要有 output_path 欄位**
4. **@@@steps@@@ 必須包含 Tool Access、Execution Steps、Business Rules、Error Handling 四個子標題**
