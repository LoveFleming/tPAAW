# PAAW + Coding App 功能總覽

> 📖 產生：2026-10-24 ｜ 依據：tPAAW dev 實際 code 盤點（App.tsx 側邊欄、CodingIDE 工具列、domain-agent-registry）
> 與 `about-paaw.md` 的關係：about-paaw.md 是總覽參考（以此為準），本檔是**功能逐項清單版**，方便查「某功能在哪、做什麼」。

---

## 一、PAAW 主體功能（Personal AI Assistant Workspace）

### 💬 聊天助理（主聊天視窗）
- **聊天 + AI 團隊對話** — 跟助理或任何 AI 員工對話；AI 可呼叫所有已安裝的 App 當工具
- **技能呼叫（Skills）** — 聊天中自動匹配觸發技能（如「幫我翻譯」→ 翻譯技能），一致性高的 CLI 式執行
- **模型選擇器** — 每次對話可切換 LLM（zai GLM / OpenRouter 等）
- **檔案上傳 / 掛載知識對話** — 聊天可直接引用知識庫檔案

### 📚 知識庫（Knowledge）
- **知識樹（KnowledgeTree）** — 檔案/資料夾瀏覽、右鍵管理、AI 摘要單檔或整個資料夾
- **Briefing Player** — 把知識庫資料夾變成簡報式播放（AI 朗讀/導讀）
- **檔案掛載（Workspaces）** — 把本機任意目錄掛進 PAAW（如專案、文件庫），AI 可讀取

### 🏗 Build（建造）
- **Skill Builder 技能建構器** — 用固定格式（Purpose/Inputs/Deterministic Script/Guardrails/Output Contract）打造最小能力單元；Skill = AI 可執行的標準作業程序
- **App Builder 應用建構器** — 描述需求 → AI 自動生成 app（app.json + SKILL.md + app.html），自動註冊為聊天工具，不用寫整合程式碼

### ▶ 執行（Execution）
- **應用程式池（App Pool）** — 所有建好的 App 一覽，點開即用；App 資料回流給 AI 產生洞見
- **Coding（AI 軟體工廠）** — 見下方第二大節
- **心智圖（Mind Map）** — 從筆記/知識生成心智圖
- **筆記（Notes）** — Markdown 筆記
- **專案看板（Projects）** — 專案管理看板
- **Schedules（CronJob）** — 排程任務：定時執行技能/工作，附執行歷史與監控

### 🧠 Management（管理）
- **Skills / Skill Pool** — 技能總覽、啟用停用、匯入匯出
- **AI 設定（System Prompts / Agents）** — 管理助理人設、AI 員工定義、每個 agent 的模型與 fallback

### 📊 Reports（報表）
- **LLM 日誌** — 每次 LLM 呼叫的完整紀錄（prompt/response/tokens）
- **Agent 執行記錄** — agent 工具呼叫軌跡、成功失敗
- **執行報表（Usage Report）** — 用量統計（token/成本/次數）
- **Skill 使用報表** — 哪些技能被用、用多少
- **安全審計紀錄（Security Audit）** — path-guard 擋截、黑名單寫入等安全事件

### 🔌 其他
- **外掛（Plugins）** — 熱插拔外掛模組（如 browser、通訊軟體 tool provider）
- **求助台（Helpdesk）** — 問題排查入口

---

## 二、Coding App 功能（AI 輔助軟體工廠 · Release Unit AI Control Plane）

> 入口：側邊欄「Coding」。核心概念：**AI 生產 → deterministic 證明 → human 決策 → Workspace 持有**

### 🎖️ EM 大總管（EM Dashboard）
- 專案 landing page：現況總覽、任務規劃、一鍵派工給團隊
- **Auto Dispatch 自動派工** — EM 分析專案現況 → 自動開 task → 派給對的 agent（可排夜間批次）
- **Code Understanding** — 掃描理解 codebase，建立專案心智模型

