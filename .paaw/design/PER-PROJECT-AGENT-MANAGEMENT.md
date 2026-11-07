# Per-Project Agent Management 設計規劃

> 每個 Code Project 都有自己獨立的 AI Crew，可以客製化 agent、技能、模型、記憶。

---

## 現狀問題

```
目前：
  data/crews/coding.*.json     ← 全域 crew 定義（6 個固定 agent）
  CodingIDE.tsx                ← hardcoded codingCrews[6]
  EMDashboard                  ← hardcoded 可調度 agent 列表
  ModelSelector                ← feature key 寫死 "codingIDE.{crewId}"
  Skills                       ← 全域，沒有 per-project 掛載

問題：
  ❌ 所有 project 共用同一組 crew，無法客製
  ❌ 不能加新 agent（要改 code）
  ❌ 不能幫特定 project 的 agent 掛 skill
  ❌ 不能設 per-project per-agent 的 model
  ❌ EM 調度列表是 hardcoded
```

---

## 目標架構

```
Global Layer（範本）
  data/crews/coding.*.json          ← 預設 AI Crew（範本）

Project Layer（副本 + 客製）
  {project}/.paaw/
    agents/                          ← 此 project 的 agent 副本 + 新 agent
      coding.architect.json          ← 從 global 複製，可覆寫
      coding.developer.json
      custom.reviewer.json           ← 新增的客製 agent
      _config.json                   ← crew 層級設定

    config:
      models:                        ← per-agent model
        coding.architect: "glm-5.1"
        coding.developer: "deepseek-v4-flash"
        custom.reviewer: "glm-5.1"
      fallbacks:                     ← per-agent fallback chain
        coding.architect: ["openrouter/glm-5.1"]
      nightShift:                    ← Night Shift per-agent model
        coding.architect: "deepseek-v4-flash"
        coding.developer: "deepseek-v4-flash"

    skills:                          ← per-project skills
      coding-security-audit/         ← 掛在 architect 上的 skill
      react-test-generator/          ← 掛在 tester 上
```

---

## 五大模組

### 1. 📋 Project Crew Init — 專案初始化

**觸發時機：** 使用者在 Coding App 選擇/建立 project 時

**流程：**
```
1. 偵測 {project}/.paaw/agents/ 是否存在
2. 不存在 → 從 data/crews/coding.*.json 複製一份
3. 建立 _config.json（空 models / fallbacks）
4. 之後所有 crew 讀取都從 project layer 讀
```

**資料結構 — `_config.json`：**
```json
{
  "version": 1,
  "globalCrewIds": ["coding.architect", "coding.developer", "coding.tester", "coding.doc-writer", "coding.qa", "coding.helpdesk"],
  "customAgents": [],
  "models": {
    "coding.architect": { "primary": "", "fallbacks": [] },
    "coding.developer": { "primary": "", "fallbacks": [] }
  },
  "nightShiftModels": {},
  "skillBindings": {
    "coding.architect": ["security-audit"],
    "coding.tester": ["react-test-generator"]
  }
}
```

**API：**
```
POST /api/coding-project/init-crew?path=...
  → 複製 global crew → project/.paaw/agents/
  → 回傳 crew 列表

GET /api/coding-project/crew?path=...
  → 讀 project layer 的 agent 列表
  → merge global（fallback）+ project（override）+ custom（new）

GET /api/coding-project/crew/:agentId?path=...
  → 讀單一 agent 完整定義
```

---

### 2. 🤖 Agent Management UI — 管理介面

**位置：** Coding App → 左側選單新增「👥 AI Crew」tab

