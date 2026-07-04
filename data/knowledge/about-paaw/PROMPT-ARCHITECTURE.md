# PAAW 提示詞組裝全圖

> 最後更新：2026-07-01
>
> 這份文件列出**每一個 AI 功能的 system prompt 最終組裝結構**。
> 組裝邏輯在 `packages/server/src/context-engine.mjs` 的 `buildFullSystemContext()` 和各 `_build*` 方法。

---

## 核心架構

```
buildFullSystemContext()  ← 所有 AI 功能共用的底層
  │
  ├── [0] _base/paaw-context.md     — PAAW 路徑、資料結構、Placeholder
  ├── [1] _base/core-rules.md       — 語言、行為準則、安全邊界
  ├── [2] chat/identity.md          — AI 身份（{{assistantName}} {{nickname}}）
  ├── [3] 使用者資訊                 — 名字、介紹、偏好 + Workspace 清單 + Knowledge 路徑
  ├── [4] MEMORY.md                 — 長期記憶
  ├── [5] Apps 清單 + App 連結規則   — 所有已安裝的 App 及其 Tool
  ├── [6] project/identity.md       — 專案管理助理規則
  │   project/rules.md
  ├── [7] chat/tool-rules.md        — Tool 使用規則（核心！只信 Tool 不信記憶）
  ├── [8] crew/skill-rules.md       — Skill 執行規則（讀 SKILL.md → 按步驟執行）
  ├── [9] app-builder-rules.md      — App 建構規則（混合進來，不管是不是 App Builder）
  ├── [10] chat/system-prompt.md    — 系統行為規範
  ├── [11] chat/guardrails.md       — 安全限制
  ├── [12] chat/reply-rules.md      — 回覆格式規則
  └── [13] API Tools + Generated Skills — 系統工具清單
```

**問題 #1**：`buildFullSystemContext()` 把所有東西都塞進去，不管目標功能需不需要。
例如 Mindmap 不需要 Skill 執行規則，Coding IDE 不需要 App Builder 規則。

**問題 #2**：`[9] app-builder-rules.md` 被混在所有 AI 的 context 裡，不管是不是 App Builder。

---

## 每個 AI 功能的實際組裝

### 1. Chat（主聊天）

```
來源：ws-handler.mjs → contextEngine.build({ target: "chat" })

System Prompt =
  buildFullSystemContext()        ← [0]～[13] 全部
  + 最近對話摘要（最新 3 則聊天）
```

### 2. Skill Builder（建構）

```
來源：ws-handler.mjs → contextEngine.build({ target: "skill-builder" })

System Prompt =
  buildFullSystemContext()        ← [0]～[13] 全部
  + skill-builder/skill-format.md （⚠️ 目前不存在！）
  + skill-builder/builder-rules.md
  + skill-builder/test-rules.md

Prompt =
  "你是 PAAW Skill 建構專家..." + 使用者的 Skill 定義
```

### 3. Skill Builder ✨ AI 生成

```
來源：skills-api.mjs POST /api/skills/generate

System Prompt =
  contextEngine.build({ target: "skill-builder" })  ← 同上 #2

User Prompt =
  使用者輸入的 Skill 名稱 + 功能描述
```

### 4. Skill Exec（執行）

```
來源：workflow.mjs POST /api/paaw/skill-exec → contextEngine.build({ target: "skill-exec" })

System Prompt =
  buildFullSystemContext()        ← [0]～[13] 全部
  + app 的 SYSTEM.md（如果有）
  + crew/skill-rules.md（再次加入，已在 full context 裡了）
  + "你是 PAAW Skill 執行引擎..."

Prompt =
  SKILL.md body（{{PAAW_ROOT}} 已替換 + {{key}} 已替換為 input）
```

### 5. Workflow

```
來源：workflow.mjs → contextEngine.build({ target: "workflow" })

System Prompt =
  buildFullSystemContext()        ← 重複！_buildWorkflow 先呼叫 _buildSkillExec
  + _buildSkillExec 的 systemPrompt（也包含 buildFullSystemContext）
  → 也就是 buildFullSystemContext() 出現兩次！

Prompt =
  SKILL.md body
```

**問題 #3**：Workflow 的 context 裡 `buildFullSystemContext()` 被呼叫兩次。

### 6-7. Cron Workflow / Cron Skill

```
來源：cron-jobs.mjs

Cron Workflow:
  如果表單有填 systemPrompt → 用自訂的
  如果沒填 → buildFullSystemContext()（直接呼叫 function）

Cron Skill:
  contextEngine.build({ target: "skill-exec" }) → 同 #4
```

### 8. Crew / Employee（AI 員工）

