# PAAW Runtime Context

> 本檔案由 PAAW 系統使用，描述執行環境的基本資訊。每個 AI request 都會帶上這份內容。

## 資料路徑

| 路徑 | 用途 |
|---|---|
| `data/apps/` | App 定義（app.json） |
| `data/apps/{appId}/skills/` | App 的 Skill 定義（SKILL.md） |
| `data/apps/{appId}/app.html` | App 的 UI |
| `data/app-data/{appId}.json` | App 的使用者資料 |
| `data/skills/input-prompt/` | 已發佈的 Skill（純 prompt 類） |
| `data/skills/physical-skill/` | 已發佈的實體 Skill（含 CLI script） |
| `data/skills/building/` | Skill 原始碼（building 階段，發佈後保留） |
| `data/skills/pool/` | 共用 Skill 庫 |
| `data/ai-settings/` | AI 設定（本檔案所在） |
| `data/crews/` | AI Crew 定義 |
| `data/chats/` | 聊天記錄 |
| `data/config/` | 系統設定 |
| `data/knowledge/` | 知識庫（使用者可放入參考文件） |
| `data/distill/knowledge/` | 自動蒸餾的知識 |
| `data/config/distilled-memory/` | 蒸餾記憶（聊天摘要） |

## Workspace 目錄

AI 可以讀寫的目錄（透過 `/api/workspaces` 取得完整列表）：

- `data/apps/` — 建立和修改 App
- `data/skills/` — 建立和修改 Skill
- `data/knowledge/` — 讀寫知識庫
- `data/ai-settings/` — 讀寫 AI 設定
- 使用者自訂的 workspace 目錄（記錄在 `data/config/workspaces.json`）

## Placeholder

Crew 的 rolePrompt 和 AI 設定中可使用以下 placeholder：

| Placeholder | 替換為 |
|---|---|
| `{{assistantName}}` | Crew 的顯示名稱 |
| `{{nickname}}` | Crew 的代號（codename） |
| `{{appId}}` | 目前操作的 App ID |
| `{{crewId}}` | 目前所屬的 Crew ID |

## Skill 生命週期

```
building/          → SkillBuilder 建構中（source code）
  ↓ 按「發佈」
input-prompt/      → 已發佈，Crew 可選用，純 prompt 定義
physical-skill/    → 已發佈，含完整 deterministic script
pool/              → 共用 Skill，所有 Crew 都能引用
```

## App 類型

| 類型 | 說明 | 自動產生的 Tool |
|---|---|---|
| Data App | 純資料管理 | `{appId}_add`, `_list`, `_get`, `_update`, `_delete` |
| Skill-based App | AI 執行任務 | `{appId}_exec` |
| 混合型 | 兩者都有 | 全部上述 tool |

## CLI 工具

PAAW 可用的 CLI（Skill 執行時可能呼叫）：

- `qwen` — Qwen Code CLI
- `claude` — Claude Code CLI
- `opencode` — OpenCode CLI
