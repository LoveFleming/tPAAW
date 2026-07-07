# PAAW Coding App 改善計劃

> **Version:** 1.0.0
> **Date:** 2026-07-07
> **Author:** Fleming + AI
> **Vision:** AI 是軟體的原始作者 + 長期維護者，人只審查

---

## 核心思想

> **AI Initial → Code Status 大盤 → 每區 AI 負責 → 大總管 AI 協調**

一個專案進來，AI 不是看 code，而是像一個新員工第一天上班：
1. 先讀 spec、runbook、decisions（員工手冊）
2. 發現缺什麼就補什麼（AI Initial）
3. 補完後出一份「專案體檢報告」（Code Status 大盤）
4. 每個區域都有專責 AI 可以深入（分區經理）
5. 大總管 AI 協調所有分區 AI（CEO）

---

## Phase 0：AI Initial — 專案知識自動補全

### 目標
當 AI 第一次接手一個專案（或使用者點「AI Initialize」），自動掃描專案、找出知識缺口、補齊。

### 流程

```
使用者點「AI Initialize」或開啟新專案
  ↓
AI 掃描專案結構（file tree、git log、package.json、README）
  ↓
檢查 .paaw/ 知識缺口：
  ├── Spec（API Contract、Node Contract、Error Mapping）❓ → 補
  ├── Runbook（每個 Error Code 的 SOP）❓ → 補
  ├── API Test Payload（每個 API 的 request/response 範例）❓ → 補
  ├── Standards（coding style、naming convention）❓ → 補
  ├── Decisions（為什麼這樣做）❓ → 補
  └── Changelog（什麼改過）❓ → 補
  ↓
AI 產出補全內容 → 存入 .paaw/
  ↓
觸發 Code Status Dashboard 刷新
```

### 具體補全項目

| 類別 | 掃描什麼 | 補什麼 | 存哪 |
|---|---|---|---|
| **API Spec** | `routes/`、`api/`、`server.ts` | API Contract（method、path、request schema、response schema、error codes） | `.paaw/specs/api-contract.md` |
| **Error Mapping** | code 中的 `throw`、`AppException`、`error code` | Error Code Table（code → type → runbook） | `.paaw/specs/error-codes.md` |
| **Runbook** | Error Mapping | 每個 error 的處理 SOP | `.paaw/runbook/` |
| **API Test Payload** | API Spec + routes | 每個 API 的 request body 範例 + 預期 response | `.paaw/test-payloads/` |
| **Standards** | code patterns、lint config | Coding style、naming、folder structure | `.paaw/standards/coding-style.md` |
| **Decisions** | git log + code comments | 架構決策紀錄 | `.paaw/decisions/` |
| **Overview** | 全部 | PROJECT.md（專案一句話、架構、依賴、入口） | `.paaw/PROJECT.md` |

### Prompt 管理

每一類補全任務都有對應的 prompt template：

```
data/prompts/
├── ai-initial/
│   ├── scan-project.md        ← 掃描專案結構
│   ├── gen-api-spec.md        ← 產出 API Spec
│   ├── gen-error-mapping.md   ← 產出 Error Mapping
│   ├── gen-runbook.md         ← 產出 Runbook
│   ├── gen-test-payload.md    ← 產出 API Test Payload
│   ├── gen-standards.md       ← 產出 Coding Standards
│   ├── gen-decisions.md       ← 產出 Decision Log
│   └── gen-overview.md        ← 產出 PROJECT.md
```

**管理規則：**
- 每個 prompt 有**預設版本**（內建）
- 使用者可以在 UI 裡**自訂覆蓋**（存 `.paaw/prompts/`）
- 自訂 > 預設
- UI 裡可以看到所有 prompt、預覽、修改、恢復預設

### AI 客服答案（HelpDesk Knowledge Base）

AI Initial 同時也產出**客服預設答案**：

```
常見問題 → AI 產出標準回答
├── 「這個專案做什麼？」→ PROJECT.md 的摘要
├── 「API 怎麼用？」→ API Spec 的摘要
├── 「Error 404 怎麼處理？」→ Runbook 的對應段落
├── 「怎麼新增一個 Node？」→ Standards 的步驟
└── 「上次改了什麼？」→ Changelog 的最近記錄
```

