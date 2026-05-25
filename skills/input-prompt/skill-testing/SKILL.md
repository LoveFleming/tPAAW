---
id: skill-testing
name: Skill 測試
version: 1.0.0
description: 測試已建立的 Skill 定義是否正確運作，驗證 frontmatter、userInputs、prompt 輸出
category: testing
suggestedRoles:
  - AI Skill Designer
  - AI Skill Creator
tags:
  - skill
  - testing
  - validation
  - qa
userInputs:
  - id: target_skill_id
    label: 目標 Skill ID
    description: 要測試的技能 ID（kebab-case）
    placeholder: 例：skill-forging
    required: true
    type: text
    group: 📋 測試標的
  - id: test_scenarios
    label: 測試場景
    description: 描述你想測試的場景，或貼上測試用的輸入資料
    placeholder: |
      例：
      1. 正常流程：給完整 inputs，看產出的 SKILL.md 格式是否正確
      2. 邊界：缺少選填欄位，看是否正常處理
      3. 錯誤：Skill ID 已存在，看是否正確拒絕
    required: false
    type: textarea
    multiline: true
    rows: 5
    group: 🧪 測試內容
  - id: auto_fix
    label: 自動修復
    description: 發現問題時是否直接修正？false = 只報告不動檔案
    placeholder: true / false
    required: false
    type: select
    values:
      - "false"
      - "true"
    group: ⚙️ 選項
---

# Skill 測試

## 目的
驗證已建立的 Skill 定義是否完整、正確、可用。確保 frontmatter 格式正確、userInputs 合理、prompt 產出符合預期。

## 觸發時機
- 新 Skill 建立後，想確認它能正確運作
- 修改了 Skill 定義，需要回歸測試
- 定期品質檢查，確保所有 Skill 處於健康狀態

## 執行步驟

### 1. 載入目標 Skill
- 讀取 `skills/input-prompt/{target_skill_id}/SKILL.md`
- 如果目標是 physical skill，也讀取 `skills/physical-skill/{target_skill_id}/`
- 如果找不到，回報錯誤並停止

### 2. Frontmatter 驗證
檢查項目：
- [ ] YAML 格式正確（可被 parser 解析）
- [ ] 必填欄位存在：`id`, `name`, `version`, `description`
- [ ] `id` 與檔案路徑的目錄名稱一致
- [ ] `id` 為合法的 kebab-case
- [ ] `version` 格式為 semver（x.y.z）
- [ ] `category` 為合法值（analysis, generation, testing, debugging, workflow, setup, tutorial）
- [ ] `userInputs` 的每個 id 為 kebab-case
- [ ] `userInputs` 的 type 為合法值（text, textarea, select, number, checkbox）
- [ ] select 類型有 values 欄位
- [ ] 至少一個 userInput 是 required

### 3. Prompt 內容驗證
檢查 body（frontmatter 之後的 markdown）：
- [ ] 包含「目的」區塊
- [ ] 包含「觸發時機」區塊
- [ ] 包含「執行步驟」區塊
- [ ] 步驟是可執行的（有具體動作，不是空泛描述）
- [ ] 如果有 Guardrails 區塊，至少有 1 條規則
- [ ] 如果有品質檢查區塊，項目是可驗證的

### 4. 模擬執行測試（如果有 test_scenarios）
根據操作員提供的測試場景：
- 模擬填入 userInputs
- 產出 systemPrompt
- 檢查 prompt 是否包含預期的結構和內容
- 驗證 output 格式是否符合 description

### 5. API 驗證
- 確認 `GET /api/skills` 能列出此 Skill
- 確認回傳的資料與 SKILL.md 一致
- 確認 CrewEditor 的「從共享池選擇」能看到

### 6. 回報結果
```
📋 Skill 測試報告：{skill_id}
═══════════════════════════
✅ Frontmatter：通過（10/10 項）
✅ Prompt 內容：通過（6/6 項）
⚠️ 模擬執行：1 項警告
   - 步驟 3 缺少錯誤處理描述
✅ API 驗證：通過

總結：通過，1 項建議改善
```

如果 `auto_fix` 為 true，直接修正發現的問題並 commit。

## 產出
- 測試報告（文字）
- （如果 auto_fix=true）修正後的 SKILL.md

## Guardrails
- 只能讀取和驗證 skill 檔案，除非 auto_fix=true 否則不能修改
- 不要建立測試用的假 skill
- 如果 target_skill_id 不存在，立即回報不嘗試猜測
- 測試結果要具體：哪一項通過、哪一項失敗、原因是什麼

## 品質檢查
- 所有 frontmatter 驗證項目都有明確的通過/失敗判定
- 模擬執行用的輸入資料不會汙染真實環境
- 報告格式統一，可讀性高