**畫面佈局：**
```
┌─────────────────────────────────────────────────┐
│  👥 AI Crew — {Project Name}                    │
├──────────┬──────────────────────────────────────┤
│ Agent    │  詳細設定                             │
│ List     │                                      │
│          │  🏛️ 林曉薇 (Architect)                │
│ 🏛️ 架構師 │  Codename: Xiaowei Lin              │
│ 💻 Dev   │  Description: ...                    │
│ 🧪 Test  │                                      │
│ 📝 Docs  │  ┌─────────────────────────────┐     │
│ 🔬 QA    │  │ ⚙️ Rules (Role Prompt)       │     │
│ 🌸 Help  │  │ [可編輯的 textarea]          │     │
│ ──────── │  │                             │     │
│ ➕ 新增  │  └─────────────────────────────┘     │
│ Agent    │                                      │
│          │  ┌─────────────────────────────┐     │
│          │  │ 🧠 Context Injection         │     │
│          │  │ ☑ 專案知識 (.paaw/)         │     │
│          │  │ ☑ Feature Map               │     │
│          │  │ ☑ Coding Standards          │     │
│          │  │ ☐ Custom Context: [____]    │     │
│          │  └─────────────────────────────┘     │
│          │                                      │
│          │  ┌─────────────────────────────┐     │
│          │  │ 🔧 Skills                    │     │
│          │  │ ☑ security-audit            │     │
│          │  │ ☐ react-test-generator      │     │
│          │  │ ☐ api-docs-generator        │     │
│          │  │ ➕ 掛載更多 Skill...         │     │
│          │  └─────────────────────────────┘     │
│          │                                      │
│          │  ┌─────────────────────────────┐     │
│          │  │ 🤖 Model                     │     │
│          │  │ Primary:   [GLM 5.1      ▼] │     │
│          │  │ Fallback1: [OR-GLM 5.1   ▼] │     │
│          │  │ Fallback2: [DS V4 Flash  ▼] │     │
│          │  │ Night Shift: [DS V4 ▼]      │     │
│          │  └─────────────────────────────┘     │
│          │                                      │
│          │  ┌─────────────────────────────┐     │
│          │  │ 💾 Memory                    │     │
│          │  │ [最近的記憶條目列表]          │     │
│          │  │ ➕ 手動加入記憶              │     │
│          │  └─────────────────────────────┘     │
│          │                                      │
│          │  [💾 儲存]  [↩️ 重置為預設]           │
└──────────┴──────────────────────────────────────┘
```

**Agent List 項目：**
- 6 個預設 agent（從 global 複製）
- N 個自訂 agent（user 新增）
- 底部「➕ 新增 Agent」按鈕

**詳細設定 tab：**
1. **Rules** — 編輯 rolePrompt
2. **Context** — 勾選要注入的 context（專案知識、Feature Map 等）
3. **Skills** — 勾選可掛載的 skills
4. **Model** — Primary + Fallback + Night Shift model
5. **Memory** — 查看 / 管理 agent 記憶

---

### 3. ➕ 新增 Agent — 自訂員工

**「新增 Agent」流程：**
```
1. 點擊 ➕ → 彈出 Agent Builder
2. 填入：
   - Agent ID: custom.reviewer（或自訂）
   - 名字: 例如「張大明 Reviewer」
   - Emoji: 🔍
   - 角色: 選預設角色或自訂
   - 職責描述
3. 選 Skills: 從 Skill Pool 勾選
4. 選 Model: 預設或指定
5. 確認 → 存到 {project}/.paaw/agents/custom.reviewer.json
6. 自動出現在 AI menu + EM 可調度列表
```

**新增後自動生效：**
- Coding IDE 左側 toolbar 的 AI menu 長出新 item
- EMDashboard 的可調度列表即時更新
- EM LLM prompt 的可調度 agent 列表動態包含
- 可在 chat 中直接對話

---

### 4. 🔧 Skill 掛載 — Agent 外掛技能

**概念：**
- Skill 是「可重複使用的能力模組」
- 一個 Skill 可掛在多個 agent 上
- 一個 agent 可掛多個 Skills
- Skill 的 prompt 會注入到 agent 的 system prompt

**Skill 來源：**
```
data/skills/physical-skill/     ← 全域 Skill Pool
  translate/                     ← 翻譯技能
  help-desk/                     ← 技術支援
  techcrunch-digest/             ← 新聞摘要
  skill-creator/                 ← 建立新技能

{project}/.paaw/skills/          ← Project 專屬 Skill
  security-audit/                 ← 安全審計
  react-test-generator/           ← React 測試生成
```

