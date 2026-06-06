---
id: node-codegen
name: Code Generation
version: 1.0.0
description: 根據規格生成符合 contract 的節點程式
userInputs:
  - id: node_spec
    label: Node 規格
    description: 貼上 node 的 spec 或 contract（含 input/output/error 定義）
    placeholder: "貼上 node contract JSON 或 spec 文件..."
    required: true
    multiline: true
  - id: target_lang
    label: 目標語言
    description: 使用什麼程式語言開發？
    placeholder: "例：TypeScript / Java"
    required: true
  - id: existing_code
    label: 現有程式碼
    description: 如果有相關的 legacy code 或想修改的檔案，貼上來
    placeholder: "貼上現有程式碼（選填）..."
    required: false
    multiline: true
  - id: codegen_notes
    label: 開發備註
    description: 任何額外的技術考量
    placeholder: "例：需要 unit test / 需要 logging / 效能要求 / 需向下相容"
    required: false
    multiline: true
---

生成節點程式時必須遵循以下規範：

1. 程式結構：
   - main handler function（entry point）
   - input validation（使用 JSON Schema）
   - business logic（依 process rules）
   - output formatting（符合 output contract）
   - error handling（依 error handling spec）

2. 必須包含：
   - TypeScript types for input/output
   - JSON Schema validation
   - 結構化日誌
   - Unit test skeleton

3. 命名規範：
   - 檔案：{domain}-{功能}-node.ts
   - Handler：{功能}Handler
   - Type：{功能}Input / {功能}Output

4. 錯誤碼格式：{DOMAIN}_NODE_{CATEGORY}_{DETAIL}