### 📦 Release Unit（RU）管理
- 專案以 RU 為單位管理（Import Project / Clone / Onboarding）
- RU 有自己的 crews、skills、task pipeline、release 流程
- Files Explorer — RU 檔案總管（瀏覽/編輯/搜尋）

### 📐 Engineering（工程）
- **Code Intel** — 代碼智慧中心（架構理解、依賴分析）
- **Decisions（決策日誌）** — ADR 技術決策記錄
- **Features（Feature Map）** — 功能 ↔ 檔案映射圖，Context Boundary 的基礎
- **Project README** — 專案文件中樞（自動生成的專案全貌）

### 👷 Production（生產）
- **AI Crew** — 團隊成員對話（每位員工獨立 chat + 工具呼叫）
- **Git** — commit / diff / 分支操作（AI 改動一目了然）
- **Issues** — 問題追蹤
- **Tasks** — 任務看板（spec → implement → commit pipeline；bootstrap 專案走短版）
- **Terminal** — 受控終端機（shell-guard 沙箱：只能動本 RU 的 process）

### 🔍 Quality（品質）
- **API Tester** — API 測試（234 個 endpoint payload 自動測）
- **Browser · QA** — 內建瀏覽器自動化測試
- **QA Records** — 品質驗證紀錄（Q&A 式驗收）
- **Security** — 安全掃描（semgrep 規則 + 結果面板）
- **Tests** — 測試套件執行與覆蓋率

### 📦 Delivery（交付）
- **Handover** — 交接簡報：讓新工程師/新 agent 快速接手 RU
- **Release Manager** — 上線管理：審證據不審碼，風險評估，批准/退回
- **Review Board** — 人類審查 code review（決策卡：expected/unexpected changes）
- **Troubleshooting** — 線上問題診斷面板

### 🛡️ 安全與護欄（底層）
- **Path Guard** — 寫入路徑黑白名單（PAAW 自我保護 + cwd 邊界；2026-10-24 修復 monorepo 誤擋）
- **Shell Guard** — agent 只能重啟本 RU dev server，禁 pkill/killall
- **Audit Log** — 每個工具呼叫完整落 log（Elasticsearch/Kibana 報表可選）
- **三 Boundary 設計**（進行中）— Context / Change / Review Boundary，限制 AI 活動範圍而非能力

---

## 三、AI 員工列表

### 🏭 Coding App 軟體工廠團隊

| 員工 | crew ID | 職責 |
|---|---|---|
| 🎖️ 陳哲宇 EM 大總管 | `coding.em` | 工作規劃、團隊調度、品質把關、夜間自動調度 |
| 🏛️ 林曉薇 架構師 | `coding.architect` | 分析架構、制定技術決策（ADR）、規劃模組邊界 |
| 💻 普里亞·夏爾馬 Developer | `coding.developer` | 實作功能、修 bug、refactor、全端開發 |
| 🧪 迪維雅·雷迪 Tester | `coding.tester` | 撰寫測試、執行測試套件、回報覆蓋率 |
| 📝 梅根·布魯克斯 Doc Writer | `coding.doc-writer` | README、API docs、changelog、架構文件 |
| 🔬 武大安 QA | `coding.qa` | Code review、覆蓋率分析、規格驗證、品質閘門 |
| 🔧 維運值班工程師 Ops | `coding.ops` | Runbook 維護、線上診斷、修復指引 |
| 🤝 交接導覽員 Handover | `coding.handover` | 產出交接簡報，讓新人/新 agent 快速接手 |
| 🚦 Release Manager | `coding.rm` | 審證據不審碼，評估上線風險，批准/退回 |
| 🎓 小春 林 Helpdesk | `coding.helpdesk` | 技術支援、排查問題、操作指引（側邊欄隱藏）|

### 💬 主聊天助理
- **PAAW 助理** — 聊天視窗的預設助理，可呼叫所有 App 工具與技能，人設可在 AI 設定調整

---

## 附註
- coding 員工支援 per-agent 模型設定（emModel / nightShiftModel / autoDispatchModel），EM 可指派便宜模型跑簡單任務
