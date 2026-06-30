# PAAW AI 功能完整清單

> 本文件記錄 PAAW 中所有使用 AI 的功能，包含 context/prompt 來源、UI 類型、streaming 支援、model 切換能力等。
>
> 最後更新：2026-06-30

---

## 總覽表

| # | 功能 | 前端頁面 | UI 類型 | Streaming | Model 切換 | 完整 Context | systemPrompt 來源 |
|---|------|---------|---------|:---------:|:---------:|:----------:|-------------------|
| 1 | **Chat（主聊天）** | `ChatView.tsx` | AgentConsole (WS) | ✅ | ✅ `chat` | ✅ | `context-engine` + 最近對話摘要 |
| 2 | **Skill Builder（建構）** | `SkillBuilder.tsx` | AgentConsole (WS) | ✅ | ✅ `skillBuilder` | ✅ | `context-engine` + skill format + builder/test rules |
| 3 | **Skill Builder ✨ AI 生成** | `SkillBuilder.tsx` (✨按鈕) | 後端直接 LLM | ❌ | ✅ body `model` | ✅ | `context-engine` + output rules |
| 4 | **Skill Exec（執行）** | — (後端 API) | 後端 API | ❌ | ✅ body `model` | ✅ | `context-engine` + app SYSTEM.md + skill-rules |
| 5 | **Workflow（工作流）** | `WorkflowExec.tsx` | 多步 API | ❌ | ✅ body `model` | ✅ | `context-engine._buildSkillExec()` |
| 6 | **Cron Workflow** | — (排程觸發) | 後端排程 | ❌ | ✅ body `model` | ✅ | auto `buildFullSystemContext()` |
| 7 | **Cron Skill** | — (排程觸發) | 後端排程 | ❌ | ✅ body `model` | ✅ | `context-engine._buildSkillExec()` |
| 8 | **Crew / Employee** | `EmployeeWorkspace.tsx` | AgentConsole (WS) | ✅ | ✅ `employee_{id}` | ✅ | `GET /api/context/employee` |
| 9 | **Coding IDE** | `CodingIDE.tsx` | SSE (EventSource) | ✅ | ✅ `coding` | ✅ | `GET /api/context/coding` |
| 10 | **App Builder** | `AppBuilder.tsx` | AgentConsole (WS) | ✅ | ✅ `appBuilder` | ✅ | `GET /api/context/app-builder` |
| 11 | **Mindmap** | `MindMapViewer.tsx` | 一次性 API | ❌ | ✅ body `model` | ✅ | `context-engine` + `mindmap/system-prompt.md` |
| 12 | **Notes** | `Notes.tsx` | 一次性 API | ❌ | ✅ body `model` | ✅ | `context-engine` + `notes/system-prompt.md` |
| 13 | **Distill（蒸餾）** | `SettingsPage.tsx` (按鈕) | 按鈕觸發 | ❌ | ✅ body `model` | ✅ | `distill/system-prompt.md` + per-source prompt |

> **註**：原本的 VibeCoding.tsx（舊版多 session）已刪除，VibeCodingIDE.tsx 已改名為 CodingIDE.tsx。App Lab 已改名為 App Builder。Skill Lab 已刪除（功能由 SkillBuilder 取代）。

---

## 各功能詳解

### 1. Chat（主聊天）

| 項目 | 說明 |
|------|------|
| **前端** | `ChatView.tsx` |
| **UI** | `AgentConsole` — WebSocket 雙向即時串流 |
| **Streaming** | ✅ WebSocket 即時串流，逐字顯示 + tool event 即時更新 |
| **Model 切換** | ✅ `ModelSelector` (feature: `chat`)，存 `user.json.preferences.chat` |
| **Context** | `context-engine._buildChat()` → `buildFullSystemContext()` + 最近對話摘要 |
| **設定檔** | `chat/identity.md`, `chat/tool-rules.md`, `chat/guardrails.md`, `chat/system-prompt.md`, `chat/reply-rules.md` |
| **後端** | `ws-handler.mjs` → `runAgentLoop()` |

### 2. Skill Builder（建構）