```
來源：前端 EmployeeWorkspace.tsx

Step 1: GET /api/context/employee?crewId=xxx
  → 後端 ai-settings.mjs → contextEngine.build({ target: "crew", crewId })
  → _buildCrew():
      buildFullSystemContext()      ← [0]～[13] 全部
      + crew/skill-rules.md（再次加入，已在 full context 裡了）
      + crew JSON 的 rolePrompt（如果有 crewId 且檔案存在）

Step 2: 前端附加：
  + "請使用 {skillName}"
  + "skill path : {absolutePath}/SKILL.md"
  + "## 操作員提供的規格資料"
  + 各欄位資料

最終 System Prompt = API context + 前端附加
```

**問題 #4**：`crew/skill-rules.md` 在 `buildFullSystemContext()` 裡已經加了一次（[8]），`_buildCrew` 又加一次。

### 9. Coding IDE

```
來源：前端 CodingIDE.tsx

GET /api/context/coding → contextEngine.build({ target: "chat" })
  → _buildChat():
      buildFullSystemContext()      ← [0]～[13] 全部
      + 最近對話摘要

前端用這個作為 systemPrompt 傳給 AgentConsole SSE stream
```

### 10. App Builder

```
來源：前端 AppBuilder.tsx

GET /api/context/app-builder → contextEngine.build({ target: "chat" })
  → _buildChat()（跟 Chat 完全一樣）

前端頁面上有 systemPrompt 文字區可手動覆蓋
```

### 11. Mindmap

```
來源：mindmap.mjs generateMindMap()

System Prompt =
  contextEngine.build({ target: "mindmap" }) 的 systemPrompt
  = buildFullSystemContext() + buildDynamicContext() + mindmap/system-prompt.md
```

### 12. Notes

```
來源：notes.mjs

System Prompt =
  contextEngine.build({ target: "notes" }) 的 systemPrompt
  = buildFullSystemContext() + buildDynamicContext() + notes/system-prompt.md
```

### 13. Project AI 助理

```
來源：前端 ProjectAiPanel.tsx
      → POST /api/paaw/chat { contextTarget: "project", model: ... }

後端 chat.mjs:
  const ctx = await contextEngine.build({ target: contextTarget || "chat" })
  → target="project" → _buildProject()

System Prompt =
  buildFullSystemContext() + buildDynamicContext() + project/identity.md + project/rules.md

訊息 = 使用者輸入的訊息（無最近對話摘要，因為不是 chat target）
```

### 14. Distill（蒸餾）

```
來源：distill.mjs callLLM()

System Prompt =
  distill/system-prompt.md（專用，不用 buildFullSystemContext）
  + distill/{source}.md（chat / vibe / cron / vibe-coding）
```

---

## 發現的問題

| # | 問題 | 影響 | 修法 |
|---|------|------|------|
| 1 | `buildFullSystemContext()` 把所有規則塞給所有 AI | Token 浪費、AI 被不相關規則干擾 | 改為模組化：核心層 + 功能層 |
| 2 | `app-builder-rules.md` 在所有 AI context 裡 | 翻譯 Skill 不需要知道 App Builder 規則 | 只在 target=app-builder 時加 |
| 3 | Workflow 呼叫 `buildFullSystemContext()` 兩次 | Token 浪費 2x | `_buildWorkflow` 不要再呼叫 `_buildSkillExec` |
| 4 | `crew/skill-rules.md` 加兩次 | 重复內容 | 從 `buildFullSystemContext` 移除，只在需要時加 |
| 5 | `skill-builder/skill-format.md` 不存在 | `loadSkillFormat()` 回傳空字串 | 建檔或移除引用 |
| 6 | Mindmap/Notes 用 `target: "chat"` + 功能 prompt | Chat 的最近對話摘要不該出現在 Mindmap | ✅ 已修：各自有獨立 target `mindmap` / `notes` |

---

## 建議的分層架構

```
Layer 0: Base（所有 AI 必須）
  _base/paaw-context.md
  _base/core-rules.md
  chat/identity.md
  使用者資訊 + Workspace
  MEMORY.md

Layer 1: Shared（大多數 AI 需要）
  chat/tool-rules.md
  chat/guardrails.md
  chat/system-prompt.md
  chat/reply-rules.md

Layer 2: Feature-specific（只給對應功能）
  chat/         → 最近對話摘要
  skill-builder/ → skill-format + builder-rules + test-rules
  crew/          → skill-rules + rolePrompt
  app-builder/   → app-builder-rules
  mindmap/       → mindmap system-prompt
  notes/         → notes system-prompt
  distill/       → distill system-prompt + per-source

Layer 3: Runtime（動態資料）
  Apps 清單
  API Tools
  Generated Skills
```

每個 target 只拿 Layer 0 + Layer 1（可選）+ Layer 2 + Layer 3（可選）。
