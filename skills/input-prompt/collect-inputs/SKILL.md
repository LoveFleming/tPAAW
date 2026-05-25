---
id: collect-inputs
name: Collect Requirements
version: 1.0.0
description: 引導操作員準備 node 開發的必要輸入資料
userInputs:
  - id: input_trigger
    label: 觸發條件
    description: 什麼事件觸發這個 node？
    placeholder: "例：當 MES 系統發出 lot-tool-check request 時觸發"
    required: true
  - id: input_schema
    label: 輸入資料結構
    description: 接收什麼格式的資料？（可用 JSON Schema 或文字描述）
    placeholder: "{\n  "lotId": "string",\n  "toolId": "string",\n  "materialType": "string",\n  "quantity": "number"\n}"
    required: true
    multiline: true
  - id: input_example
    label: 輸入範例
    description: 提供一筆實際的 input example
    placeholder: "{\n  "lotId": "LOT-20260401-001",\n  "toolId": "TOOL-A01",\n  "materialType": "Wafer",\n  "quantity": 25\n}"
    required: false
    multiline: true
  - id: output_schema
    label: 輸出資料結構
    description: 產出什麼格式的資料？
    placeholder: "{\n  "result": "PASS | FAIL",\n  "checkedItems": [{ "item": "string", "status": "string" }],\n  "summary": "string"\n}"
    required: true
    multiline: true
  - id: output_example
    label: 輸出範例
    description: 提供一筆實際的 output example
    placeholder: "{\n  "result": "PASS",\n  "checkedItems": [\n    { "item": "material_type", "status": "MATCH" },\n    { "item": "quantity", "status": "OK" }\n  ],\n  "summary": "All checks passed"\n}"
    required: false
    multiline: true
  - id: process_rules
    label: 處理流程與判斷邏輯
    description: 主要處理流程 step by step，以及判斷條件
    placeholder: "1. 驗證 lotId 格式\n2. 查詢 tool 對應的 material 清單\n3. 比對 materialType 是否在清單中\n4. 檢查 quantity 是否在允許範圍\n5. 全部通過 → PASS，否則 → FAIL 並記錄失敗項目"
    required: true
    multiline: true
  - id: error_scenarios
    label: 錯誤情境
    description: 列出可預期的錯誤情境及處理方式
    placeholder: "| 情境 | 處理方式 | 錯誤碼 |\n|------|---------|--------|\n| lotId 不存在 | 回傳錯誤 | MAT_NODE_BIZ_LOT_NOT_FOUND |\n| toolId 未註冊 | 回傳錯誤 | MAT_NODE_BIZ_TOOL_NOT_REGISTERED |\n| material 不匹配 | 記錄並回傳 FAIL | MAT_NODE_BIZ_MATERIAL_MISMATCH |"
    required: true
    multiline: true
  - id: dev_notes
    label: 開發備註
    description: 任何額外的技術考量或偏好
    placeholder: "例：使用 TypeScript / 需要 logging / 需要 unit test / 效能要求 P99 < 100ms"
    required: false
    multiline: true
---

操作員已提供完整的規格資料（見下方）。如果資料不完整或有疑問，請先向操作員確認再開始開發。

確認清單：
- [ ] Input 定義完整（觸發條件 + 資料結構 + 範例）
- [ ] Output 定義完整（資料結構 + 範例）
- [ ] Process Rules 清楚（流程 + 判斷邏輯）
- [ ] Error Handling 完整（情境 + 處理方式 + 錯誤碼）