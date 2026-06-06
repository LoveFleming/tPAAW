---
id: skill-forging
name: Skill 鍛造
version: 1.0.0
description: 從零鍛造一個完整的 Skill，涵蓋 ID 設計、Role Prompt、Inputs/Outputs、Rules、Guardrails，並可選擇打包為實體 Skill Package
category: generation
suggestedRoles:
  - AI Skill Designer
  - AI Skill Creator
tags:
  - skill
  - forging
  - creation
  - design
  - package
userInputs:
  - id: skill_id
    label: Skill ID
    description: 技能的唯一識別碼（kebab-case），例：error-code-audit、release-planner
    placeholder: 例：contract-validator
    required: true
    type: text
    group: 📋 基本定義
  - id: role_prompt
    label: Role Prompt
    description: 這個技能的角色提示詞 — 告訴 AI 它是誰、要做什麼、怎麼做
    placeholder: |
      例：你是合約驗證專家。負責檢查 API 合約的完整性、一致性、向後相容性。
      遵循四步流程：Parse → Compare → Classify → Report。
      回答時使用繁體中文，技術術語保留英文。
    required: true
    type: textarea
    multiline: true
    rows: 6
    group: 📋 基本定義
  - id: user_inputs
    label: User Inputs 設計
    description: 操作員需要提供哪些輸入？每個輸入的 id、label、type、是否必填
    placeholder: |
      例：
      1. target_path (必填, text) — 要掃描的目錄路徑
      2. focus_area (選填, textarea) — 關注重點，如「錯誤處理」「效能瓶頸」
      3. output_format (選填, select: [markdown, json]) — 報告格式
    required: true
    type: textarea
    multiline: true
    rows: 5
    group: 🎯 輸入輸出
  - id: rules
    label: 執行規則 (Rules)
    description: 這個技能在執行時必須遵守的規則，例：不要修改檔案、必須先建索引再分析
    placeholder: |
      例：
      1. 只能讀取檔案，不能寫入或修改
      2. 分析前必須先建立完整的依賴圖
      3. 每個發現都要附帶嚴重等級（critical/warning/info）
      4. 如果發現 critical 等級問題，必須立即停止並回報
    required: false
    type: textarea
    multiline: true
    rows: 4
    group: 🛡️ 約束
  - id: guardrails
    label: Guardrails
    description: 安全護欄 — 什麼情況下必須停止、拒絕或警告操作員
    placeholder: |
      例：
      1. 如果目標路徑在 node_modules 內，拒絕執行並提示
      2. 如果檔案超過 10000 行，警告操作員可能需要較長時間
      3. 不處理 .env 或包含 secret 的檔案
    required: false
    type: textarea
    multiline: true
    rows: 4
    group: 🛡️ 約束
  - id: output_spec
    label: 期望產出 (Output)
    description: 完成後操作員會得到什麼？格式、內容、存放位置
    placeholder: |
      例：
      - 產出一份 Markdown 格式的分析報告
      - 包含：摘要、問題清單（含嚴重等級）、建議修正方案
      - 報告存放於 {projectRoot}/reports/{timestamp}.md
    required: true
    type: textarea
    multiline: true
    rows: 3
    group: 🎯 輸入輸出
  - id: build_package
    label: 打包為 Skill Package
    description: 是否同時產出 physical skill package（可部署的 zip）？勾選後會額外產出目錄結構和打包腳本
    placeholder: true / false
    required: true
    type: select
    values:
      - "false"
      - "true"
    group: 📦 打包選項
  - id: suggested_roles
    label: 建議指派角色
    description: 哪些 AI 員工角色適合使用這個技能？
    placeholder: 例：Node Developer, QA Engineer, Troubleshooting Engineer
    required: false
    type: text
    group: 📎 參考
  - id: reference_examples
    label: 參考案例
    description: 有沒有之前成功的 prompt 或類似技能可以參考？
    placeholder: 例：之前用「掃描 src/ 下所有 .ts 檔的 error handling...」效果很好
    required: false
    type: textarea
    multiline: true
    rows: 3
    group: 📎 參考
---

# Skill 鍛造

## 目的
從操作員的需求出發，鍛造一個完整的、可立即使用的 Skill 定義。
不像「Skill 建立」是訪談式探索，「Skill 鍛造」是**精確鍛造** — 操作員已經知道要什麼，直接給規格，產出成品。

