---
id: draft-flow-specs
name: Draft Flow Specs
version: 1.0.0
description: 使用 DSL 草擬 orchestrator flow
userInputs:
  - id: flow_name
    label: Flow 名稱
    description: 這個 orchestrator flow 叫什麼？
    placeholder: "例：Hold Lot Orchestrator / Material Check Flow"
    required: true
  - id: flow_trigger
    label: 觸發條件
    description: 什麼事件會啟動這個 flow？
    placeholder: "例：MES 發出 lot-tool-check request / 每天凌晨 2:00 排程"
    required: true
  - id: flow_steps
    label: 處理步驟
    description: 列出主要步驟，以及步驟之間的判斷條件
    placeholder: "1. 查詢觸發規則\n2. 取得候選 lot 清單\n3. 驗證每個 lot\n   → 通過：執行 hold\n   → 失敗：記錄錯誤\n4. 回報執行結果"
    required: true
    multiline: true
  - id: flow_nodes
    label: 已定義的 Nodes
    description: 已經有哪些 node 可以使用？（貼上 node contract 或名稱）
    placeholder: "例：queryTriggerRule, queryCandidateLot, validateCandidateLot"
    required: false
    multiline: true
  - id: flow_notes
    label: 補充說明
    description: 任何額外的 flow 設計考量
    placeholder: "例：需要支援冪等 / 失敗要能重試 / 需要人工審核關卡"
    required: false
    multiline: true
---

草擬 flow spec 時使用以下 DSL 格式：
BLOCK:execute
  RUN {nodeId} E:{policy}
BLOCK:decision
  IF {condition} THEN {branch}
每個 node 必須標注 input/output/error handling。