# About PAAW — 總覽參考（林雨晴專用）

> 📖 本檔是 PAAW 的最新參考文件（2026-10-02 版）。回答 PAAW 與 Coding App 的問題時**以此檔為準**；`paaw-intro.md` 是故事版行銷介紹、`coding-app.md` 是流程細節，若與本檔矛盾以本檔為準。
> 存取其他文件：`file_list({ workspace: "knowledge" })` → `file_read({ workspace: "knowledge", path: "檔名" })`。

---

## 1. PAAW 是什麼

**PAAW = Personal AI Assistant Workspace — Build your personal AI workforce.**

一句話核心價值：
> 人用 AI 自己做工具 → AI 幫你記資料 → AI 放大你記的資料 → 形成能力飛輪

- 不是一次性對話工具，是**個人的 AI 工作力平台**
- 你打造的每個工具、記下的每筆知識，都讓 AI 更懂你、更能幫你
- 誰用：軟體工程師、技術主管、獨立開發者、知識工作者

## 2. 主要功能模組

| 模組 | 用途 |
|------|------|
| **Chat（AI Crew）** | 聊天視窗直接用所有工具；多個 AI 角色各司其職 |
| **Coding App** | AI 軟體開發團隊（見 §3，重點模組） |
| **App Builder** | 「做一個 XX app」→ 自動產出 app + UI + Skill |
| **Skill Builder** | 最小能力單元：Purpose / Inputs / Deterministic Script / Guardrails / Output Contract / Validation |
| **Workflow Builder** | 工作流編排，多步驟自動化 |
| **Knowledge / Files** | 知識庫（本目錄），AI 可讀可搜 |
| **Memory** | 跨對話記憶管理 |
| **Execution Center** | CronJob 排程、監控、夜間自主工作 |
| **Browser** | 內建瀏覽器（agent 可操作、截圖、視覺驗證） |

### Capability Platform 三層（App Builder 的設計核心）

```
使用者說「我要做一個 XX app」
  ↓ App Builder 產出 app.json + SKILL.md + app.html
自動註冊為 Chat Tool（不用寫 integration code）
  ↓
雙入口：聊天視窗說一句話 / 點開 App 視窗都能用
  ↓
App 產生的資料 = AI 的記憶 → 產生洞見 → 飛輪
```

## 3. Coding App — AI 輔助軟體工廠（重點）

**定位：** 人類提需求與決策，AI 團隊規劃、寫碼、測試、審查、寫文件 — 全流程自動化。
**North Star：** Release Unit AI Control Plane — AI 生產、deterministic 證明、human 決策。
**鐵律：** No answer without evidence — LLM 只推理，事實靠程式。

### 3.1 AI 開發團隊（2026-10 現況，共 10 位 + 主助理）

| Agent | 本名 | 職責 | 不做什麼 |
|-------|------|------|---------|
| 🎖️ EM 大總管 | 陳哲宇 Ethan | 派工、開單、追蹤、結案；白天聽人的、晚上自主指揮 | 不寫碼、不推 git |
| 🏛️ 首席工程師 | 林曉薇 Xiaowei | 架構、技術決策 (ADR)、風險評估 | 不寫實作碼 |
| 💻 Developer | 普里亞·夏爾馬 Priya | 寫碼、修 bug、refactor | 不 push、不做架構決策 |
| 🧪 Tester | 迪維雅·雷迪 Divya | UT / E2E 測試、把寫好的程式鞏固起來 | 發現 bug 不自己修 |
| 🔬 QA | 武大安 Da'an | Code Review、看 git diff 證據、品質把關 | 不寫碼 |
| 📝 Doc Writer | 梅根·布魯克斯 Megan | README / API docs / changelog | 不寫碼 |
| 🌸 Helpdesk | 小春 Hayashi | 技術支援、排查 | 不寫碼 |
| 🛠️ Ops | 格蕾塔·穆勒 Greta | 運維、troubleshooting | — |
| 🚢 Release Manager | 彼得·諾瓦克 Piotr | Release 流程、打包 (pack) | — |
| 🤝 Handover | 蘇菲亞·科瓦爾斯卡 Zofia | 交接文件、狀態保存 | — |

主助理 **林雨晴 Rainy Lin**（my.assistant）不屬於 coding 團隊 — 負責日常對話與 PAAW 操作諮詢（就是回答本檔問題的角色）。

### 3.2 開發流程與驗收雙門檻（2026-10-01 起）

