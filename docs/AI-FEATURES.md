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
| 3 | **Skill Builder ✨ AI 生成** | 無 UI（後端直接 LLM） | ❌ 一次性回傳 | ❌ 用預設 provider | ✅ | API `context-engine` + output rules |
| 4 | **Skill Exec（執行）** | 無前端 UI（後端 API） | ❌ 一次性回傳 | ❌ 用預設 provider | ✅ | API `context-engine` |
| 5 | **Workflow（工作流）** | WorkflowExec (多步 API) | ❌ 逐步 API 回傳 | ❌ 用預設 provider | ✅ | API `context-engine._buildSkillExec()` |
| 6 | **Cron Workflow** | 無 UI（排程觸發） | ❌ 一次性回傳 | ❌ 用預設 provider | ✅ | auto `buildFullSystemContext()` |
| 7 | **Cron Skill** | 無 UI（排程觸發） | ❌ 一次性回傳 | ❌ 用預設 provider | ✅ | API `context-engine._buildSkillExec()` |
| 8 | **Crew / Employee** | AgentConsole (WebSocket) | ✅ 即時串流 | ✅ ModelSelector | ✅ | API `GET /api/context/employee` |
| 9 | **VibeCoding** | AgentConsole (WebSocket) | ✅ 即時串流 | ✅ ModelSelector | ✅ | API `GET /api/context/vibe-coding` |
| 10 | **VibeCodingIDE** | SSE (EventSource) | ✅ SSE 串流 | ❌ 用預設 provider | ✅ | API `GET /api/context/vibe-coding` |
| 11 | **App Lab** | AgentConsole (WebSocket) | ✅ 即時串流 | ✅ ModelSelector | ✅ | API `GET /api/context/app-builder` |
| 12 | **Mindmap** | MindMapViewer (一次性 API) | ❌ 一次性回傳 | ❌ 用預設 provider | ✅ | API `context-engine` + `mindmap/system-prompt.md` |
| 13 | **Notes** | Notes (一次性 API) | ❌ 一次性回傳 | ❌ 用預設 provider | ✅ | API `context-engine` + `notes/system-prompt.md` |
| 14 | **Distill（蒸餾）** | SettingsPage 按鈕觸發 | ❌ 一次性回傳 | ❌ 用預設 provider | ✅ | `distill/system-prompt.md` + inline distillPrompt |

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
| **systemPrompt 來源** | `skills-api.mjs` → `contextEngine.build({ target: "skill-builder" })` + output rules |
| **完整系統 Context** | ✅ 完整系統 context + skill-builder 專用 + output 格式規則 |
| **功能專用設定檔** | `skill-builder/skill-format.md` |
| **後端路由** | `POST /api/skills/generate` → `callLLMWithRetry()` |

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
| **systemPrompt 來源** | `workflow.mjs` → `contextEngine.build({ target: "skill-exec" })` |
| **完整系統 Context** | ✅ 完整系統 context + app SYSTEM.md + skill rules |
| **功能專用設定檔** | app `SYSTEM.md` |
| **後端路由** | `workflow.mjs` `POST /api/paaw/skill-exec` → `runAgentLoop()` |

---

### 6. Cron Workflow

| 項目 | 說明 |
|------|------|
| **前端頁面** | 無 UI（排程觸發） |
| **UI 元件** | 後端排程執行 |
| **Streaming** | ❌ 一次性回傳 |
| **Model 切換** | ❌ 用預設 provider（可透過 cron job 設定指定 model） |
| **systemPrompt 來源** | 自動 fetch `buildFullSystemContext()`（若 cron 表單有填則用自訂的） |
| **完整系統 Context** | ✅ 若自訂為空則自動用完整 context |
| **功能專用設定檔** | 無 |
| **後端路由** | `cron-jobs.mjs` → `runAgentLoop({ systemPrompt })` |

---

### 7. Cron Skill

| 項目 | 說明 |
|------|------|
| **前端頁面** | 無 UI（排程觸發） |
| **UI 元件** | 後端排程執行 |
| **Streaming** | ❌ 一次性回傳 |
| **Model 切換** | ❌ 用預設 provider |
| **systemPrompt 來源** | `contextEngine.build({ target: "skill-exec" })` 完整 context |
| **完整系統 Context** | ✅ 完整系統 context + SKILL.md + skill rules |
| **功能專用設定檔** | SKILL.md 本身 |
| **後端路由** | `cron-jobs.mjs` → `runAgentLoop({ prompt, skillMd, systemPrompt })` |

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
| **Model 切換** | ❌ 用預設 provider（model 由 `POST /api/agent-run/stream` 的 model 參數決定） |
| **systemPrompt 來源** | `GET /api/context/vibe-coding` → `buildFullSystemContext()` |
| **完整系統 Context** | ✅ 完整系統 context |
| **功能專用設定檔** | 無 |
| **後端路由** | `cron-jobs.mjs` `POST /api/agent-run/stream` → `runAgentLoopStream()` |

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

### 12. Mindmap

