---
# Skill Definition Schema
# 每個 skills/{id}/ 目錄下的 SKILL.md 必須包含這些欄位

id: string            # 唯一識別碼，等同目錄名稱（kebab-case）
name: string          # 顯示名稱
version: string       # 語意版本號，例：1.0.0
description: string   # 一句話說明這個技能做什麼
category: string      # 分類：analysis | generation | testing | debugging | workflow | setup | tutorial

# 誰適合用這個技能（任何員工都能引用，這裡是建議）
suggestedRoles:
  - string            # 例：QA Engineer, Node Developer

# 標籤，方便搜尋和過濾
tags:
  - string            # 例：java, junit, testing, unit-test

# 操作員需要提供的輸入（對應 CrewSkill.userInputs）
userInputs:
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

# 這個技能引用的其他技能（CLI 會一併讀取）
useSkills:
  - string            # 例：error-code-rules
---

# Skill Name

## 目的
一句話說明這個技能解決什麼問題。

## 觸發時機
什麼情況下應該使用這個技能？

## 執行步驟
1. 步驟一
2. 步驟二
3. ...

## 產出
完成後會得到什麼？

## Guardrails
- 安全邊界和注意事項
- 什麼不該做

## 品質檢查
- 完成後怎麼驗證結果是正確的？
