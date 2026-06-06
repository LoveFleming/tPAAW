---
id: sla-monitor
name: SLA Monitor
version: 1.0.0
description: 定義與監控服務等級指標（SLI/SLO/SLA），追蹤服務品質達成率
userInputs:
  - id: sla_service
    label: 服務名稱
    description: 要設定 SLA 的服務
    placeholder: "例：User API / Payment Service / Dashboard"
    required: true
  - id: sla_tier
    label: 服務等級
    description: 目標的服務等級
    placeholder: "例：99.9% / 99.95% / 99.99%"
    required: true
  - id: sla_critical_paths
    label: 關鍵路徑
    description: 最重要的 API 路徑或使用者流程
    placeholder: "例：登入 → 查詢 → 下單 → 付款"
    required: false
    multiline: true
---

建立 SLA 監控方案：

1. SLI 定義（Service Level Indicator）
   - Availability：成功請求 / 總請求
   - Latency：P99 回應時間
   - Error Rate：5xx 佔比
   - Throughput：每秒請求數

2. SLO 設定（Service Level Objective）
   - 根據業務需求設定目標值
   - Availability ≥ 99.9%
   - P99 Latency < 500ms
   - Error Rate < 0.1%
   - 計算 Error Budget

3. 監控策略
   - Health Check 頻率建議
   - Alerting 條件與閾值
   - Escalation 規則
   - On-call 通知設定

4. 儀表板設計
   - 關鍵指標視覺化
   - 趨勢圖與異常標記
   - Error Budget 消耗追蹤
   - Burn Rate 計算

5. 報告模板
   - 週報 / 月報格式
   - SLI 達成率統計
   - Incident 回顧摘要
   - 改善建議

產出完整的 SLA 監控方案文件。