---
id: health-check-design
name: Health Check Design
version: 1.0.0
description: 為 API 服務設計標準化的 Health Check Endpoint 與監控架構
userInputs:
  - id: hcd_service
    label: 服務名稱
    description: 要設計 Health Check 的服務
    placeholder: "例：User Service / Order API"
    required: true
  - id: hcd_dependencies
    label: 服務依賴
    description: 這個服務依賴哪些外部資源
    placeholder: "例：PostgreSQL, Redis, Stripe API, S3"
    required: true
  - id: hcd_tech_stack
    label: 技術棧
    description: 使用的程式語言和框架
    placeholder: "例：Node.js + Express / Python + FastAPI"
    required: false
---

設計 API 服務的 Health Check 架構：

1. Health Endpoint 設計
   - /health（基本存活檢查）
   - /health/live（Liveness Probe）
   - /health/ready（Readiness Probe）
   - /health/detail（詳細元件狀態）

2. 檢查項目定義
   - Database 連線
   - Cache 連線
   - External API 依賴
   - Disk / Memory 基本資源
   - Background Job 狀態
   - Message Queue 狀態

3. 回應格式設計
   - HTTP Status Code 語義（200 / 503）
   - Response Body 結構（status / checks / version / uptime）
   - degraded 狀態處理（部分依賴異常但服務仍可用）

4. 監控整合
   - Uptime Robot / Prometheus / Datadog 設定
   - Alerting Rule 建議
   - Dashboard 設計
   - On-call 整合

5. 最佳實踐
   - Health Check 不應有外部依賴導致的 cascade failure
   - 回應時間應 < 1 秒
   - 避免在 Health Check 執行重度操作
   - Cache Health Check 結果

產出 Health Check 設計文件，包含 Endpoint 規格、實作範例與監控設定。