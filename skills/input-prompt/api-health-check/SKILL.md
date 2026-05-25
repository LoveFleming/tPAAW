---
id: api-health-check
name: API Health Check
version: 1.0.0
description: 對指定 API 服務執行全面健康檢查，涵蓋可用性、回應時間、狀態碼、Payload 驗證
userInputs:
  - id: api_base_url
    label: API Base URL
    description: 要檢查的 API 服務網址
    placeholder: "例：https://api.example.com / http://localhost:3000"
    required: true
  - id: api_endpoints
    label: Endpoints 清單
    description: 要檢查的 API 路徑（每行一個）
    placeholder: "例：\nGET /api/health\nGET /api/users\nPOST /api/auth/login"
    required: true
    multiline: true
  - id: api_auth
    label: 認證方式
    description: API 的認證方式（選填）
    placeholder: "例：Bearer Token / API Key / 無需認證"
    required: false
  - id: api_expected_schema
    label: 預期回應結構
    description: 預期的 Response JSON 結構（選填）
    placeholder: "例：{ "status": "ok", "data": [...] }"
    required: false
    multiline: true
---

執行 API 服務健康檢查：

1. Endpoint 可用性檢查
   - 對每個關鍵 Endpoint 發送請求
   - 確認 HTTP Status Code（2xx / 4xx / 5xx）
   - 記錄回應時間（ms）
   - DNS 解析是否正常

2. 回應品質驗證
   - Response Payload 結構是否符合預期
   - 必要欄位是否存在
   - 資料格式是否正確（JSON Schema 驗證）
   - 空值或異常值偵測

3. 效能指標
   - 回應時間與基線比較
   - P50 / P95 / P99 Latency 估算
   - Payload Size 是否合理
   - Timeout 或 Slow Response 偵測

4. 認證與授權
   - Public Endpoint 可達性
   - Protected Endpoint 認證流程
   - Token 過期偵測
   - CORS / Rate Limiting 行為

5. 依賴服務檢查
   - External API 依賴是否正常
   - Database 連線健康
   - Cache 服務狀態
   - Third-party 整合點驗證

產出 API 健檢報告，每個 Endpoint 標示 ✅ 正常 / ⚠️ 注意 / ❌ 異常，附上回應時間、狀態碼與異常詳情。