| 項目 | 說明 |
|------|------|
| **前端頁面** | `MindMapViewer.tsx` |
| **UI 元件** | 一次性 API 回傳，前端渲染心智圖 |
| **Streaming** | ❌ 一次性回傳 |
| **Model 切換** | ❌ 用預設 provider |
| **systemPrompt 來源** | `mindmap.mjs` → `buildFullSystemContext()` + `mindmap/system-prompt.md` |
| **完整系統 Context** | ✅ 完整系統 context + 心智圖專用規則 |
| **功能專用設定檔** | `mindmap/system-prompt.md` |
| **後端路由** | `mindmap.mjs` → `callLLMWithRetry()` |

---

### 13. Notes

| 項目 | 說明 |
|------|------|
| **前端頁面** | `Notes.tsx` |
| **UI 元件** | 一次性 API 回傳，前端渲染 HTML 筆記 |
| **Streaming** | ❌ 一次性回傳 |
| **Model 切換** | ❌ 用預設 provider |
| **systemPrompt 來源** | `notes.mjs` → `buildFullSystemContext()` + `notes/system-prompt.md` |
| **完整系統 Context** | ✅ 完整系統 context + 筆記專用規則 |
| **功能專用設定檔** | `notes/system-prompt.md` |
| **後端路由** | `notes.mjs` → `callLLMWithRetry()` |

---

### 14. Distill（蒸餾）

| 項目 | 說明 |
|------|------|
| **前端頁面** | `SettingsPage.tsx`（蒸餾頁籤，按鈕觸發） |
| **UI 元件** | 按鈕觸發，後端批次處理 |
| **Streaming** | ❌ 一次性回傳 |
| **Model 切換** | ❌ 用預設 provider |
| **systemPrompt 來源** | `distill/system-prompt.md` + inline `distillPrompt`（per source） |
| **完整系統 Context** | ✅ distill 專用 system prompt + source distillPrompt |
| **功能專用設定檔** | `distill/system-prompt.md`（新增） |
| **後端路由** | `distill.mjs` → `callLLMWithRetry()` |

---

## AI Settings 檔案對照

所有 AI 設定檔位於 `data/ai-settings/`，可透過 API 或檔案系統修改。

| 目錄 | 檔案 | 內容 | 被哪些功能用到 |
|------|------|------|---------------|
| `_base/` | `core-rules.md` | PAAW 核心規則 | 所有功能（base context） |
| `_base/` | `paaw-context.md` | PAAW 路徑與環境變數 | 所有功能（base context） |
| `chat/` | `identity.md` | AI 人設（名字、風格、語氣） | 所有功能（via buildFullSystemContext） |
| `chat/` | `tool-rules.md` | Tool 使用規則 | 所有功能 |
| `chat/` | `guardrails.md` | 安全與執行限制 | 所有功能 |
| `chat/` | `system-prompt.md` | 系統行為規範 | 所有功能 |
| `chat/` | `reply-rules.md` | 回覆格式、App 連結規則 | 所有功能 |
| `skill-builder/` | `builder-rules.md` | SKILL.md 建構規則 | Skill Builder |
| `skill-builder/` | `test-rules.md` | Skill 測試規則 | Skill Builder |
| `skill-builder/` | `skill-format.md` | SKILL.md 格式規範 | Skill Builder, ✨AI 生成 |
| `crew/` | `skill-rules.md` | Skill 執行通用規則 | Skill Exec, Crew |
| `app-builder/` | `app-builder-rules.md` | App 建構規則 | Chat, App Lab |
| `mindmap/` | `system-prompt.md` | 心智圖產生規則（MECE、金字塔...） | Mindmap |
| `notes/` | `system-prompt.md` | 筆記整理規則（萃取、結構化...） | Notes |
| `project/` | `identity.md` | 專案管理 AI 人設 | Chat（project context） |
| `project/` | `rules.md` | 專案管理規則 | Chat（project context） |
| `distill/` | `system-prompt.md` | 蒸餾器規則 | Distill |

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
| `WebSocket /ws` | Chat 即時串流（systemPrompt 由前端傳入） | Chat, SkillBuilder, Crew |

target 對照：`chat`, `skill-exec`, `workflow`, `crew`, `skill-builder`, `crew-chat`→crew, `vibe-coding`→chat, `app-builder`→chat, `employee`→crew, `mindmap`→chat, `notes`→chat

---

## 待修清單

所有 14 個 AI 功能的 **完整系統 context** 已全部修完 ✅

剩餘可改善項目：

| # | 功能 | 問題 | 修法 |
|---|------|------|------|
| 1 | **VibeCodingIDE** | 無 ModelSelector，用預設 provider | 加 ModelSelector (feature key: `vibeCodingIDE`) |
| 2 | **Workflow/Cron/Skill Exec** | 無 ModelSelector，用預設 provider | 後端 API 加 model 參數支援 |
| 3 | **Mindmap/Notes/Distill** | 無 ModelSelector，用預設 provider | 後端 API 加 model 參數支援 |
| 4 | **Distill** | per-source distillPrompt 仍 inline 在 `distill.mjs` | 抽出成 `data/ai-settings/distill/` 下 per-source 檔案 |
| 5 | **SkillBuilder API** | `skill-lab/build-files` 路由名稱舊 | 改名為 `skill-builder/build-files` |
