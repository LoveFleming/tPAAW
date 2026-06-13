# PAAW Architecture TODO

> 最後更新：2026-06-13
> 搭配 docs/architecture.md 閱讀

---

## Phase 1 — 基礎安全（已完成 ✅）

- [x] 架構設計文件 `docs/architecture.md`
- [x] Tool Engine（ReAct loop + streaming）
- [x] Provider Adapter（OpenAI-compatible，Qwen/GLM/DeepSeek）
- [x] Tool Registry（統一註冊與執行）
- [x] Chat Route 改寫（接入 Tool Engine）
- [x] Security Kernel — Policy Pipeline（3 個內建政策）
- [x] Security Kernel — Approval System
- [x] Security Kernel — Secret Store（AES-256-GCM）
- [x] Security Kernel — Audit Log
- [x] TypeScript 型別定義（engine/src/tool-engine/）

---

## Phase 2 — Plugin System（下一步）

### 2.1 Plugin Loader
- [ ] 定義 plugin 格式（plugin.json + main.mjs）
- [ ] Plugin loader — 掃描 `plugins/` 目錄，載入 plugin
- [ ] Plugin 生命週期管理（install → enable → disable → uninstall）
- [ ] Plugin 驗證（schema 校驗、基本安全性檢查）

### 2.2 Hook System
- [ ] Hook 註冊介面（`on(hookName, handler)`）
- [ ] Hook 點定義：
  - `before_tool_call` — tool 執行前（可攔截/修改參數）
  - `after_tool_call` — tool 執行後（可修改結果）
  - `before_chat_send` — 發送給 LLM 前
  - `after_chat_recv` — 收到 LLM 回應後
  - `on_startup` — server 啟動時
  - `on_shutdown` — server 關閉時
- [ ] Hook 執行順序（priority）
- [ ] 整合進 Tool Engine（tool call 前後觸發 hook）

### 2.3 Plugin Registry
- [ ] 已安裝 plugin 清單 API（`GET /api/plugins`）
- [ ] 啟用/停用 plugin API（`POST /api/plugins/:id/enable`）
- [ ] Plugin 配置 API（讀取/更新 plugin config）

---

## Phase 3 — Provider Engine 增強

### 3.1 Model Failover
- [ ] Failover 邏輯（GLM → Qwen → DeepSeek 自動降級）
- [ ] Failover 觸發條件（rate limit / timeout / auth error / billing error）
- [ ] Failover 紀錄（audit log）

### 3.2 Model Catalog
- [ ] Model registry（名稱 → provider + maxTokens + capabilities）
- [ ] Model alias（`glm-5.1` = `zai/glm-5.1`）
- [ ] Model 能力標記（tool_call, vision, streaming）
- [ ] `/api/models` API（列出可用 models）

### 3.3 Provider 管理
- [ ] Provider 健康檢查（定期 ping）
- [ ] Provider 統計（latency、token usage、error rate）
- [ ] Provider 配置 API（`GET/PUT /api/providers`）
- [ ] API key 加密遷移（明文 → Secret Store 加密格式）

---

## Phase 4 — Package Manager

### 4.1 套件格式
- [ ] 定義統一 package.json 格式（`paaw.type: skill | app | tool | plugin`）
- [ ] 版本號規範（semver）
- [ ] 相依性宣告（`dependencies: [...]`）

### 4.2 Install / Update / Remove
- [ ] `paaw install <git-url>` — 從 git 安裝
- [ ] `paaw install <local-path>` — 從本地目錄安裝
- [ ] `paaw list` — 列出已安裝
- [ ] `paaw update <name>` — 更新
- [ ] `paaw remove <name>` — 移除
- [ ] 安裝後自動 reload（不需重啟 server）

### 4.3 Share / Export
- [ ] `paaw pack <name>` — 打包成可分享的目錄/tarball
- [ ] `paaw publish` — 推到 git repo（初期用 GitHub）
- [ ] README template（讓每個 skill/app 都有說明文件）

---

## Phase 5 — 安全增強

### 5.1 Sandbox Manager
- [ ] Sandbox policy 定義（allowedPaths, allowedCommands, networkAccess, timeout）
- [ ] exec tool sandbox — 限制可執行的命令白名單
- [ ] fs tool sandbox — 限制可存取的目錄
- [ ] Container sandbox（長期，Docker/Podman 可選）

### 5.2 Rate Limiter
- [ ] Per-tool rate limit（每個 tool 獨立計數）
- [ ] Per-session rate limit（每個 session 獨立計數）
- [ ] Token bucket 或 sliding window 實作
- [ ] 超限回應格式（告訴 LLM 等一下再試）

### 5.3 Permission Model
- [ ] 定義 permission levels（admin / user / guest）
- [ ] Agent 能力白名單（哪個 agent 可以用哪些 tool）
- [ ] 路徑權限（哪個 agent 可以存取哪些目錄）

---

## Phase 6 — 架構優化（長期）

### 6.1 Session Isolation
- [ ] 獨立 session context（不同聊天不同 history）
- [ ] Session 繫結 agent（每個 session 可以有不同的 agent/model/tools）
- [ ] Session 持久化（重啟不遺失）

### 6.2 Subagent System
- [ ] Agent spawn（主 agent 可以生成子 agent）
- [ ] 子 agent 能力繼承（可選）
- [ ] 子 agent 結果回報
- [ ] 子 agent 生命週期管理

### 6.3 TypeScript Migration
- [ ] server 從 `.mjs` 遷移到 `.ts`
- [ ] engine/src/tool-engine/ TypeScript 版本正式啟用
- [ ] shared 型別完善
- [ ] Build pipeline（tsx / tsup / tsc）

---

## 執行順序建議

```
Phase 2 (Plugin System)     ← 現在做這個
  ↓
Phase 3 (Provider Engine)   ← 第二優先
  ↓
Phase 4 (Package Manager)   ← 有了 plugin 後才能做好
  ↓
Phase 5 (安全增強)           ← 持續強化
  ↓
Phase 6 (架構優化)           ← 長期目標
```

---

## 相關檔案位置

```
docs/
├── architecture.md              ← 架構設計文件
└── arch-todo.md                 ← 本文件

packages/server/src/lib/
├── tool-engine/                 ← Tool Engine
│   ├── index.mjs
│   ├── provider.mjs
│   └── tool-registry.mjs
└── security/                    ← Security Kernel
    ├── index.mjs
    ├── policy-pipeline.mjs
    ├── approval.mjs
    ├── secret-store.mjs
    └── audit-log.mjs

packages/engine/src/tool-engine/ ← TypeScript 版本（待啟用）
```
