---
id: test-design
name: Test Cases Design
version: 1.0.0
description: 根據規格設計完整的測試案例，覆蓋正常流程、邊界條件與錯誤情境
userInputs:
  - id: test_spec
    label: 規格文件
    description: 貼上要設計測試的 Spec（Node Spec / API Spec / Orchestrator Spec）
    placeholder: "貼上 spec 內容..."
    required: true
    multiline: true
  - id: test_scope
    label: 測試範圍
    description: 想設計哪種測試？
    placeholder: "例：Unit Test / Contract Test / E2E Test / 全部"
    required: true
  - id: test_priority
    label: 優先等級
    description: 哪些情境最重要？
    placeholder: "例：error handling 最重要 / happy path 先 / 全部同等"
    required: false
  - id: test_existing
    label: 現有測試
    description: 如果已經有測試，貼上來看看還缺什麼
    placeholder: "貼上現有測試程式碼（選填）..."
    required: false
    multiline: true
---

根據規格設計測試案例：

1. 測試分類
   - Unit Test Cases（每個 Node）
   - Contract Test Cases（Input/Output 驗證）
   - Integration Test Cases（Orchestrator Flow）
   - Error Scenario Test Cases
   - Regression Test Cases

2. 每個測試案例包含
   - Test Case ID
   - Description
   - Pre-conditions
   - Input Data
   - Expected Output
   - Expected Error (if any)

3. 覆蓋原則
   - Happy path 必須覆蓋
   - 每個 Error Code 至少一個測試
   - 邊界值測試
   - 空值 / null / 缺少欄位測試

產出結構化的測試案例文件。