**掛載後的效果：**
```
Agent system prompt =
  Base rolePrompt (from crew definition)
  + Skills prompt (from each mounted skill)
  + Context injection (feature map, coding standards, etc.)
```

**UI：**
```
🔧 Skills for coding.architect

Available Skills:
  ☑ security-audit          ← 已掛載
  ☐ api-docs-generator      ← 未掛載
  ☐ code-review-checklist
  ☐ translate

➕ 建立 Project Skill...
➕ 從 Global Pool 匯入...
```

---

### 5. 🌙 Per-Agent Model for Night Shift / EM Dispatch

**場景：** 夜間批次跑 6 個 agent，不同 agent 用不同 model 省成本。

**設定位置：** AI Crew tab → 每個 agent → Model 區塊

**三組 model 設定：**

| 場景 | 用途 | 範例 |
|------|------|------|
| **Interactive** | 聊天 / 直接對話 | GLM 5.1（要品質） |
| **EM Dispatch** | EM 調度執行 | GLM 5.1（要品質） |
| **Night Shift** | 夜間批次 | DeepSeek V4 Flash（省成本） |

**model 為空 = 用全域預設**

**成本策略範例：**
```
coding.architect   → GLM 5.1        （架構決策要品質）
coding.developer   → GLM 5.1        （寫碼要品質）
coding.tester      → DeepSeek Flash （寫測試夠用）
coding.doc-writer  → DeepSeek Flash （寫文檔夠用）
coding.qa          → GLM 5.1        （Code Review 要品質）
coding.helpdesk    → DeepSeek Flash （技術支援夠用）
custom.reviewer    → GLM 5.1        （客製 agent）
```

**EM 調度時的 model 解析：**
```
dispatch(agentId) →
  1. 查 project config models[agentId].primary
  2. 空 → 查 project config models.default
  3. 空 → 用全域 model.primary
```

---

## 資料流

### 讀取流程（Coding App 啟動時）

```
                 Global Crew                Project Crew
              data/crews/*.json         {project}/.paaw/agents/
                     │                          │
                     └─────────┬────────────────┘
                               │
                      merge & override
                               │
                     ┌─────────▼──────────┐
                     │  GET /api/         │
                     │  coding-project/   │
                     │  crew?path=...     │
                     └─────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │  統一的 crew list    │
                    │  - 6 default agents │
                    │  - N custom agents  │
                    │  - per-agent model  │
                    │  - per-agent skills │
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
     CodingIDE toolbar    EMDashboard       Night Shift
     （AI menu 長出       （可調度列表      （per-agent
      對應 agent 數量）     動態更新）        model）
```

### 寫入流程（編輯 agent 設定時）

```
User 編輯 agent →
  PATCH /api/coding-project/crew/:agentId?path=...
  Body: { rolePrompt?, models?, skillBindings?, ... }
  → 寫到 {project}/.paaw/agents/{agentId}.json
  → 或更新 _config.json
  → 回傳更新後的完整 agent 定義
  → frontend 即時刷新
```

---

## Server API 設計

```
# Crew 管理
POST   /api/coding-project/init-crew?path=...
       → 初始化 project crew（從 global 複製）

GET    /api/coding-project/crew?path=...
       → 取得 project crew（merge 後的完整列表）

GET    /api/coding-project/crew/:agentId?path=...
       → 取得單一 agent 完整定義

PATCH  /api/coding-project/crew/:agentId?path=...
       → 更新 agent（rolePrompt / model / skills / context）

POST   /api/coding-project/crew?path=...
       → 新增自訂 agent

DELETE /api/coding-project/crew/:agentId?path=...
       → 刪除自訂 agent（預設 agent 不能刪）

POST   /api/coding-project/crew/:agentId/reset?path=...
       → 重置為 global 預設

# Skill 掛載
GET    /api/coding-project/skills?path=...
       → 列出可用 Skills（global pool + project skills）

POST   /api/coding-project/crew/:agentId/skills?path=...
       → 更新 agent 的 skill 綁定

# Model 設定
PATCH  /api/coding-project/crew/:agentId/model?path=...
       → 更新 per-agent model（interactive / EM / nightShift）

# Memory
GET    /api/coding-project/crew/:agentId/memory?path=...
       → 列出 agent 記憶

POST   /api/coding-project/crew/:agentId/memory?path=...
       → 新增記憶條目
```