```
開單（人 or EM）→ EM 派工
  → Developer 寫碼 → git commit（絕不 push）
  → 門檻一：QA 看碼（自動附 git diff 證據，不是聽 developer 自述）
  → 門檻二：Tester 鞏固（跑既有測試 → 補 UT 邊界 → E2E 全綠）
  → 兩關都過才能 complete
  → 人在 Git tab review → 人自己 push
```

- **Agent 永遠不 git push** — commit 為止，push 是人的決策權
- Bug 迴圈：QA 發現 → 開 bug 單（帶證據）→ 重派 → 回歸驗
- **保險絲：同一單打回 3 次 → EM 停手升級人類**（帶完整證據鏈）
- 同類 bug 第二次 → 自動開「治本」單（refactor + 回歸測試）

### 3.3 EM 工頭三柱（2026-10-01 上線）

1. **單 = 檔案 = 狀態機** — 每張單落在 `.paaw/tasks/`，有進度日誌；EM 挺久也不會失憶，掛掉重跑可恢復
2. **開單紀律 + QA 看碼** — 沒單不派工；QA 驗收看 git diff 程式證據
3. **四條工作入口**（deterministic job types，自然語言說得出就觸發得到）：
   - `cu-scan` — 掃專案知識缺口，開補洞單
   - `security-fix` — 安全掃描 findings 開修復單
   - `test-gen` — 覆蓋率缺口開測試單
   - `release-prep` — Release 前檢查清單開單

**Auto Dispatch 夜間自主工作：** 排程（每晚 22:30）或自然語言觸發 — Fleming 下班後 EM 接手指揮，同制度換指揮官。白天人指揮 agent，晚上 EM 取代人指揮。

### 3.4 Browser 工具（agent 的眼睛和手）

Coding agents 有 7 個 browser tools：`navigate / read / screenshot / click / type / select / test`
- 瀏覽器綁定 release unit（開自己 RU 的頁面，不開 PAAW 自己的 UI）
- **截圖自動進 agent 視覺** — 有 vision model（glm-4.6v）配置時，截圖直接變成 agent 看得見的圖 → 自己做視覺驗證
- IDE 有 Browser tab，人看得到 agent 的操作截圖與重播

### 3.5 專案知識庫 `.paaw/`

每個專案自動生成，AI 團隊共享大腦：
- `PROJECT.md` / `CODING-STANDARDS.md` / `DECISIONS.md`（ADR）/ `CHANGELOG.md`
- `features/` — Feature-File Mapping（改碼前先查哪個功能涉及哪些檔案）
- `tasks/` / `issues/` — 單與問題追蹤
- `coding-memory/qa-results.jsonl` — 全員共見的測試/QA 記錄

## 4. 常見問題（FAQ）

**Q：怎麼開始一個新功能？**
打開 Coding App，跟 EM（陳哲宇）說需求即可；或用 balanced mode：plan → 人 confirm → execute。複雜需求 EM 會先請架構師出方案。

**Q：為什麼 agent 寫完碼不 push？**
紀律：agent 只 commit，人在 Git tab review 後自己 push。push = 發佈決策權，留給人。

**Q：測試結果在哪看？**
QA/Tester 每次驗收都記進 `.paaw/coding-memory/qa-results.jsonl`（verdict + 問題 + 截圖證據），Coding App 任務卡與 QA 記錄都看得到。

**Q：EM 晚上自己會做什麼？**
Auto Dispatch 排程（22:30 起跑四入口工作）：掃專案缺口、修安全問題、補測試、release 準備 — 有單可循、bug 三次打回會停手找人。

**Q：agent 會不會亂改東西？**
有 guardrails：feature boundary（改哪個功能只碰哪些檔案）、QA 看實際 git diff、變更都要交代理由。破壞性操作一律升級人類。

**Q：PAAW 跑在哪個 port？（Mac mini 預設）**
PAAW dashboard 4097、PAAW Gateway 運維台 4290、Agent Orchestrator 4100。開發模式 UI 是 5173。

**Q：技術棧？**
前端 React + Vite；後端 Node.js (ESM) monorepo（ui / server / shared / db / context / engine）；AI multi-provider（GLM 5.1 主力 + DeepSeek / OpenRouter fallback）；資料 SQLite + JSON 檔案。

---

_更新：2026-10-02（EM 三柱、驗收雙門檻、browser 視覺驗證已收錄）。架構細節問了不確定時，請老實說不知道並建議 Fleming 問 EM 或架構師。_
