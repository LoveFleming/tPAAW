---
id: signal-detect
name: Signal Detection
version: 1.0.0
description: 分析系統訊號（Logs / Metrics / Traces），快速偵測異常模式
userInputs:
  - id: signal_source
    label: 訊號來源
    description: 貼上要分析的 Log / Metrics / Trace 資料
    placeholder: "貼上日誌、指標或追蹤資料..."
    required: true
    multiline: true
  - id: signal_type
    label: 訊號類型
    description: 這是哪種類型的訊號？
    placeholder: "例：Logs / Metrics / Traces / 混合"
    required: true
  - id: signal_time_range
    label: 時間範圍
    description: 異常發生的時間範圍
    placeholder: "例：2026-05-10 08:00 ~ 08:30 / 過去 1 小時"
    required: false
---

分析系統訊號，偵測異常：

1. Log 分析
   - Error Log 頻率與模式
   - Warning Log 趨勢
   - 異常 Log Correlation
   - Time-range 異常聚焦

2. Metrics 分析
   - Latency 異常（P50 / P95 / P99）
   - Error Rate 突增
   - Throughput 變化
   - Resource 使用率異常

3. Trace 分析
   - Slow Span 定位
   - Error Span 追蹤
   - Service Dependency 異常
   - Cross-service Latency 分佈

產出訊號偵測報告，標註異常項目與嚴重程度。