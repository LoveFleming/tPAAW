---
id: bug-review
name: Bug Review
version: 1.0.0
description: 分析缺陷報告，定位根因，評估影響範圍與修復建議
userInputs:
  - id: bug_description
    label: 缺陷描述
    description: 發生了什麼問題？
    placeholder: "例：API 回傳 500 錯誤，log 顯示 BIZ_NODE_LOT_CHECK_TIMEOUT..."
    required: true
    multiline: true
  - id: bug_error_code
    label: Error Code
    description: 相關的 Error Code（如果有的話）
    placeholder: "例：BIZ_NODE_LOT_CHECK_TIMEOUT"
    required: false
  - id: bug_log
    label: 相關 Log
    description: 貼上相關的 log 或 error stack trace
    placeholder: "貼上 log 內容（選填）..."
    required: false
    multiline: true
  - id: bug_spec
    label: 相關規格
    description: 貼上相關的 spec 或 contract
    placeholder: "貼上 spec 內容（選填）..."
    required: false
    multiline: true
  - id: bug_code
    label: 相關程式碼
    description: 貼上可能有問題的程式碼
    placeholder: "貼上程式碼（選填）..."
    required: false
    multiline: true
---

分析缺陷並提供完整報告：

1. 缺陷分類
   - Root Cause Analysis
   - 影響範圍（哪些 API / Node 受影響）
   - 嚴重程度（Critical / Major / Minor）

2. 規格比對
   - 是否違反 Spec 定義
   - 是否為 Spec 未涵蓋的情境
   - Error Code 是否正確使用

3. 修復建議
   - 修正方向
   - 需要更新的 Spec
   - 需要新增的 Test Case
   - Regression Test 建議

4. 預防措施
   - 如何避免同類問題再發生
   - PR Gate 是否需要新增檢查項目