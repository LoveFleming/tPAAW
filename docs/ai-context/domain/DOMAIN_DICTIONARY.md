# Domain Dictionary

> 每個 term 的驗證指令附在各自下方

## Skill

**意義：** 最小能力單元，AI 可呼叫的工具。4 種執行器：prompt / data / api / script

**出現模組：** `data/skills/`, `packages/server/src/tools/index.mjs`, `routes/crew.mjs`, `routes/skill.mjs`, `routes/skills-api.mjs`

**常見欄位：**
- `id` — 唯一識別
- `name` — 顯示名稱
- `description` — 描述
- `execution.runner` — 執行器類型 (prompt|data|api|script)
- `execution.mode` — sync | async
- `execution.timeout` — 逾時秒數
- `input.properties` — 輸入欄位定義
- `output.properties` — 輸出欄位定義
- `samples[]` — 範例輸入/輸出

**注意事項：** Skill 的 SKILL.md 用 frontmatter (---) 格式定義 meta，body 支援 {{placeholder}} 替換

> 驗證：`grep -n "runner.*prompt.*data.*api.*script" packages/shared/src/schemas/index.ts`

---

## App

**意義：** 面向使用者的應用，由 Skill 組成或資料驅動。`dataShape` 決定自動產生的工具集

**出現模組：** `data/apps/`, `packages/server/src/tools/index.mjs`, `routes/apps.mjs`

**常見欄位：**
- `id` — 唯一識別（小寫英文開頭 `[a-z][a-z0-9_]*`）
- `name` — 顯示名稱
- `type` — "data" | "skill-based"
- `dataShape` — "array" | "object" | "none"
- `schema` — JSON Schema（含 properties, required, oneOf）
- `triggers[]` — 觸發關鍵字
- `skills[]` — AppSkillRef 陣列

**DataShape 對應工具：**
| dataShape | 自動產生工具 |
|---|---|
| "array" | {id}_add, _list, _get, _update, _delete |
| "object" | {id}_get, _set |
| "none" | {id}_exec |

> 驗證：`grep -n "_add\|_list\|_get\|_set\|_update\|_delete\|_exec" packages/server/src/tools/index.mjs | head -12`

---

## Crew

**意義：** AI 員工，有 rolePrompt 的 Skill 執行者

**出現模組：** `data/crews/`, `routes/crew.mjs`, `context-engine.mjs`

**常見欄位：** `id`, `name`, `rolePrompt`, `avatar`, `skills[]`

> 驗證：`ls data/crews/*.json` → 7 個 crew 檔案

---

## Context Target

**意義：** Context Engine 的組裝目標，決定載入哪些 ai-settings 子目錄

**12 個 target：** chat, skill-exec, workflow, crew, skill-builder, mindmap, notes, project, distill, app-exec, app-builder, coding

> 驗證：`grep 'case "' packages/server/src/context-engine.mjs`

---

## Tool Engine

**意義：** ReAct loop 執行引擎，管理 LLM ↔ Tool 的多輪互動

**出現模組：** `lib/tool-engine/index.mjs`, `routes/chat.mjs`

**關鍵行為：**
- `maxToolRounds` 預設 5 輪
- 偵測假 tool call（LLM 用文字模擬而非真正呼叫）
- Result Validation：寫入操作後回查確認
- Security Kernel：每次 tool call 前安全檢查

> 驗證：`grep "looksLikeFakeToolCall\|detectToolError\|verifyWriteResult\|SecurityKernel" packages/server/src/lib/tool-engine/index.mjs`

---

## Provider

**意義：** LLM API 提供者（OpenAI-compatible）

**出現模組：** `data/config/providers.json`, `lib/tool-engine/provider.mjs`, `lib/llm-utils.mjs`

**常見欄位：** `id`, `name`, `baseURL`, `apiKey`, `models[]`

**目前支援：** zai (智譜 GLM), openrouter (OpenRouter)

> 驗證：`cat data/config/providers.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(list(d['providers'].keys()))"`

---

## Data Shape

**意義：** App 的資料形態，決定自動產生的工具集和 CRUD 行為

**3 種值：** "array" (列表型, 5 工具), "object" (單物件型, 2 工具), "none" (無資料, 1 工具)

> 驗證：`grep -n "dataShape.*array.*object.*none" packages/server/src/tools/index.mjs`

---

## Vibe Session

**意義：** Coding IDE 的終端機/AI session

**出現模組：** `logs/vibe-sessions/`, `websocket/ws-handler.mjs`

**兩種模式：** shell (系統終端), paaw-agent (AI Agent Loop)

> 驗證：`grep "paaw-agent\|engine.*paaw" packages/server/src/websocket/ws-handler.mjs | head -5`

---

## Bridge

**意義：** Docker 外部守門員，3 個職責：Sync / Tool Proxy / Update

**出現模組：** `lib/bridge/paaw-bridge.mjs`

**API keys 只存在 host** — sandbox 不能直接存取外部 API

> 驗證：`grep "TOOL_TOKENS\|apiKeys\|apiKey" packages/server/src/lib/bridge/paaw-bridge.mjs | head -5`

---

## Security Kernel

**意義：** 安全核心，4 個子系統：Policy Pipeline / Approval / Secret Store / Audit Log

**出現模組：** `lib/security/index.mjs`

**內建政策：** 參數注入檢查、exec 指令黑名單、fs 路徑保護、rate limit

> 驗證：`grep "_registerBuiltinPolicies\|param_injection\|exec_security\|fs_security" packages/server/src/lib/security/index.mjs`

---

## Distill

**意義：** AI 互動記錄與蒸餾，用於分析使用者行為模式

**出現模組：** `routes/distill.mjs`, `routes/chat.mjs`

> 驗證：`grep "recordChatInteraction\|recordVibeOutput" packages/server/src/routes/chat.mjs packages/server/src/routes/distill.mjs`
