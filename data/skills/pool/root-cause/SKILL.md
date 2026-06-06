---
id: root-cause
name: Root Cause Analysis
version: 1.0.0
description: 根據異常訊號與系統架構，進行根因分析，定位問題源頭
userInputs:
  - id: rca_incident
    label: 異常描述
    description: 發生了什麼問題？
    placeholder: "例：API 回傳 503，持續 15 分鐘，影響查詢服務..."
    required: true
    multiline: true
  - id: rca_evidence
    label: 證據資料
    description: 貼上相關的 Log、Metrics 截圖、Trace 連結等
    placeholder: "貼上日誌、指標、追蹤資料..."
    required: true
    multiline: true
  - id: rca_architecture
    label: 系統架構
    description: 相關的系統架構或服務依賴關係（選填）
    placeholder: "描述服務之間的關係..."
    required: false
    multiline: true
  - id: rca_recent_changes
    label: 近期變更
    description: 最近是否有部署、設定變更或外部服務異常？
    placeholder: "例：今天上午部署了 v2.3.1..."
    required: false
    multiline: true
---

執行 Root Cause Analysis：

1. 問題描述
   - 異常現象摘要
   - 影響範圍（Service / API / Node）
   - 發生時間與持續時間

2. 訊號 Correlation
   - Log ↔ Metric ↔ Trace 關聯
   - Time-series 對齊分析
   - Service Dependency Chain

3. 根因定位
   - 直接原因 (Direct Cause)
   - 根本原因 (Root Cause)
   - 貢獻因素 (Contributing Factors)

4. 影響評估
   - 受影響的業務流程
   - 使用者影響範圍
   - 資料一致性風險

產出結構化的 RCA 報告。