---
id: quality-gate
name: Quality Gate
version: 1.0.0
description: 執行完整的品質閘門檢查，確認交付物可以進入下一階段
userInputs:
  - id: gate_artifact
    label: 交付物
    description: 貼上要過 Gate 的內容（Spec + Code + Test）
    placeholder: "貼上 spec、程式碼、測試等交付物..."
    required: true
    multiline: true
  - id: gate_type
    label: Gate 類型
    description: 要過什麼類型的 Gate？
    placeholder: "例：PR Gate / Release Gate / Spec Gate / Full Gate"
    required: true
  - id: gate_standard
    label: 適用標準
    description: 參考哪份標準來檢查？
    placeholder: "例：工廠標準 v1 / Error Code Rules v1 / 全部適用"
    required: false
---

執行 Quality Gate 檢查：

1. Spec Gate
   - Spec 是否存在且完整
   - API Contract 是否穩定
   - Node Contract 是否完整

2. Code Gate
   - Code 是否符合 Spec
   - Error Code 是否符合規範
   - 是否有 Lint 問題

3. Test Gate
   - Unit Test 是否通過
   - Contract Test 是否通過
   - E2E Test 是否通過
   - 覆蓋率是否達標

4. Runbook Gate
   - Runbook 是否存在
   - Error Code 是否都有對應處理步驟
   - Observability 是否完整

5. 最終判定
   - PASS / CONDITIONAL PASS / FAIL
   - 條件清單（如果是 CONDITIONAL）
   - 阻擋清單（如果是 FAIL）