存入 `.paaw/helpdesk/faq.md` 或 Knowledge Base，HelpDesk AI 可以直接引用。

### UI 變動

- 頂部欄新增 **「🚀 AI Initialize」** 按鈕（有專案時才顯示）
- 點擊後顯示進度面板：
  ```
  🔍 掃描專案結構... ✓
  📝 產出 API Spec... ✓ (3 APIs)
  🐛 產出 Error Mapping... ✓ (12 error codes)
  📖 產出 Runbook... ✓ (8 runbooks)
  🧪 產出 API Test Payload... ⏳ (2/3)
  📏 產出 Coding Standards... pending
  🏗️ 產出 Decision Log... pending
  📊 產出 PROJECT.md... pending
  🤖 產出 HelpDesk FAQ... pending
  ```
- 完成後自動跳轉到 Code Status Dashboard

---

## Phase 1：Code Status Dashboard — 專案體檢大盤

### 目標
AI Initial 完成後，使用者看到的是一個「專案健康度大盤」，而不是一堆 code。

### 大盤佈局

```
┌─────────────────────────────────────────────────────────┐
│  🏥 Code Status Dashboard                               │
├──────────┬──────────┬──────────┬──────────┬──────────────┤
│ 📋 Spec  │ 🧪 Test  │ 🐛 Bug  │ 📖 Docs  │ 🔧 Maintain │
│  85/100  │  72/100  │  91/100 │  60/100  │   78/100    │
├──────────┴──────────┴──────────┴──────────┴──────────────┤
│                                                          │
│  📋 Spec Score: 85                                       │
│  ├── ✅ API Contract: 3/3 APIs documented                │
│  ├── ✅ Error Mapping: 12/12 error codes defined         │
│  ├── ⚠️ Node Contract: 2/3 nodes have input/output      │
│  └── ❌ Flow Spec: Missing                              │
│                                                          │
│  🧪 Test Score: 72                                       │
│  ├── ✅ API Test Payload: 3/3 APIs have test data        │
│  ├── ⚠️ Unit Test: 45% coverage                          │
│  └── ❌ E2E Test: Not configured                         │
│                                                          │
│  🐛 Bug / Error Score: 91                                │
│  ├── ✅ Runbook: 8/8 error codes have runbooks           │
│  ├── ✅ Error Handling: All paths covered                 │
│  └── ⚠️ Known Issues: 2 unresolved                      │
│                                                          │
│  📖 Docs Score: 60                                       │
│  ├── ✅ PROJECT.md: Exists                               │
│  ├── ⚠️ README: Outdated (3 months)                      │
│  └── ❌ HelpDesk FAQ: Missing                            │
│                                                          │
│  🔧 Maintainability: 78                                  │
│  ├── ✅ Standards: Coding style defined                   │
│  ├── ✅ Decisions: 5 ADRs recorded                       │
│  ├── ⚠️ Changelog: Last entry 2 weeks ago                │
│  └── ❌ Dependency Audit: Not done                        │
│                                                          │
├──────────────────────────────────────────────────────────┤
│  🤖 Quick Actions                                        │
│  [🔧 Fix Spec Gaps] [🧪 Add Tests] [📖 Update Docs]    │
│  [🐛 Check Runbooks] [📊 Full AI Review]                 │
└──────────────────────────────────────────────────────────┘
```

### 評分邏輯

每個大類別的評分由 AI 根據 `.paaw/` 內容計算：

| 類別 | 滿分條件 |
|---|---|
| **Spec** | API Contract 完整 + Node Contract 完整 + Error Mapping 完整 + Flow Spec 存在 |
| **Test** | API Test Payload 完整 + Unit Test coverage ≥ 80% + E2E configured |
| **Bug/Error** | Runbook 完整 + Error handling 覆蓋 + No unresolved critical issues |
| **Docs** | PROJECT.md + README updated + HelpDesk FAQ + Changelog recent |
| **Maintainability** | Standards defined + Decisions recorded + Changelog current + Dependencies audited |

### UI 變動

