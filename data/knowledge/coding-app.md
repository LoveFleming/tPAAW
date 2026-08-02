# Coding App — AI 輔助軟體工廠

> **把軟體開發流程變成一條 AI 驅動的生產線**

---

## 一句話

人類提需求，AI 團隊做規規劃、寫規劃、寫碼、測試、審查、寫文件 — 全流程自動化，人只做決策和驗收。

---

## 為什麼需要 Coding App？

軟體開發的瓶頸從來不是打字速度，而是：
- **不知道要寫什麼** — 需求不明確
- **不知道改了什麼** — 變更沒追蹤
- **不知道品質如何** — 沒測試沒 review
- **不知道誰在做什么** — 協作混亂

Coding App 把這些問題全部交給 AI 團隊處理。人類只需要：
1. 說出你要什麼
2. 驗收成果

---

## AI 開發團隊

Coding App 內建 7 個 AI Agent，各有專長、各有護欄，像真正的軟體團隊一樣分工協作：

| Agent | 代號 | 專長 | 護欄 |
|-------|------|------|------|
| 🎖️ **EM 大總管** | 陳哲宇 Ethan | 技術管理、工作規劃、派工追蹤、品質把關 | 不寫碼、不做架構決策、不 push |
| 🏛️ **架構師** | 林曉薇 Xiaowei | 系統架構、技術決策 (ADR)、風險評估、模組邊界 | 不寫實作碼、不寫測試、不做日常 debug |
| 💻 **Developer** | 普里亞 Priya | 寫程式、修 bug、refactor、功能實作 | 不做架構決策、不寫正式測試、不寫文件 |
| 🧪 **Tester** | Divya | 單元/整合/E2E 測試、覆蓋率分析 | 不做架構決策、不寫實作碼 |
| 📝 **Doc Writer** | Megan | README、API docs、changelog | 不寫碼、不做架構決策 |
| 🔬 **QA** | 武大安 | Code Review、品質把關、安全掃描 | 不寫碼、不做架構決策 |
| 🌸 **Helpdesk** | 小春 | 技術支援、排查問題 | 不寫碼、不做架構決策 |

### 派工流程

```
人類說「我要加一個登入功能」
  ↓
EM 規劃 → 拆分任務
  ↓
1️⃣ 架構師 → 設計登入架構 + ADR
  ↓
2️⃣ Developer → 實作登入 API + UI
  ↓
3️⃣ Tester → 寫登入測試
  ↓
4️⃣ QA → Code Review + 安全掃描
  ↓
5️⃣ Doc Writer → 更新 API 文件
  ↓
EM 統一報告成果
```

### EM 自主執行模式

EM 不只是傳話筒，他能**自主完成整個開發流程**：
- 收到明確目標 → 自己拆分任務 → 逐個派工 → 等結果 → 處理失敗 → 全部完成後統一報告
- 不需要人一步一步盯著
- 只有需求不明確、破壞性操作、需要外部帳密時才會問人

---

## 專案知識庫 — `.paaw/`

每個專案自動生成 `.paaw/` 目錄，是 AI 團隊的共享大腦：

```
.paaw/
├── PROJECT.md           # 專案概述（AI 自動生成）
├── CODING-STANDARDS.md  # 編碼規範
├── DECISIONS.md         # 技術決策記錄 (ADR)
├── CHANGELOG.md         # 變更日誌
├── features/            # Feature-File Mapping（功能→檔案對照）
├── standards/           # 標準文件
├── issues/              # 問題追蹤
├── tasks/               # 任務管理
├── agent-memory/        # 各 Agent 的長期記憶
├── auto-dispatch/         # 夜間巡邏報告
└── conversations/       # Agent 對話歷史
```

### Feature-File Mapping

改碼前先查 mapping — 哪個功能涉及哪些檔案、哪個檔案屬於哪個功能。不憑感覺猜檔案位置，先查再動手。

### Code Understanding

