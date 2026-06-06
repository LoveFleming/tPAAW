---
id: contract-validation
name: Contract Validation
version: 1.0.0
description: 驗證程式碼是否符合 node contract 規範
userInputs:
  - id: contract_def
    label: Contract 定義
    description: 貼上 node contract（input/output/error schema）
    placeholder: "貼上 contract JSON 或 spec 文件..."
    required: true
    multiline: true
  - id: source_code
    label: 待驗證程式碼
    description: 貼上要驗證的 node 程式碼
    placeholder: "貼上 node 程式碼..."
    required: true
    multiline: true
  - id: validation_focus
    label: 重點關注
    description: 特別想驗證哪些部分？
    placeholder: "例：error handling 是否完整 / output 格式是否正確 / 全部都要驗"
    required: false
    multiline: true
---

驗證節點程式的 contract 合規：

1. Input Schema 驗證：所有 required 欄位都有 validation
2. Output Schema 驗證：輸出格式符合 contract
3. Error Handling 驗證：每個錯誤情境都有對應處理
4. 產生合規報告