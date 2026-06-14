# Workflow 執行規則

## Workflow 定義

Workflow 是一系列 Skill 的組合，按照指定順序執行。

## 執行流程

1. **驗證** — 檢查所有節點是否連接正確
2. **初始化** — 載入 workflow 定義和所有引用的 Skill
3. **執行** — 依序執行每個節點
   - 每個節點完成後，輸出傳遞給下一個節點
   - 支援條件分支（根據前一步結果決定下一步）
4. **錯誤處理** — 如果某節點失敗，依策略處理：
   - skip：跳過該節點繼續
   - retry：重試指定次數
   - abort：中止整個 workflow

## Workflow 節點類型

- **任務節點** (task) — 執行一個 Skill
- **條件節點** (gate) — 根據條件決定流向
- **平行節點** (parallel) — 同時執行多個子節點
- **等待節點** (wait) — 等待外部事件或時間

## 品質要求

- 每個 workflow 都要有明確的起點和終點
- 節點之間資料傳遞必須型別匹配
- 所有節點都必須有 error handling
- Workflow 執行過程要可觀測（log 每個節點的 start/finish/error）