AI 自動掃描專案，產出結構化的專案知識：
- 模組依賴圖
- API 清單（含 schema 完整度）
- 資料模型
- 技術債清單
- 健康缺口檢測

---

## Task & Issue 管理

### Issue — 問題記錄
記錄 bug、需求、安全問題，分類追蹤：
- 📋 requirement — 新功能需求
- 🐛 bug — 錯誤修復
- 🔒 security — 安全問題
- 🔧 chore — 雜務

### Task — 可執行任務
從 Issue 拆分出具體的、可派工的 Task：
- 大任務先拆分（`task_decompose`），每個子任務 effort ≤ M
- 逐個派工給最適合的 agent
- 等結果 → 確認成功 → 再派下一個
- 子任務全完成 → 關閉父任務

---

## 夜間巡邏 — Auto Dispatch

**睡覺時 AI 也在工作。**

Auto Dispatch 是自動化的夜間開發流程：

| 模式 | 說明 |
|------|------|
| **EM 模式** | EM 自動分析現況、規劃工作、派工執行，像白天的自主模式一樣 |
| **Parallel 模式** | 多個 agent 同時處理不同任務，加速產出 |

### Auto Dispatch 做什麼？
- 掃描未 push 的 commit
- 修安全問題
- 補測試
- 補文件
- Code review
- 產出報告存到 `.paaw/auto-dispatch/reports/YYYY-MM-DD.md`

### 安全機制
- 可隨時中斷（interrupt）
- 卡住可強制 reset
- 所有變更都 commit，不 push（push 只由人執行）

---

## 安全掃描 — Semgrep

內建 Semgrep 安全掃描，自動檢測：
- XSS、SQL injection、eval() 等常見漏洞
- 硬編碼密碼/金鑰
- 不安全的 HTTP/TLS 設定
- 過時的 crypto（MD5/SHA1）
- 同步 I/O 在 request handler

掃描結果自動轉為 Issue，追蹤修復進度。

---

## AI 產出物

Coding App 的 AI 不只寫碼，還能自動產出完整的專案知識：

| 產出物 | 說明 | Prompt |
|--------|------|--------|
| **Project Overview** | 專案概述 | `scan-project.md` |
| **Architecture Map** | 架構圖 | `gen-architecture.md` |
| **Feature Map** | 功能→檔案對照 | `gen-feature-map.md` |
| **Coding Standards** | 編碼規範 | `gen-standards.md` |
| **API Spec** | API 規格書 | `gen-api-spec.md` |
| **Error Mapping** | 錯誤碼對照 | `gen-error-mapping.md` |
| **Test Payload** | 測試資料 | `gen-test-payload.md` |
| **Decisions** | 技術決策 (ADR) | `gen-decisions.md` |
| **Code Review** | 程式碼審查 | `code-review.md` |
| **FAQ** | 常見問題 | `gen-faq.md` |

---

## 健康檢查 — Health Check

一鍵檢查 Coding App 各子系統狀態：
- Provider 設定是否正確
- Feature map 覆蓋率
- 未解決的 Issue
- Auto Dispatch 狀態（偵測卡住的 run）
- 安全掃描新鮮度
- LLM 活動
- Coding standards 是否存在

---

## Commit 紀律

- ✅ Agent 完成工作後**必須 commit**，不留 uncommitted change
- ❌ **絕對不允許 push** — push 只由人類執行
- ✅ 新增 commit，不要 amend/reset

---

## 核心原則

1. **人做決策，AI 做執行** — 人類提需求和驗收，AI 負責中間所有步驟
2. **先理解再動手** — 改碼前先查 Feature-File Mapping，不憑感覺猜
3. **大任務先拆分** — 不一次丟一大坨工作給 agent，逐個派工逐個驗收
4. **知識持續累積** — `.paaw/` 是 AI 團隊的共享記憶，越用越聰明
5. **安全第一** — 安全掃描、護欄、commit 紀律，多層保障
6. **睡覺也在進步** — Auto Dispatch 讓專案 24 小時在改善
