# Training: ES Log Collector Skill

## 訓練 Prompt

你是一個 Elasticsearch 日誌分析專家。請根據以下 Skill 規格，鍛造一個完整的 Skill 定義（SKILL.md），包含 frontmatter 和完整內容。

### 規格需求

- **Skill ID:** `es-log-collector`
- **用途:** 從 Elasticsearch 叢集收集分散式日誌，按時間線 correlation 排序，產生結構化分析報告
- **適用場景:** 微服務架構下，一個請求跨越多個服務，需要在 ES 中追蹤完整呼叫鏈
- **角色:** ES Log Collector — 分散式日趵收集與分析專家
- **AI 類型:** 建議指派給 Troubleshooting Engineer 或 Health Checker

### 操作員需要提供的輸入

1. `es_host` (必填) — Elasticsearch 主機位址，例：`http://localhost:9200`
2. `es_index` (必填) — 要查詢的 index pattern，例：`app-logs-*`
3. `trace_id` (必填) — 追蹤的 Trace ID 或 Correlation ID
4. `time_range` (選填) — 時間範圍，例：`last 1h`、`2026-01-01~2026-01-02`
5. `log_level` (選填) — 篩選等級，例：`ERROR`、`WARN`，預設為 `ERROR`
6. `services` (選填) — 限制特定服務，例：`order-service,payment-service`

### 執行規則

1. 先用 trace_id 在 ES 搜尋所有相關日誌
2. 按 @timestamp 排序，建立時間線
3. 識別每筆 log 對應的 service name
4. 標記 ERROR 和 WARN 等級的日誌
5. 如果有 stack trace，解析出關鍵錯誤訊息
6. 建議搜尋 ES 的 query DSL

### 安全護欄

1. 不執行任何寫入操作（只查詢）
2. 不暴露 ES 帳密
3. 如果查詢結果超過 1000 筆，警告操作員並建議縮小範圍
4. 不自動連線到 ES（只產生查詢指令和分析）

### 期望產出

- Markdown 格式的日誌分析報告
- 包含：時間線表格、服務呼叫鏈圖、錯誤摘要、建議排查方向
- 產出 ES query DSL 供操作員直接執行

---

## 測試 Prompt

用這個 skill 分析以下情境：

- ES Host: `http://es-prod.example.com:9200`
- Index: `microservice-logs-2026.05.*`
- Trace ID: `trace-abc-123-def`
- 時間範圍: 最近 30 分鐘
- 只看 ERROR 等級

請產生完整的查詢 DSL 和分析報告模板。
