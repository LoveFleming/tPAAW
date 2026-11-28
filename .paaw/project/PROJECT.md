# paaw

> 📄 Product Spec · 上次更新 2026-11-27 17:30 · 人+AI 共寫

<!-- SPEC:START — Product Spec（人+AI 共寫區） -->
## 📄 Product Spec

## 1. Product Overview — 產品定位、目標、範圍、使用情境

- **定位**：PAAW（Personal AI Assistant Workspace）— 打造個人 AI Workforce 的工作區平台。
- **目標**：（資料待補 — 待人確認）
- **範圍內**（依事實資料之功能清單）：
  - A2A 協定互動：Agent Card 探索、JSON-RPC 任務入口、任務列表/中斷
  - Agent 治理：Agent 設定讀寫、記憶 CRUD、任務日誌、日誌清理
  - LLM 設定：LLM Providers 列表/更新、AI 設定總覽、使用者偏好讀寫
  - Workspace 與 API 工具：Workspaces 管理、Request 集合、API 代理、請求歷史、SSE 串流代理
  - Crew 協作：Crew 對話/派工、EM 規劃/執行、派工型錄、執行中 Agents、中斷 Crew Agent、Crew 匯入/匯出、QA 結果讀寫、Context 用量估算、審查委員會
  - RU（Release Unit）管理：RU 資訊讀寫、AI 調整 RU 資訊、RU 除錯/操作日誌、RU 彙總、DFO 文件/版本、C4 模型讀取/重掃、Coding DB 狀態
  - App 生命週期：建立 App、訓練報告 App、發布報告、發布證據、匯入 App、App 規則
  - 助理設定：技能綁定、頭像、使用者設定檔、Providers（assistant）、寫檔、系統提示
  - 安全：安全模式讀寫、網路白名單
  - 備份：備份設定讀寫、執行/列出/還原/刪除備份
  - 瀏覽器自動化：環境狀態、導航、截圖、畫面串流、分頁、下載、對話框、鍵盤滑鼠、視覺模式、剪貼簿等
  - 聊天與自動派工：聊天 Context/CRUD/訊息、自動派工設定/提示詞/啟動停止/預覽/執行紀錄/報告串流
  - 排程與執行：Cron 任務管理、Agent Run（同步/SSE）
  - 稽核：稽核日誌日期列表與查詢
  - UI 狀態：讀/全量寫/部分更新
- **範圍外**：（資料待補 — 待人確認）
- **使用情境**：（資料待補 — 待人確認）

## 2. Functional Requirements — 功能需求、業務規則、Acceptance Criteria

> 事實資料僅含功能名稱（desc 皆為空、codeFiles/apis 為 0），以下需求描述與驗收條件為最小推論框架，細節均為（資料待補 — 待人確認）。

#### FR-01 — A2A Agent 探索與任務（A20261121-004~008）

**Requirement**

系統支援 A2A 協定：探索 Agent Card、經 JSON-RPC 任務入口派發任務、列出與中斷 A2A 任務、取得 Agent Card（API 路徑）。

**Acceptance Criteria**

- 可取得遠端 Agent 之 Agent Card（資料待補 — 待人確認）
- A2A 任務可建立、列表、中斷（資料待補 — 待人確認）

#### FR-02 — Agent 設定與記憶（A20261121-013/014/117~119）

**Requirement**

支援讀取/更新 Agent 設定，以及 Agent 記憶的讀、寫、刪。

**Acceptance Criteria**

- Agent 設定讀取與更新成功回傳（資料待補 — 待人確認）
- 記憶 CRUD 操作可執行（資料待補 — 待人確認）

#### FR-03 — LLM Providers 與 AI 設定（A20261121-015/016/019、017/018）

**Requirement**

支援列出/更新 LLM Providers、AI 設定總覽、使用者偏好讀寫。

**Acceptance Criteria**

- Providers 列表與更新、AI 設定總覽、偏好讀寫皆可執行（資料待補 — 待人確認）

#### FR-04 — Workspace 與 API 代理（A20261121-020~024）

**Requirement**

支援列出 Workspaces、管理 Request 集合、API 代理請求、儲存請求歷史、SSE 代理串流；另含 Workspace 新增/刪除（046/047）與 assistant 版列表（045）。

**Acceptance Criteria**

- API 代理可轉發請求並回傳結果；SSE 串流可串接（資料待補 — 待人確認）
- 請求歷史可儲存（資料待補 — 待人確認）

#### FR-05 — 日誌與稽核（A20261121-009~012、106/107、053/054）

**Requirement**

支援 RU 除錯日誌、Agent 任務日誌列表、RU 彙總、舊 Agent 日誌清理、RU 操作日誌與詳情、稽核日誌日期列表與查詢。

**Acceptance Criteria**

- 日誌可查詢、彙總、清理（資料待補 — 待人確認）

#### FR-06 — Crew 協作與派工（A20261121-101~121、085~098）

**Requirement**

