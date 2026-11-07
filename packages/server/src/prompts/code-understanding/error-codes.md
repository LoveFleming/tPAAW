# Code Understanding — Error Codes by Feature（LLM 語意整理）

You are a senior engineer doing an error-handling inventory of this codebase.

## What You Receive

- **ERROR SIGNALS** — machine-collected source lines that look error-related (throw / raise / Error / HTTP 4xx-5xx / reject…). Convention-agnostic: the project may use ANY style (constant codes, inline strings, HTTP-status-only, exceptions…) or none at all. Signals may contain noise — you judge and filter.
- Each signal group belongs to one feature from the Feature Map.

## What You Produce — strict JSON only（純 JSON，無 markdown fence）

```json
{
  "conventions": "none | systematic | mixed",
  "conventionNote": "這個 codebase 的 error 處理慣例判讀（用了什麼命名/結構、涵蓋多少）",
  "recommendation": { "suggest": false, "plan": "" },
  "byFeature": [
    {
      "featureId": "F-001",
      "featureName": "…",
      "summary": "這個 feature 的 error 處理現況 1-2 句（主要型態、缺口）",
      "codes": [
        { "code": "BIZ_ORCH_ORDER_LOT_MISSING", "message": "lot is required", "kind": "throw", "httpStatus": 409, "file": "src/order/service.ts", "line": 3, "note": "可選：一句話補充" },
        { "code": null, "message": "Unexpected token", "kind": "http", "httpStatus": 500, "file": "src/api/proxy.ts", "line": 88 }
      ]
    }
  ],
  "unmapped": [ { "code": null, "message": "…", "kind": "error-call", "httpStatus": null, "file": "…", "line": 1 } ]
}
```

## Rules

1. **只用素材裡實際存在的行** — 不發明 code、不猜不存在的檔案。無法歸類的進 unmapped。
2. `code`：該行有真實的常數/識別字（如 `BIZ_ORCH_ORDER_LOT_MISSING`、`ORD-001`、`ERR_VALIDATION`）才填；`throw new Error("訊息")` 這種沒有 code → `code: null`，message 填實際訊息。
3. 過濾雜訊：函式名含 Error 的正常調用、註解、型別宣告 — 直接丟棄，不要列出來。
4. `conventions` 判讀：
   - `systematic` = 有系統性 error code 命名（常數表、registry、穩定前綴）
   - `none` = 幾乎全是 inline 字串 / 只靠 HTTP status / 裸 exception
   - `mixed` = 兩者混合
5. **建議導入（重點）**：當 `conventions` 為 `none`（或幾乎 none）→ `recommendation.suggest = true`，`plan` 給導入方案，以 Error Code Rules v1 為基底：
   - 格式：`{CODE_CLASS}_{AREA}_{FAMILY}_{DETAIL}`（全大寫蛇底）
   - `CODE_CLASS ∈ SYS（系統/5xx）| BIZ（業務規則/4xx）| EXT（外部依賴/502）`
   - 命名錨定語意不錨定實作（LOT 不叫 DATABASE_ROW）
   - plan 要具體：建議的第一批 area（照這個 codebase 的分層）、3-5 個 seed code 範例（從現有 error 訊息轉寫）、放哪裡（error registry 檔案）、throw 點怎麼改
   - 若 conventions 已是 `systematic`/`mixed` → `suggest = false`，plan 留空或一句話說明現有慣例夠用
6. `summary`/`note` 用繁體中文，技術術語保留英文。
