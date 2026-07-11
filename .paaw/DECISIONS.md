# Decision Records

> Architecture Decision Records (ADR)。每筆記錄解釋 WHY 某個決策被做出。

---

## ADR-001: Token Budget 取代固定 slice(-20)

**Date:** 2026-07-10
**Status:** Accepted

### Context
混合 CJK / 英文內容，`slice(-20)` 取最後 20 則訊息太死板。CJK 每字約 2-3 token，20 則中文訊息可能遠超 model 限制；20 則英文可能太短浪費 context。

### Decision
用 ~4 chars/token 估算，設定 12000 token budget（含 system prompt），預留 2000 token 給 response。被修剪的舊訊息每則總結 150 字元，以 system message 注入。

### Consequences
- Positive: 更穩定的上下文長度，CJK 不會爆 token
- Negative: 估算不精確（CJK 偏高），但安全側誤差可接受

### Alternatives
- tiktoken 精確計算 → 需引入依賴，且不支援 GLM tokenizer
- 固定 char budget → CJK 和英文混算不準

---

## ADR-002: 歸檔而非刪除對話

**Date:** 2026-07-10
**Status:** Accepted

### Context
用戶要求「新對話」功能，但不想丟失歷史對話。

### Decision
新對話 = 將當前對話歸檔到 `{crewId}.archive/{timestamp}-{preview}.json`，不是刪除。歸檔列表可瀏覽、可載入繼續聊天。

### Consequences
- Positive: 可隨時載入舊對話繼續，零資料損失
- Negative: 佔磁碟空間（但 JSON 很小，可忽略）

### Alternatives
- 直接刪除 → 資料損失風險
- 資料庫存 → 過度設計，JSON 檔案足夠

---

## ADR-003: 移除 per-crew model 設定

**Date:** 2026-07-11
**Status:** Accepted

### Context
每個 crew 各自設 `chatConfig.model` 造成管理混亂。PAAW 已有 fallback chain（zai GLM → OpenRouter GLM → DeepSeek），per-crew model 多餘且容易忘記改。

### Decision
- `chatConfig.model` 移除 — model 由 PAAW 預設/fallback chain 控制
- `chatConfig.approvalMode` 移除 — 改為 runtime 設定，不存 crew JSON
- `risk` 欄位移除 — 不再需要 risk level 分級
- ModelSelector 保留在 EmployeeWorkspace（runtime 選擇），但不寫回 crew JSON

### Consequences
- Positive: 統一管理，改一處生效
- Negative: 不能 per-crew 用不同 model（暫無此需求）

### Alternatives
- 保留但加 UI 提示 → 增加複雜度，沒解決問題
- 全部用全域設定，移除 ModelSelector → 太硬，失去 runtime 彈性

---

## ADR-004: expertise/guardrails 用 textarea 不用 tag input

**Date:** 2026-07-11
**Status:** Accepted

### Context
guardrails 的轉介規則有條件邏輯（「如果是 API bug → Developer，如果是環境問題 → Helpdesk」），tag input 限制表達力。且 rolePrompt 是 textarea，guardrails 卻是 tag，UI 不一致。

### Decision
`expertise`、`guardrails.redirectRules`、`guardrails.refuseTopics` 全部改為 `string`（textarea），跟 rolePrompt 風格一致。`buildSystemPrompt` 直接注入文字，不再 `map(e => \`- ${e}\`)`。

### Consequences
- Positive: 可寫複雜條件、AI 好編輯、UI 一致
- Negative: 需要人工維護格式（但 placeholder 有範例）

### Alternatives
- 保留 tag input → 限制表達力
- 用 JSON schema → 過度結構化，一般人難編輯

---

## ADR-005: 自建 paaw-agent-loop 取代外部 CLI agent

**Date:** 2026-07-09 (approx)
**Status:** Accepted

### Context
原本依賴外部 CLI agent（如 tagent），但整合困難、debug 不便、且無法完全控制 tool-calling 行為。

### Decision
自建 `paaw-agent-loop.mjs` — system prompt 組裝 → LLM API 呼叫 → tool 執行 → 結果回饋的循環。完全在 server 端跑，不需外部 process。

### Consequences
- Positive: 完全控制、debug 容易、串流支援
- Negative: 需自行維護 tool-calling 邏輯

### Alternatives
- 繼續用外部 CLI → 整合痛苦
- 用 LangChain → 太重，引入大量依賴

---

## ADR-006: Thinking Bubble 歷史保留

**Date:** 2026-07-10
**Status:** Accepted

### Context
AI 回應時先顯示 thinking bubble，最終回答回來後直接替換，思考過程丟失。用戶希望能回顧 AI 的推理過程。

### Decision
在最終回答替換 thinking bubble 前，將思考內容存入 `_thinkingHistory[]`。前端可展開查看歷史思考。

### Consequences
- Positive: 保留推理鏈，供後續提煉知識
- Negative: 訊息物件變大（但 thinking 通常不長）
