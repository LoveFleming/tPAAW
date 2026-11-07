# PAAW Coding App — 功能定稿 v1（2026-09-05）

> **Status: FEATURE FREEZE。** 本文件是目前的完整功能盤點 — 測試以本文件為準。
> 測試路線：**RU 建立 → CU → 開發 → 測試 → 維運**，用各種程式語言的 repo 實測。

---

## 0️⃣ Release Unit（RU）— 一切的單位

| # | 功能 | 入口 | 說明 |
|---|------|------|------|
| 0.1 | RU 註冊/管理 | Coding IDE 左側 | `data/config/release-units.json`；一個 RU = 一個 repo/服務 |
| 0.2 | 🌐 Git Clone 建 RU | DirExplorer → 🌐 | URL/路徑白名單、重複 409、失敗自動清理 |
| 0.3 | 🎉 Onboarding Wizard | clone 完自動跳 | 掃描（語言/框架 chips）→ Skill 建議 → CU 一鍵跑；`cuDone>0 && newCount===0` 自動靜默 |
| 0.4 | `.paaw/` 資料夾 | 每個 RU 內 | CU 產物 + crew 副本 + skills 副本；**刪掉重跑 = 重建**（registry 在 PAAW 端，RU 不會丟） |

---

## 1️⃣ CU（Code Understanding）— 6 步

**入口：** Coding IDE → Code Understanding；或 onboarding 自動跑；單步可重跑。
**產物：** `{ru}/.paaw/*.json`

| # | 步驟 | 產物 | 內容 |
|---|------|------|------|
| 1.1 | 📡 Scan | project-scan.json | 語言/框架/檔案樹/規模 |
| 1.2 | 🗺️ Feature Map v2 | features/FEATURES.json | **骨架數學決定論：進入點(route/UI/API) → reach closure → Jaccard 聚類（同 repo 重跑必同輸出）**；長肉 = **每個 feature 一個獨立 agent loop**（cu-feature agent，core-read 工具組，多輪 read_file 實際讀 code — 不是一次送全部 features 給 LLM）；斷點續跑（parts/ 逐個落檔，重跑只補缺）；agent 失敗兩次 → 決定論降級命名（標 degraded，整步不失敗）；orphans 程式歸不了 → LLM 分組標 `grade:"utility"`（非決定論，人定案）；meta 檔記 shared 層/enrichment 統計（loops/turns/tokens） |
| 1.3 | 🧠 Code Intelligence | code-intel.json | 呼叫圖/依賴/架構筆記 |
| 1.4 | 🧪 Test Intelligence | test-intel.json | 測試覆蓋地圖 |
| 1.5 | 🔢 Error Codes | error-codes.json | **v2：機器收訊號（throw/raise/panic/HTTP 4xx-5xx/Error 類…跨語言）→ LLM 語意整理 by feature**；判讀 conventions（none/systematic/mixed）；無慣例 → 建議導入 Rules v1；每筆帶 file:line 證據 |
| 1.6 | 🏛️ C4 Model | c4-model.json | **對外連線全景**：機器收證據（manifests 分類 db/cache/queue/cloud/api-client、env KEY 名、compose、EXPOSE、URI scheme+host）→ LLM 組 C4 L1/L2；repo compose 內=container、只有 env/依賴=external system |

**規則：**
- 1.5/1.6 走「機器收證據 + LLM 組裝」；GET 讀檔**不燒 token**（缺檔回 `missing:true`），重整理才花 token
- 安全：env 只抓 KEY 名、URI 剝 userinfo — credentials 不入 json
- prompt 可 per-RU 覆寫：`{ru}/.paaw/prompts/code-understanding/<step>.md`

### CU 附屬面板
- **Code Intel 頁 5 tabs**：Call Graph / Deps / Impact / Health / **🏛 Architecture（C4）**
- **Feature Map**：feature 樹 + docs + 🔢 error codes by feature + 📋 建議 banner
- **project_info tool**（agent 用）：features / runbook / faq / **error_codes（search=錯誤碼/訊息片段反查 feature+file:line — debug 入口）** / **c4_model（search=redis 等，查對外連線）**

---

## 2️⃣ Skill & Crew — RU 的資產

| # | 功能 | 入口 | 說明 |
|---|------|------|------|
| 2.1 | Skill Instance Model | CrewManager → 📚 | skills 是 RU 資產（`{ru}/.paaw/skills/`，sidecar `_paaw.json`）；狀態 synced/behind/customized/orphan/broken；單一路徑不 fallback |
| 2.2 | Skill 建議 | Onboarding / 🧩 | 機器掃語言/框架 → 建議各 agent 綁哪些 skill（LLM 只標註，人決定） |
| 2.3 | Crew 管理 | CrewManager | EM/developer/reviewer/RM/helpdesk/ops prompt 副本；**prompt 更新不自動套用既有副本 — 刪 `.paaw` 重建才拿新版** |
| 2.4 | Per-agent Model | CrewEditor | 每個 agent 可指定 model（簡單任務便宜 model、寫碼強 model） |

