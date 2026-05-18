# 快速導覽

給第一次進入 AI Software Factory 的人看的。

這份快速導覽的目的，不只是介紹功能，而是讓人快速理解：

> 這不是讓 AI 自由寫程式。  
> 這是一條以 Spec 為核心、以 Gate 控制品質、由人做最後決策的 API 生產線。

---

## 1. AI Software Factory 是什麼？

AI Software Factory 是一套 **Spec-Driven、Gate-Controlled** 的軟體生產線。

它不是單純讓 AI 幫忙寫程式，而是把軟體交付拆成一條可重複、可檢查、可治理的流程：

```text
Spec → Contract → Code → Test → Lint → Runtime Validation → Review → Release
````

在這條生產線裡：

* Spec 是 Single Source of Truth
* AI 根據 Spec 產生程式碼、測試、文件與 Runbook
* Controller / Service / Orchestrator / Node 有清楚邊界
* Node 有明確的 Input / Output Contract
* Gate 負責檢查品質
* Human Reviewer 負責最後判斷與放行

AI 在這裡不是自由創作者，而是受規格與工程規範約束的生產助理。

---

## 2. 為什麼我們需要 AI Software Factory？

我們真正要解決的問題，不只是「寫程式速度不夠快」，而是：

* 需求不夠清楚
* 規格沒有被落實
* 程式邊界不清楚
* 測試不足
* Sanity check 不確實
* 上線前才發現問題
* 出事後難以追蹤原因
* 文件、測試、Runbook 與程式碼不同步

傳統開發常常依賴工程師的經驗與記憶。
但當系統變大、團隊變多、舊程式越來越複雜時，光靠人小心是不夠的。

AI Software Factory 的目標是：

> 把品質要求變成工程制度，
> 把交付流程變成可檢查的生產線，
> 把 AI 的速度放進受控的框架裡。

---

## 3. 為什麼可以信任 AI 產生的程式？

我們不是要求大家相信 AI。

我們要相信的是：

> 一條有 Spec、有程式邊界、有 Contract、有 100% unit test、有 regression test、有 Sonar、有 lint、有 fail-fast 的生產線。

AI 只是加速填標準零件，品質由 Spec、Contract、Test、Lint、Quality Gate 和 Human Review 來守。

更重要的是：

> Spec 不是只放在文件裡，Spec 會進入 runtime。

如果程式碼改了，但 Spec 沒改；
或是 Code 與 Contract 對不起來；
系統會在啟動或執行前段 fail first / fail fast。

這代表錯誤不會悄悄進入 production。

AI 的產出必須受到以下控制：

* 根據 Spec 產生程式碼
* 遵守 Controller / Service / Orchestrator / Node 邊界
* 遵守 Node Input / Output Contract
* 遵守 Error Code 規則
* 產生對應 Unit Test
* 通過 Context Regression Test
* 通過 Sonar 品質檢查
* 通過 Lint 檢查
* 通過 Runtime Contract Validation
* 經過 PR Review 與 Human Approval

所以這不是：

```text
AI 寫完就上線
```

而是：

```text
AI 產出 → Gate 檢查 → 人審核 → 才能放行
```

---

## 4. Spec 如何變成 Code？

AI Software Factory 的核心流程是：

```text
Business Requirement
        ↓
Spec
        ↓
API Contract / Node Contract / Orchestrator Spec
        ↓
Generated Code
        ↓
Generated Test
        ↓
Generated Runbook
        ↓
Quality Gates
        ↓
Human Review
        ↓
