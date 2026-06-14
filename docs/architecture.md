# PAAW Architecture — Personal AI Assistant Workspace

> 設計目標：安全、可擴展、易於更新、易於分享
> 參考 OpenClaw 的設計哲學，但為 PAAW 的量級量身打造

---

## 一、核心設計原則

### 1. 安全優先 (Security by Design)

```
每一個 tool call 都是攻擊面
每一個 provider API key 都是資產
每一個 user message 都是隱私
```

- 所有外部執行（exec、fs、network）必須經過 **政策管道**
- 敏感操作必須 **用戶批准**
- API keys 必須 **加密儲存**
- 所有 tool call 必須 **可稽核**

### 2. 一切皆 Plugin (Everything is a Plugin)

OpenClaw 的 plugin 架構是我最喜歡的設計：

```
Plugin = 擁有邊界（ownership boundary）
Capability = 核心合約（core contract）

plugin 提供實作，capability 定義介面
core 不依賴特定 plugin，只依賴 capability
```

PAAW 裡的 plugin 類型：

| Type | Description | Example |
|------|-------------|---------|
| `provider` | AI 模型供應商 | Qwen, GLM, Claude |
| `tool` | 工具註冊 | app_list, translate_exec |
| `app` | 資料驅動應用 | Bookmarks, Pocket |
| `skill` | 技能腳本 | translate.SKILL.md |
| `hook` | 生命週期鉤子 | before_tool_call, after_tool_call |
| `channel` | 訊息管道 | Discord, Telegram, WebChat |
| `cli-backend` | CLI 後端 | qwen-cli, claude-code |

### 3. 套件化可分享 (Package-based Sharing)

```
一個 skill/app/tool = 一個目錄 + metadata
分享 = git push / npm publish / 目錄壓縮
匯入 = git clone / npm install / 複製目錄
```

### 4. 可更新 (Updatable)

```
Core updates → git pull / npm update
Plugin updates → per-package version management
Skills/Apps → hot-reload (不重啟 server)
```

---

## 二、整體架構圖

```
┌─────────────────────────────────────────────────────────────────────┐
│                        PAAW Gateway                                 │
│                                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │ WebChat  │  │ REST API │  │ Discord  │  │ Future Channels  │   │
│  │ (UI)     │  │ (HTTP)   │  │ (Plugin) │  │ (Plugin)         │   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────────┬─────────┘   │
│       │              │             │                  │            │
│       └──────────────┼─────────────┼──────────────────┘            │
│                      │             │                               │
│              ┌───────▼─────────────▼──────────┐                    │
│              │       Router / Dispatcher       │                   │
│              │  (chat route, agent route, etc) │                   │
│              └───────┬────────────────────────┘                    │
│                      │                                            │
│              ┌───────▼──────────────────────┐                     │
│              │      Security Kernel          │                    │
│              │  ┌────────────────────────┐   │                    │
│              │  │ Sandbox Manager         │   │                    │
│              │  │ Approval System         │   │                    │
│              │  │ Secret Store (encrypted)│   │                    │
│              │  │ Tool Policy Pipeline    │   │                    │
│              │  │ Audit Log              │   │                    │
│              │  └────────────────────────┘   │                    │
│              └───────┬──────────────────────┘                     │
│                      │                                            │
│              ┌───────▼──────────────────────┐                     │
│              │       Tool Engine             │                    │
│              │  (ReAct Loop + Streaming)     │                    │
│              └───────┬──────────────────────┘                     │
│                      │                                            │
│        ┌─────────────┼─────────────┬────────────────┐            │
│        ▼             ▼             ▼                ▼            │
│  ┌──────────┐ ┌──────────┐ ┌────────────┐ ┌──────────────┐      │
│  │Provider  │ │Tool      │ │Plugin      │ │Executor      │       │
│  │Adapters  │ │Registry  │ │System      │ │Pool          │       │
│  │(Qwen/GLM)│ │          │ │(Hooks etc) │ │(Sandboxed)   │       │
│  └──────────┘ └──────────┘ └────────────┘ └──────────────┘      │
│                      │                                            │
│        ┌─────────────┼─────────────┬────────────────┐            │
│        ▼             ▼             ▼                ▼            │
│  ┌──────────┐ ┌──────────┐ ┌────────────┐ ┌──────────────┐      │
│  │Apps      │ │Skills    │ │Crews       │ │Knowledge     │       │
│  │(data/apps)│ │(data/skills)│ │(data/crews)│ │(data/knowledge)│   │
│  └──────────┘ └──────────┘ └────────────┘ └──────────────┘      │
│                      │                                            │
│              ┌───────▼──────────────────────┐                     │
│              │    Plugin Package Manager     │                    │
│              │  (install / uninstall / update)                    │
│              └──────────────────────────────────┘                 │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 三、Security Kernel (安全核心)

這是最重要的部分。以下是逐層的安全設計。

### 3.1 Tool Policy Pipeline

每個 tool call 都要通過政策管線：

```
Tool Call Request
    │
    ▼
