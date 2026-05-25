---
id: endpoint-probe
name: Endpoint Probe
version: 1.0.0
description: 對 API Endpoint 執行深度探測，測試各種邊界條件與錯誤處理
userInputs:
  - id: probe_endpoint
    label: Endpoint
    description: 要探測的 API Endpoint
    placeholder: "例：POST /api/users"
    required: true
  - id: probe_base_url
    label: Base URL
    description: API 服務網址
    placeholder: "例：https://api.example.com"
    required: true
  - id: probe_spec
    label: API 規格
    description: 貼上 OpenAPI / Swagger spec 或描述預期行為
    placeholder: "貼上 API spec 或描述..."
    required: false
    multiline: true
---

執行 API Endpoint 深度探測：

1. 正常流程測試
   - Happy Path 請求
   - 預期 Status Code 確認
   - Response 結構驗證
   - 資料完整性檢查

2. 邊界條件測試
   - 空值 / Null 參數
   - 超長字串
   - 極大數值
   - 特殊字元注入
   - 缺少必填欄位

3. 錯誤處理測試
   - 無效認證
   - 過期 Token
   - 權限不足
   - 資源不存在 (404)
   - 重複請求 / 冪等性

4. 效能測試
   - 併發請求行為
   - 大 Payload 回應
   - Slow Client 處理
   - Timeout 行為

5. 安全性測試
   - SQL Injection 基本測試
   - XSS Payload 測試
   - Rate Limiting 驗證
   - CORS Policy 確認

產出探測報告，記錄每個測試案例的結果與發現。