---
id: incident-detection
name: Incident Detection
version: 1.0.0
description: 分析 API 異常數據，判斷是否為事故，提供分級與應變建議
userInputs:
  - id: incident_symptom
    label: 異常症狀
    description: 觀察到的異常現象
    placeholder: "例：API 回應時間從 200ms 升到 5s，錯誤率從 0.1% 升到 15%"
    required: true
    multiline: true
  - id: incident_service
    label: 受影響服務
    description: 哪些 API 或服務受影響
    placeholder: "例：POST /api/orders, GET /api/products"
    required: true
  - id: incident_data
    label: 監控數據
    description: 貼上相關的監控數據、Log、Metric 截圖等
    placeholder: "貼上監控數據或日誌..."
    required: false
    multiline: true
---

執行 API 事故偵測與分析：

1. 異常確認
   - 異常類型判定（Latency Spike / Error Burst / 完全不可用）
   - 影響範圍評估（哪些 Endpoint / 哪些使用者）
   - 開始時間與持續時間

2. 嚴重程度分級
   - P1：服務完全不可用
   - P2：核心功能異常，部分使用者受影響
   - P3：非核心功能異常或效能下降
   - P4：輕微異常，不影響使用者體驗

3. 根因假設
   - 依賴服務異常？
   - 部署變更引起？
   - 流量突增？
   - 資源耗盡？
   - 外部服務故障？

4. 應變建議
   - 緊急止血措施（Rollback / Circuit Breaker / Rate Limit）
   - 溝通建議（Status Page / 使用者通知）
   - 監控指標追蹤清單

5. 事後檢討模板
   - Incident Timeline
   - Root Cause
   - Impact Assessment
   - Action Items
   - Prevention Measures

產出事故分析報告與應變建議。