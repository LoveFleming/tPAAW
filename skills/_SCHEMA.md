# Skills 目錄結構

```
skills/
├── input-prompt/              ← 定義「操作員填什麼 + AI prompt 怎麼寫」
│   ├── aioc-tour/
│   │   └── SKILL.md           ← frontmatter (userInputs, useSkills) + prompt body
│   ├── bug-review/
│   │   └── SKILL.md
│   └── ...
│
└── physical-skill/            ← 打包好的實體 skill（zip 解開後的檔案）
    ├── node-codegen/          ← CLI runtime 載入執行
    │   ├── SKILL.md
    │   ├── scripts/
    │   └── ...
    └── ...
```

## Input Prompt（`input-prompt/`）

定義操作員的表單欄位和 AI 的 prompt 指令。

### SKILL.md Schema

```yaml
---
id: string              # 唯一識別碼（kebab-case）
name: string            # 顯示名稱
version: string         # 語意版本號，例：1.0.0
description: string     # 一句話說明
category: string        # analysis | generation | testing | debugging | workflow | setup | tutorial

suggestedRoles:
  - string              # 建議使用的 AI 員工角色

tags:
  - string              # 搜尋標籤

userInputs:             # 操作員要填的表單欄位
  - id: string
    label: string
    description: string
    placeholder: string
    required: boolean
    type: text | textarea | select | number
    multiline: boolean
    rows: number
    group: string
    options:
      - string

usePhysicalSkills:      # 引用的實體 skill（對應 physical-skill/ 下的目錄名）
  - string              # 例：node-codegen, test-generation
---

# Skill Name（Markdown body）

## 目的 / 觸發時機 / 執行步驟 / 產出 / Guardrails / 品質檢查
```

### 關鍵欄位說明

- **`userInputs`**：前端表單欄位定義，決定操作員要填什麼
- **Markdown body**：AI prompt 指令，告訴 AI 做什麼、怎麼做
- **`usePhysicalSkills`**：引用 `physical-skill/` 下的實體 skill，CLI runtime 會載入執行
  - 一個 input-prompt 可以引用 0~N 個 physical-skill
  - 也可以不引用任何 physical-skill（純 prompt 互動）

## Physical Skill（`physical-skill/`）

打包好的實體 skill，CLI runtime 會載入來用。

### 目錄結構（由 zip 解開）

```
physical-skill/
└── {skill-id}/
    ├── SKILL.md            ← skill 描述（名稱、版本、用途）
    ├── scripts/            ← 可執行腳本
    ├── references/         ← 參考資料
    └── ...                 │其他 skill 需要的檔案
```

### 特性

- 由 zip 解壓安裝，不是手動編輯的
- CLI runtime 直接載入使用
- 可以被多個 input-prompt 引用
- 是可累積、可重用的執行能力

## 引用關係

```
Crew（員工）
  └── skillIds[] → input-prompt/{id}/SKILL.md
                      └── usePhysicalSkills[] → physical-skill/{id}/
```

- 員工的 `skillIds` 引用 `input-prompt/` 下的 skill
- input-prompt 的 `usePhysicalSkills` 引用 `physical-skill/` 下的 skill
- 層層引用，不跨層