┌──────────────────┐
│ 1. Identity      │ ← Tool name, caller agent, session
├──────────────────┤
│ 2. Allowlist     │ ← 這個 tool 是否允許此 agent 使用？
├──────────────────┤
│ 3. Param Valid.  │ ← JSON Schema 驗證參數
├──────────────────┤
│ 4. Rate Limit    │ ← 避免濫用
├──────────────────┤
│ 5. Approval      │ ← 敏感操作需要批准？
├──────────────────┤
│ 6. Sandbox       │ ← 是否需要 sandbox 環境？
├──────────────────┤
│ 7. Audit Log     │ ← 記錄完整的 tool call 軌跡
├──────────────────┤
│ 8. Execute       │ ← 實際執行
└──────────────────┘
    │
    ▼
Tool Result
```

**實作方式：** Pipeline middleware chain，每個 stage 可以：
- `pass` → 繼續下一個
- `block(reason)` → 拒絕，回傳錯誤
- `approvalRequired()` → 暫停，等待用戶批准
- `sandboxRequired()` → 包裝 executor 在 sandbox 中執行

### 3.2 Approval System

敏感操作需要用戶確認：

```
Agent 想執行:  exec { command: "rm -rf /" }
                │
                ▼
Approval System ─→ 擱置執行
                │
                ├→ 發送 approval request 給用戶
                │  (SSE event: { type: "approval", ... })
                │
                ├→ 用戶回覆 approve / deny
                │
                ├→ approved → 繼續執行
                │
                └→ denied → 回傳 blocked
```

什麼需要 approval：
- `exec` command（尤其是 destructive 命令）
- `fs_write` / `fs_delete` (特別是系統路徑)
- `network` 對外發 request
- 任何標記為 `dangerous: true` 的 tool

### 3.3 Secret Store

API keys 不應該明文存：

```
data/config/providers.json
├─ providers:
│  ├─ zai:
│  │   apiKey: "enc:AES256:base64cipher=="  ← 加密
│  │   baseURL: https://...
│  └─ qwen:
│       apiKey: "enc:AES256:base64cipher=="  ← 加密
└─ keyring: "path/to/master.key"            ← master key 存在外面

Users/.paaw/keys/master.key (600 permission) ← 真實 master key
```

啟動時解密，運行中只保留在 memory。

### 3.4 Sandbox Manager

對於不信任的 tool 執行：

```typescript
interface SandboxPolicy {
  type: 'none' | 'exec-sandbox' | 'container' | 'chroot'
  allowedPaths?: string[]  // 白名單目錄
  allowedCommands?: string[] // 白名單指令
  maxCpu?: number
  maxMemory?: string
  maxOutput?: number  // 輸出上限
  readOnly?: boolean
  networkAccess?: boolean
  timeout?: number
}
```

**實作路徑：**
1. Phase 1: `exec` tool 用 `execOptions.security` + timeout（已有）
2. Phase 2: 用 `child_process` + `uid/gid` 隔離
3. Phase 3: 可選 container sandbox（Docker/Podman）

---

## 四、Plugin System (插件系統)

### 4.1 Plugin 格式

```
plugins/
└── <plugin-id>/
    ├── plugin.json          ← metadata
    ├── main.mjs             ← entry point
    ├── skills/              ← 可選，內含 skills
    │   └── <skill-name>/
    │       └── SKILL.md
    └── assets/              ← 可選，靜態資源
