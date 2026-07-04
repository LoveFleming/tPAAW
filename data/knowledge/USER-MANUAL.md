# PAAW User Manual

> **PAAW — Personal AI Assistant Workspace**
> Build your personal AI Workforce
>
> 完整功能使用手冊，從入門到精通
>
> Repo: `LoveFleming/tPAAW` · Branch: `dev`
> 最後更新：2026-07-05

---

## 目錄

1. [PAAW 是什麼？](#1-paaw-是什麼)
2. [第一次使用](#2-第一次使用)
3. [Chat — AI 聊天助理](#3-chat--ai-聊天助理)
4. [Skill Builder — 技能建構器](#4-skill-builder--技能建構器)
5. [App Builder — 應用建構器](#5-app-builder--應用建構器)
6. [AI Crew — AI 員工團隊](#6-ai-crew--ai-員工團隊)
7. [Workflow — 工作流](#7-workflow--工作流)
8. [Cron Jobs — 排程任務](#8-cron-jobs--排程任務)
9. [Coding IDE — 程式開發環境](#9-coding-ide--程式開發環境)
10. [Mindmap — 心智圖](#10-mindmap--心智圖)
11. [Notes — 智慧筆記](#11-notes--智慧筆記)
12. [Projects — 專案管理](#12-projects--專案管理)
13. [Knowledge — 知識庫](#13-knowledge--知識庫)
14. [Settings — 系統設定](#14-settings--系統設定)
15. [AI Settings — AI 行為調校](#15-ai-settings--ai-行為調校)
16. [Distill — 對話蒸餾](#16-distill--對話蒸餾)
17. [備份與還原](#17-備份與還原)
18. [i18n — 多語系支援](#18-i18n--多語系支援)
19. [常用快速鍵與技巧](#19-常用快速鍵與技巧)
20. [FAQ](#20-faq)

---

## 1. PAAW 是什麼？

**PAAW = Personal AI Assistant Workspace**

一句話：**Build your personal AI Workforce — 人用 AI 自己做工具 → AI 幫你記資料 → AI 放大你記的資料。**

PAAW 讓你：

- 🤖 **跟 AI 聊天**就能完成工作（所有工具在聊天視窗都能用）
- 🔧 **用 AI 建造工具**（Skill、App、Workflow），不用寫程式
- 👥 **組建 AI 團隊**（Crew），每個成員有不同專長
- ⏰ **排程自動化**（Cron Job），定時執行任務
- 📝 **管理知識**，AI 幫你整理、蒸餾、放大

### 核心概念

| 概念 | 說明 | 比喻 |
|------|------|------|
| **Skill** | 最小能力單元，定義 AI 如何完成一件事 | 一個函數 |
| **App** | 資料驅動或 Skill-based 的應用 | 一個 App |
| **Crew** | AI 員工，有角色、技能、個性 | 一個同事 |
| **Workflow** | 多個 Skill 串聯的流程 | 一條流水線 |
| **Cron Job** | 定時執行的任務 | 鬧鐘 + 執行者 |
| **Chat** | 統一入口，所有工具在這裡都能叫用 | 你的指揮中心 |

### 能力飛輪

```
你用 AI 做工具（Skill / App）
      ↓
AI 幫你記資料（App data）
      ↓
AI 放大你記的資料（聊天中自動叫用 Tool）
      ↓
產出更多洞識 → 回饋到工具 → 飛輪轉更快
```

---

## 2. 第一次使用

### 2.1 打開 Dashboard

啟動 PAAW 後，打開瀏覽器前往：

- **開發模式**：http://localhost:5173
- **Production 模式**：http://localhost:4097

### 2.2 介面導覽

左側欄（Sidebar）分為以下區塊：

| 區塊 | 功能 |
|------|------|
| 💬 **Chat** | AI 聊天助理 |
| 🔧 **Skill Builder** | 建構技能 |
| 📦 **App Builder** | 建構應用 |
| 📋 **App Pool** | 管理 App |
| 👥 **AI Crew** | 管理 AI 員工 |
| ⚡ **Workflow** | 工作流編輯與執行 |
| ⏰ **Cron Jobs** | 排程任務 |
| 💻 **Coding IDE** | 程式開發環境 |
| 🧠 **Mindmap** | 心智圖 |
| 📝 **Notes** | 筆記 |
| 📊 **Projects** | 專案管理 |
| 📁 **Knowledge** | 知識庫檔案 |
| ⚙️ **Settings** | 系統設定 |
| 🤖 **AI Settings** | AI 行為調校 |

### 2.3 切換模型

大部分 AI 功能頁面都有 🤖 **ModelSelector** 下拉框，可以：

- 選擇不同的 LLM model（如 GLM 5.1、DeepSeek）
- 偏好會自動記住，下次開啟同一功能時延用

### 2.4 切換語系

Dashboard 右下角（或 Settings 頁面）可切換 UI 語系：

- 🇹🇼 繁體中文
- 🇬🇧 英文
- 🇯🇵 日文
- 🌐 中英混合

---

## 3. Chat — AI 聊天助理

> **所有 App/Tool 在聊天視窗都能用，這是 PAAW 的核心。**

### 3.1 基本對話

1. 點左側欄 **💬 Chat**
2. 在輸入框打字，按 Enter 送出（Shift+Enter 換行）
3. AI 回覆會逐字串流顯示
4. AI 呼叫工具時，會看到 `🔧 tool_name...` → `✅ 結果`

### 3.2 在聊天中使用 App

每個安裝的 App 會自動成為聊天工具。例如：

- 你裝了 **pocket**（記帳 App）
- 聊天中說「幫我記一筆消費 200 元買咖啡」
- AI 自動呼叫 `pocket_add` 工具寫入資料
- 你可以問「這週花了多少？」AI 呼叫 `pocket_list` 查詢

### 3.3 觸發關鍵字路由

聊天中提到關鍵字會自動匹配到對應的 Skill/App：

| 你說... | AI 自動叫用 |
|---------|------------|
| 「幫我翻譯...」 | `translate_exec` |
| 「記一筆...」 | `pocket_add` |
| 「查一下...」 | 對應 App 的 `_list` |
| 「總結這段...」 | `summarize_exec` |

### 3.4 上傳檔案

聊天視窗支援拖拽上傳檔案，AI 可以讀取檔案內容並處理。

### 3.5 切換 AI 人設

AI 的人設由 `data/ai-settings/chat/identity.md` 決定。你可以：

1. 前往 **AI Settings** → **chat** → **identity.md**
2. 編輯 AI 的名字、性格、語氣
3. 存檔後立即生效

### 3.6 IME 中文輸入

聊天輸入框已正確處理 IME composition：
- 中文/日文選字按 Enter **不會** 送出訊息
- 選字完畢後再按 Enter 才會送出

---

## 4. Skill Builder — 技能建構器

> **Skill 是 PAAW 中最小的能力單元。** 一個 Skill = 一個有明確輸入/輸出的 AI 任務。

### 4.1 Skill 結構

每個 Skill 的 SKILL.md 包含以下區塊：

```markdown
# Skill

## Purpose
（這個 Skill 做什麼）

## Inputs
（需要什麼輸入）

## Deterministic Script
### Tool Access
### Execution Steps
### Business Rules
### Error Handling

## Guardrails
（安全限制）

## Output Contract
（輸出格式保證）

## Validation
（如何驗證結果）
```

### 4.2 建構流程

1. 點 **Skill Builder**
2. 填入各欄位（或用 ✨ 按鈕讓 AI 幫你填）
3. 點 **Build** → AI 產出完整 SKILL.md
4. 點 **Test** → 輸入測試資料，驗證 Skill 行為
5. 產出檔案在 `data/skills/building/{slug}/`

### 4.3 ✨ AI 自動生成

點 **✨ 按鈕**，用一句話描述你要的 Skill，AI 幫你填完所有欄位。

例如：「我要一個翻譯 Skill，輸入英文文字，輸出繁中翻譯」

### 4.4 Skill 的四種 Runner

| Runner | 執行方式 |
|--------|---------|
| `llm` | AI 直接回應（最常用） |
| `cli` | 執行命令列工具 |
| `script` | 執行 JavaScript |
| `api` | 呼叫外部 API |

### 4.5 Skill 執行方式

Skill 可以被以下方式叫用：

- **聊天中**自動觸發（關鍵字匹配）
- **Crew** 作為員工的能力
- **Workflow** 作為流程的一步
- **Cron Job** 排程執行
- **API** 直接呼叫 `POST /api/paaw/skill-exec`

---

## 5. App Builder — 應用建構器

> **不用寫程式，用聊天就能建一個 App。** 建完後 App 自動成為聊天工具。

### 5.1 用 App Builder 建App

1. 點 **App Builder**
2. 用自然語言描述你要的 App：
   > 「我要一個讀書筆記 App，欄位有書名、章節、重點摘要、頁碼、標籤」
3. AI 會幫你產出：
   - `app.json`（App 定義 + schema）
   - App UI（自動生成列表/新增/編輯介面）
   - Chat Tool（自動註冊為聊天工具）

### 5.2 App 的三種 Data Shape

| Data Shape | 說明 | 自動產生的工具 |
|------------|------|---------------|
| `array` | 列表型資料 | `_add`, `_list`, `_get`, `_update`, `_delete` |
| `object` | 單一物件 | `_get`, `_set` |
| `skill` | Skill-based | `_exec` |

### 5.3 手動建立 App

在 `data/apps/{app-id}/` 建立 `app.json`：

```json
{
  "id": "reading-notes",
  "name": "讀書筆記",
  "description": "記錄讀書重點",
  "dataShape": "array",
  "schema": {
    "book": { "type": "string", "label": "書名", "required": true },
    "chapter": { "type": "string", "label": "章節" },
    "highlight": { "type": "text", "label": "重點摘要" },
    "page": { "type": "number", "label": "頁碼" },
    "tags": { "type": "array", "items": { "type": "string" }, "label": "標籤" }
  }
}
```

存檔後 App 立即生效，不需要重啟 server。

### 5.4 App Pool 管理

Dashboard → **App Pool** 可以：
- 查看所有已安裝的 App
- 編輯 App schema
- 刪除 App
- 查看 App 資料

### 5.5 App 資料儲存

App 資料存在 `data/app-data/{app-id}.json`。每個 App 一個 JSON 檔案。

---

## 6. AI Crew — AI 員工團隊

> **Crew 是有角色、技能和個性的 AI 成員。** 每個 Crew 像一個虛擬同事。

### 6.1 建立 Crew

1. Dashboard → **AI Crew** → **New Crew**
2. 設定：
   - **名字**：例如「寫作助手」
   - **rolePrompt**：角色描述（決定 AI 的行為）
   - **skills**：綁定的 Skill 清單
   - **model**：使用的 LLM model

範例 Crew JSON：

```json
{
  "id": "06-ai.writer",
  "name": "寫作助手",
  "rolePrompt": "你是一位專業寫作助手，擅長中英文寫作、翻譯、潤飾。回覆風格溫暖但有條理。",
  "skills": ["translate", "summarize", "rewrite"],
  "model": "glm-5.1"
}
```

### 6.2 使用 Crew

1. 點 Crew → **進入 Workspace**
2. 像聊天一樣跟 Crew 對話
3. Crew 會用它綁定的 Skill 來完成任務
4. 每個 Crew 有獨立的 model 偏好

### 6.3 預設 Crew 範例

PAAW 預設有以下 Crew（在 `data/crews/`）：

| Crew ID | 名稱 | 角色 |
|---------|------|------|
| `00-ai.factory-assistant` | 工廠助理 | AI Factory 總管 |
| `01-ai.health-checker` | 健康檢查員 | 系統健康檢查 |
| `02-ai.spec` | 規格撰寫員 | 寫技術規格文件 |
| `03-ai.node-dev` | Node 開發者 | Node.js 開發 |
| `04-ai.qa` | QA 測試員 | 品質保證、測試 |
| `05-ai.troubleshooting` | 除錯專員 | 問題排查 |
| `07-ai.skill-designer` | Skill 設計師 | 設計新 Skill |

---

## 7. Workflow — 工作流

> **多個 Skill 串聯起來，一步接一步完成複雜任務。**

### 7.1 編輯 Workflow

1. Dashboard → **Workflow Editor**
2. 定義 steps（每個 step 是一個 Skill 執行）：

```json
{
  "steps": [
    {
      "name": "翻譯",
      "skillId": "translate",
      "input": { "text": "{{input.text}}", "target_lang": "zh-TW" }
    },
    {
      "name": "總結",
      "skillId": "summarize",
      "input": { "text": "{{steps.0.output}}" }
    }
  ]
}
```

3. `{{input.xxx}}` 引用使用者輸入
4. `{{steps.N.output}}` 引用前面步驟的結果

### 7.2 執行 Workflow

1. Dashboard → **Workflow Exec**
2. 選擇要執行的 Workflow
3. 輸入起始資料
4. 點 **Execute**，每步結果會逐步顯示

### 7.3 Workflow + Cron

Workflow 可以搭配 Cron Job 排程執行，例如每天早上 8:00 自動翻譯+總結新聞。

---

## 8. Cron Jobs — 排程任務

> **定時執行任務：提醒、報告、自動化流程。**

### 8.1 建立 Cron Job

1. Dashboard → **Cron Jobs** → **New**
2. 填入：
   - **名字**：方便識別
   - **類型**：

| 類型 | 說明 | 用途 |
|------|------|------|
| `reminder` | 提醒 | 定時發訊息提醒你 |
| `report` | 報告 | 排程執行 Skill，產出結果 |
| `workflow` | 工作流 | 排程執行 Workflow |

   - **排程（cron expression）**：下方有範例
   - **輸出目標**：`chat`（發到聊天）或 `file`（寫入檔案）

### 8.2 Cron Expression 速查

| Expression | 意思 |
|------------|------|
| `0 9 * * *` | 每天 9:00 |
| `0 9 * * 1` | 每週一 9:00 |
| `*/30 * * * *` | 每 30 分鐘 |
| `0 0,12 * * *` | 每天 0:00 和 12:00 |
| `0 9 1 * *` | 每月 1 號 9:00 |
| `0 18 * * 1-5` | 平日 18:00 |
| `0 22 * * *` | 每天 22:00 |

> Cron 欄位順序：分 時 日 月 週

### 8.3 管理 Cron Job

- **暫停/啟用**：Toggle 開關
- **查看上次執行**：列表顯示 `lastRun` 和 `lastStatus`
- **編輯**：點 job 名稱
- **刪除**：點刪除按鈕

### 8.4 Cron Job 範例

**運動提醒**：
```json
{
  "name": "運動提醒",
  "type": "reminder",
  "reminderText": "該去運動了！🏃",
  "schedule": "30 10 * * *",
  "outputTarget": "chat"
}
```

**每日新聞摘要**：
```json
{
  "name": "AI 每日摘要",
  "type": "report",
  "skillId": "ai-news-digest",
  "schedule": "0 8 * * *",
  "outputTarget": "chat"
}
```

---

## 9. Coding IDE — 程式開發環境

> **內建終端機 + AI Agent 的開發環境。**

### 9.1 介面

| 區域 | 說明 |
|------|------|
| 左側 | 檔案樹（瀏覽、開啟、右鍵操作） |
| 中間 | 程式碼編輯器 |
| 右側 | AI 助理對話框（SSE 串流） |
| 底部 | 終端機（完整 PTY） |

### 9.2 AI Agent 能力

Coding IDE 中的 AI 有以下工具可用：

| Tool | 功能 |
|------|------|
| `read_file` | 讀取檔案 |
| `write_file` | 寫入檔案 |
| `edit_file` | 精確文字替換 |
| `glob` | 搜尋檔案名稱 |
| `grep` | 搜尋檔案內容 |
| `diff` | 比較差異 |
| `git` | Git 操作 |
| `bash` | 執行 Shell 命令 |
| `ask_user` | 詢問使用者 |

### 9.3 使用方式

1. 點 **Coding IDE**
2. 在右側 AI 對話框描述你要做的事：
   > 「幫我加一個新的 API route，路徑 /api/export，回傳 CSV」
3. AI 會讀寫檔案、執行命令，逐步完成
4. 所有操作都即時顯示

### 9.4 安全限制

- AI 只能寫入 workspace 目錄範圍內的檔案
- Docker 模式下，AI 在容器內操作，更安全

---

## 10. Mindmap — 心智圖

> **用 AI 自動產生心智圖，從任何主題或檔案出發。**

### 10.1 產生心智圖

1. 點 **Mindmap**
2. 輸入主題（或選擇一個知識庫檔案）
3. 選擇 🤖 model
4. 點 **Generate**
5. AI 產生互動式心智圖，可展開/收合節點

### 10.2 匯出

產出的心智圖儲存在 `data/mindmaps/`，可匯出為 Markdown 或圖片。

---

## 11. Notes — 智慧筆記

> **AI 幫你整理筆記，自動結構化、標記、分類。**

### 11.1 建立 AI 筆記

1. 點 **Notes**
2. 選擇一個筆記檔案（或建立新的）
3. 用 🤖 按鈕切換 model
4. 點 **AI Write**，輸入需求：
   > 「整理今天會議的重點，列成條列式」
5. AI 產出結構化筆記

### 11.2 筆記格式

筆記儲存在 `data/notes/`，格式為 Markdown。

---

## 12. Projects — 專案管理

> **看板式專案管理，搭配 AI 助理。**

### 12.1 專案看板

1. Dashboard → **Projects**
2. 建立 Project → 新增 Task
3. Task 可拖拽改變狀態（Todo → In Progress → Done）
4. 每個 Task 可以有標籤、截止日期、描述

### 12.2 Project AI 助理

每個專案面板內建 AI 助理：
- 分析專案進度
- 建議下一步
- 自動建立 Task

---

## 13. Knowledge — 知識庫

> **結構化的知識檔案管理。**

### 13.1 知識庫結構

```
data/knowledge/
├── RUNBOOK.md           ← 營運操作手冊
├── USER-MANUAL.md       ← 本文件
└── about-paaw/
    ├── AI-FEATURES.md
    ├── DEVELOPER-GUIDE.md
    ├── PAAW-REFERENCE.md
    └── ai-context/      ← 給 AI 讀的結構化知識
        ├── overview/
        ├── architecture/
        ├── flows/
        ├── api/
        └── ...
```

### 13.2 在聊天中使用知識

AI 在聊天時會自動讀取 `data/knowledge/` 中的檔案作為 context。你可以：

- 放入你的業務文件
- 放入技術規格
- 放入 FAQs
- AI 會基於這些知識回答問題

### 13.3 檔案操作

Knowledge 頁面支援：
- 瀏覽目錄樹
- 新增/編輯/刪除檔案
- 拖拽上傳
- Markdown 預覽

---

## 14. Settings — 系統設定

Dashboard → **Settings** 包含：

### 14.1 供應商管理

- 新增/編輯/刪除 LLM Provider
- 設定 API Key、Base URL、Models
- 切換 Active Provider

### 14.2 偏好設定

| 偏好 key | 控制哪個功能的 model |
|----------|-------------------|
| `chat` | Chat |
| `skillBuilder` | Skill Builder |
| `appBuilder` | App Builder |
| `coding` | Coding IDE |
| `codingIDE` | Coding IDEIDE |
| `employee_{id}` | 特定 Crew |

### 14.3 Agent 設定

| 參數 | 說明 |
|------|------|
| `maxTurns` | Agent Loop 最大回合數 |
| `timeoutSeconds` | 整體逾時 |
| `bashTimeoutSeconds` | bash 命令逾時 |
| `shellTimeoutMs` | Shell 逾時 |

### 14.4 Tools 管理

管理系統中可用的 API Tools（AI 可呼叫的外部 API）。

### 14.5 API Tester

線上測試 API，歷史記錄存在 `data/api-tester-history.json`。

### 14.6 備份設定

- 啟用/停用自動備份
- 設定備份間隔
- 設定保留份數
- 手動執行備份
- 還原備份

---

## 15. AI Settings — AI 行為調校

> **不改程式碼，只改 Markdown 就能調整 AI 行為。**

### 15.1 分類結構

AI Settings 按功能分類，每類下的 `.md` 檔案決定該功能的 AI 行為：

| 分類 | 檔案 | 影響功能 |
|------|------|---------|
| `_base/` | `core-rules.md`, `paaw-context.md` | 全部（基底規則） |
| `chat/` | `identity.md` | AI 人設 |
| `chat/` | `tool-rules.md` | 工具使用規則 |
| `chat/` | `guardrails.md` | 安全限制 |
| `chat/` | `reply-rules.md` | 回覆格式 |
| `skill-builder/` | `builder-rules.md` | Skill 建構規則 |
| `app-builder/` | `app-builder-rules.md` | App 建構規則 |
| `crew/` | `skill-rules.md` | Skill 執行規則 |
| `mindmap/` | `system-prompt.md` | 心智圖規則 |
| `notes/` | `system-prompt.md` | 筆記規則 |
| `project/` | `identity.md`, `rules.md` | 專案 AI |
| `distill/` | `system-prompt.md` + 各 source | 蒸餾器 |

### 15.2 編輯方式

1. Dashboard → **AI Settings**
2. 選擇分類
3. 選擇檔案
4. 線上 Markdown 編輯器中修改
5. 存檔後**立即生效**，不需要重啟

### 15.3 模板變數

AI Settings 中的 `.md` 檔支援模板變數：

| 變數 | 替換為 |
|------|--------|
| `{{PAAW_ROOT}}` | PAAW 的絕對路徑 |
| `{{assistantName}}` | user.json 中的 assistantName |
| `{{nickname}}` | 使用者暱稱 |

---

## 16. Distill — 對話蒸餾

> **AI 自動摘要過去的對話，萃取出有價值的知識。**

### 16.1 蒸餾來源

| Source | 內容 |
|--------|------|
| `chat` | Chat 對話歷史 |
| `vibe` | Coding CLI session |
| `cron` | Cron 執行記錄 |
| `vibe-coding` | Coding IDE session |

### 16.2 執行蒸餾

1. Dashboard → **Settings** → **蒸餾** 分頁
2. 選擇來源（或全部）
3. 點 **Run Distill**
4. 結果存在 `data/distill/`

### 16.3 用途

蒸餾結果會被 AI 讀取作為 context，讓 AI：
- 記住過去的決策
- 避免重複犯錯
- 保持回答一致性

---

## 17. 備份與還原

### 17.1 自動備份

預設每 30 分鐘自動備份 `data/` 目錄。

設定：Settings → **備份設定**

| 項目 | 說明 |
|------|------|
| 自動備份 | 開關 |
| 間隔 | 毫秒（預設 1800000 = 30 分鐘） |
| 最大份數 | 保留多少份（預設 20） |
| 備份目錄 | 存放位置 |

### 17.2 手動備份

Settings → 備份 → **立即備份**

### 17.3 還原

Settings → 備份 → 選擇備份 → **還原**

> ⚠️ 還原會覆蓋目前 data/，建議先備份當前狀態。

---

## 18. i18n — 多語系支援

### 18.1 支援語系

| Locale | 語言 |
|--------|------|
| `zh` | 繁體中文 |
| `en` | 英文 |
| `ja` | 日文 |
| `zh-mix` | 中英混合 |

### 18.2 切換語系

Dashboard 右下角的語系切換器，或 Settings 頁面。

### 18.3 新增 UI 字串（開發者）

修改 UI 時，新字串必須：
1. 用 `t("category.key")` 而非硬編碼文字
2. 同時在 4 個 locale 檔加 key
3. Key 命名規則：`category.subcategory`

Locale 檔位置：`packages/ui/src/i18n/locales/`

---

## 19. 常用快速鍵與技巧

### 19.1 通用

| 快速鍵 | 功能 |
|--------|------|
| `Enter` | 送出訊息 |
| `Shift+Enter` | 換行 |
| `Ctrl+C` | 停止 server |

### 19.2 聊天技巧

- **指定 model**：用 🤖 ModelSelector 切換
- **引用檔案**：拖拽檔案到聊天框
- **用 App**：直接描述需求，AI 自動叫用工具
- **多輪對話**：AI 有完整對話歷史，不用重複背景

### 19.3 App 設計技巧

- **Schema 要清楚**：欄位名、type、label 定義清楚，AI 才能正確使用
- `dataShape: "array"` 適合列表型（待辦、記帳、書籤）
- `dataShape: "object"` 適合設定型（偏好、配置）
- `dataShape: "skill"` 適合純 AI 能力（翻譯、總結）

---

## 20. FAQ

### Q: Chat 沒有回應怎麼辦？

1. 檢查 Settings → 供應商 → API Key 是否有效
2. 看 server console 有沒有錯誤
3. 嘗試切換到另一個 provider/model
4. 詳見 [Runbook 故障排除](./RUNBOOK.md#9-故障排除)

### Q: 如何讓 AI 記住我的偏好？

編輯 `data/config/user.json` 或在聊天中告訴 AI，它會嘗試記住。也可以在 `data/MEMORY.md` 寫入長期記憶。

### Q: App 建完後 AI 在聊天中找不到工具？

確認 `data/apps/{app-id}/app.json` 格式正確。重啟 server 後 App 會被重新載入。

### Q: 如何備份我的資料？

Settings → 備份 → 立即備份。或手動複製 `data/` 目錄。

### Q: 可以多人使用嗎？

PAAW 設計為單人使用。沒有認證系統，不適合多人共用。

### Q: 如何在另一台電腦使用？

1. Git clone repo
2. `npm install`
3. 複製 `data/` 目錄（或從 Git pull）
4. 設定 `providers.json` 的 API key
5. `npm run dev`

### Q: AI 的回答不夠好怎麼調？

1. 前往 **AI Settings** 調整對應的 `.md` 規則檔
2. 改 `identity.md` 調整人設
3. 改 `reply-rules.md` 調整回覆格式
4. 存檔後立即生效

### Q: Cron Job 沒有執行？

1. 確認 job 是 enabled 狀態
2. 確認 server 在跑（Cron 由 server 管理）
3. 查看 `lastRun` 和 `lastStatus`
4. 查看 `logs/cron/` 日誌

### Q: 如何新增 Skill？

兩種方式：
1. **Skill Builder**：圖形化介面，AI 輔助產出
2. **手動建立**：在 `data/skills/` 建目錄，寫 SKILL.md

### Q: Docker 模式跟本機模式差在哪？

| 項目 | 本機模式 | Docker 模式 |
|------|---------|------------|
| AI bash | 直接在 host 執行 | 在容器內執行 |
| 安全性 | 較低（AI 可存取全部檔案） | 較高（隔離） |
| 啟動 | `npm run dev` | `npm run dev:bridge` |
| 檔案同步 | 即時 | 需要審核（sync approval） |

### Q: 如何貢獻程式碼？

1. Fork `LoveFleming/tPAAW`
2. 切到 `dev` branch
3. 提 PR

> ⚠️ 改完碼一定要 commit + push，不留 uncommitted local change。

---

## 附錄：功能矩陣

| 功能 | AI | Streaming | Model 切換 | Tool 使用 | 說明 |
|------|:--:|:---------:|:----------:|:---------:|------|
| Chat | ✅ | ✅ WS | ✅ | ✅ | 主聊天 |
| Skill Builder | ✅ | ✅ WS | ✅ | ✅ | 建構 Skill |
| App Builder | ✅ | ✅ WS | ✅ | ✅ | 建構 App |
| Coding IDE | ✅ | ✅ SSE | ✅ | ✅ | 程式開發 |
| Crew/Employee | ✅ | ✅ WS | ✅ | ✅ | AI 員工 |
| Skill Exec | ✅ | ❌ | ✅ | ✅ | 執行 Skill |
| Workflow | ✅ | ❌ | ✅ | ✅ | 多步流程 |
| Cron | ✅ | ❌ | ✅ | ✅ | 排程 |
| Mindmap | ✅ | ❌ | ✅ | ❌ | 心智圖 |
| Notes | ✅ | ❌ | ✅ | ❌ | 筆記 |
| Project AI | ✅ | ❌ | ✅ | ❌ | 專案助理 |
| Distill | ✅ | ❌ | ✅ | ❌ | 蒸餾 |

---

> **一句話**：PAAW 讓你用 AI 打造自己的工具兵團。這份手冊幫你從入門到精通每個功能。
