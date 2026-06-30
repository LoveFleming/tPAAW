# PAAW AI 功能完整清單

> 本文件記錄 PAAW 中所有使用 AI 的功能，包含 context/prompt 來源、UI 類型、streaming 支援、model 切換能力等。
>
> 最後更新：2026-06-30

---

## 目錄

1. [總覽表](#總覽表)
2. [各功能詳解](#各功能詳解)
3. [AI Settings 檔案對照](#ai-settings-檔案對照)
4. [Context 來源架構](#context-來源架構)
5. [待修清單](#待修清單)

---

## 總覽表

| # | 功能 | UI 類型 | Streaming | Model 切換 | 完整系統 Context | systemPrompt 來源 |
|---|------|---------|-----------|-----------|-----------------|-------------------|
| 1 | **Chat（主聊天）** | AgentConsole (WebSocket) | ✅ 即時串流 | ✅ ModelSelector | ✅ | API `context-engine` |
| 2 | **Skill Builder（建構）** | AgentConsole (WebSocket) | ✅ 即時串流 | ✅ ModelSelector | ✅ | API `POST /api/ai-settings/skill-builder/build` |
| 3 | **Skill Builder ✨ AI 生成** | 無 UI（後端直接 LLM） | ❌ 一次性回傳 | ❌ 用預設 provider | ❌ | 硬編碼 + `skill-format.md` |
| 4 | **Skill Exec（執行）** | 無前端 UI（後端 API） | ❌ 一次性回傳 | ❌ 用預設 provider | ✅ | API `context-engine` |
| 5 | **Workflow（工作流）** | WorkflowExec (多步 API) | ❌ 逐步 API 回傳 | ❌ 用預設 provider | ❌ | 硬編碼 `SYSTEM.md + "你是..."` |
| 6 | **Cron Workflow** | 無 UI（排程觸發） | ❌ 一次性回傳 | ❌ 用預設 provider | ⚠️ 不固定 | cron 表單的 systemPrompt |
| 7 | **Cron Skill** | 無 UI（排程觸發） | ❌ 一次性回傳 | ❌ 用預設 provider | ❌ | 只有 skillMd |
| 8 | **Crew / Employee** | AgentConsole (WebSocket) | ✅ 即時串流 | ✅ ModelSelector | ✅ | API `GET /api/context/employee` |
| 9 | **VibeCoding** | AgentConsole (WebSocket) | ✅ 即時串流 | ✅ ModelSelector | ✅ | API `GET /api/context/vibe-coding` |
| 10 | **VibeCodingIDE** | SSE (EventSource) | ✅ SSE 串流 | ❌ 硬編碼 `gpt-4o-mini` | ❌ | 無 systemPrompt |
| 11 | **App Lab** | AgentConsole (WebSocket) | ✅ 即時串流 | ✅ ModelSelector | ✅ | API `GET /api/context/app-builder` |
| 12 | **Skill Lab** | AgentConsole (WebSocket) | ✅ 即時串流 | ❌ 無 ModelSelector | ❌ | 完全沒傳 systemPrompt |
| 13 | **Mindmap** | MindMapViewer (一次性 API) | ❌ 一次性回傳 | ❌ 用預設 provider | ❌ | `mindmap/system-prompt.md` |
| 14 | **Notes** | Notes (一次性 API) | ❌ 一次性回傳 | ❌ 用預設 provider | ❌ | `notes/system-prompt.md` |
| 15 | **Distill（蒸餾）** | SettingsPage 按鈕觸發 | ❌ 一次性回傳 | ❌ 用預設 provider | ❌ | inline `distillPrompt` |

---

## 各功能詳解

### 1. Chat（主聊天）

| 項目 | 說明 |
|------|------|
| **前端頁面** | `ChatView.tsx` |
| **UI 元件** | `AgentConsole` — WebSocket 雙向即時串流 |
| **Streaming** | ✅ WebSocket 即時串流，逐字顯示 + tool event 即時更新 |
| **Model 切換** | ✅ `ModelSelector` (feature key: `chat`)，偏好存 `user.json.preferences.chat` |
| **systemPrompt 來源** | `context-engine._buildChat()` → `buildFullSystemContext()` + 最近對話摘要 |
| **完整系統 Context** | ✅ identity, user profile, memory, apps, tool rules, API tools, guardrails, project rules, reply rules |
| **功能專用設定檔** | `chat/identity.md`, `chat/tool-rules.md`, `chat/guardrails.md`, `chat/system-prompt.md`, `chat/reply-rules.md` |
| **後端路由** | `ws-handler.mjs` → `runAgentLoop()` |

---

### 2. Skill Builder（建構）

| 項目 | 說明 |
|------|------|
| **前端頁面** | `SkillBuilder.tsx` |
| **UI 元件** | `AgentConsole` — WebSocket 雙向即時串流 |
| **Streaming** | ✅ 同 Chat |
| **Model 切換** | ✅ `ModelSelector` (feature key: `skillBuilder`)，偏好存 `user.json.preferences.skillBuilder` |
| **systemPrompt 來源** | `POST /api/ai-settings/skill-builder/build` → `context-engine._buildSkillBuilder()` → `buildFullSystemContext()` + skill format + builder rules + test rules |
| **完整系統 Context** | ✅ 完整系統 context + skill-builder 專用設定 |
| **功能專用設定檔** | `skill-builder/builder-rules.md`, `skill-builder/test-rules.md`, `skill-builder/skill-format.md` |
| **後端路由** | `ai-settings.mjs` → `contextEngine.build({ target: "skill-builder" })` |
| **備註** | Build 時 AI 看到完整系統 context + SKILL.md 格式規範 + 建構規則 + 測試規則 |

---

### 3. Skill Builder ✨ AI 生成

| 項目 | 說明 |
|------|------|
| **前端頁面** | `SkillBuilder.tsx`（✨ 按鈕觸發） |
| **UI 元件** | 無即時 UI — 後端直接 call LLM，回傳完整結果填入表單 |
| **Streaming** | ❌ 一次性回傳 |
| **Model 切換** | ❌ 用預設 provider（`resolveLLM()` 抓 `providers.json` 的 default provider） |
| **systemPrompt 來源** | `skills-api.mjs` 硬編碼 `"你是 PAAW Skill 建構專家..."` + `skill-format.md` |
| **完整系統 Context** | ❌ 缺 identity, memory, apps, tool rules, guardrails 等 |
| **功能專用設定檔** | `skill-builder/skill-format.md` |
| **後端路由** | `POST /api/skills/generate` → `callLLMWithRetry()` |
| **⚠️ 待修** | 需改用 `buildFullSystemContext()` 或 `GET /api/context/skill-builder` |

---

### 4. Skill Exec（Skill 執行）

| 項目 | 說明 |
|------|------|
| **前端頁面** | 無直接前端 UI（被 Workflow、Cron、API 呼叫） |
| **UI 元件** | 後端 API，一次性回傳結果 |
| **Streaming** | ❌ 一次性回傳（非 WebSocket） |
| **Model 切換** | ❌ 用預設 provider |
| **systemPrompt 來源** | `context-engine._buildSkillExec()` → `buildFullSystemContext()` + app `SYSTEM.md` + `crew/skill-rules.md` |
| **完整系統 Context** | ✅ 完整系統 context + app 專用 + skill 規則 |
| **功能專用設定檔** | `crew/skill-rules.md`, app `SYSTEM.md` |
| **後端路由** | `workflow.mjs` `POST /api/paaw/skill-exec` → `runAgentLoop()` |

---

### 5. Workflow（工作流）

| 項目 | 說明 |
|------|------|
| **前端頁面** | `WorkflowExec.tsx` |
| **UI 元件** | 逐步 API 呼叫，每步 `POST /api/paaw/skill-exec`，前端顯示執行進度 |
| **Streaming** | ❌ 逐步 API 回傳（非即時串流） |
| **Model 切換** | ❌ 用預設 provider |
| **systemPrompt 來源** | `workflow.mjs` 硬編碼 `app SYSTEM.md + "你是「{appId}」App 的 Skill 執行引擎。嚴格按照 Skill 定義處理..."` |
| **完整系統 Context** | ❌ 缺 identity, memory, apps, tool rules, guardrails |
| **功能專用設定檔** | app `SYSTEM.md` |
| **後端路由** | `workflow.mjs` `POST /api/paaw/skill-exec` → `runAgentLoop()` |
| **⚠️ 待修** | 應改用 `context-engine._buildSkillExec()` 取代硬編碼 systemPrompt |

---

### 6. Cron Workflow

| 項目 | 說明 |
|------|------|
| **前端頁面** | 無 UI（排程觸發） |
| **UI 元件** | 後端排程執行 |
| **Streaming** | ❌ 一次性回傳 |
| **Model 切換** | ❌ 用預設 provider（可透過 cron job 設定指定 model） |
| **systemPrompt 來源** | cron job 表單中的 `systemPrompt` 欄位（使用者自訂或留空） |
| **完整系統 Context** | ⚠️ 不固定 — 有填就有，沒填就只有 `runAgentLoop` 預設行為 |
| **功能專用設定檔** | 無 |
| **後端路由** | `cron-jobs.mjs` → `runAgentLoop({ systemPrompt })` |
| **⚠️ 待修** | 若 systemPrompt 為空，應自動 fetch `buildFullSystemContext()` |

---

### 7. Cron Skill

| 項目 | 說明 |
|------|------|
| **前端頁面** | 無 UI（排程觸發） |
| **UI 元件** | 後端排程執行 |
| **Streaming** | ❌ 一次性回傳 |
| **Model 切換** | ❌ 用預設 provider |
| **systemPrompt 來源** | 只有 `skillMd`（SKILL.md 內容） |
| **完整系統 Context** | ❌ 缺 identity, memory, apps, tool rules, guardrails |
| **功能專用設定檔** | SKILL.md 本身 |
| **後端路由** | `cron-jobs.mjs` → `runAgentLoop({ prompt, skillMd })` |
| **⚠️ 待修** | 應改用 `context-engine._buildSkillExec()` 取得完整 context |

---

### 8. Crew / Employee

| 項目 | 說明 |
|------|------|
| **前端頁面** | `EmployeeWorkspace.tsx` |
| **UI 元件** | `AgentConsole` — WebSocket 雙向即時串流 |
| **Streaming** | ✅ 即時串流 |
| **Model 切換** | ✅ `ModelSelector` (feature key: `employee_{id}`)，每個 employee 獨立偏好 |
| **systemPrompt 來源** | `GET /api/context/employee?crewId={id}` → `buildFullSystemContext()` + `crew/skill-rules.md` + `crewData.rolePrompt` |
| **完整系統 Context** | ✅ 完整系統 context + skill rules + crew rolePrompt |
| **功能專用設定檔** | `crew/skill-rules.md`, crew JSON `rolePrompt`, app `SYSTEM.md` |
| **後端路由** | `ai-settings.mjs` → `contextEngine.build({ target: "crew" })` |
| **前端 fallback** | 若 API 失敗，fallback 到前端 `buildSystemPrompt()` 舊邏輯 |

---

### 9. VibeCoding

| 項目 | 說明 |
|------|------|
| **前端頁面** | `VibeCoding.tsx` |
| **UI 元件** | `AgentConsole` — WebSocket 雙向即時串流 |
| **Streaming** | ✅ 即時串流 |
| **Model 切換** | ✅ `ModelSelector` (feature key: `vibeCoding`) |
| **systemPrompt 來源** | `GET /api/context/vibe-coding` → `buildFullSystemContext()`（等同 chat context） |
| **完整系統 Context** | ✅ 完整系統 context |
| **功能專用設定檔** | 無專用（使用 chat 的所有設定） |
| **後端路由** | `ai-settings.mjs` → `contextEngine.build({ target: "chat" })` |
| **備註** | 使用者可在 New Session 表單填自訂 systemPrompt，此時不會 fetch API |

---

### 10. VibeCodingIDE

| 項目 | 說明 |
|------|------|
| **前端頁面** | `VibeCodingIDE.tsx` |
| **UI 元件** | SSE (Server-Sent Events) 串流 |
| **Streaming** | ✅ SSE 串流 |
| **Model 切換** | ❌ 硬編碼 `gpt-4o-mini` |
| **systemPrompt 來源** | 無 systemPrompt |
| **完整系統 Context** | ❌ 完全沒有 |
| **功能專用設定檔** | 無 |
| **後端路由** | `cron-jobs.mjs` `POST /api/agent-run/stream` → `runAgentLoopStream()` |
| **⚠️ 待修** | 需加 systemPrompt + ModelSelector |

---

### 11. App Lab

| 項目 | 說明 |
|------|------|
| **前端頁面** | `AppLab.tsx` |
| **UI 元件** | `AgentConsole` — WebSocket 雙向即時串流 |
| **Streaming** | ✅ 即時串流 |
| **Model 切換** | ✅ `ModelSelector` (feature key: `appLab`) |
| **systemPrompt 來源** | `GET /api/context/app-builder` → `buildFullSystemContext()`（等同 chat context + app-builder-rules） |
| **完整系統 Context** | ✅ 完整系統 context |
| **功能專用設定檔** | `app-builder/app-builder-rules.md`（已在 `buildFullSystemContext` 中載入） |
| **後端路由** | `ai-settings.mjs` → `contextEngine.build({ target: "chat" })` |
| **備註** | 頁面上有 systemPrompt 文字區可手動覆蓋 |

---

### 12. Skill Lab

| 項目 | 說明 |
|------|------|
| **前端頁面** | `SkillLab.tsx` |
| **UI 元件** | `AgentConsole` — WebSocket 雙向即時串流 |
| **Streaming** | ✅ 即時串流 |
| **Model 切換** | ❌ 無 ModelSelector |
| **systemPrompt 來源** | 完全沒傳 systemPrompt |
| **完整系統 Context** | ❌ 完全沒有 |
| **功能專用設定檔** | 無 |
| **後端路由** | `ws-handler.mjs` → `runAgentLoop()` |
| **⚠️ 待修** | 需加 `GET /api/context/skill-exec` + ModelSelector |

---

### 13. Mindmap

| 項目 | 說明 |
|------|------|
| **前端頁面** | `MindMapViewer.tsx` |
| **UI 元件** | 一次性 API 回傳，前端渲染心智圖 |
| **Streaming** | ❌ 一次性回傳 |
| **Model 切換** | ❌ 用預設 provider |
| **systemPrompt 來源** | `mindmap/system-prompt.md`（完整的功能專用 prompt，含 MECE、金字塔原則等） |
| **完整系統 Context** | ❌ 只有功能專用 prompt，缺 identity, memory, apps 等 |
| **功能專用設定檔** | `mindmap/system-prompt.md` |
| **後端路由** | `mindmap.mjs` → `callLLMWithRetry()` |
| **⚠️ 待修** | 需加 `buildFullSystemContext()` 前綴 |

---

### 14. Notes

| 項目 | 說明 |
|------|------|
| **前端頁面** | `Notes.tsx` |
| **UI 元件** | 一次性 API 回傳，前端渲染 HTML 筆記 |
| **Streaming** | ❌ 一次性回傳 |
| **Model 切換** | ❌ 用預設 provider |
| **systemPrompt 來源** | `notes/system-prompt.md`（完整的功能專用 prompt，含萃取、結構化、行動導向等） |
| **完整系統 Context** | ❌ 只有功能專用 prompt，缺 identity, memory, apps 等 |
| **功能專用設定檔** | `notes/system-prompt.md` |
| **後端路由** | `notes.mjs` → `callLLMWithRetry()` |
| **⚠️ 待修** | 需加 `buildFullSystemContext()` 前綴 |

---

### 15. Distill（蒸餾）

| 項目 | 說明 |
|------|------|
| **前端頁面** | `SettingsPage.tsx`（蒸餾頁籤，按鈕觸發） |
| **UI 元件** | 按鈕觸發，後端批次處理 |
| **Streaming** | ❌ 一次性回傳 |
| **Model 切換** | ❌ 用預設 provider |
| **systemPrompt 來源** | inline `distillPrompt`（在 `distill.mjs` 的 `DEFAULT_CONFIG` 中硬編碼） |
| **完整系統 Context** | ❌ 只有蒸餾專用 prompt |
| **功能專用設定檔** | 無（全部 inline 在 `distill.mjs`） |
| **後端路由** | `distill.mjs` → `callLLMWithRetry()` |
| **⚠️ 待修** | distillPrompt 應抽出成 `data/ai-settings/distill/` 下的設定檔 |

---

## AI Settings 檔案對照

所有 AI 設定檔位於 `data/ai-settings/`，可透過 API 或檔案系統修改。

| 目錄 | 檔案 | 內容 | 被哪些功能用到 |
|------|------|------|---------------|
| `_base/` | `core-rules.md` | PAAW 核心規則 | 所有功能（base context） |
| `_base/` | `paaw-context.md` | PAAW 路徑與環境變數 | 所有功能（base context） |
| `chat/` | `identity.md` | AI 人設（名字、風格、語氣） | Chat, SkillBuilder, SkillExec, Crew, VibeCoding, AppLab |
| `chat/` | `tool-rules.md` | Tool 使用規則 | 同上 |
| `chat/` | `guardrails.md` | 安全與執行限制 | 同上 |
| `chat/` | `system-prompt.md` | 系統行為規範 | 同上 |
| `chat/` | `reply-rules.md` | 回覆格式、App 連結規則 | 同上 |
| `skill-builder/` | `builder-rules.md` | SKILL.md 建構規則 | Skill Builder |
| `skill-builder/` | `test-rules.md` | Skill 測試規則 | Skill Builder |
| `skill-builder/` | `skill-format.md` | SKILL.md 格式規範 | Skill Builder, ✨AI 生成 |
| `crew/` | `skill-rules.md` | Skill 執行通用規則 | Skill Exec, Crew |
| `app-builder/` | `app-builder-rules.md` | App 建構規則 | Chat, App Lab |
| `mindmap/` | `system-prompt.md` | 心智圖產生規則（MECE、金字塔...） | Mindmap |
| `notes/` | `system-prompt.md` | 筆記整理規則（萃取、結構化...） | Notes |
| `project/` | `identity.md` | 專案管理 AI 人設 | Chat（project context） |
| `project/` | `rules.md` | 專案管理規則 | Chat（project context） |

---

## Context 來源架構

```
┌─────────────────────────────────────────────────┐
│           buildFullSystemContext()               │
│     （所有 AI 功能共用的完整系統 context）         │
├─────────────────────────────────────────────────┤
│                                                 │
│  ┌─ _base/core-rules.md ──────────────────────┐ │
│  │  PAAW 核心規則 + 路徑 + 環境變數            │ │
│  └────────────────────────────────────────────┘ │
│                                                 │
│  ┌─ chat/identity.md ────────────────────────-┐ │
│  │  AI 人設：{{assistantName}}, {{nickname}}   │ │
│  └────────────────────────────────────────────┘ │
│                                                 │
│  ┌─ User Profile + Memory ───────────────────┐ │
│  │  使用者資訊 + MEMORY.md 長期記憶            │ │
│  └────────────────────────────────────────────┘ │
│                                                 │
│  ┌─ Apps + Tool Rules ───────────────────────┐ │
│  │  可用 App 清單 + tool-rules.md + API Tools │ │
│  └────────────────────────────────────────────┘ │
│                                                 │
│  ┌─ Project + App Builder Rules ─────────────┐ │
│  │  project/identity.md + rules.md            │ │
│  │  app-builder/app-builder-rules.md          │ │
│  └────────────────────────────────────────────┘ │
│                                                 │
│  ┌─ Guardrails + System Prompt + Reply ──────┐ │
│  │  guardrails.md + system-prompt.md          │ │
│  │  reply-rules.md + skill-rules.md           │ │
│  └────────────────────────────────────────────┘ │
│                                                 │
└─────────────────────────────────────────────────┘
         │
         │  再加上各功能專用設定
         ▼
┌─────────────────────────────────────────────────┐
│  Skill Builder  + skill-format.md               │
│                 + builder-rules.md               │
│                 + test-rules.md                  │
├─────────────────────────────────────────────────┤
│  Skill Exec     + app SYSTEM.md                 │
│                 + crew/skill-rules.md            │
├─────────────────────────────────────────────────┤
│  Crew           + crew/skill-rules.md            │
│                 + crew JSON rolePrompt           │
├─────────────────────────────────────────────────┤
│  Chat           + 最近對話摘要                    │
├─────────────────────────────────────────────────┤
│  Mindmap        + mindmap/system-prompt.md       │
├─────────────────────────────────────────────────┤
│  Notes          + notes/system-prompt.md         │
└─────────────────────────────────────────────────┘
```

### API 端點

| 端點 | 用途 | 前端頁面 |
|------|------|---------|
| `GET /api/context/:target` | 取得任意 target 的完整系統 context | Employee, VibeCoding, AppLab |
| `POST /api/ai-settings/skill-builder/build` | Skill Builder 專用（含 skillDef） | SkillBuilder |
| `WebSocket /ws` | Chat 即時串流（systemPrompt 由前端傳入） | Chat, SkillBuilder, Crew, SkillLab |

target 對照：`chat`, `skill-exec`, `workflow`, `crew`, `skill-builder`, `crew-chat`→crew, `vibe-coding`→chat, `app-builder`→chat, `employee`→crew, `mindmap`→chat, `notes`→chat

---

## 待修清單

以下功能缺完整系統 context，AI 工作時看不到 identity/memory/apps/tools 等資訊：

| # | 功能 | 問題 | 修法 |
|---|------|------|------|
| 1 | **Skill Builder ✨ AI 生成** | 硬編碼 prompt，缺系統 context | `skills-api.mjs` 改用 `buildFullSystemContext()` |
| 2 | **Workflow** | 只有 `SYSTEM.md + "你是..."` | `workflow.mjs` 改用 `context-engine._buildSkillExec()` |
| 3 | **Cron Skill** | 只有 skillMd | `cron-jobs.mjs` 改用 `context-engine._buildSkillExec()` |
| 4 | **Cron Workflow** | systemPrompt 不固定 | 空時自動 fetch `buildFullSystemContext()` |
| 5 | **Skill Lab** | 完全沒傳 systemPrompt，沒 ModelSelector | 加 `GET /api/context/skill-exec` + ModelSelector |
| 6 | **VibeCodingIDE** | 無 systemPrompt，硬編碼 gpt-4o-mini | 加 systemPrompt + ModelSelector |
| 7 | **Mindmap** | 只有功能專用 prompt | `mindmap.mjs` 加 `buildFullSystemContext()` 前綴 |
| 8 | **Notes** | 只有功能專用 prompt | `notes.mjs` 加 `buildFullSystemContext()` 前綴 |
| 9 | **Distill** | inline distillPrompt | 抽出成 `data/ai-settings/distill/` 設定檔 |
