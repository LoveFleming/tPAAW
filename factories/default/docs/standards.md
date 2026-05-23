# 標準

> **Production standards that every engineer and AI employee must follow.**
> 這裡定義工程師與 AI 員工都必須遵守的生產標準。

---

## 1. Standard Overview

AI Software Factory 的標準不是文件形式的建議，而是實際生產過程中必須遵守的工程規範。

所有 API、Node、Orchestrator、Runbook、Test 與 PR，都必須依照標準產出、檢查與交付。

標準的目的不是增加流程負擔，而是讓軟體交付變得：

- 可重複
- 可檢查
- 可追蹤
- 可治理
- 可由 AI 協助產出
- 可由 deterministic gates 驗證

---

## 2. API Spec Standard

> **Every API must start from a clear specification.**
> 每一支 API 都必須先有清楚的規格。

API Spec 是 API 生產線的入口，定義 API 的業務目的、輸入輸出、流程邊界與錯誤行為。

每一份 API Spec 至少必須包含：

- API Name
- Endpoint
- HTTP Method
- Business Purpose
- Request Contract
- Response Contract
- Business Rules
- Error Handling
- Related Orchestrator
- Related Nodes
- Test Scenarios
- Runbook Reference

### 原則

- No Spec, No Code
- API 名稱必須具備業務語意
- Request / Response 必須明確定義
- API 行為必須可以被測試驗證
- API Spec 必須能支援 AI 產生程式碼、測試與文件

---

## 3. Node Contract Standard

> **Every Node must have a strong input/output contract.**
> 每一個 Node 都必須有明確的輸入與輸出契約。

Node 是 AI Software Factory 中最重要的業務邏輯單位。每個 Node 必須封裝一個清楚、可理解、可測試的業務能力。

每一份 Node Contract 至少必須包含：

- Node Name
- Business Intent
- Input Contract
- Output Contract
- Process Rules
- Validation Rules
- Error Codes
- External Dependencies
- Mock Data
- Unit Test Cases

### 原則

- Node 名稱必須表達業務目的
- Node 不應只是技術 function 包裝
- Node Output 應該具備業務語意
- Node 必須可單獨測試
- Node 必須避免過大或過度細碎
- Node Contract 是 AI 開發 Node 的主要依據

---

## 4. Error Code Standard

> **Errors must be diagnosable, searchable, and actionable.**
> 錯誤必須能被診斷、搜尋與行動化。

Error Code 不是單純給程式看的代碼，而是給工程師、值班人員、Runbook、Dashboard 與 AI Medic 使用的診斷語言。

每一個 Error Code 必須能回答：

- 是哪一類錯誤？
- 發生在哪一層？
- 屬於哪個能力族群？
- 具體原因是什麼？
- 應該由誰處理？
- Runbook 是否可以對應？

### 建議命名格式

```text
{CODE_CLASS}_{AREA}_{FAMILY}_{DETAIL}
```

### Example

```text
BIZ_NODE_LOT_TOOL_MATCH_LOT_TOOL_MISMATCH
EXT_NODE_MES_QUERY_TIMEOUT
SYS_ORCH_STEP_RESULT_MISSING
SYS_FW_BOOT_CONFIG_MISSING
```

### 原則

- Error Code 必須穩定
- 不可自由命名
- 不可把底層錯誤包成模糊錯誤
- Node 丟出的錯誤，上層應盡量保留原始 Error Code
- Error Code 必須能支援 Runbook、Dashboard 與事件分析

---

## 5. Orchestrator Spec Standard

> **Orchestrator defines the business flow, not hidden code logic.**
> Orchestrator 定義業務流程，不應把重要邏輯藏在程式裡。

Orchestrator Spec 是 API 流程的主設計圖。它描述一條 API 生產線如何組合多個 Nodes，完成一個完整的業務目的。

每一份 Orchestrator Spec 至少必須包含：

- Orchestrator Name
- Business Intent
- Trigger API
- Flow Steps
- Node Execution Order
- Decision Points
- Branch Rules
- Retry Rules
- Fallback Rules
- Compensation Rules
- Error Mapping
- Observability Fields
- Test Scenarios
- Runbook Reference