Release
```

Spec 不是一般文件，而是工程生產的起點。

一份好的 Spec 需要說清楚：

* API 要解決什麼業務問題
* Input 是什麼
* Output 是什麼
* Orchestrator 流程是什麼
* 每個 Node 的責任是什麼
* 每個 Node 的 Input / Output Contract 是什麼
* Business Rule 是什麼
* Error Code 是什麼
* 測試情境是什麼
* Runbook 要如何處理異常

AI 根據這些 Spec 產生：

* Controller
* Service
* Orchestrator
* Node
* DTO
* Unit Test
* Regression Test
* Error Mapping
* Runbook Draft
* Observability Fields

也就是說，AI 不是憑空寫程式。
AI 是根據規格，在標準框架裡產生可檢查的工程產物。

---

## 5. Gate 如何保護品質？

Gate 是 AI Software Factory 的品質門禁。

Gate 不是提醒，也不是建議。
Gate 是：

> 不通過，就不能往下走。

主要 Gate 包含：

### Spec Gate

檢查 Spec 是否清楚、完整、可實作。

包含：

* API 目的是否明確
* Input / Output 是否定義清楚
* Node 責任是否清楚
* Orchestrator 流程是否合理
* Error Code 是否符合規則
* 測試情境是否足夠
* Runbook 是否有對應處理方式

---

### Contract Gate

檢查 Code 與 Contract 是否一致。

包含：

* Request DTO 是否符合 API Contract
* Response DTO 是否符合 API Contract
* Node Input 是否符合 Node Contract
* Node Output 是否符合 Node Contract
* Required field 是否完整
* Type 是否正確
* Enum 是否符合規範

---

### Runtime Validation Gate

Spec 會進入 runtime，成為執行期的約束。

如果程式與 Spec / Contract 不一致，系統要能 fail first / fail fast。

這代表：

* 啟動時可以檢查 Spec 是否存在
* 啟動時可以檢查 Contract 是否一致
* 執行時可以檢查 Node Input / Output 是否符合規格
* 不符合規格就快速失敗，不讓問題往後擴散

---

### Test Gate

測試不是補充品，而是放行條件。

包含：

* Unit Test
* Context Regression Test
* API Test
* Node Test
* Orchestrator Flow Test

目標是：

> 每次修改都能確認新功能正確，舊行為沒有被破壞。

---

### Quality Gate

用工具檢查程式品質。

包含：

* Sonar no code smell
* Lint
* Coverage
* Duplicate code check
* Naming convention check
* Error code rule check
* Forbidden dependency check

---

### PR Gate

所有修改都要進入 PR 流程。

PR 不只看 code，也要看：

* Spec 是否同步修改
* Test 是否同步補上
* Runbook 是否同步更新
* Gate report 是否通過
* AI review 是否有提出風險
* Human reviewer 是否同意放行

---

## 6. Human Reviewer 最後決定什麼？

AI Software Factory 不代表人不重要。

相反地，人的角色會更重要，只是工作重心會改變。

以前人常常花很多時間在：

* 寫 boilerplate code
* 補重複的 test
* 查 coding standard
* 補文件
* 補 Runbook
* 做低價值的人工比對

未來人的角色會往兩邊移動。

---

### 方向一：往上游，把 Spec 搞清楚

這是最重要的工作。

因為：

> Spec 錯，Code 一定錯。

人要負責釐清：

* 真正的 business intent 是什麼
* 使用者情境是什麼
* 哪些是 business rule
* 哪些是 exception case
* 哪些是可接受的 fallback
* 哪些情況必須 abort
* 哪些情況需要人工 approval
* 哪些行為要納入 regression test

這類角色可以稱為：

```text
Spec Engineer
Business Spec Owner
API Designer
Orchestrator Designer
```

他們的重點不是寫更多 code，
而是讓 AI 有正確、清楚、可檢查的規格可以執行。

---

### 方向二：往下游，成為工廠檢查員

另一種人的角色，是成為 AI Software Factory 的品質檢查員。

他們不需要逐行手寫所有程式，
而是看：

* Spec 是否合理
* AI 產出的 code 是否符合標準
* Gate report 是否通過
* Test coverage 是否足夠
* Regression result 是否安全
* Sonar / Lint 是否乾淨
* Error handling 是否完整
* Runbook 是否可用
* PR diff 是否超出範圍
* 風險是否可以接受

這類角色可以稱為：

```text
Factory Inspector
AI Output Reviewer
Quality Gate Reviewer
Release Reviewer
```

人的價值會從「自己下去做所有苦工」，
轉成「定義正確方向，檢查風險，做最後決策」。

---

## 7. 如何開始一條 API 生產線？

開始一條 API 生產線，不是直接叫 AI 寫 code。

正確流程是：

```text
1. 定義 API Business Intent
2. 撰寫 API Spec
3. 定義 API Contract
4. 拆解 Orchestrator Flow
5. 定義 Node Responsibility
6. 定義 Node Input / Output Contract
7. 定義 Error Code
8. 定義 Test Case
9. 定義 Runbook
10. 讓 AI 產生程式碼與測試
11. 執行 Gate
12. Human Review
13. Merge / Release
```

第一版不需要一次做到完美。
重點是先讓每一支 API 都走同一條標準路徑。

每完成一支 API，工廠就會累積：

* 一份 Spec
* 一組 Contract
* 一組 Node
* 一組 Test
* 一份 Runbook
* 一份 Gate Report
* 一次可回溯的工程紀錄

長期來看，這些不是單一 API 的產物，
而是整座 AI Software Factory 的工程資產。

---

## 核心訊息

我們不是要求大家相信 AI。

我們是要求大家相信一條有：

* Spec
* Code Boundary
* Contract
* Runtime Validation
* Unit Test
* Regression Test
* Sonar
* Lint
* Quality Gate
* Human Approval

的受控生產線。

AI 負責加速。
Spec 負責約束。
Gate 負責放行。
人負責最後決策。

---

## 最重要的一句話

> AI Software Factory 不是讓 AI 自由寫程式，
> 而是讓 AI 在 Spec、Contract、Runtime Validation、Test、Lint、Quality Gate 和 Human Approval 的約束下，生產可檢查、可回歸、可治理的軟體。

