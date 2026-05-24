---
id: skill-creation
name: Skill 建立
version: 1.0.0
description: 設計並建立新的 Skill 定義，產出完整的 SKILL.md 到 skills/ 目錄
category: generation
suggestedRoles:
  - AI Skill Creator
tags:
  - skill
  - creation
  - design
userInputs:
  - id: skill_purpose
    label: 技能目的
    description: 這個技能解決什麼問題？做什麼事？
    placeholder: 例：掃描 Java 專案目錄結構，自動識別模組邊界，產出 release unit 清單
    required: true
    type: textarea
    multiline: true
    rows: 4
    group: 📋 Skill 定義
  - id: skill_audience
    label: 適用角色
    description: 哪些 AI 員工角色適合用這個技能？
    placeholder: 例：Node Developer, QA Engineer
    required: false
    type: text
    group: 📋 Skill 定義
  - id: skill_inputs_description
    label: 需要的操作員輸入
    description: 使用者需要提供什麼資訊才能啟動這個技能？
    placeholder: 例：1. 目標類別路徑 2. 測試重點（選填）3. 測試框架
    required: false
    type: textarea
    multiline: true
    rows: 3
    group: 📋 Skill 定義
  - id: skill_examples
    label: 成功案例或參考
    description: 之前有成功讓 AI 做過類似的事嗎？把 prompt 或過程貼過來
    placeholder: 例：之前我用「分析 src/services/ 下的錯誤處理...」的 prompt 得到很好的結果
    required: false
    type: textarea
    multiline: true
    rows: 3
    group: 📎 參考
useSkills:
  - skill-creation
---

# Skill 建立

## 目的
把操作員的需求和經驗轉化為結構化、可重用的 Skill 定義，產出完整的 SKILL.md 檔案。

## 觸發時機
- 操作員發現一個反覆出現的工程問題，想建立可重用的 Skill
- 操作員有一個好 prompt，想固化成標準技能
- 需要為 AI 員工新增能力

## 執行步驟

### 1. 需求探索
跟操作員確認：
- **做什麼**：這個技能要解決什麼問題？
- **給誰用**：哪些角色適合？
- **需要什麼輸入**：操作員要提供什麼才能啟動？
- **期望產出**：完成後得到什麼？
- **有沒有成功經驗**：之前用 prompt 做成功過嗎？

### 2. 設計 Skill ID
- 用 kebab-case，例：`java-unit-test`、`error-code-audit`
- 要能從 ID 看出技能做什麼
- 確認 `skills/` 目錄下沒有同名的

### 3. 撰寫 SKILL.md
按照以下結構撰寫（參考 skills/_SCHEMA.md）：

```
---
id: {skill-id}
name: 顯示名稱
version: 1.0.0
description: 一句話說明
category: analysis | generation | testing | debugging | workflow | setup | tutorial
suggestedRoles: [...]
tags: [...]
userInputs: [...]
useSkills: [...]
---

# Skill Name

## 目的
## 觸發時機
## 執行步驟
## 產出
## Guardrails
## 品質檢查
```

### 4. 建立檔案
把 SKILL.md 寫到正確的位置：
```
{AIOC Base}/skills/{skill-id}/SKILL.md
```

### 5. 驗證
- frontmatter 格式正確（YAML）
- 所有必填欄位都有
- userInputs 的 id 是合法的 kebab-case
- 檔案確實存在於 skills/ 目錄下
- 用 `GET /api/skills` 能列出來

### 6. 回報
告訴操作員：
- Skill 已建立在哪裡
- 可以在 CrewEditor 的「從共享池選擇」看到
- 建議指派給哪個員工

## 產出
- `skills/{skill-id}/SKILL.md` — 完整的技能定義
- 操作員可以在 Dashboard 上立即使用

## Guardrails
- Skill 是方法論，不是程式碼。寫的是「怎麼做」而不是「做什麼」
- userInputs 只放必要的，不要一次要太多
- description 要一句話說清楚，方便搜尋
- 不要建立空的或半成品 Skill
- 如果需要引用其他 Skill，在 useSkills 裡標明

## 品質檢查
- 一個新手工程師讀完 SKILL.md 就知道怎麼做
- frontmatter 可以被 YAML parser 正確解析
- `GET /api/skills` 回傳的清單包含這個新 Skill
