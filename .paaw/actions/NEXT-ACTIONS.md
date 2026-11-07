# Next Actions

> 下一步待辦。AI 讀取此檔案決定接下來做什麼。

## 🔴 Priority — 立即

1. **EM Dashboard 交接狀態面板** — 右側加一個 panel，顯示 8 個知識檔案的填充狀態（✅/⚠️/❌），backup 人一眼看到完整度
2. **跑 Code Understanding** — 用 AI 掃描專案，自動填充 ARCHITECTURE.md / API spec / error mapping 等
3. **整理已歸檔對話** — 從 coding-memory/conversations/.archive/ 提煉 FAQ

## 🟡 Important — 本週

4. **測試自動化整合** — test runner UI，AI 寫的測試結果反饋到 TEST-EVIDENCE.md
5. **CI/CD 基礎** — push → build + test pipeline
6. **AI 自動更新知識庫** — AI 完成任務後自動更新 STATUS.md / CHANGELOG.md

## 🟢 Nice to Have

7. **前端展示上下文窗口統計** — 顯示 token 使用量、修剪數量
8. **知識庫提煉** — 歸檔對話 → Runbook / FAQ
9. **多 Crew 協作流程** — architect → developer → tester 自動 flow
10. **版本發布管理** — tag-based release notes

## 💡 Backlog

- 多專案支援（一個 PAAW 管多個 repo）
- AI 自動 code review on PR
- 知識庫搜尋（semantic search on .paaw/）
- AI 自動寫 test case
- Crew 效能分析（回應品質、速度、token 消耗）
