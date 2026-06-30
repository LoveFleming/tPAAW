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

---

## 總覽表

| # | 功能 | UI 類型 | Streaming | Model 切換 | 完整 Context | systemPrompt 來源 |
|---|------|---------|:---------:|:---------:|:----------:|-------------------|
| 1 | **Chat（主聊天）** | AgentConsole (WS) | ✅ | ✅ `chat` | ✅ | `context-engine` + 最近對話摘要 |
| 2 | **Skill Builder（建構）** | AgentConsole (WS) | ✅ | ✅ `skillBuilder` | ✅ | `context-engine` + skill format + rules |
| 3 | **Skill Builder ✨ AI 生成** | 後端直接 LLM | ❌ | ✅ body `model` | ✅ | `context-engine` + output rules |
| 4 | **Skill Exec（執行）** | 後端 API | ❌ | ✅ body `model` | ✅ | `context-engine` + app SYSTEM.md + skill-rules |
| 5 | **Workflow（工作流）** | WorkflowExec (多步 API) | ❌ | ✅ body `model` | ✅ | `context-engine._buildSkillExec()` |
| 6 | **Cron Workflow** | 無 UI（排程） | ❌ | ✅ body `model` | ✅ | auto `buildFullSystemContext()` |
| 7 | **Cron Skill** | 無 UI（排程） | ❌ | ✅ body `model` | ✅ | `context-engine._buildSkillExec()` |
| 8 | **Crew / Employee** | AgentConsole (WS) | ✅ | ✅ `employee_{id}` | ✅ | `GET /api/context/employee` |
| 9 | **VibeCoding** | AgentConsole (WS) | ✅ | ✅ `vibeCoding` | ✅ | `GET /api/context/vibe-coding` |
| 10 | **VibeCodingIDE** | SSE (EventSource) | ✅ | ✅ `vibeCodingIDE` | ✅ | `GET /api/context/vibe-coding` |
| 11 | **App Lab** | AgentConsole (WS) | ✅ | ✅ `appLab` | ✅ | `GET /api/context/app-builder` |
| 12 | **Mindmap** | 一次性 API | ❌ | ✅ body `model` | ✅ | `context-engine` + `mindmap/system-prompt.md` |
| 13 | **Notes** | 一次性 API | ❌ | ✅ body `model` | ✅ | `context-engine` + `notes/system-prompt.md` |
| 14 | **Distill（蒸餾）** | 按鈕觸發 | ❌ | ✅ body `model` | ✅ | `distill/system-prompt.md` + per-source prompt |

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
| **systemPrompt 來源** | `POST /api/ai-settings/skill-builder/build` → `buildFullSystemContext()` + skill format + builder rules + test rules |
| **完整系統 Context** | ✅ 完整系統 context + skill-builder 專用設定 |
| **功能專用設定檔** | `skill-builder/builder-rules.md`, `skill-builder/test-rules.md`, `skill-builder/skill-format.md` |
| **後端路由** | `ai-settings.mjs` → `contextEngine.build({ target: "skill-builder" })` |

---

### 3. Skill Builder ✨ AI 生成

| 項目 | 說明 |
|------|------|
| **前端頁面** | `SkillBuilder.tsx`（✨ 按鈕觸發） |
| **UI 元件** | 無即時 UI — 後端直接 call LLM，回傳完整結果填入表單 |
| **Streaming** | ❌ 一次性回傳 |
| **Model 切換** | ✅ body `model` 參數（預設用 providers.json 的 default） |
| **systemPrompt 來源** | `contextEngine.build({ target: "skill-builder" })` + output rules |
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
| **Model 切換** | ✅ body `model` 參數 |
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
| **Model 切換** | ✅ body `model` 參數 |
| **systemPrompt 來源** | `contextEngine.build({ target: "skill-exec" })` |
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
| **Model 切換** | ✅ body `model` 參數（可透過 cron job 設定指定） |
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
| **Model 切換** | ✅ body `model` 參數 |
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
| **systemPrompt 來源** | `GET /api/context/vibe-coding` → `buildFullSystemContext()` |
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
| **Model 切換** | ✅ `ModelSelector` (feature key: `vibeCodingIDE`) |
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
| **systemPrompt 來源** | `GET /api/context/app-builder` → `buildFullSystemContext()`（含 app-builder-rules） |
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
| **Model 切換** | ✅ body `model` 參數（預設用 providers.json 的 default） |
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
| **Model 切換** | ✅ body `model` 參數（預設用 providers.json 的 default） |
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
| **Model 切換** | ✅ body `model` 參數 |
| **systemPrompt 來源** | `distill/system-prompt.md`（基礎）+ `distill/{source}.md`（per-source） |
| **完整系統 Context** | ✅ distill 基礎 prompt + per-source 蒸餾 prompt |
| **功能專用設定檔** | `distill/system-prompt.md`, `distill/chat.md`, `distill/vibe.md`, `distill/cron.md`, `distill/vibe-coding.md` |
| **後端路由** | `distill.mjs` → `callLLMWithRetry()` |

---

## AI Settings 檔案對照

