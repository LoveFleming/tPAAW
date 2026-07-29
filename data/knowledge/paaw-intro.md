# PAAW — Personal AI Assistant Workspace

> **Build your personal AI workforce**

## 一句話

人用 AI 自己做工具 → AI 幫你記資料 → AI 放大你記的資料 → 形成能力飛輪

---

## 為什麼需要 PAAW？

不會寫程式的人，也能用 AI 打造自己的工具，並在聊天視窗或 App 視窗使用。

傳統做法：有需求 → 找工程師 → 等開發 → 等測試 → 等上線
PAAW 做法：有需求 → 跟 AI 說一句話 → 工具自動產生 → 立刻能用

---

## 核心概念

### Skill — 最小能力單元

Skill 是 PAAW 的原子單位。每一個 Skill 封裝一項明確的能力，有固定的結構：

```
Prompt/Instruction → Input Schema → Context/Knowledge
→ Tool Access → Deterministic Script → Guardrails → Output Format
```

所有 App、Workflow、CronJob 最終都是叫用 Skill。Skill + CLI = AI as a Service，不直接 call LLM API，答案一致性高。

### App — 資料驅動的應用

每個新 App 自動產生 Tool，不需要手動寫 integration code。使用者從聊天視窗或 App 視窗都能用。App 產生的資料成為 AI 的記憶，AI 讀取後產生洞見，形成正向循環。

### Capability Platform 三層架構

```
使用者（不會寫程式）
  ↓ 在聊天視窗或 App Builder 說「我要做一個 XX app」
  ↓
App Builder（AI 幫你建 Skill + App）
  ↓ 產出：app.json + SKILL.md + app.html
  ↓
自動註冊為 Chat Tool（AI 可呼叫）
  ↓
使用者從「聊天視窗」或「App 視窗」都能用
  ↓
App 產生的資料 → AI 讀取 → 產生洞見
```

---

## 功能模組

| 模組 | 說明 |
|------|------|
| **Chat Assistant** | 聊天助理，所有 App 在聊天視窗都能用。觸發關鍵字自動匹配路由 |
| **🤖 Coding App** | AI 輔助軟體工廠 — 7 個 AI Agent 組成開發團隊，自主規劃/寫寫碼/測試/審查/文件。詳見 [coding-app.md](coding-app.md) |
| **Skill Builder** | 技能建構器，定義最小能力單元 |
| **App Builder** | 應用建構器，AI 幫你從需求產出完整 App |
| **Workflow Builder** | 工作流建構器，串接多個 Skill 完成複雜流程 |
| **Knowledge / Files** | 知識與檔案管理，AI 的長期記憶 |
| **Memory** | 記憶管理，累積的資料放大成洞見 |
| **Execution Center** | 執行中心 — CronJob、監控、排程 |

---

## 關鍵規則

1. **每個新 App 都自動產生 Tool** — 不需要手動寫 integration code
2. **Skill + CLI = AI as a Service** — 不直接 call LLM API，答案一致性高
3. **雙入口：聊天視窗 + App 視窗** — 說一句話或點開 App 都能用
4. **App 資料 = AI 的記憶** — AI 讀 App 資料產生洞見，形成正向循環
5. **觸發關鍵字自動匹配** — 聊天中說「幫我翻譯」→ 自動路由到 translate_exec
6. **系統提示詞是為不會寫程式的人設計的** — 人只要描述需求，AI 做剩下的

---

## Per-Agent Model Dispatch

不同任務用不同模型，聰明省成本：

| 工作類型 | Model | 原因 |
|---------|-------|------|
| 複雜推理、寫碼 | GLM 5.1 / Claude | 需要品質 |
| 資料整理、格式轉換 | DeepSeek V4 Flash | 簡單便宜 |
| 定期檢查 / Cron | DeepSeek V4 Flash | 高頻省成本 |
| 翻譯、摘要 | DeepSeek V4 Flash | 夠用 |

Skill Builder 可指定推薦 model，Workflow Orchestrator 根據 node 類型自動路由到合適 model。

---

## Tool Provider 架構

PAAW 支援外掛 Tool Provider，不需改核心碼即可擴充能力：

- **Tool Provider** = 註冊一組 tool 的模組（e.g. discord provider 註冊 send/read/react）
- 4 種 runner：script / api / mcp / builtin
- 放在 `data/tools/{provider-id}/` 目錄，熱插拔
- Skill 可呼叫 Tool、App 可宣告 Tool 依賴

---

## 技術棧

- **前端：** React + Vite
- **後端：** Node.js (ESM)
- **資料庫：** SQLite
- **AI：** Multi-provider（GLM 5.1 / DeepSeek / OpenRouter / 自定義）
- **架構：** Monorepo（packages/ui + server + shared + db + context + engine）
