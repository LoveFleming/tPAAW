---
id: extract-user-stories
name: Extract User Stories
version: 1.0.0
description: 從需求文件或 legacy code 中提取 user stories
userInputs:
  - id: source_material
    label: 需求來源
    description: 貼上 PM 的需求文件、會議記錄、或 legacy code 片段
    placeholder: "貼上需求文件內容...\n\n例：\nPM 要求做一個 lot-tool-check 功能，當 MES 發出請求時，要驗證 tool 上的 material 是否符合規定..."
    required: true
    multiline: true
  - id: domain
    label: 領域範圍
    description: 這個需求屬於哪個業務領域？
    placeholder: "例：Material Management / Hold Lot / Phase Tracking"
    required: true
  - id: priority
    label: 優先級與時程
    description: 急迫程度與預期交付時間
    placeholder: "例：P1 本週交付 / P2 下個 Sprint / P3 有空再做"
    required: false
  - id: constraints
    label: 額外限制或背景
    description: 任何技術限制、合規要求、或 legacy 系統相依
    placeholder: "例：必須相容 MES v3 API / 不能動到 DB schema / 需要通過 SOX audit"
    required: false
    multiline: true
---

當收到需求時，請依以下格式萃取 user stories：
- As a [角色], I want [功能], so that [價值]
- 驗收條件 (Acceptance Criteria)
- 邊界條件 (Edge Cases)
- 依賴項 (Dependencies)