---

## UI 變更清單

### CodingIDE.tsx
1. `codingCrews` 從 hardcoded → `fetch('/api/coding-project/crew')`
2. 左側 toolbar AI menu 動態渲染 crew list
3. 新增「👥 AI Crew」main tab type
4. Crew tab → `CrewManager` component

### EMDashboard.tsx
1. 可調度 agent 列表從 hardcoded → API 讀取
2. EM prompt 的 agent 列表動態生成
3. 每個 task 帶上 agent 的 model 設定

### NightShiftPanel.tsx
1. 6 agent 平行 → N agent 平行（動態數量）
2. 每個 agent 用自己的 nightShift model

### 新元件
1. **CrewManager** — AI Crew 管理主頁面
2. **AgentEditor** — 單一 agent 編輯器
3. **AgentBuilder** — 新建 agent 的 wizard
4. **SkillPicker** — Skill 選擇器
5. **ModelConfig** — Per-agent model 設定

---

## 實作分 Phase

### Phase 1 — 資料層（Server）
- `init-crew` API（global → project 複製）
- `GET /crew` API（merge 讀取）
- `PATCH /crew/:agentId` API
- project crew 存讀邏輯
- ⏱️ 預估：1-2 天

### Phase 2 — UI 骨架
- CrewManager component + tab
- Agent list（唯讀）
- Agent 詳細頁（Rules / Context / Model tab）
- CodingIDE 動態讀取 crew
- ⏱️ 預估：2-3 天

### Phase 3 — Agent 編輯
- Rules textarea 編輯 + 儲存
- Model selector（interactive / EM / nightShift）
- Context 勾選
- Reset to default
- ⏱️ 預估：1-2 天

### Phase 4 — 新增 Agent
- AgentBuilder wizard
- 自訂 agent 存檔
- 自動出現在 menu + EM + chat
- ⏱️ 預估：1-2 天

### Phase 5 — Skill 掛載
- SkillPicker component
- Skill 綁定 API
- Skill prompt 注入 agent system prompt
- ⏱️ 預估：2-3 天

### Phase 6 — EM + Night Shift 整合
- EM prompt 動態讀取 project crew
- Night Shift 動態 agent 數量
- per-agent model 解析
- ⏱️ 預估：1-2 天

### Phase 7 — Memory 管理
- Agent memory viewer
- 手動加入 / 編輯記憶
- ⏱️ 預估：1 天

---

## 關鍵設計決策

### Q: 為什麼用檔案系統而不是 DB？
每個 project 的 crew 定義是**專案資產**，跟 code 一起版控。`.paaw/agents/` 進 git，團隊成員 pull 就拿到一致的 crew 設定。

### Q: Global crew 變更如何同步？
Global crew 是範本。init 時複製到 project，之後 project 有自己的副本。Global 更新不自動覆蓋 project（用 reset 按鈕手動同步）。

### Q: 自訂 agent 的 ID 規則？
`custom.{name}` — 避免跟 `coding.*` 衝突。例如 `custom.reviewer`、`custom.devops`。

### Q: Skills 如何影響 agent？
Skill 的 SKILL.md 或 prompt 段落會被注入到 agent 的 system prompt。不是 runtime 動態呼叫，是 prompt 層的增強。

### Q: per-agent model 在 EM dispatch 時怎麼傳？
`a2aCallAgent` 加上 `modelOverride` 參數。從 project crew config 讀取對應 agent 的 model。

---

## 一句話總結

> **每個 Code Project 都有一份自己的 AI Crew 副本**，可以加人、改規則、掛技能、設模型。全域 crew 是範本，project crew 是客製化。EM 調度和 Night Shift 都從 project crew 動態讀取。