---

## 3️⃣ 開發（Auto Dispatch → Agent 寫碼 → 人 Review）

| # | 功能 | 入口 | 說明 |
|---|------|------|------|
| 3.1 | Auto Dispatch 單軌 | `.paaw/auto-dispatch/config.json` `schedule.enabled` | 一個開關；夜間佇列 = task 內容（無 phase/gate 矩陣） |
| 3.2 | Task Pipeline | Task 面板 | bootstrap 階段短版（spec→implement→commit done 即 resolved）；mvp+ 全版七階段；task 自帶 `pipelinePhases`/`pipelineMode` |
| 3.3 | EM 派工（自決編制 v2） | 自動 | **RU task 一律走 EM 決策迴圈**：每輪一次結構化 LLM 決策（dispatch/complete/escalate）— 開幾個 agent loop、派誰、順序、打回重派由 EM 看 task 與成果自己決定（spec 是建議非硬性）；每個 dispatch = 一個完整 agent loop（多輪 + tool call，順序執行）；EM 一次順序完成多個 tasks；決策 LLM 連續失敗 2 次 → deterministic chain 保底；token tracking 累計（決策 + agent 全算） |
| 3.4 | Git 規則 | agent 寫碼時 | agent 只 `stage` + staged_summary；**commit 永遠是人類** |
| 3.5 | 人 Review | Staged Changes | UI review → approve（commit）/reject |
| 3.6 | Plan 結案 | Plan 面板 | `markPlanCompleted`；`autoExecute:false` 不入 plan |

---

## 4️⃣ 測試 & 品質

| # | 功能 | 入口 | 說明 |
|---|------|------|------|
| 4.1 | Code Health | 🔧 | 掃描 → agent 修復 →（重掃） |
| 4.2 | Semgrep Security | 掃描時 | **TS/Go/Java/Python**（golang pack 78 rules 官方 sparse-clone） |
| 4.3 | API Tester | API 面板 | endpoint payload 實測 |
| 4.4 | Doc Coverage | 📄 | 文檔覆蓋檢查 |
| 4.5 | Build gate | — | UI `vite build` ✓；`tsc -b` 有 pre-existing type errors（tech debt，非新功能造成） |

---

## 5️⃣ 維運 & 交接

| # | 功能 | 入口 | 說明 |
|---|------|------|------|
| 5.1 | Release Manager | RM panel | release unit 模型、pipelineMode-aware、empty-state 已修（initialized 不只看 TASKS.json） |
| 5.2 | Handover | 🤝 | 交接狀態 |
| 5.3 | Ops | ⚙️ | 維運面板 |
| 5.4 | Debug 反查 | helpdesk rule 7 | 收到錯誤碼/訊息 → 先 `project_info(error_codes, search=...)` 反查，沒 hit 才 grep |
| 5.5 | 對外連線查詢 | c4_model | ops/handover 問「這 RU 連哪些 DB/服務」直接答 |
| 5.6 | Evidence / Decision Log | 📎 | 決策與證據卡 |
| 5.7 | Cost | RuCostSection | token/成本歸集 |

---

## 🧪 多語言測試矩陣（建議）

| 功能 | TS/JS | Python | Go | Java |
|------|:---:|:---:|:---:|:---:|
| CU scan / feature-map | ✅ | ✅ | ✅ | ✅ |
| Error codes 訊號收集 | throw/HTTP/Error 類 | raise/Exception | panic/errors.New/fmt.Errorf | Exception |
| C4 manifests | package.json(+workspace) | requirements/pyproject | go.mod | pom/gradle |
| C4 URI/env/compose | ✅ | ✅ | ✅ | ✅ |
| Semgrep | ✅ | ✅ | ✅（78 rules，無 hardcoded-credentials rule） | ✅ |
| Skill 建議（語言/框架掃描） | ✅ | ✅ | ✅ | ✅ |

**測試建議：** 每種語言挑一個 OSS repo clone 進來 → 跑完整 CU 6 步 → 開一個小 task 走 Auto Dispatch → staged review → commit → Code Health + Semgrep → RM release。Beta 候選：spring-petclinic（Java）、golang/example（Go）、psf/requests（Python）。

---

## ⛔ 定稿範圍外（未實作 — 測不到是正常的）

- Feature Guardrail 三 boundary（Context/Change/Review）+ Deterministic Code Map — 設計文件有、程式沒有
- Release Unit AI Control Plane R2-R6（現況 = R1 部分）
- error codes「建議導入」的自動套用（只有建議，人類決定）
- `packages/ui` `tsc -b` 清 0（pre-existing 51 errors）

---

*Baseline: dev@374cb7cc + feature-map v2（2026-09-05 晚，Fleming 授權的凍結例外）。本文件由 Stewart 維護，功能凍結至測試回合結束。*