```

`plugin.json`:
```json
{
  "id": "my-plugin",
  "name": "我的插件",
  "version": "1.0.0",
  "description": "做某件事的插件",
  "author": "Fleming",
  "license": "MIT",
  "type": "tool",
  "contracts": {
    "tools": ["my_tool", "my_other_tool"],
    "hooks": ["before_tool_call"],
    "skills": ["my-skill"]
  },
  "configSchema": {
    "type": "object",
    "properties": { ... }
  },
  "entry": "./main.mjs"
}
```

### 4.2 Hook System

OpenClaw 的 hook 系統做得很好，PAAW 可以借鏡：

```typescript
// 註冊 hook
plugins.hooks.register('before_tool_call', async (ctx) => {
  if (ctx.toolName === 'exec' && ctx.params.command.includes('rm')) {
    return { blocked: true, reason: 'rm command not allowed' }
  }
  return { blocked: false }
})

// 現有的 hook point
'before_tool_call'    // tool 執行前
'after_tool_call'     // tool 執行後
'before_chat_send'    // 發送給 LLM 前
'after_chat_recv'     // 從 LLM 收到回應後
'before_agent_start'  // agent 啟動前
'on_startup'          // server 啟動時
```

### 4.3 Plugin Lifecycle

```
Install   → 下載 plugin → 驗證簽章 → 複製到 plugins/
Enable    → 讀取 plugin.json → 註冊 tools/hooks
Disable   → 取消註冊 tools/hooks
Update    → 下載新版 → 替換檔案 → 重新 Enable
Uninstall → 取消註冊 → 刪除檔案
```

---

## 五、Package Manager (套件管理員)

### 5.1 分享格式

每個 skill/app/tool 都是一個**目錄 + metadata**：

```
# 分享一個 skill
skill-translate/
├── SKILL.md              # 技能定義
├── package.json           # metadata
│   ├── name: translate
│   ├── version: 1.0.0
│   ├── paaw: { type: "skill" }
│   └── dependencies: []
└── tests/
    └── basic.json

# 分享一個 app
app-bookmarks/
├── app.json               # app 定義
├── app.html               # UI
├── package.json
│   ├── name: bookmarks
│   ├── paaw: { type: "app" }
│   └── dependencies: []
└── README.md

# 分享一個 tool plugin
tool-github/
├── plugin.json
├── main.mjs
├── package.json
└── README.md
```

### 5.2 安裝流程

```
# 從 git 安裝
paaw install git@github.com:user/paaw-skill-translate.git
paaw install https://github.com/user/paaw-skill-translate

# 從 npm 安裝（等 registry 成熟）
paaw install @paaw/skill-translate

# 從本地目錄安裝
paaw install /path/to/skill-translate

# 列出已安裝
paaw list

# 更新
paaw update translate

# 移除
paaw remove translate
```

### 5.3 Import 機制

User 可以匯入別人的 skill/app/tool：

```
1. 找到喜歡的 skill/app（Discord, GitHub, 論壇）
2. 用分享 URL 或 git clone
3. paaw install <url>
4. 立即在聊天中使用
```

---

## 六、Provider Engine (模型引擎)

### 6.1 Provider Adapter (已實作)

```typescript
interface ProviderAdapter {
  name: string
  chat(messages, tools, model): AsyncIterable<ProviderChunk>
}
```

### 6.2 Provider 管理

```
data/config/providers.json ← 配置檔
│
├─ providers:
│  ├─ zai:     { baseURL, apiKey(encrypted), defaultModel }
│  ├─ qwen:    { baseURL, apiKey(encrypted), defaultModel }
│  └─ openrouter: { ... }
│
├─ active: "zai"           ← 預設 provider
├─ defaultModel: "glm-5.1" ← 預設 model
├─ failover: ["qwen"]      ← failover 順序
└─ models:
   ├─ glm-5.1:  { provider: "zai", maxTokens: 128000 }
   └─ qwen-turbo: { provider: "qwen", maxTokens: 32000 }
