---
id: test-generation
name: Test Generation
version: 1.0.0
description: 為節點程式生成完整的測試案例
userInputs:
  - id: test_source
    label: 待測程式碼
    description: 貼上要寫測試的 node 程式碼
    placeholder: "貼上 node 程式碼..."
    required: true
    multiline: true
  - id: test_contract
    label: Contract 定義
    description: 貼上 node contract（幫助生成精確的測試）
    placeholder: "貼上 contract JSON（選填）..."
    required: false
    multiline: true
  - id: test_scope
    label: 測試範圍
    description: 想測哪些情境？
    placeholder: "例：只要 happy path + error cases / 全部覆蓋 / 只測 boundary cases"
    required: false
---

生成節點測試時覆蓋：
1. Happy path
2. Edge cases
3. Error cases
4. Contract validation
5. Integration mock

測試檔案命名：{domain}-{功能}-node.test.ts