| 項目 | 說明 |
|------|------|
| **前端** | `SkillBuilder.tsx` |
| **UI** | `AgentConsole` — WebSocket 雙向即時串流 |
| **Streaming** | ✅ |
| **Model 切換** | ✅ `ModelSelector` (feature: `skillBuilder`) |
| **Context** | `POST /api/ai-settings/skill-builder/build` → `buildFullSystemContext()` + skill format + builder rules + test rules |
| **設定檔** | `skill-builder/builder-rules.md`, `skill-builder/test-rules.md`, `skill-builder/skill-format.md` |
| **後端** | `ai-settings.mjs` → `contextEngine.build({ target: "skill-builder" })` |

### 3. Skill Builder ✨ AI 生成

| 項目 | 說明 |
|------|------|
| **前端** | `SkillBuilder.tsx`（✨ 按鈕觸發） |
| **UI** | 無即時 UI — 後端直接 call LLM，回傳結果填入表單 |
| **Streaming** | ❌ 一次性回傳 |
| **Model 切換** | ✅ body `model` 參數 |
| **Context** | `contextEngine.build({ target: "skill-builder" })` + output rules |
| **設定檔** | `skill-builder/skill-format.md` |
| **後端** | `skills-api.mjs` `POST /api/skills/generate` → `callLLMWithRetry()` |

### 4. Skill Exec（Skill 執行）

| 項目 | 說明 |
|------|------|
| **前端** | 無直接 UI（被 Workflow、Cron、API 呼叫） |
| **UI** | 後端 API，一次性回傳 |
| **Streaming** | ❌ |
| **Model 切換** | ✅ body `model` |
| **Context** | `context-engine._buildSkillExec()` → `buildFullSystemContext()` + app `SYSTEM.md` + `crew/skill-rules.md` |
| **設定檔** | `crew/skill-rules.md`, app `SYSTEM.md` |
| **後端** | `workflow.mjs` `POST /api/paaw/skill-exec` → `runAgentLoop()` |

### 5. Workflow（工作流）

| 項目 | 說明 |
|------|------|
| **前端** | `WorkflowExec.tsx` |
| **UI** | 逐步 API 呼叫，每步 `POST /api/paaw/skill-exec`，前端顯示進度 |
| **Streaming** | ❌ 逐步回傳 |
| **Model 切換** | ✅ body `model` |
| **Context** | `contextEngine.build({ target: "skill-exec" })` |
| **設定檔** | app `SYSTEM.md` |
| **後端** | `workflow.mjs` → `runAgentLoop()` |

### 6. Cron Workflow

| 項目 | 說明 |
|------|------|
| **前端** | 無 UI（排程觸發） |
| **Streaming** | ❌ |
| **Model 切換** | ✅ body `model`（可透過 cron job 設定指定） |
| **Context** | 自動 `buildFullSystemContext()`（若 cron 表單有填則用自訂的） |
| **後端** | `cron-jobs.mjs` → `runAgentLoop()` |

### 7. Cron Skill

| 項目 | 說明 |
|------|------|
| **前端** | 無 UI（排程觸發） |
| **Streaming** | ❌ |
| **Model 切換** | ✅ body `model` |
| **Context** | `contextEngine.build({ target: "skill-exec" })` |
| **設定檔** | SKILL.md 本身 |
| **後端** | `cron-jobs.mjs` → `runAgentLoop()` |

### 8. Crew / Employee

| 項目 | 說明 |
|------|------|
| **前端** | `EmployeeWorkspace.tsx` |
| **UI** | `AgentConsole` — WebSocket 雙向即時串流 |
| **Streaming** | ✅ |
| **Model 切換** | ✅ `ModelSelector` (feature: `employee_{id}`)，每個 employee 獨立偏好 |
| **Context** | `GET /api/context/employee?crewId={id}` → `buildFullSystemContext()` + `crew/skill-rules.md` + `crewData.rolePrompt` |
| **設定檔** | `crew/skill-rules.md`, crew JSON `rolePrompt`, app `SYSTEM.md` |
| **後端** | `ai-settings.mjs` → `contextEngine.build({ target: "crew" })` |
| **Fallback** | API 失敗時 fallback 到前端 `buildSystemPrompt()` |

### 9. Coding IDE

