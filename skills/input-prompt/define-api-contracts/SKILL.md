---
id: define-api-contracts
name: Define API Contracts
version: 1.0.0
description: 定義 API 與 Data contracts（JSON Schema）
userInputs:
  - id: api_purpose
    label: API 用途
    description: 這個 API 要做什麼？誰會呼叫它？
    placeholder: "例：MES 系統呼叫此 API 查詢 tool 上的 material 是否允許上架"
    required: true
  - id: api_path
    label: API Path & Method
    description: 預期的 endpoint 和 HTTP method
    placeholder: "例：POST /api/v1/material/lot-tool-check"
    required: true
  - id: request_fields
    label: Request 欄位
    description: API 需要接收哪些欄位？
    placeholder: "lotId: string (required)\ntoolId: string (required)\nmaterialType: string (optional)\nquantity: number (optional)"
    required: true
    multiline: true
  - id: response_fields
    label: Response 欄位
    description: API 要回傳哪些欄位？
    placeholder: "result: PASS | FAIL\ncheckedItems: array of { item, status }\nsummary: string"
    required: true
    multiline: true
  - id: error_cases
    label: 錯誤情境
    description: 列出可能的錯誤情境
    placeholder: "lotId 不存在 → 404\ntoolId 未註冊 → 400\nmaterial 不匹配 → 200 但 result=FAIL"
    required: false
    multiline: true
  - id: api_notes
    label: 補充說明
    description: 任何額外的設計考量
    placeholder: "例：需支援分頁 / 需向下相容 v0 / response time < 200ms"
    required: false
    multiline: true
---

定義 API 合約時，請遵守以下規範：
1. 使用 JSON Schema draft-07
2. Request/Response 必須包含 example
3. 錯誤回應使用統一 ErrorEnvelope
4. 版本號格式：major.minor.patch
5. API path 遵循 /api/v{version}/{domain}/{resource}