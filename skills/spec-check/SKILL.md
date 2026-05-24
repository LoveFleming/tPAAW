---
id: spec-check
name: Spec Check
version: 1.0.0
description: 檢查規格文件是否完整、清楚、可被工程師與 AI 理解
userInputs:
  - id: spec_content
    label: 規格文件
    description: 貼上要檢查的 Spec 內容（API Spec / Node Spec / Orchestrator Spec）
    placeholder: "貼上 spec 內容..."
    required: true
    multiline: true
  - id: spec_type
    label: 規格類型
    description: 這是什麼類型的規格？
    placeholder: "例：API Spec / Node Spec / Orchestrator Spec / 全部"
    required: true
  - id: spec_check_focus
    label: 重點關注
    description: 特別想檢查哪些部分？
    placeholder: "例：error handling 是否完整 / contract 是否穩定 / 全部都要驗"
    required: false
    multiline: true
---

執行 Spec 完整性檢查：

1. API Spec 檢查
   - 是否有 API Name、Endpoint、Method
   - Request / Response Contract 是否完整
   - Business Purpose 是否清楚
   - Error Handling 是否定義

2. Node Spec 檢查
   - Node 名稱是否具備業務語意
   - Input / Output Contract 是否完整
   - Process Rules 是否清楚
   - Error Code 是否符合命名規範

3. Orchestrator Spec 檢查
   - Flow Steps 是否清楚
   - Node Execution Order 是否合理
   - Decision Points 是否定義
   - Fallback / Retry 是否規劃

產出檢查報告，列出缺失項目與改善建議。