支援 Crew 對話/派工、EM 規劃/執行/任務執行、派工型錄、QA 結果讀寫、Context 用量估算、執行中 Agents、中斷 Crew Agent、Crew 匯入/匯出、審查委員會；以及自動派工設定、提示詞讀寫/重設、啟動/停止/重設、預覽計畫、執行紀錄與報告串流。

**Acceptance Criteria**

- Crew 派工可執行並產生執行紀錄（資料待補 — 待人確認）
- 自動派工可啟動/停止，報告可串流接收（資料待補 — 待人確認）

#### FR-07 — RU/DFO/C4/發布（A20261121-123~128、099/100、025~027、122）

**Requirement**

支援 RU 資訊讀寫與 AI 調整、Coding DB 狀態、DFO 文件讀取與版本清單、C4 模型讀取/重掃、建立 App、訓練報告 App、發布報告、讀發布證據。

**Acceptance Criteria**

- RU 資訊可讀寫並由 AI 調整（資料待補 — 待人確認）
- 發布流程可產出報告與證據（資料待補 — 待人確認）

#### FR-08 — 助理/使用者設定（A20261121-028~036、043/044、049~051）

**Requirement**

支援助理技能綁定列表/更新、Data Home 根目錄、使用者設定檔讀寫、頭像上傳/取得、App 規則讀寫、版本取得、Providers（assistant）列表/更新、知識庫路徑列表、UI 狀態讀/全量寫/部分更新。

**Acceptance Criteria**

- 各設定項讀寫正常（資料待補 — 待人確認）

#### FR-09 — 安全模式與網路白名單（A20261121-039~042）

**Requirement**

支援讀取/切換安全模式、讀取/更新網路白名單。

**Acceptance Criteria**

- 安全模式切換生效；白名單更新後生效（資料待補 — 待人確認）

#### FR-10 — 備份（A20261121-055~060）

**Requirement**

支援備份設定讀寫、執行備份、列出備份、還原備份、刪除備份。

**Acceptance Criteria**

- 備份可建立、還原、刪除（資料待補 — 待人確認）

#### FR-11 — 瀏覽器自動化（A20261121-061~076）

**Requirement**

支援瀏覽器環境狀態、視窗調整、導航、截圖/即時截圖/截圖檔、畫面串流、分頁列表/操作、下載清單、對話框處理、操作紀錄、剪貼簿讀取、鍵盤/滑鼠輸入、視覺模式操作、瀏覽器狀態。

**Acceptance Criteria**

- 各瀏覽器操作可執行並回傳結果（資料待補 — 待人確認）

#### FR-12 — 聊天（A20261121-077~084）

**Requirement**

支援建立聊天 Context、聊天列表/單一取得/建立/更新/刪除、發送訊息、系統提示列表。

**Acceptance Criteria**

- 聊天 CRUD 與訊息發送可執行（資料待補 — 待人確認）

#### FR-13 — 排程與 Agent Run（A20261121-001~003）

**Requirement**

支援 Cron 任務管理、Agent Run 同步執行與 SSE 串流執行。

**Acceptance Criteria**

- Cron 可排程觸發 Agent Run（資料待補 — 待人確認）
- SSE 串流輸出可持續接收（資料待補 — 待人確認）

#### FR-14 — 技能管理（A20261121-115/116）

**Requirement**

支援 CU 步驟技能管理與列專案技能。

**Acceptance Criteria**

- 技能可列出與管理（資料待補 — 待人確認）

## 3. Non-Functional Requirements — Performance、Availability、Security、Scalability

#### NFR-01 — Performance

**Requirement**

（資料待補 — 待人確認；僅知支援 SSE 串流，隱含串流延遲需求，但無量化數據）

**Acceptance Criteria**

- （資料待補 — 待人確認）

#### NFR-02 — Availability

**Requirement**

（資料待補 — 待人確認）

**Acceptance Criteria**

- （資料待補 — 待人確認）

#### NFR-03 — Security

**Requirement**

具備安全模式（讀/切換）與網路白名單（讀/更新）機制；餘（資料待補 — 待人確認）。

**Acceptance Criteria**

- 安全模式與網路白名單設定可生效（資料待補 — 待人確認）

#### NFR-04 — Scalability

**Requirement**

（資料待補 — 待人確認）

**Acceptance Criteria**

- （資料待補 — 待人確認）

## 4. API & Data Contract — API、Request/Response、Error Code、Schema

| Endpoint | Method | 用途 |
|---|---|---|
| （資料待補 — 待人確認） | — | 事實資料僅記載 features 共 100+ 項、errorCodes 53 個，未提供路徑 |

#### API-01 —（資料待補 — 待人確認）

- 用途：（資料待補 — 待人確認；對應功能清單見第 2 節）
- Request：（資料待補 — 待人確認）
- Response：（資料待補 — 待人確認）
- Error Codes：系統共有 53 個錯誤碼，具體代碼與意義（資料待補 — 待人確認）

