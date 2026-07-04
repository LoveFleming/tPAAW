# AI Context Package — 總索引與接手檢查清單

> 這份索引連結所有子文件，並提供接手前的完整檢查清單

## 文件結構

```
memory/paaw-docs/
├── overview/
│   └── PROJECT_OVERVIEW.md          ← 專案概覽、系統邊界
├── architecture/
│   └── ARCHITECTURE_OVERVIEW.md     ← 模組、資料流、Entry points、設計模式
├── codebase/
│   └── CODEBASE_MAP.md              ← 目錄說明、重要檔案、閱讀起點
├── domain/
│   └── DOMAIN_DICTIONARY.md         ← 10 個核心 domain terms
├── api/
│   └── API_SPEC.md                  ← HTTP API + WebSocket + Bridge + Internal APIs
├── flows/
│   └── CORE_FLOWS.md               ← 5 條核心流程詳解
├── schemas/
│   └── DATA_MODELS.md               ← App/Skill/Chat/Crew/Provider/DB Schema
├── errors/
│   └── ERROR_HANDLING.md            ← 錯誤類型、retry、驗證機制
├── testing/
│   └── TESTING_GUIDE.md             ← 現有測試、缺漏、建議
├── runbooks/
│   └── RUNBOOK.md                   ← 啟動/build/test/debug
├── change-guide/
│   └── CHANGE_GUIDE.md              ← 修改指引、禁區、同步義務
├── risk/
│   └── RISK_AND_DEBT.md             ← 4 個架構風險、5 個隱含假設、4 個耦合
└── ai-context/
    └── this file                     ← 總索引 + 檢查清單
```

## 快速導航

| 我想... | 看哪個文件 |
|---|---|
| 了解 PAAW 是什麼 | `overview/PROJECT_OVERVIEW.md` |
| 了解系統架構 | `architecture/ARCHITECTURE_OVERVIEW.md` |
| 找某個檔案在哪 | `codebase/CODEBASE_MAP.md` |
| 查 domain term | `domain/DOMAIN_DICTIONARY.md` |
| 看 API endpoint | `api/API_SPEC.md` |
| 理解核心流程 | `flows/CORE_FLOWS.md` |
| 查資料結構 | `schemas/DATA_MODELS.md` |
| 除錯 | `errors/ERROR_HANDLING.md` + `runbooks/RUNBOOK.md` |
| 準備改碼 | `change-guide/CHANGE_GUIDE.md` |
| 評估風險 | `risk/RISK_AND_DEBT.md` |

---

## 驗證方式：如何確認這些文件不是亂編的

每份文件都附了 `> 驗證：...` 區塊，裡面是可在 repo 執行的指令。

**批次驗證全部文件的關鍵聲明：**

```bash
cd /Users/steward/App/tPAAW

echo "=== 1. Route 數量 ==="
echo "文件說 20，實際："
ls packages/server/src/routes/*.mjs | wc -l

echo "=== 2. UI 頁面數 ==="
echo "文件說 35，實際："
ls packages/ui/src/pages/*.tsx | wc -l

echo "=== 3. DB 表數量 ==="
echo "文件說 9，實際："
grep "CREATE TABLE" packages/db/src/migrate.ts | wc -l

echo "=== 4. Context targets ==="
echo "文件說 12，實際："
grep 'case "' packages/server/src/context-engine.mjs | wc -l

echo "=== 5. Ports ==="
echo "HTTP=4097:"
grep "PAAW_PORT" packages/server/src/routes/shared.mjs
echo "WS=4098:"
grep "WS_PORT" packages/server/src/websocket/ws-handler.mjs
echo "Bridge=4100:"
grep "BRIDGE_PORT" packages/server/src/lib/bridge/paaw-bridge.mjs

echo "=== 6. Security Kernel ==="
grep "class SecurityKernel" packages/server/src/lib/security/index.mjs

echo "=== 7. loadAppInstructions 雙重實作 ==="
grep -rn "loadAppInstructions\|buildAppInstructions" packages/server/src/

echo "=== 8. tools/index.mjs 行數 ==="
wc -l packages/server/src/tools/index.mjs

echo "=== 9. Unit test 數 ==="
ls tests/unit/ | wc -l

echo "=== 10. E2E test 數 ==="
ls tests/e2e/*.spec.ts | wc -l

echo "=== 11. i18n locale 數 ==="
ls packages/ui/src/i18n/locales/ | wc -l

echo "=== 12. App 數量 ==="
ls data/apps/ | wc -l

echo "=== 13. Crew 數量 ==="
ls data/crews/*.json | wc -l

echo "=== 14. ai-settings 類別數 ==="
ls data/ai-settings/ | wc -l

echo "=== 15. SSE 使用位置 ==="
grep -rl "text/event-stream" packages/server/src/
```

如果以上結果跟文件說的數字一致，文件就是準的。

---

## AI 接手維護前檢查清單

### 環境準備

- [ ] Node.js >= 20（`node -v`）
- [ ] `npm install` 成功
- [ ] `npm run dev` 前後端都啟動（UI 在 5173，API 在 4097）
- [ ] `data/config/providers.json` 有有效 API key
- [ ] `npm run test` 全部通過
- [ ] `npm run migrate` DB 初始化完成

### 理解核心

- [ ] 讀過 `overview/PROJECT_OVERVIEW.md`
- [ ] 讀過 `architecture/ARCHITECTURE_OVERVIEW.md`
- [ ] 讀過 `flows/CORE_FLOWS.md`（5 條流程）
- [ ] 讀過 `domain/DOMAIN_DICTIONARY.md`（10 個 terms）
- [ ] 理解 4 層 Context Engine
- [ ] 理解 4 種 Skill Runner
- [ ] 理解 3 種 Data Shape 決定的工具集
- [ ] 理解 Tool Engine 的 ReAct loop

### 關鍵路徑確認

- [ ] Chat 流程可跑通（輸入 → AI 回應）
- [ ] App Tool 在 Chat 中可被 AI 呼叫
- [ ] Coding IDE 可啟動 Agent Loop
- [ ] Context Engine 各 target 能產出 system prompt
- [ ] Provider 切換正常

### 已知風險確認

- [ ] 知道 context-engine 和 tools/index 的 loadAppInstructions 要同步
- [ ] 知道改 UI 要同步 4 個 locale 檔
- [ ] 知道改完碼要 commit + push
- [ ] 知道 Provider API key 明文，不能 commit
- [ ] 知道 data/ 不應 commit

### 文件一致性

- [ ] 跑過上面的「批次驗證」指令，結果跟文件一致
- [ ] 確認 `risk/RISK_AND_DEBT.md` 的風險仍存在
- [ ] 確認 `testing/TESTING_GUIDE.md` 的缺漏仍存在
