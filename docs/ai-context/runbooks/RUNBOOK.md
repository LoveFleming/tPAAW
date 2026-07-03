# Runbook

> 所有指令都可在 repo 內實際執行驗證

## 啟動

```bash
cd /Users/steward/App/tAgent

# 開發模式（UI + API 同時）
npm run dev

# 分別啟動
npm run dev:ui      # Vite dev server (port 5173)
npm run dev:server  # PAAW server (port 4097)

# Bridge（Docker 模式）
npm run dev:bridge   # Bridge server (port 4100)
```

> 驗證 scripts 存在：`grep "dev\|dev:ui\|dev:server\|dev:bridge" package.json`

## Build

```bash
npm run build       # 建構 UI → packages/ui/dist/
npm run migrate     # 執行 DB migration
```

> 驗證：`grep '"build"\|"migrate"' package.json`

## 測試

```bash
npm run test        # Unit tests (vitest)
npm run test:e2e    # E2E tests (Playwright)
npm run test:all    # 全部
```

> 驗證：`grep '"test"\|"test:e2e"\|"test:all"' package.json`

## Debug

### 常見問題排查表

| 問題 | 檢查指令 | 解法 |
|---|---|---|
| Chat 沒回應 | `cat data/config/providers.json \| python3 -c "import sys,json;d=json.load(sys.stdin);p=d['providers'].get(d['active']);print('key=',bool(p and p.get('apiKey') and p['apiKey']!='na'))"` | 設定有效的 API key |
| App 工具不見 | `ls data/apps/*/app.json` | 確認 app.json 存在且格式正確 |
| SSE 串流中斷 | 看 server console 的 `[chat]` logs | 檢查 proxy 設定 |
| WebSocket 連不上 | `lsof -i :4098` | 確認 port 未被佔用 |
| Context 空白 | `ls data/ai-settings/chat/` | 確認 .md 規則檔存在 |
| Agent Loop 卡住 | `cat data/ai-settings/agent-config.json` | 調整 maxTurns/timeout |
| CORS 問題 | `grep "Access-Control" packages/server/src/paaw-server.mjs` | 確認 CORS 設定 |
| DB 損壞 | `ls data/db/` | 刪除 .sqlite 檔重新 migrate |

### 重要 Config 檔案

| 檔案 | 用途 | 驗證 |
|---|---|---|
| `data/config/providers.json` | LLM provider | `cat data/config/providers.json \| head -5` |
| `data/config/user.json` | 使用者設定 | `cat data/config/user.json` |
| `data/workspaces.json` | Workspace 目錄 | `cat data/workspaces.json` |
| `data/ai-settings/agent-config.json` | Agent Loop 設定 | `cat data/ai-settings/agent-config.json` |
| `.env` | 環境變數 | `cat .env.example` |

### Debug Log 位置

| 位置 | 內容 | 驗證 |
|---|---|---|
| Server stdout | 所有 console.log | 直接看 terminal |
| `data/distill/` | AI 互動記錄 | `ls data/distill/` |
| `logs/vibe-sessions/` | Coding IDE session | `ls logs/vibe-sessions/` |
| `temp/payload-*.json` | LLM API payload | `ls temp/payload-*.json 2>/dev/null \| head -3` |
| `temp/stream-*.log` | LLM 串流 log | `ls temp/stream-*.log 2>/dev/null \| head -3` |
| `logs/cron/` | Cron 日誌 | `ls logs/cron/ 2>/dev/null` |

> ⚠️ `temp/` 目錄包含 debug payload，不應 commit。確認 .gitignore 有排除。

### 快速功能驗證 curl

```bash
# 檢查 server 是否活著
curl http://localhost:4097/api/apps

# 檢查 providers 設定
curl http://localhost:4097/api/paaw/providers

# 檢查 chat 列表
curl http://localhost:4097/api/paaw/chats

# 檢查 system prompts
curl http://localhost:4097/api/system-prompts
```
