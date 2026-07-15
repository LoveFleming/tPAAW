# AI Operating Guide — Backup 接手指南

> 看完這份就能指揮 AI 團隊。不需要問任何人。

## AI 團隊成員

| ID | 角色 | 名字 | 專業範圍 | 拒絕 |
|----|------|------|---------|------|
| `coding.architect` | 架構師 | 林曉薇 | 系統架構、技術選型、ADR | 非技術問題、具體 bug 修復 |
| `coding.developer` | 開發者 | Priya Sharma | TS/React/Node.js 全端 | 非開發問題、CI/CD 部署 |
| `coding.tester` | 測試工程師 | Divya Reddy | Jest/Vitest/Playwright | 非測試問題、部署維運 |
| `coding.qa` | QA | 武大安 | Code Review、品質把關 | 非品質問題、功能實作 |
| `coding.doc-writer` | 文件撰寫 | Megan Brooks | 技術文件、API 文件 | 非文件問題、程式碼實作 |
| `coding.helpdesk` | 技術支援 | 小春 林 | Debug、環境問題、FAQ | 非技術問題、功能實作 |

每位成員有 **轉介規則**：超出範圍的問題會建議找對應的人。

## 怎麼指揮

### 方式一：EM 大總管（推薦）
1. 打開 Coding App → 🎖️ EM 大總管 tab
2. 用自然語言描述需求：「幫我加一個 XXX 功能」
3. EM 會自動分派給對應 agent
4. 右側可看到 Agent Activity Log（即時操作記錄）

### 方式二：直接找 agent
1. 打開 AI Crew tab
2. 選擇要對話的 agent（架構師 / Developer / Tester / QA / Doc Writer / Helpdesk）
3. 直接在 chat 發訊息
4. 對話自動持久化，切換 crew 會自動載入該 crew 的對話

### 方式三：A2A API
```
POST /api/a2a/message/stream
{
  "agentId": "coding.developer",
  "message": "修復 XXX bug"
}
```

## 工作流程範例

### 新功能開發
```
Architect (曉薇)     → 討論設計、產出 ADR
    ↓
Developer (Priya)    → 實作程式碼
    ↓
Tester (Divya)       → 寫測試
    ↓
QA (大安)            → Code Review
    ↓
Doc Writer (Megan)   → 更新文件 + CHANGELOG
```

### Bug 修復
```
Helpdesk (小春)      → 初步排查、重現步驟
    ↓
Developer (Priya)    → 修復
    ↓
Tester (Divya)       → 回歸測試
```

### 知識庫維護
```
EM Dashboard → 🧠 Code Understanding 按鈕
    ↓
AI 掃描專案（9 步驟）
    ↓
產出：PROJECT.md / ARCHITECTURE.md / DECISIONS.md / API spec / error mapping
    ↓
人工審閱 + 補充產品定位
```

## AI 可用的工具（20 個）

### 檔案操作
- `read_file` — 讀檔案
- `write_file` — 寫檔案
- `edit_file` — 精確編輯
- `glob` — 檔案搜尋
- `grep` — 內容搜尋
- `diff` — 比對差異

### 版本控制
- `git` — Git 操作（status, diff, commit, push...）

### 執行
- `bash` — 執行 shell 命令
- `browser_test` — 瀏覽器測試

### 知識管理
- `record_decision` — 寫 ADR 到 DECISIONS.md
- `update_changelog` — 寫變更到 CHANGELOG.md
- `update_docs` — 更新文件
- `action_log_add` — 記錄操作
- `action_log_list` — 查詢操作記錄

### 記憶
- `agent_memory_save` — 存 AI 記憶
- `agent_memory_load` — 讀 AI 記憶

### 其他
- `ask_user` — 向使用者提問

## 重要規則（鐵律）

### 1. 改完碼一定要 commit + push
- 不留 uncommitted local change
- 原因：公司 Windows/Linux 跟 Mac mini 都從 repo pull，local fix 沒 push = 別人跑舊碼
- 教訓：Knowledge 顯示空白 + 右鍵 menu 壞掉，都是 local 修了但沒 push

### 2. 跨平台路徑
- ❌ 禁止 `new URL(import.meta.url).pathname` — Windows 產生 `/C:/path`
- ✅ 一律用 `fileURLToPath(import.meta.url)`
- ✅ PAAW_ROOT 從 `shared.mjs` import
- ✅ 回傳前端的路徑一律 `normalizePath()`
- ✅ 路徑切割用 `split(/[\\/]/)`
- 詳見：`.paaw/CODING-STANDARDS.md`

### 3. IME 中文輸入
- 新 textarea/input 有 Enter 送出時，必須用 `useRef` 追蹤 composition
- 三層保護：`composingRef` → `isComposing` → `keyCode 229`
- 詳見：`.paaw/CODING-STANDARDS.md`

### 4. i18n
- 新字串直接寫 `t()` + 加 locale key
- 4 個 locale 檔：`zh.json`, `en.json`, `ja.json`, `zh-mix.json`
- Key 命名：`category.subcategory`

### 5. Model 設定
- Model 由 PAAW 預設/fallback chain 控制：zai GLM 5.1 → OpenRouter GLM → DeepSeek
- 不在 crew JSON 裡設 model
- Runtime 可用 ModelSelector 選擇，但不持久化到 crew

## 緊急狀況處理

| 狀況 | 處理 |
|------|------|
| AI 當掉 | 重整頁面。對話已持久化，不會丟失 |
| Build 失敗 | 看 terminal output。通常是路徑或 import 問題 |
| Git 衝突 | 用 Git tab 看 diff，手動 resolve |
| AI 回答不對 | 檢查 system prompt（dispatch-log.jsonl 有記錄）|
| Token 超限 | 確認對話長度，開新對話歸檔舊的 |
| Crew 找不到 | 確認 `data/crews/` 下有對應的 JSON 檔 |

## 知識檔案導覽

| 檔案 | 用途 | 何時看 |
|------|------|--------|
| `PROJECT.md` | 產品是什麼、技術棧、結構 | 第一次了解專案 |
| `STATUS.md` | 做到哪、做什麼、待做什麼 | 接手時第一個看 |
| `DECISIONS.md` | 為什麼這樣做（ADR） | 改架構前先看 |
| `CHANGELOG.md` | 每次改了什麼 | 看最近變更 |
| `TEST-EVIDENCE.md` | 哪些功能已驗收 | 確認品質 |
| `KNOWN-ISSUES.md` | 已知問題 | 避開地雷 |
| `NEXT-ACTIONS.md` | 下一步 | 找工作做 |
| `CODING-STANDARDS.md` | 寫碼規範 | 動手前必看 |
