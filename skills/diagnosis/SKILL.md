---
id: diagnosis
name: Diagnosis
version: 1.0.0
description: 系統性診斷流程，從訊號收集到問題確認的結構化步驟
userInputs:
  - id: diag_symptom
    label: 異常症狀
    description: 觀察到什麼異常？
    placeholder: "例：回應時間從 200ms 升到 3s..."
    required: true
    multiline: true
  - id: diag_system
    label: 系統範圍
    description: 涉及哪些服務或元件？
    placeholder: "例：OrderService → BillingService → PaymentGateway"
    required: true
  - id: diag_baseline
    label: 正常基線
    description: 正常的行為是什麼樣子？
    placeholder: "例：P99 latency 通常 < 500ms..."
    required: false
    multiline: true
---

執行結構化系統診斷：

1. 訊號收集
   - 確認可用的 Observability 工具
   - 收集相關 Logs / Metrics / Traces
   - 確認時間範圍與基線

2. 異常確認
   - 與正常基線比較
   - 確認是否為已知問題
   - 評估嚴重程度

3. 範圍縮小
   - Service 層級定位
   - Node / API 層級定位
   - Dependency Chain 分析

4. 根因假設
   - 列出可能的根因假設
   - 依可能性排序
   - 建議驗證步驟

產出診斷報告與建議的下一步行動。