| 項目 | 說明 |
|------|------|
| **前端** | `CodingIDE.tsx` |
| **UI** | All-in-one IDE：左邊檔案樹 + 中間編輯器 + 右邊 AI chat |
| **Streaming** | ✅ SSE 串流 |
| **Model 切換** | ✅ `ModelSelector` (feature: `coding`) |
| **Context** | `GET /api/context/coding` → `buildFullSystemContext()` |
| **後端** | `cron-jobs.mjs` `POST /api/agent-run/stream` → `runAgentLoopStream()` |

### 10. App Builder

| 項目 | 說明 |
|------|------|
| **前端** | `AppBuilder.tsx` |
| **UI** | `AgentConsole` — WebSocket 雙向即時串流 |
| **Streaming** | ✅ |
| **Model 切換** | ✅ `ModelSelector` (feature: `appBuilder`) |
| **Context** | `GET /api/context/app-builder` → `buildFullSystemContext()`（含 app-builder-rules） |
| **設定檔** | `app-builder/app-builder-rules.md` |
| **後端** | `ai-settings.mjs` → `contextEngine.build({ target: "chat" })` |
| **備註** | 頁面上有 systemPrompt 文字區可手動覆蓋 |

### 11. Mindmap

| 項目 | 說明 |
|------|------|
| **前端** | `MindMapViewer.tsx` |
| **UI** | 一次性 API 回傳，前端渲染心智圖 |
| **Streaming** | ❌ |
| **Model 切換** | ✅ body `model` |
| **Context** | `mindmap.mjs` → `buildFullSystemContext()` + `mindmap/system-prompt.md` |
| **設定檔** | `mindmap/system-prompt.md` |
| **後端** | `mindmap.mjs` → `callLLMWithRetry()` |

### 12. Notes

| 項目 | 說明 |
|------|------|
| **前端** | `Notes.tsx` |
| **UI** | 一次性 API 回傳，前端渲染 HTML 筆記 |
| **Streaming** | ❌ |
| **Model 切換** | ✅ body `model` |
| **Context** | `notes.mjs` → `buildFullSystemContext()` + `notes/system-prompt.md` |
| **設定檔** | `notes/system-prompt.md` |
| **後端** | `notes.mjs` → `callLLMWithRetry()` |

### 13. Distill（蒸餾）

| 項目 | 說明 |
|------|------|
| **前端** | `SettingsPage.tsx`（蒸餾頁籤，按鈕觸發） |
| **UI** | 按鈕觸發，後端批次處理 |
| **Streaming** | ❌ |
| **Model 切換** | ✅ body `model` |
| **Context** | `distill/system-prompt.md`（基礎）+ `distill/{source}.md`（per-source） |
| **設定檔** | `distill/system-prompt.md`, `distill/chat.md`, `distill/vibe.md`, `distill/cron.md`, `distill/vibe-coding.md` |
| **後端** | `distill.mjs` → `callLLMWithRetry()` |

---

## AI Settings 檔案對照

所有設定檔在 `data/ai-settings/`，可透過 AI Settings 頁面線上編輯。

| 目錄 | 檔案 | 內容 | 被誰用 |
|------|------|------|--------|
| `_base/` | `core-rules.md`, `paaw-context.md` | 核心規則 + 路徑環境 | 全部 13 功能 |
| `chat/` | `identity.md` | AI 人設 | 全部 13 功能 |
| `chat/` | `tool-rules.md` | Tool 使用規則 | 全部 13 功能 |
| `chat/` | `guardrails.md` | 安全限制 | 全部 13 功能 |
| `chat/` | `system-prompt.md` | 系統行為規範 | 全部 13 功能 |
| `chat/` | `reply-rules.md` | 回覆格式規則 | 全部 13 功能 |
| `skill-builder/` | `builder-rules.md` | SKILL.md 建構規則 | #2, #3 |
| `skill-builder/` | `test-rules.md` | Skill 測試規則 | #2, #3 |
| `skill-builder/` | `skill-format.md` | SKILL.md 格式規範 | #2, #3 |
| `crew/` | `skill-rules.md` | Skill 執行規則 | #4, #5, #7, #8 |
| `app-builder/` | `app-builder-rules.md` | App 建構規則 | #1, #10 |
| `mindmap/` | `system-prompt.md` | 心智圖規則 | #11 |
| `notes/` | `system-prompt.md` | 筆記規則 | #12 |
| `project/` | `identity.md`, `rules.md` | 專案管理規則 | 全部 13 功能 |
| `distill/` | `system-prompt.md` | 蒸餾器基礎規則 | #13 |
| `distill/` | `chat.md` | Chat 對話蒸餾 prompt | #13 |
| `distill/` | `vibe.md` | Coding CLI 蒸餾 prompt | #13 |
| `distill/` | `cron.md` | Cron 排程蒸餾 prompt | #13 |
| `distill/` | `vibe-coding.md` | Coding IDE 蒸餾 prompt | #13 |