### 原則

- Orchestrator 應保持乾淨、可讀
- 複雜業務判斷應適當下放到 Node
- Orchestrator 負責流程協調，不負責塞滿細節邏輯
- 每個 Step 必須清楚說明輸入、輸出與失敗處理
- Orchestrator Spec 必須能讓 AI 與工程師共同理解流程

---

## 6. Runbook Standard

> **Every API must be operable after deployment.**
> 每一支 API 上線後都必須能被維運。

Runbook 是 API 進入正式生產環境後的操作指南。沒有 Runbook 的 API，不應被視為完整交付。

每一份 Runbook 至少必須包含：

- API / Orchestrator Name
- Common Error Codes
- Failure Symptoms
- Possible Causes
- Investigation Steps
- Log Search Keywords
- Dashboard Links
- Recovery Actions
- Escalation Rules
- Owner Information

### 原則

- Runbook 必須對應 Error Code
- Runbook 必須讓值班人員能快速定位問題
- Runbook 不應只是文字說明，而要能支援實際查案
- Runbook 應該隨著事件回饋持續改善
- AI Medic 可以依據 Runbook 協助診斷與建議處理方式

---

## 7. Test Standard

> **Code is not complete until it is tested.**
> 沒有測試的程式不算完成。

Test Standard 定義 API、Node 與 Orchestrator 必須通過哪些測試，才能進入下一個交付階段。

測試至少應包含：

- Unit Test
- Node Contract Test
- Orchestrator Flow Test
- API Contract Test
- Error Handling Test
- Regression Test
- E2E Test
- Mock Data Test

### 原則

- 每個 Node 必須有 Unit Test
- 每個 API 必須有 API Contract Test
- 每個 Orchestrator 必須有 Flow Test
- 重要錯誤場景必須被測試
- Mock Data 必須與 Contract 對齊
- 測試結果必須能被 PR Gate 使用

---

## 8. PR Gate Standard

> **AI can help, but gates decide.**
> AI 可以協助，但是否通過由 Gate 決定。

PR Gate 是 AI Software Factory 的品質關卡。不論程式是人寫的，還是 AI 產生的，都必須通過相同標準。

PR Gate 至少應檢查：

- Spec 是否存在
- API Contract 是否完整
- Node Contract 是否完整
- Error Code 是否符合規範
- Unit Test 是否通過
- Contract Test 是否通過
- E2E Test 是否通過
- Lint 是否通過
- Sonar / Code Quality 是否通過
- Runbook 是否存在
- Observability Fields 是否完整

### 原則

- PR Gate 是品質底線
- AI 產出不能跳過 Gate
- 人工 Review 不能取代 deterministic gate
- Gate 失敗必須回到 Spec 或 Code 修正
- Gate 結果必須可追蹤、可稽核

---

## 9. Engineer and AI Employee Rules

工程師與 AI 員工都必須遵守相同的生產標準。

### 工程師必須做到

- 先確認 Spec，再開始實作
- Review AI 產出的程式碼與測試
- 確認業務語意正確
- 確認 Runbook 可以實際使用
- 確認 PR Gate 全部通過

### AI 員工必須做到

- 根據 Spec 產出程式碼
- 根據 Contract 產生 DTO / Schema
- 根據 Error Code Standard 產生錯誤處理
- 根據 Test Standard 產生測試
- 根據 Runbook Standard 產生操作文件
- 不可自行創造未定義的規格與命名

---

## 10. Final Principle

> **Standard makes quality repeatable.**
> 標準讓品質可以被重複生產。

AI Software Factory 的標準不是限制創意，而是建立一條穩定、安全、可持續改善的生產線。

當 Spec、Contract、Test、Runbook 與 PR Gate 都被標準化後，工程師可以更專注在業務價值，AI 員工也能在明確邊界內穩定產出。

最終目標是讓軟體交付從一次性的手工打造，變成可治理、可累積、可放大的工程生產系統。
