# 憲法

> **The Factory Constitution**
> 這裡定義 AI Software Factory 的信念、最高原則，以及不可妥協的工程底線。

AI Software Factory 的目標不是單純加快寫程式速度，而是建立一套可重複、可檢查、可累積、可治理的軟體交付模式。

憲法是工廠的最高原則。它不會因為短期壓力、個人習慣、專案趕工或技術偏好而輕易改變。

---

## 1. Spec is Single Source of Truth

規格是工廠中所有工作的共同依據。

需求、資料契約、流程邏輯、錯誤處理、測試案例、Runbook、程式碼與 AI 協作，都必須回到 Spec。

如果規格不清楚，後面的程式碼、測試與維運都會變成猜測。猜測會造成品質不穩定，也會讓知識留在個人腦中，無法被團隊累積。

在 AI Software Factory 中，Spec 不是文件的附屬品。Spec 是軟體生產線的核心控制點。

---

## 2. No Spec, No Code

沒有規格，就不應該開始寫正式程式碼。

程式碼不應該只靠口頭說明、個人經驗或臨時理解來產生。正式開發前，必須先明確定義：

- 這個功能要解決什麼業務問題
- 輸入資料是什麼
- 輸出資料是什麼
- 處理規則是什麼
- 可能發生哪些錯誤
- 錯誤應該如何回應
- 如何驗證功能是正確的

如果 Spec 還沒有被說清楚，代表問題本身還沒有被真正理解。

AI 可以幫助我們加快開發速度，但 AI 不應該被拿來放大混亂。沒有規格的 AI 產出，只是更快產生更多不可控的程式碼。

---

## 3. Code must be generated or checked from Spec

程式碼必須能夠追溯回規格。

不論程式碼是由工程師撰寫，還是由 AI 協助產生，都必須符合 Spec 的定義。

Spec 應該能夠用來：

- 產生程式碼
- 檢查程式碼
- 產生測試案例
- 檢查資料契約
- 檢查錯誤處理
- 檢查 Runbook
- 檢查 API 行為是否一致

程式碼不是單獨存在的成果。程式碼是 Spec 的實作結果。

如果程式碼與 Spec 不一致，應該先釐清是 Spec 需要修正，還是 Code 需要修正。但兩者不能長期分離。

---

## 4. Every Node must have contract

每一個 Node 都必須有明確的資料契約。

Node 是工廠中的基本生產單位。每個 Node 都應該清楚定義自己的責任邊界，而不是把不明確的邏輯藏在程式碼裡。

每個 Node 至少應該說清楚：

- Node 的業務目的
- Input Contract
- Output Contract
- Process Rules
- Error Handling
- Dependency
- Observability
- Test Cases

好的 Node 應該是可理解、可測試、可重用、可替換的。

如果一個 Node 沒有 Contract，代表它的責任不清楚。責任不清楚的 Node，會讓 Orchestrator 變得難以維護，也會讓 AI 無法穩定協作。

---

## 5. Every API must have test and runbook

每一條 API 生產線都必須具備測試與 Runbook。

API 不只是能夠執行就算完成。它必須能夠被驗證、被監控、被追蹤，並且在異常時能夠被處理。

每個 API 至少應該具備：

- Unit Test
- Contract Test
- Integration Test
- Regression Test
- Error Scenario Test
- Runbook
- Observability Definition
- Troubleshooting Guide

測試用來證明系統目前是正確的。Runbook 用來確保系統出問題時，團隊知道如何處理。

沒有測試的 API，不能證明品質。沒有 Runbook 的 API，不能安全交付給維運。

---

## 6. AI can help, but gates decide

AI 可以協助設計、產生、檢查、重構、補測試、寫文件與整理 Runbook。但 AI 的產出不能直接等於通過。

工廠需要明確的品質閘門。最後是否能進入下一階段，必須由 Gate 決定，而不是由 AI 自己決定。

Gate 可以包含：

- Spec Gate
- Contract Gate
- Code Review Gate
- Test Gate
- Security Gate
- Runbook Gate
- Observability Gate
- Release Gate

AI 是加速器，不是品質保證本身。真正保證品質的是制度、規格、測試、審查與可追蹤的工程流程。

AI Software Factory 的核心不是「讓 AI 自由產生程式碼」。而是讓 AI 在清楚規格與嚴格 Gate 之下，成為可靠的工程協作者。

---

## 工廠宣言

> **We do not build software by guessing.**
> **We build software from Spec, through Gates, with AI as our accelerator.**

我們不靠猜測開發軟體。我們以 Spec 作為源頭，透過 Gate 守住品質，並讓 AI 成為提升速度與品質的工程夥伴。

---

## 不可妥協的原則

1. 規格不清楚，不進入正式開發。
2. 沒有 Contract 的 Node，不應進入生產線。
3. 沒有測試的 API，不應視為完成。
4. 沒有 Runbook 的 API，不應交付維運。
5. AI 產出必須接受 Gate 檢查。
6. Code 必須能追溯回 Spec。
7. 工廠累積的是規格、契約、測試、知識與流程，不只是程式碼。

---

## 最終定位

> **This constitution defines what the factory believes and what the factory will never compromise.**

這份憲法定義 AI Software Factory 的信念與不可妥協的原則。它是所有生產線、AI Crew、Spec、Node、API、測試與 Runbook 的最高依據。