---

## Context 來源架構

```
┌─────────────────────────────────────────────────┐
│           buildFullSystemContext()               │
│     （所有 AI 功能共用的完整系統 context）         │
├─────────────────────────────────────────────────┤
│  _base/core-rules.md   — PAAW 核心規則 + 路徑    │
│  chat/identity.md      — AI 人設                  │
│  User Profile + MEMORY.md                        │
│  Apps + tool-rules.md + API Tools 清單           │
│  project/identity.md + rules.md                  │
│  app-builder/app-builder-rules.md                │
│  chat/guardrails.md + system-prompt.md           │
│  chat/reply-rules.md + crew/skill-rules.md       │
└─────────────────────────────────────────────────┘
         │
         │  + 各功能專用設定
         ▼
┌─────────────────────────────────────────────────┐
│  Skill Builder  + skill-format + builder/test    │
│  Skill Exec     + app SYSTEM.md + skill-rules    │
│  Crew           + crew rolePrompt                │
│  Chat           + 最近對話摘要                    │
│  Mindmap        + mindmap/system-prompt.md       │
│  Notes          + notes/system-prompt.md         │
│  Distill        + distill/system-prompt.md       │
│                 + distill/{source}.md             │
└─────────────────────────────────────────────────┘
```

---

## API 端點

### Context & Model

| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/context/:target` | 取得完整系統 context |
| POST | `/api/ai-settings/skill-builder/build` | Skill Builder 專用（帶 skillDef） |
| GET | `/api/user/preferences` | 讀取 model 偏好 |
| PUT | `/api/user/preferences` | 更新 model 偏好 |
| GET | `/api/paaw/providers` | 讀取 provider 設定 |
| PUT | `/api/paaw/providers` | 更新 provider 設定 |
| GET | `/api/ai-settings/agent-config` | 讀取 agent 迴圈設定 |
| PUT | `/api/ai-settings/agent-config` | 更新 agent 迴圈設定 |

### AI 操作

| Method | Path | 說明 |
|--------|------|------|
| WS | `/ws` | Chat / AgentConsole WebSocket |
| POST | `/api/agent-run/stream` | SSE 串流（Coding IDE） |
| POST | `/api/paaw/skill-exec` | Skill / Workflow 執行 |
| POST | `/api/skills/generate` | ✨ AI 生成 SKILL.md |
| POST | `/api/mindmap/generate` | 心智圖產生 |
| POST | `/api/notes/ai-write` | AI 筆記 |
| POST | `/api/distill/run` | 蒸餾全部 |
| POST | `/api/distill/run/:source` | 蒸餾指定來源 |

### target 對照

| target | context-engine method | 用途 |
|--------|----------------------|------|
| `chat` | `_buildChat()` | Chat, Coding IDE, App Builder, Mindmap, Notes |
| `skill-exec` | `_buildSkillExec()` | Skill Exec, Workflow, Cron Skill |
| `skill-builder` | `_buildSkillBuilder()` | Skill Builder, ✨ AI 生成 |
| `crew` | `_buildCrew()` | Crew / Employee |

---

## Model 切換方式

| 類型 | 功能 | 切換方式 | 前端 UI |
|------|------|---------|---------|
| **ModelSelector** | Chat, SkillBuilder, Crew, Coding IDE, App Builder | dropdown 元件，偏好存 `user.json.preferences.{feature}` | ✅ |
| **body model** | Workflow, Skill Exec, Cron, Mindmap, Notes, Distill | API body `model` 參數 | ❌ API only |
