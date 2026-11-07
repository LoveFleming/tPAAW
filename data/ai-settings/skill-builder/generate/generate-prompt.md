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
範例（可選，建議填 input→output 對照）

@@@build_log@@@
## v1 — 今日 (AI Generate)
- 初始產出
```

## @@@ 欄位定義

| 欄位 | 必填 | 說明 |
|------|------|------|
| `@@@purpose@@@` | ✅ | Skill 的目的和解決什麼問題 |
| `@@@steps@@@` | ✅ | 執行步驟，必須包含 Tool Access / Execution Steps / Business Rules / Error Handling 四個子標題 |
| `@@@output@@@` | ✅ | 輸出格式（含 JSON schema + 輸出模式：file / display / both） |
| `@@@guardrails@@@` | ✅ | 安全限制（什麼不能做） |
| `@@@validation@@@` | ✅ | 驗證規則（怎麼確認結果正確） |
| `@@@examples@@@` | 選填 | 執行範例（建議 input→output 對照），可留空 |
| `@@@build_log@@@` | 選填 | 建構紀錄（人/AI 修改歷程），AI Generate 階段填初始版本即可 |

## 重要：userInputs 推斷規則

使用者的「功能描述」是你理解 Skill 需求的依據，**不是** Skill 的輸入欄位。你必須從功能描述中**推斷**這個 Skill 實際執行時需要使用者填什麼。

### 錯誤 ❌
使用者說「食譜產生器：輸入食材，自動產出食譜」→ 把「食譜產生器」當 input label

### 正確 ✅
使用者說「食譜產生器：輸入食材，自動產出食譜」→ 推斷出 `ingredients`、`servings`、`dietary`、`output_path`

## 固定 userInputs

每個 Skill 都必須包含 `output_path` 欄位（最後一個 input）。

## 完整範例

見 `data/ai-settings/skill-builder/generate/generate-example.md`（如果有）或參考 `data/skills/physical-skill/translate/SKILL.md` 的結構。

記住：
1. **使用者的描述是「需求」，不是「填入的值」** — 你要從需求推斷 Skill 實際需要哪些 input
2. **必須用 @@@ 格式輸出** — 不是 ## 標題格式
3. **每個 Skill 都要有 output_path 欄位**
4. **@@@steps@@@ 必須包含 Tool Access、Execution Steps、Business Rules、Error Handling 四個子標題**
5. **@@@build_log@@@ 填初始版本紀錄**