**補充事實**：程式中存在 A2A JSON-RPC 任務入口（JSON-RPC 協定）與 SSE 串流端點，實際契約（資料待補 — 待人確認）。

## 5. Architecture Design — Components、Sequence、Integration、Data Flow

- **Components**：

| Component | 職責 |
|---|---|
| @paaw/ui | 前端 UI workspace（有 build 與 typecheck script）（細節資料待補 — 待人確認） |
| @paaw/server | 後端 server（有 start script）（細節資料待補 — 待人確認） |
| scripts/prod-server.mjs | 生產環境啟動腳本（職責資料待補 — 待人確認） |

- **Sequence**：

（資料待補 — 待人確認；僅知存在「Crew 派工 → EM 規劃 → EM 執行 → QA 結果」與「SSE 串流」等流程名稱，無實際互動細節）

- **Integrations**：

| From | To | Protocol/Format |
|---|---|---|
| @paaw/server | 遠端 A2A Agent | JSON-RPC（A2A） |
| @paaw/ui / client | LLM Providers | API 代理（含 SSE 串流） |
| @paaw/server | 瀏覽器環境 | 瀏覽器自動化操作（協定資料待補 — 待人確認） |

- **Data Flow**：（資料待補 — 待人確認；已知存在請求歷史儲存、稽核日誌、三層日誌架構（ADR-023）等資料流名稱）

## 6. Technical Design — Modules、Interface、核心邏輯、技術選型

- **技術選型**：

| 項目 | 選擇 |
|---|---|
| 語言/型別 | TypeScript（typecheck script 存在） |
| 套件管理/monorepo | npm workspaces（`-w @paaw/ui`、`-w @paaw/server`） |
| 測試框架 | Vitest |
| 開發並行工具 | concurrently |
| UI framework | （資料待補 — 待人確認；frameworks 為空） |
| Server framework | （資料待補 — 待人確認） |

- **Modules**：（資料待補 — 待人確認；僅知 codeIntel：functions 2764、symbols 4826）

- **核心邏輯**：（資料待補 — 待人確認）

- **關鍵決策**（依 ADR 標題）：

| 主題 | 決定 | 原因 |
|---|---|---|
| 日誌架構（ADR-023） | 日誌三層架構與資產級保留政策 | （資料待補 — 待人確認） |
| TASK-049 測試策略（ADR-022） | 範本檔以「靜態契約掃描 + 最小可執行語意重現」雙層鞏固 | （資料待補 — 待人確認） |
| TASK-055 測試範圍（ADR-024） | route-level 整合測試 Secretary.tsx 背後的 4 個 server routes | （資料待補 — 待人確認） |

## 7. Testing Strategy — Unit、Integration、E2E、Failure Scenarios

測試目標：以自動化測試（現有 115 個測試檔：unit 104、e2e 11、integration 0、contract 0，框架 Vitest）保障功能正確性；整合與契約測試目前為 0，屬缺口。

| ID | 類型 | 情境 | 預期結果 |
|---|---|---|---|
| T-01 | Unit | （資料待補 — 待人確認，現有 104 個 unit 測試檔） | 全數通過 |
| T-02 | Integration | Secretary.tsx 背後 4 個 server routes（ADR-024） | route-level 整合測試通過 |
| T-03 | Integration | 範本檔靜態契約掃描 + 語意重現（ADR-022） | 契約掃描與重現皆通過 |
| T-04 | E2E | （資料待補 — 待人確認，現有 11 個 e2e 測試檔） | 全數通過 |
| T-05 | Failure | 中斷 A2A 任務 / 中斷 Crew Agent | 任務正確终止並回報狀態（資料待補 — 待人確認） |
| T-06 | Failure | SSE 串流中斷 | （資料待補 — 待人確認） |
| T-07 | Load | （資料待補 — 待人確認） | （資料待補 — 待人確認） |

## 8. Operations & Observability — Metrics、Logging、Tracing、Deployment、Alerting

- **Metrics**：

| Metric | 用途 |
|---|---|
| （資料待補 — 待人確認） | — |

- **Logging**：
  - 依 ADR-023 採「日誌三層架構與資產級保留政策」（細節資料待補 — 待人確認）
  - 稽核日誌可依日期列表與查詢
  - 含 RU 除錯日誌、Agent 任務日誌、RU 操作日誌
  - 不記什麼：（資料待補 — 待人確認）

- **Tracing**：暫不（資料待補 — 待人確認）

- **Deployment**：
  - 開發：`npm run dev`（concurrently 同時啟 UI 與 API）；可分開 `dev:ui` / `dev:server`
  - 建置：`npm run build`（僅 build UI workspace）
  - 生產啟動：`npm run start`（server）或 `npm run start:prod`（node scripts/prod-server.mjs）
  - 其他部署細節（資料待補 — 待人確認）

- **Alerting**：

| Alert | 觸發條件 |
|---|---|
| （資料待補 — 待人確認） | — |

<!-- SPEC:END -->