- 右側面板新增 **「🏥 Status」** tab（跟 Chat、Standards、Sessions 同級）
- 點擊各區分數 → 展開詳細項目
- 每個詳細項目旁邊有 **「🤖 Fix」** 按鈕 → 觸發該區的專責 AI

---

## Phase 2：分區 AI — 每個大盤區域有專責 AI

### 目標
Dashboard 每個分區都有專門的 AI，像部門經理一樣負責自己那一塊。

### 分區 AI 清單

| AI 角色 | 負責區域 | 能力 | 用什麼 Prompt |
|---|---|---|---|
| **Spec AI** | Spec Score | 補 API Contract、Node Contract、Error Mapping、Flow Spec | `gen-api-spec.md`、`gen-error-mapping.md` 等 |
| **Test AI** | Test Score | 產 API Test Payload、寫 Unit Test、配置 E2E | `gen-test-payload.md`、`gen-unit-test.md` 等 |
| **Bug AI** | Bug/Error Score | 寫 Runbook、修 error handling、追蹤 known issues | `gen-runbook.md`、`fix-error-handling.md` 等 |
| **Docs AI** | Docs Score | 更新 README、產 HelpDesk FAQ、更新 Changelog | `update-readme.md`、`gen-faq.md` 等 |
| **Maintain AI** | Maintainability | 寫 Standards、記 Decisions、Audit dependencies | `gen-standards.md`、`gen-decisions.md` 等 |

### 互動方式

```
使用者在大盤點「🤖 Fix」(Spec 區)
  ↓
Spec AI 被喚醒
  ↓
讀取 .paaw/specs/ + 掃描 code
  ↓
列出要補的項目：
  「發現 2 個 API 缺少 response schema：
   1. POST /api/users
   2. DELETE /api/users/:id
   要我補嗎？」
  ↓
使用者確認 → Spec AI 補完 → 更新分數
```

### UI 變動

- Dashboard 每個項目旁的「🤖 Fix」→ 打開右側 AI Chat，自動切換到對應的 AI 模式
- AI Chat 的 mode selector 增加分區選項：`Chat | Agent | Spec AI | Test AI | Bug AI | Docs AI | Maintain AI`
- 每個 AI 的 prompt template 可在 Settings 裡管理

---

## Phase 3：大總管 AI — 協調所有分區 AI

### 目標
一個 Orchestrator AI，像 CEO 一樣協調所有部門 AI。

### 大總管職責

```
使用者說：「我要加一個用戶刪除功能」
  ↓
大總管 AI 接收需求
  ↓
拆解任務：
  1. 📋 Spec AI → 寫 API Spec (DELETE /api/users/:id)
  2. 📋 Spec AI → 寫 Error Mapping (USER_NOT_FOUND, DELETE_CONFLICT)
  3. 🐛 Bug AI → 寫 Runbook (DELETE_CONFLICT 的處理 SOP)
  4. 🧪 Test AI → 寫 API Test Payload
  5. 🧪 Test AI → 寫 Unit Test
  6. 📖 Docs AI → 更新 Changelog
  ↓
依序或平行調度分區 AI
  ↓
彙整結果 → 顯示給使用者審查
  ↓
使用者確認 → 各 AI 產出落地到 code 和 .paaw/
```

### 大總管 vs 分區 AI

| | 大總管 AI | 分區 AI |
|---|---|---|
| **角色** | CEO — 拆任務、排優先、協調 | 部門經理 — 執行自己領域 |
| **知道什麼** | 整個專案的狀態 + 所有分區的進度 | 自己領域的 spec + code |
| **能做什麼** | 接需求、拆任務、調度、彙整 | 讀 code、寫 spec、產 test、寫 runbook |
| **何時被喚醒** | 使用者在 Chat 打字提需求 | 大總管分配任務 / 使用者點 Fix |

### UI 變動

- AI Chat mode selector：`Chat | 🏛️ Orchestrator | 📋 Spec | 🧪 Test | 🐛 Bug | 📖 Docs | 🔧 Maintain`
- 選 Orchestrator 時，Chat 變成「需求入口」— 使用者隨便說，大總管拆任務
- 大總管分配任務時，Dashboard 即時更新各區狀態（動畫效果）
- 任務完成後，大總管彙整 Summary 給使用者

