# Project Status

> 每次重大變更後更新。AI 可讀取此檔案了解專案進度。

**最後更新：** 2026-07-11
**版本：** dev branch, commit `703788a`

## 已完成功能

### Coding App (AI-Native IDE)
- [x] 檔案總管 + 程式碼編輯器（多 tab）
- [x] 終端機（node-pty）
- [x] Git 面板（status / diff / blame / review）
- [x] API 測試器
- [x] 瀏覽器預覽
- [x] AI 聊天面板（串流回應）

### AI Crew 團隊
- [x] 6 位專業角色（architect / developer / tester / qa / doc-writer / helpdesk）
- [x] 每位角色有 expertise + guardrails（專業範圍 + 轉介規則 + 拒絕主題）
- [x] Crew 對話持久化（`.paaw/coding-memory/conversations/{crewId}.json`）
- [x] 歸檔系統（新對話 → 歸檔舊對話 → 可載入繼續）
- [x] 智能上下文窗口管理（Token budget ≈12000，修剪消息自動總結）
- [x] Thinking bubble 歷史保留（`_thinkingHistory[]`）

### EM 大總管
- [x] EM Dashboard Landing Page
- [x] EM Chat（自然語言指揮）
- [x] Code Understanding（9 步驟專案掃描）
- [x] 5-category Health Scores
- [x] Agent Activity Log（即時操作記錄）

### 基礎設施
- [x] A2A Protocol 客戶端（`/api/a2a/message/stream`）
- [x] paaw-agent-loop.mjs（自建 tool-calling loop）
- [x] domain-agent-registry.mjs（Crew 載入 + system prompt 組裝）
- [x] 20 個 AI 工具（read/write/edit/glob/grep/git/bash/...）
- [x] Crew 編輯器（expertise + guardrails textarea）
- [x] ModelSelector（runtime 選擇，不綁 crew）

## 進行中
- [ ] `.paaw/` 知識庫填充（本批次：8 個檔案建立中）

## 待做
- [ ] 測試自動化整合（test runner UI）
- [ ] CI/CD 基礎（push → build + test）
- [ ] 知識庫提煉（歸檔對話 → FAQ/Runbook）
- [ ] AI 自動更新 STATUS.md / CHANGELOG.md
- [ ] EM Dashboard 交接狀態面板
