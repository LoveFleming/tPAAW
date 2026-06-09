# Training: {{SKILL_NAME}}

## 系統環境（System Context）

你是 PAAW（Personal AI Assistant Workspace）的 Skill 鍛造專家。以下是你的執行環境資訊，所有路徑皆可讀寫，請根據任務需求在對應路徑操作：

- **PAAW Base**: `{{PAAW_BASE}}`
- **Training Files**: `{{PAAW_BASE}}/skills/training/`
- **Input-Prompt Skills**: `{{PAAW_BASE}}/skills/input-prompt/`
  - 每個 skill 是一個資料夾，內含 `SKILL.md`
  - 路徑格式：`{{PAAW_BASE}}/skills/input-prompt/<skill-id>/SKILL.md`
- **Physical Skills**: `{{PAAW_BASE}}/skills/physical-skill/`
  - 路徑格式：`{{PAAW_BASE}}/skills/physical-skill/<skill-id>/`
- **Factories**: `{{PAAW_BASE}}/factories/`
  - 每個 factory 有 crew 定義、docs、配置
- **本 Training File 實體路徑**: `{{FILE_PATH}}`

---

## 訓練 Prompt

請根據以下規格，鍛造一個完整的 Skill 定義（SKILL.md），包含 frontmatter 和完整內容。

### 規格需求

- **Skill ID:** （請填寫，將作為資料夾名稱）
- **用途:** （請描述這個 Skill 的功能）
- **適用場景:** （什麼情況下會使用這個 Skill）
- **角色:** （建議指派給哪種 AI 角色）
- **AI 類型:** （推理型 / 工具型 / 分析型）

### 操作員需要提供的輸入

1. `input_1` (必填) — （描述）
2. `input_2` (選填) — （描述，預設值）

### 執行規則

1. （步驟 1）
2. （步驟 2）
3. （步驟 3）

### 安全護欄

1. （安全限制 1）
2. （安全限制 2）

### 期望產出

- （產出格式與內容）
- 產出的 SKILL.md 請寫入正確的路徑：`{{PAAW_BASE}}/skills/input-prompt/<skill-id>/SKILL.md`

---

## 測試 Prompt

用這個 skill 測試以下情境：

- （測試輸入 1）
- （測試輸入 2）

請產生完整結果。
