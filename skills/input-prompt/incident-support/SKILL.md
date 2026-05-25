---
id: incident-support
name: Incident Support
version: 1.0.0
description: 在事件發生時提供即時故障排除支援，協助快速恢復服務
userInputs:
  - id: incident_description
    label: 事件描述
    description: 發生了什麼事件？
    placeholder: "例：生產環境 API 大量 500 錯誤..."
    required: true
    multiline: true
  - id: incident_severity
    label: 嚴重程度
    description: 你認為的嚴重程度？
    placeholder: "例：P1 / P2 / P3 / 不確定"
    required: true
  - id: incident_actions
    label: 已採取行動
    description: 目前已經做了什麼？
    placeholder: "例：已重啟服務、已通知 on-call..."
    required: false
    multiline: true
  - id: incident_logs
    label: 相關日誌
    description: 貼上相關的 error log 或監控數據
    placeholder: "貼上日誌或指標數據（選填）..."
    required: false
    multiline: true
---

提供事件故障排除支援：

1. 事件分級
   - Severity 評估（P1~P4）
   - 影響範圍確認
   - 使用者影響評估

2. 快速回應
   - 緊急止血建議（Mitigation）
   - 關鍵指標監控清單
   - 溝通建議（Status Page / 通知）

3. 恢復計畫
   - Recovery Steps
   - 驗證清單（Service Health Check）
   - Rollback 評估

4. 事後檢討
   - Timeline 重建
   - Root Cause 摘要
   - 預防措施建議
   - Runbook 更新建議

產出事件處理報告。