```

### 6.3 Model Failover

```
嘗試 GLM 5.1
  ├─ 成功 → 使用
  └─ 失敗（rate limit / timeout / auth error）
       └─ 自動降級到 Qwen
            ├─ 成功 → 使用
            └─ 失敗 → 回報錯誤
```

---

## 七、App & Skill System (已有 + 增強)

### 7.1 App 的雙入口

- Chat 視窗 → Tool Engine → Tool Registry → 執行 app tool
- App 視窗 → 直接呼叫 app API

兩者共享同一份 data。

### 7.2 Skill 的增強

現有 skill 格式（SKILL.md）已經很好。只需要：

1. **版本化**：每個 skill 有 version field
2. **相依性**：skill 可以依賴其他 skill 或 tool
3. **測試**：每個 skill 有 test cases
4. **分享**：package.json + SKILL.md → 可分享的套件

---

## 八、Security Implementation Plan

### Phase 1 (Immediate)

| Item | Effort | Impact |
|------|--------|--------|
| API keys 加密儲存 | 小 | 高 |
| Tool call audit log | 小 | 高 |
| Tool policy pipeline | 中 | 高 |
| exec 指令 timeout + maxOutput | 小 | 中 |

### Phase 2 (Short term)

| Item | Effort | Impact |
|------|--------|--------|
| Approval system | 中 | 高 |
| Rate limiting | 中 | 中 |
| Plugin hook system | 中 | 中 |
| Skill hot-reload | 中 | 中 |

### Phase 3 (Medium term)

| Item | Effort | Impact |
|------|--------|--------|
| Container sandbox | 大 | 高 |
| Plugin marketplace | 大 | 中 |
| Skill dependency mgmt | 中 | 中 |
| User permission model | 大 | 高 |

---

## 九、立即可以開始做的事

### 優先級 1：Security Kernel

```bash
packages/server/src/lib/security/
├── index.mjs              # Security Kernel 入口
├── policy-pipeline.mjs    # Tool policy chain
├── approval.mjs           # 批准系統
├── secret-store.mjs       # 加密金鑰儲存
├── audit-log.mjs          # 稽核日誌
├── rate-limiter.mjs       # 速率限制
└── types.mjs              # 型別
```

### 優先級 2：Plugin System

```bash
packages/server/src/lib/plugins/
├── index.mjs              # Plugin Manager
├── loader.mjs             # Plugin loader
├── registry.mjs           # Plugin registry
├── hooks.mjs              # Hook system
├── package-manager.mjs    # Install/update/remove
└── types.mjs              # 型別
```

### 優先級 3：Provider Engine 增強

```bash
packages/server/src/lib/providers/
├── index.mjs              # Provider Manager
├── adapter.mjs            # Base adapter (已存在)
├── failover.mjs           # Failover logic
├── model-catalog.mjs      # Model registry
└── types.mjs              # 型別
```

---

## 十、總結：PAAW 的獨特定位

| | OpenClaw | PAAW |
|---|---|---|
| **目標用戶** | 個人/專業用戶 | 華語開發者/自造者 |
| **部署** | Node.js daemon | Node.js server + Web UI |
| **Plugin** | npm + ClawHub | git + local + npm |
| **Skill** | AgentSkills 格式 | 同左 + App Skills |
| **App** | — (無此概念) | **核心功能**：資料驅動 App |
| **Crew** | Multi-agent | AI Factory Crew |
| **安全** | 嚴謹的 threat model | 輕量但夠用 |
| **分享** | ClawHub | GitHub + Discord |

**PAAW 的殺手級功能：**
1. **App Builder** — 聊天就能建 App（OpenClaw 沒有）
2. **AI Factory** — 多 agent 協作工廠
3. **雙入口** — Chat + App Window 都能用
4. **華語原生** — prompt / skill / 文件都中文

OpenClaw 有一套非常成熟的 plugin 和安全架構可以參考，但 PAAW 的創新在 **App + Skill + Crew 的整合**，這才是 PAAW 的價值。

---

*版本：2026-06-13 | Draft v1*