---

## Phase 4：Prompt 管理 + 持久化

### 目標
所有 AI 的 prompt 都可管理、可版本控制、可跨專案共享。

### Prompt 管理系統

```
data/prompts/                          ← 全局預設 prompts
├── ai-initial/
│   ├── scan-project.md
│   ├── gen-api-spec.md
│   ├── gen-error-mapping.md
│   ├── gen-runbook.md
│   ├── gen-test-payload.md
│   ├── gen-standards.md
│   └── gen-overview.md
├── spec-ai/
│   ├── analyze-gaps.md
│   ├── gen-api-contract.md
│   └── gen-flow-spec.md
├── test-ai/
│   ├── gen-payload.md
│   ├── gen-unit-test.md
│   └── gen-e2e.md
├── bug-ai/
│   ├── gen-runbook.md
│   └── fix-handling.md
├── docs-ai/
│   ├── update-readme.md
│   ├── gen-faq.md
│   └── update-changelog.md
├── maintain-ai/
│   ├── gen-standards.md
│   ├── gen-decisions.md
│   └── audit-deps.md
└── orchestrator/
    ├── decompose-task.md
    └── summarize.md

.paaw/prompts/                         ← 專案自訂 prompts（覆蓋蓋預設）
├── gen-api-spec.md                    ← 專案自己的版本
└── gen-test-payload.md                ← 專案自己的版本
```

### UI：Prompt 管理器

- Sidebar 新增 **「🎯 Prompts」** 區域
- 列出所有 prompt 類別
- 每個 prompt 可以：預覽、編輯、恢復預設、匯出/匯入
- 標示哪些被專案自訂覆蓋了（黃色標記）

---

## 實施時程

| Phase | 功能 | 預估 | 依賴 |
|---|---|---|---|
| **Phase 0** | AI Initialize + Prompt 管理 + HelpDesk FAQ | 2-3 天 | 無 |
| **Phase 1** | Code Status Dashboard + 評分 | 2-3 天 | Phase 0 |
| **Phase 2** | 分區 AI + 各區 Fix 按鈕 | 3-5 天 | Phase 1 |
| **Phase 3** | 大總管 AI + 任務拆解 | 3-5 天 | Phase 2 |
| **Phase 4** | Prompt 持久化 + 版本控制 + 共享 | 2-3 天 | Phase 0 |

### Phase 0 先做什麼（最小可行版本）

1. **AI Initialize 按鈕 + 掃描邏輯**
2. **3 個核心 prompt：** `scan-project.md`、`gen-api-spec.md`、`gen-test-payload.md`
3. **產出存入 .paaw/：** `specs/`、`test-payloads/`
4. **API Tester 連動：** AI 產出的 test payload 自動出現在 API Tester
5. **Prompt UI：** 基本的列表 + 預覽 + 編輯

---

## 跟現有功能的對應

| 現有功能 | 改善方向 |
|---|---|
| **.paaw/ knowledge** | AI Initial 自動補全，不再靠人手動建 |
| **AI Chat** | 變成多模式：Chat / Orchestrator / 分區 AI |
| **API Tester** | AI 產出 test payload 自動填入 |
| **Git Panel** | AI Review 自動帶 Spec 比對 |
| **Standards Editor** | AI Initial 自動產出 coding standards |
| **Session History** | 大總管 AI 可以讀取歷史 session 理解上下文 |
| **Decision Log** | AI Initial 從 git log 自動萃取 |
| **Project Health** | 升級為 Code Status Dashboard |

---

## 跟 AI Factory 藍圖的對齊

這份計劃直接對齊 `memory/ai-factory-blueprint.md`：

| 藍圖層 | Coding App 對應 |
|---|---|
| **Spec Layer** | AI Initial → .paaw/specs/ |
| **Runtime Layer** | 分區 AI 讀 spec 執行 |
| **AI 員工 Layer** | Spec AI、Test AI、Bug AI、Docs AI、Maintain AI |
| **Quality Gate** | Code Status Dashboard 評分 |
| **Observability** | Dashboard + Changelog + Decision Log |

---

*PAAW Coding App — AI 是專案的原始作者 + 長期維護者*