## 觸發時機
- 操作員明確知道要建立什麼技能，已有具體規格
- 需要快速鍛造一個標準化的 Skill
- 要將一個好 prompt 固化為可重用的技能定義
- 需要產出 physical skill package（zip 部署包）

## 執行步驟

### 1. 解析規格
從操作員提供的輸入中提取：
- **Skill ID** — 確認是合法的 kebab-case，檢查 skills/ 目錄下是否已存在
- **Role Prompt** — 解析為結構化的角色定義（who + what + how）
- **User Inputs** — 轉換為標準 YAML userInputs 格式
- **Rules** — 整理為有序的規則清單
- **Guardrails** — 整理為安全護欄條目
- **Output Spec** — 定義產出格式和位置

### 2. 設計 Skill ID
- 確認 `{skill_id}` 為 kebab-case
- 檢查 `skills/input-prompt/{skill_id}/` 和 `skills/physical-skill/{skill_id}/` 是否已存在
- 如果衝突，建議替代名稱

### 3. 撰寫 SKILL.md
使用以下模板，將操作員的規格填入：

```
---
id: {skill_id}
name: {顯示名稱}
version: 1.0.0
description: {一句話說明}
category: {分類}
suggestedRoles: [{建議角色}]
tags: [{標籤}]
userInputs: [{從操作員輸入轉換}]
---

# {Skill Name}

## 目的
{從 role_prompt 提取核心目的}

## 觸發時機
{根據 skill 功能推斷}

## 執行步驟
{從 role_prompt 的方法論提取}

### Rules
{從 rules 輸入轉換}

### Guardrails
{從 guardrails 輸入轉換}

## 產出
{從 output_spec 載入}

## 品質檢查
{根據技能特性設計驗證步驟}
```

### 4. 驗證 Frontmatter
- YAML 格式正確
- 所有必填欄位存在（id, name, version, description, userInputs）
- userInputs 的 id 為 kebab-case
- userInputs 的 type 為合法值（text, textarea, select, number, checkbox）
- select 類型必須有 values 欄位

### 5. 建立檔案
```
{AIOC Root}/skills/input-prompt/{skill_id}/SKILL.md
```

### 6. 打包（如果 build_package 為 true）
如果操作員選擇打包，額外執行：

a) 建立 physical skill 目錄結構：
```
skills/physical-skill/{skill_id}/
├── SKILL.md          ← 完整技能定義（複製自 input-prompt 版本）
├── scripts/          ← 如果有需要腳本
│   └── README.md     ← 腳本說明
├── references/       ← 參考資料
│   └── README.md
└── README.md         ← 技能概覽
```

b) 更新 `usePhysicalSkills` 標記
c) 在 SKILL.md 的 frontmatter 加上：
```yaml
usePhysicalSkills: true
```

### 7. 回報結果
告訴操作員：
- ✅ Skill 已建立在哪裡
- ✅ 可以在 Dashboard 上立即使用
- ✅ 建議指派給哪些員工角色
- 如果有打包：✅ Physical skill package 已建立
- 提供驗證指令：`GET /api/skills` 確認能列出

## 產出
- `skills/input-prompt/{skill_id}/SKILL.md` — 完整的技能定義
- （選擇性）`skills/physical-skill/{skill_id}/` — 實體技能包目錄結構
- 操作員可在 Dashboard 上立即使用

## Guardrails
- Skill ID 不允許覆蓋已存在的技能（必須先確認）
- Role Prompt 不能為空或過於模糊
- User Inputs 至少要有一個必填欄位
- Rules 和 Guardrails 如果操作員沒給，根據技能性質自動生成合理的預設值
- 打包時不執行外部腳本，只建立目錄結構和範本
- 所有路徑使用相對於 AIOC Root 的路徑

## 品質檢查
- [ ] frontmatter 可被 YAML parser 正確解析
- [ ] Skill ID 為 kebab-case 且不衝突
- [ ] 至少 1 個 userInput 是 required
- [ ] Role Prompt 包含 who + what + how 三個維度
- [ ] Guardrails 至少有 1 條
- [ ] `GET /api/skills` 能列出這個新 Skill
- [ ] （如果打包）physical-skill 目錄結構完整
