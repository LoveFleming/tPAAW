# PAAW Runbook

> **PAAW — Personal AI Assistant Workspace**
> 營運操作手冊：安裝、部署、日常操作、監控、故障排除、備份還原
>
> Repo: `LoveFleming/tPAAW` · Branch: `dev`
> 最後更新：2026-07-05

---

## 目錄

1. [系統概覽](#1-系統概覽)
2. [環境需求](#2-環境需求)
3. [安裝與設定](#3-安裝與設定)
4. [啟動與停止](#4-啟動與停止)
5. [部署模式](#5-部署模式)
6. [日常操作](#6-日常操作)
7. [備份與還原](#7-備份與還原)
8. [監控與健康檢查](#8-監控與健康檢查)
9. [故障排除](#9-故障排除)
10. [組態設定參考](#10-組態設定參考)
11. [安全注意事項](#11-安全注意事項)
12. [常用 curl 速查](#12-常用-curl-速查)

---

## 1. 系統概覽

PAAW 是單機部署的 AI 助理工作平台，核心元件：

| 元件 | Port | 說明 |
|------|------|------|
| HTTP Server (API + 靜態 UI) | `4097` | REST API、SSE 串流、Production 時 serve UI |
| WebSocket Server | `4098` | PTY 終端機、AgentConsole 雙向串流 |
| Bridge Server (Docker 模式) | `4100` | 容器安全守門員、Tool Proxy |
| Vite Dev Server (開發模式) | `5173` | 前端 hot-reload dev server |

**架構：**
```
┌──────────────┐     HTTP/WS/SSE      ┌──────────────┐
│  React UI    │ ←──────────────────→ │  Node Server │ ←→ data/ (JSON + MD)
│  (Vite/Dist) │                      │  (4097/4098) │ ←→ LLM API (zai/OpenRouter)
└──────────────┘                      └──────────────┘
```

**資料儲存：** 全部在 `data/` 目錄（JSON + Markdown 檔案），少量 SQLite。

---

## 2. 環境需求

| 項目 | 最低需求 | 建議 |
|------|---------|------|
| **Node.js** | v20+ | v22+ |
| **OS** | macOS / Linux / Windows (WSL) | macOS / Linux |
| **npm** | v10+ | v10+ |
| **磁碟** | 500MB（不含 data） | 2GB+ |
| **RAM** | 512MB | 2GB+ |
| **LLM API** | 任一 OpenAI-compatible provider | zai GLM 5.1 + OpenRouter fallback |

### 必裝系統依賴

```bash
# macOS
xcode-select --install        # Xcode Command Line Tools
brew install node             # Node.js

# Ubuntu/Debian
sudo apt install -y nodejs npm build-essential python3

# Git（所有平台）
git --version                 # 確認已安裝
```

### 可選系統依賴

| 工具 | 用途 | 安裝 |
|------|------|------|
| Docker | Docker 部署模式 | [docker.com](https://docker.com) |
| `node-pty` 終端機 | 已含在 npm install | 自動編譯 |

---

## 3. 安裝與設定

### 3.1 Clone Repository

```bash
git clone https://github.com/LoveFleming/tAgent.git
cd tAgent
git checkout dev
```

### 3.2 安裝依賴

```bash
npm install
```

> `postinstall` script 會自動偵測環境並設定 `node-pty`。

### 3.3 設定 LLM Provider

編輯 `data/config/providers.json`：

```json
{
  "active": "zai",
  "defaultModel": "glm-5.1",
  "providers": {
    "zai": {
      "name": "ZhipuAI",
      "baseURL": "https://open.bigmodel.cn/api/paas/v4",
      "apiKey": "你的-API-KEY",
      "models": ["glm-5.1", "glm-4-flash"]
    },
    "openrouter": {
      "name": "OpenRouter",
      "baseURL": "https://openrouter.ai/api/v1",
      "apiKey": "你的-OPENROUTER-KEY",
      "models": ["z-ai/glm-5.1", "deepseek/deepseek-v4-flash"]
    }
  }
}
```

> ⚠️ **API Key 安全**：`providers.json` 包含明文金鑰，確認 `.gitignore` 已排除 `data/`。

### 3.4 設定使用者資訊

編輯 `data/config/user.json`：

```json
{
  "name": "你的名字",
  "assistantName": "AI 助理名稱",
  "preferences": {
    "chat": "glm-5.1",
    "skillBuilder": "glm-5.1",
    "appBuilder": "glm-5.1",
    "coding": "glm-5.1"
  }
}
```

### 3.5 環境變數（可選）

複製 `.env.example` 為 `.env`：

```bash
cp .env.example .env
```

| 變數 | 預設 | 說明 |
|------|------|------|
| `PAAW_PORT` | `4097` | API + UI port |
| `PAAW_WS_PORT` | `4098` | WebSocket port |
| `PAAW_ROOT` | 自動偵測 | 資料根目錄 |
| `NODE_ENV` | `development` | `production` 時 serve UI dist |
| `BRIDGE_TOKEN` | — | Docker Bridge 認證 token |
| `BACKUP_INTERVAL_MS` | `1800000` | 自動備份間隔（30 分鐘） |

### 3.6 驗證安裝

```bash
# 確認套件安裝成功
ls node_modules/.package-lock.json

# 確認 PAAW_ROOT 偵測正確
node -e "console.log(require('path').resolve('.'))"
```

---

## 4. 啟動與停止

### 4.1 開發模式（UI + API 同時）

```bash
npm run dev
```

啟動後：
- **UI**: http://localhost:5173（Vite hot-reload）
- **API**: http://localhost:4097

> 兩個 process 同時跑，UI 透過 Vite proxy 連 API。

### 4.2 分別啟動

```bash
npm run dev:ui       # 只跑前端 (port 5173)
npm run dev:server   # 只跑後端 (port 4097 + 4098)
```

### 4.3 Production 模式

```bash
# 建構 UI
npm run build

# 啟動 server（同時 serve UI dist）
NODE_ENV=production npm run dev:server
# → http://localhost:4097 (API + UI 同一個 port)
```

### 4.4 停止

| 模式 | 停止方式 |
|------|---------|
| `npm run dev` | `Ctrl+C`（concurrently 會同時終止兩個 process） |
| `npm run dev:server` | `Ctrl+C` |
| Background (`&` 或 PM2) | `kill $(lsof -ti :4097)` |
| Docker | `docker compose down` |

### 4.5 驗證啟動成功

```bash
# API server 存活
curl http://localhost:4097/api/apps
# → [{"id":"pocket",...}]

# Provider 設定
curl http://localhost:4097/api/paaw/providers
# → {"active":"zai","providers":{...}}

# WebSocket port 確認
lsof -i :4098
# → node ... LISTER
```

---

## 5. 部署模式

### 5.1 本機直接部署（推薦：個人使用）

```bash
npm install
npm run build
NODE_ENV=production node packages/server/src/paaw-server.mjs
```

**優點**：簡單、低延遲、完整檔案系統存取
**缺點**：無隔離、AI agent 可能修改系統檔案

### 5.2 Docker 部署（含 Bridge 安全隔離）

```bash
# 設定 Bridge token
echo "BRIDGE_TOKEN=your-secret-token" >> .env

# 啟動 Docker sandbox + Bridge
npm run dev:bridge

# 或用 docker compose
docker compose up -d
```

**Bridge 架構**：
```
Host (macOS/Linux)                Docker Container
┌─────────────────┐              ┌─────────────────┐
│  PAAW Server    │  ← sync →    │  Sandbox        │
│  (port 4097)    │              │  (受限環境)      │
│  Bridge         │  ← tool →    │  AI Agent 在這  │
│  (port 4100)    │   proxy      │  執行 bash 等   │
└─────────────────┘              └─────────────────┘
```

- AI Agent 在容器內執行 bash/read/write
- 敏感操作透過 Tool Proxy 向 Bridge 請求
- 容器內修改需經 sync approval 才會寫回 host

### 5.3 PM2 持久化（可选）

```bash
npm install -g pm2

# 啟動
pm2 start packages/server/src/paaw-server.mjs --name paaw-server
pm2 start npm --name paaw-ui -- run dev:ui   # 若需分開跑

# 設定開機自動啟動
pm2 save
pm2 startup
```

**PM2 常用指令**：

```bash
pm2 status              # 查看狀態
pm2 logs paaw-server    # 查看日誌
pm2 restart paaw-server # 重啟
pm2 stop paaw-server    # 停止
```

### 5.4 macOS launchd（可选）

建立 `~/Library/LaunchAI/app.paaw.plist`：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>app.paaw</string>
  <key>ProgramArguments</key>
  <array>
    <string>node</string>
    <string>/path/to/tPAAW/packages/server/src/paaw-server.mjs</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key><string>production</string>
    <key>PAAW_PORT</key><string>4097</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAI/app.paaw.plist
```

---

## 6. 日常操作

### 6.1 建立 Skill

1. 開啟 Dashboard → **Skill Builder**
2. 填入 Skill 名稱、目的、Inputs、Script 等
3. 點 **Build** → AI 產出 `SKILL.md`
4. 點 **Test** → 驗證 Skill 行為
5. 產出檔案位置：`data/skills/building/{slug}/`

### 6.2 建立 App

1. Dashboard → **App Builder**（聊天介面）
2. 描述你要的 App：「我要一個記帳 App，欄位有日期、金額、類別、備註」
3. AI 產出 `app.json` + UI
4. App 自動成為 Chat Tool（聊天中可叫用）

**手動建立 App**：在 `data/apps/{app-id}/` 建立 `app.json`：

```json
{
  "id": "my-app",
  "name": "我的記事本",
  "dataShape": "array",
  "schema": {
    "title": { "type": "string", "required": true },
    "content": { "type": "string" },
    "tags": { "type": "array", "items": { "type": "string" } }
  }
}
```

### 6.3 建立 Crew（AI 員工）

1. Dashboard → **AI Crew**
2. 選擇現有 Crew 或新增
3. 設定角色、rolePrompt、綁定 Skill
4. 進入 Employee Workspace 可直接對話

Crew JSON 格式（`data/crews/{id}.json`）：

```json
{
  "id": "06-ai.writer",
  "name": "寫作助手",
  "rolePrompt": "你是一個專業寫作助手...",
  "skills": ["translate", "summarize"],
  "model": "glm-5.1"
}
```

### 6.4 建立 Cron Job

1. Dashboard → **Cron Jobs** → **New**
2. 選擇類型：
   - **Reminder** — 定時提醒
   - **Skill** — 排程執行 Skill
   - **Workflow** — 排程執行 Workflow
3. 設定 cron expression（下方有範例）
4. 設定 output target（chat 或 file）

**Cron Expression 範例**：

| Expression | 意思 |
|------------|------|
| `0 9 * * *` | 每天早上 9:00 |
| `0 9 * * 1` | 每週一 9:00 |
| `*/30 * * * *` | 每 30 分鐘 |
| `0 0,12 * * *` | 每天 0:00 和 12:00 |
| `0 9 1 * *` | 每月 1 號 9:00 |
| `0 18 * * 1-5` | 平日（週一到週五）18:00 |

### 6.5 執行 Workflow

1. Dashboard → **Workflow Editor**
2. 編輯 Workflow JSON（定義 steps，每個 step 是一個 Skill exec）
3. 存檔後到 **Workflow Exec** 頁面執行
4. 每步驟的結果會逐步顯示

### 6.6 編輯 AI Settings

Dashboard → **AI Settings**，可線上編輯所有 prompt 規則檔：

| 分類 | 檔案 | 影響 |
|------|------|------|
| Chat | `identity.md` | AI 人設、名字、語氣 |
| Chat | `tool-rules.md` | 工具使用規則 |
| Chat | `guardrails.md` | 安全限制 |
| Chat | `reply-rules.md` | 回覆格式 |
| Skill Builder | `builder-rules.md` | Skill 建構規則 |
| App Builder | `app-builder-rules.md` | App 建構規則 |

### 6.7 切換 AI Provider / Model

**前端操作**：
1. Settings → 供應商 → 新增/編輯 provider
2. 在各功能頁面用 🤖 ModelSelector 切換 model

**手動操作**：編輯 `data/config/providers.json` 的 `active` 欄位

---

## 7. 備份與還原

### 7.1 自動備份

PAAW 內建自動備份，預設每 30 分鐘。

**設定**（`data/config/backup.json`）：

```json
{
  "enabled": true,
  "interval": 1800000,
  "maxBackups": 20,
  "backupDir": "/path/to/backups"
}
```

**API 操作**：

```bash
# 取得備份設定
curl http://localhost:4097/api/backup/config

# 更新備份設定
curl -X PUT http://localhost:4097/api/backup/config \
  -H "Content-Type: application/json" \
  -d '{"enabled":true,"interval":3600000,"maxBackups":30}'

# 立即備份
curl -X POST http://localhost:4097/api/backup/run

# 列出所有備份
curl http://localhost:4097/api/backup/list

# 從備份還原
curl -X POST http://localhost:4097/api/backup/restore \
  -H "Content-Type: application/json" \
  -d '{"id":"backup-20260705-000000"}'

# 刪除備份
curl -X DELETE "http://localhost:4097/api/backup/delete?id=backup-20260705-000000"
```

### 7.2 手動備份

```bash
# 完整備份（含所有 data + ai-settings）
cd /Users/steward/App/tPAAW
tar -czf ~/paaw-backup-$(date +%Y%m%d-%H%M%S).tar.gz data/ packages/db/data/

# 只備份 data/
tar -czf ~/paaw-data-$(date +%Y%m%d).tar.gz data/
```

### 7.3 Git 作為版本控制備份

```bash
# 在 PAAW 目錄
git add data/
git commit -m "backup: $(date +%Y-%m-%d)"
git push origin dev
```

> ⚠️ 確認 `.gitignore` 排除了 `data/config/providers.json`（含 API key）或整個 repo 是 private。

### 7.4 還原

```bash
# 停止 server
# npm run dev 的話 Ctrl+C

# 還原 data/
tar -xzf ~/paaw-backup-20260705-000000.tar.gz

# 重啟
npm run dev
```

### 7.5 備份內容

自動備份包含以下目錄：

| 目錄 | 內容 | 重要度 |
|------|------|--------|
| `data/apps/` | App 定義 | 🔴 高 |
| `data/app-data/` | App 資料 | 🔴 高 |
| `data/skills/` | Skill 定義 | 🔴 高 |
| `data/crews/` | Crew 定義 | 🔴 高 |
| `data/chats/` | 聊天歷史 | 🟡 中 |
| `data/ai-settings/` | AI 規則檔 | 🔴 高 |
| `data/config/` | 系統設定 | 🔴 高 |
| `data/knowledge/` | 知識庫 | 🟡 中 |
| `data/notes/` | 筆記 | 🟡 中 |
| `data/projects/` | 專案 | 🟡 中 |
| `data/cron/` | 排程定義 | 🟡 中 |
| `data/workflows/` | Workflow 定義 | 🟡 中 |

---

## 8. 監控與健康檢查

### 8.1 健康檢查 curl

```bash
# Server 是否存活
curl -s http://localhost:4097/api/apps | python3 -c "import sys,json; print(f'✅ Server OK — {len(json.load(sys.stdin))} apps')"

# Provider 設定是否正確
curl -s http://localhost:4097/api/paaw/providers | python3 -c "
import sys,json
d=json.load(sys.stdin)
p=d['providers'].get(d['active'])
has_key = bool(p and p.get('apiKey') and p['apiKey']!='na')
print(f'Provider: {d[\"active\"]}, Model: {d.get(\"defaultModel\",\"?\")}, Key: {\"✅\" if has_key else \"❌\"}')"

# WebSocket port
lsof -i :4098 >/dev/null 2>&1 && echo "✅ WS OK" || echo "❌ WS not running"
```

### 8.2 日誌位置

| 日誌 | 位置 | 說明 |
|------|------|------|
| Server stdout | Terminal（執行 `npm run dev` 的視窗） | 所有 console.log |
| Coding IDE session | `logs/vibe-sessions/` | Agent Loop 互動記錄 |
| Cron 執行 | `logs/cron/` | 排程執行日誌 |
| Distill 記錄 | `data/distill/` | AI 對話蒸餾摘要 |
| Debug payload | `temp/payload-*.json` | LLM API 完整 request payload |
| Debug stream | `temp/stream-*.log` | LLM 串流 raw log |

> ⚠️ `temp/` 不應 commit，確認 `.gitignore` 有排除。

### 8.3 系統資源監控

```bash
# PAAW process 記憶體用量
ps aux | grep "paaw-server" | grep -v grep

# 磁碟空間（data 目錄大小）
du -sh data/

# 連線數
lsof -i :4097 | wc -l
```

### 8.4 Dashboard Monitoring 頁面

PAAW 內建 Monitoring 頁面（Dashboard 左側欄），顯示：
- Server uptime
- 記憶體使用
- API 呼叫統計
- Active WebSocket connections

---

## 9. 故障排除

### 9.1 快速排查表

| 問題 | 可能原因 | 檢查 | 解法 |
|------|---------|------|------|
| **Chat 沒回應** | API key 未設定/失效 | `curl localhost:4097/api/paaw/providers` | 設定有效的 API key |
| **Chat 回空白** | LLM 限流或空回應 | 看 server console `[chat]` logs | 等待 retry 或換 provider |
| **WebSocket 連不上** | Port 4098 未開 | `lsof -i :4098` | 重啟 server |
| **Port 已被佔用** | 舊 process 未結束 | `lsof -i :4097` | `kill $(lsof -ti :4097)` |
| **App 工具不見** | app.json 格式錯誤 | `cat data/apps/*/app.json` | 修正 JSON 格式 |
| **Context 空白** | ai-settings .md 遺失 | `ls data/ai-settings/chat/` | 從 backup 還原 |
| **Agent Loop 卡住** | maxTurns/timeout 設太小 | `cat data/ai-settings/agent-config.json` | 調大 maxTurns |
| **Cron 不執行** | cron job disabled | 查看 Cron Jobs 頁面 | 啟用 job |
| **DB 損壞** | SQLite 檔損壞 | `ls data/db/` | 刪除 `.sqlite` 重新 migrate |
| **UI 空白** | 未 build 或 dist 不存在 | `ls packages/ui/dist/` | `npm run build` |
| **SSE 中斷** | Proxy buffer 問題 | 看 server console | 加 `X-Accel-Buffering: no` header |

### 9.2 LLM API 問題

**症狀：Chat 完全沒回應或回 error**

```bash
# 1. 確認 provider 設定
curl -s http://localhost:4097/api/paaw/providers | python3 -m json.tool

# 2. 確認 API key 有效（手動測試）
curl -s https://open.bigmodel.cn/api/paas/v4/chat/completions \
  -H "Authorization: Bearer 你的KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"glm-5.1","messages":[{"role":"user","content":"hi"}]}' | head -20

# 3. 查看 debug payload
ls -la temp/payload-*.json 2>/dev/null | tail -3
cat temp/payload-*.json 2>/dev/null | python3 -m json.tool | tail -30
```

**常見 LLM 錯誤**：

| HTTP Status | 意思 | 處理 |
|-------------|------|------|
| 401 | API key 無效 | 換正確的 key |
| 429 | 限流 | 等 retry 或換 provider |
| 500/502/503 | Provider 伺服器問題 | 等 retry 或換 provider |
| Timeout | 網路問題或 prompt 太長 | 縮短輸入 |

PAAW 內建 retry 機制（最多 5 次，exponential backoff 2s~30s），輕微問題會自動恢復。

### 9.3 WebSocket 問題

```bash
# 確認 WS server 在跑
lsof -i :4098

# 手動測試 WS（需 wscat）
npx wscat -c ws://localhost:4098

# 重啟 server
kill $(lsof -ti :4097 -ti :4098)
npm run dev
```

### 9.4 檔案系統問題

```bash
# data/ 目錄權限
ls -la data/

# 修復權限
chmod -R u+rwX data/

# 確認磁碟空間
df -h .

# 找出大檔案
du -sh data/*/ | sort -rh | head -10
```

### 9.5 DB Migration 問題

```bash
# 重新跑 migration
npm run migrate

# 如果 DB 損壞，備份後重建
cp data/db/paaw.sqlite data/db/paaw.sqlite.bak
rm data/db/paaw.sqlite
npm run migrate
```

### 9.6 Clear Cache / Reset

```bash
# 清除 debug temp
rm -rf temp/

# 清除 distill（AI 對話摘要）
rm -rf data/distill/*

# 清除 logs
rm -rf logs/*
```

> ⚠️ 不要刪除 `data/config/`、`data/apps/`、`data/skills/`、`data/crews/`、`data/ai-settings/`！

---

## 10. 組態設定參考

### 10.1 關鍵設定檔一覽

| 檔案 | 用途 | 格式 |
|------|------|------|
| `data/config/providers.json` | LLM Provider 設定 | JSON |
| `data/config/user.json` | 使用者資訊 + model 偏好 | JSON |
| `data/config/ui-state.json` | UI 狀態 | JSON |
| `data/config/backup.json` | 備份設定 | JSON |
| `data/ai-settings/agent-config.json` | Agent Loop 參數 | JSON |
| `data/workspaces.json` | Workspace 目錄清單 | JSON |
| `data/cron/cron-jobs.json` | Cron Job 定義 | JSON |
| `.env` | 環境變數 | KEY=VALUE |

### 10.2 Agent Config（`data/ai-settings/agent-config.json`）

```json
{
  "maxTurns": 100,
  "timeoutSeconds": 1800,
  "bashTimeoutSeconds": 300,
  "shellTimeoutMs": 600000
}
```

| 參數 | 預設 | 說明 |
|------|------|------|
| `maxTurns` | 100 | Agent Loop 最大 tool-call 輪數 |
| `timeoutSeconds` | 1800 | 整個 Agent 執行逾時（30 分鐘） |
| `bashTimeoutSeconds` | 300 | 單次 bash 命令逾時（5 分鐘） |
| `shellTimeoutMs` | 600000 | Shell 執行總逾時（10 分鐘） |

### 10.3 AI Settings 目錄結構

```
data/ai-settings/
├── _base/              — 核心規則（所有功能共用）
│   ├── core-rules.md
│   └── paaw-context.md
├── chat/               — Chat 規則
│   ├── identity.md     — AI 人設
│   ├── tool-rules.md   — 工具規則
│   ├── guardrails.md   — 安全限制
│   ├── system-prompt.md— 行為規範
│   └── reply-rules.md  — 回覆格式
├── skill-builder/      — Skill Builder 規則
├── crew/               — Crew 規則
├── app-builder/        — App Builder 規則
├── mindmap/            — 心智圖規則
├── notes/              — 筆記規則
├── project/            — 專案 AI 規則
├── distill/            — 蒸餾器規則
└── agent-config.json   — Agent Loop 參數
```

### 10.4 i18n 語系

4 個 locale 檔在 `packages/ui/src/i18n/locales/`：

| 檔案 | 語言 |
|------|------|
| `zh.json` | 繁體中文 |
| `en.json` | 英文 |
| `ja.json` | 日文 |
| `zh-mix.json` | 中英混合 |

> 新增 UI 字串時，4 個 locale 檔都要加 key。

---

## 11. 安全注意事項

### 11.1 已知風險

| 風險 | 說明 | 緩解 |
|------|------|------|
| 無認證 | API 完全開放，CORS = `*` | 僅在本機/內網使用 |
| API Key 明文 | `providers.json` 含明文 key | `.gitignore` 排除、repo 設為 private |
| AI 可執行 bash | Agent Loop 有 bash tool | Docker 模式隔離、Security Kernel 攔截 |
| 無 ACID | JSON 檔案讀寫無鎖 | 單人使用避免併發 |

### 11.2 安全建議

1. **不要暴露到公網**：PAAW 設計為本機使用，port 4097/4098 不應對外開放
2. **repo 設為 private**：`LoveFleming/tPAAW` 已是 private，確認勿改為 public
3. **Docker 模式**：在容器內執行 AI bash 命令，避免直接操作 host
4. **定期備份**：啟用自動備份，確認 `backups/` 目錄有足夠空間
5. **`providers.json` 不 commit**：確認在 `.gitignore` 中

### 11.3 Security Kernel

PAAW 內建 Security Kernel（`packages/server/src/lib/security/`），每次 tool call 前檢查：
- Policy Pipeline — 規則匹配
- Approval — 需要人工審核的操作
- Audit — 操作日誌
- Secret Store — 敏感資料保護

---

## 12. 常用 curl 速查

```bash
# ── 基本存活檢查 ──
curl http://localhost:4097/api/apps
curl http://localhost:4097/api/paaw/providers
curl http://localhost:4097/api/paaw/chats

# ── System Prompts ──
curl http://localhost:4097/api/system-prompts

# ── User Preferences ──
curl http://localhost:4097/api/user/preferences

# ── Agent Config ──
curl http://localhost:4097/api/ai-settings/agent-config

# ── Skills / Apps / Crews ──
curl http://localhost:4097/api/skills
curl http://localhost:4097/api/apps
curl http://localhost:4097/api/crews
curl http://localhost:4097/api/workflows

# ── Context（看完整 systemPrompt）──
curl http://localhost:4097/api/context/chat
curl http://localhost:4097/api/context/skill-builder
curl http://localhost:4097/api/context/crew

# ── 備份 ──
curl -X POST http://localhost:4097/api/backup/run
curl http://localhost:4097/api/backup/list

# ── 檔案操作 ──
curl "http://localhost:4097/api/paaw-root"          # 取得 PAAW_ROOT
curl "http://localhost:4097/api/vibe-fs/list?path=data/apps"  # 列目錄
```

---

## 附錄：版本與更新

| 日期 | 版本 | 變更 |
|------|------|------|
| 2026-07-05 | v1.0 | 初始版本 |

---

> **一句話**：PAAW 是你的 AI 工作平台，這份 Runbook 讓你在出問題時不會手忙腳亂。