所有 AI 設定檔位於 `data/ai-settings/`，可透過 API 或檔案系統修改。

| 目錄 | 檔案 | 內容 | 被誰用 |
|------|------|------|--------|
| `_base/` | `core-rules.md` | PAAW 核心規則 | 所有 14 功能 |
| `_base/` | `paaw-context.md` | PAAW 路徑與環境變數 | 所有 14 功能 |
| `chat/` | `identity.md` | AI 人設（名字、風格、語氣） | 所有 14 功能（via buildFullSystemContext） |
| `chat/` | `tool-rules.md` | Tool 使用規則 | 所有 14 功能 |
| `chat/` | `guardrails.md` | 安全與執行限制 | 所有 14 功能 |
| `chat/` | `system-prompt.md` | 系統行為規範 | 所有 14 功能 |
| `chat/` | `reply-rules.md` | 回覆格式、App 連結規則 | 所有 14 功能 |
| `skill-builder/` | `builder-rules.md` | SKILL.md 建構規則 | #2, #3 |
| `skill-builder/` | `test-rules.md` | Skill 測試規則 | #2, #3 |
| `skill-builder/` | `skill-format.md` | SKILL.md 格式規範 | #2, #3 |
| `crew/` | `skill-rules.md` | Skill 執行通用規則 | #4, #5, #7, #8 |
| `app-builder/` | `app-builder-rules.md` | App 建構規則 | #1, #11 |
| `mindmap/` | `system-prompt.md` | 心智圖產生規則（MECE、金字塔...） | #12 |
| `notes/` | `system-prompt.md` | 筆記整理規則（萃取、結構化...） | #13 |
| `project/` | `identity.md` | 專案管理 AI 人設 | 所有 14 功能 |
| `project/` | `rules.md` | 專案管理規則 | 所有 14 功能 |
| `distill/` | `system-prompt.md` | 蒸餾器基礎規則 | #14 |
| `distill/` | `chat.md` | Chat 對話蒸餾 prompt | #14 |
| `distill/` | `vibe.md` | Vibe Coding CLI 蒸餾 prompt | #14 |
| `distill/` | `cron.md` | Cron 排程蒸餾 prompt | #14 |
| `distill/` | `vibe-coding.md` | Vibe Coding IDE 蒸餾 prompt | #14 |

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
│  ┌─ chat/identity.md ─────────────────────────┐ │
│  │  AI 人設：{{assistantName}}, {{nickname}}    │ │
│  └────────────────────────────────────────────┘ │
│                                                 │
│  ┌─ User Profile + Memory ────────────────────┐ │
│  │  使用者資訊 + MEMORY.md 長期記憶             │ │
│  └────────────────────────────────────────────┘ │
│                                                 │
│  ┌─ Apps + Tool Rules ────────────────────────┐ │
│  │  可用 App 清單 + tool-rules.md + API Tools  │ │
│  └────────────────────────────────────────────┘ │
│                                                 │
│  ┌─ Project + App Builder Rules ──────────────┐ │
│  │  project/identity.md + rules.md             │ │
│  │  app-builder/app-builder-rules.md           │ │
│  └────────────────────────────────────────────┘ │
│                                                 │
│  ┌─ Guardrails + System Prompt + Reply ───────┐ │
│  │  guardrails.md + system-prompt.md           │ │
│  │  reply-rules.md + skill-rules.md            │ │
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
├─────────────────────────────────────────────────┤
│  Distill        + distill/system-prompt.md       │
│                 + distill/{source}.md             │
└─────────────────────────────────────────────────┘
```

### API 端點

| 端點 | 用途 | 前端頁面 |
|------|------|---------|
| `GET /api/context/:target` | 取得任意 target 的完整系統 context | Employee, VibeCoding, AppLab, VibeCodingIDE |
| `POST /api/ai-settings/skill-builder/build` | Skill Builder 專用（含 skillDef） | SkillBuilder |
| `WebSocket /ws` | Chat 即時串流（systemPrompt 由前端傳入） | Chat, SkillBuilder, Crew |

target 對照：`chat`, `skill-exec`, `workflow`, `crew`, `skill-builder`, `crew-chat`→crew, `vibe-coding`→chat, `app-builder`→chat, `employee`→crew, `mindmap`→chat, `notes`→chat

### Model 參數

所有 AI 功能都支援 `model` 參數：

| 功能 | Model 切換方式 | 前端 UI |
|------|---------------|---------|
| Chat, SkillBuilder, Crew, VibeCoding, AppLab, VibeCodingIDE | `ModelSelector` 元件，偏好存 `user.json.preferences.{feature}` | ✅ dropdown |
| Workflow, Skill Exec | body `model` 參數 → `runAgentLoop({ model })` | ❌ API only |
| Cron Workflow/Skill | body `model` 參數 → `runAgentLoop({ model })` | ❌ API only |
| Mindmap | body `model` 參數 → `resolveLLM(model)` | ❌ API only |
| Notes | body `model` 參數 → `resolveLLM(model)` | ❌ API only |
| Distill | body `model` 參數 → `callLLM(... model)` | ❌ API only |
