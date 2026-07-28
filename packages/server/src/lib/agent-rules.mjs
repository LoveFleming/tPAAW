/**
 * Shared agent rules — injected into every crew's system prompt (slimmed v2)
 *
 * Used by: a2a.mjs, coding.mjs
 * v2: 9,507 → ~3,800 chars (cut 60%) — removed examples, redundant tool lists,
 *     format templates. Kept: hard rules, tool routing, workflow steps.
 */

export const AGENT_RULES = `
## 工作規則

### 🔒 Commit（不可違反）
- 完成後必須 commit，message 用 Conventional Commits（type(scope): desc，英文，<72字）
- **絕對不允許 push** — 未經人同意不可 git push
- 不要 amend/reset 已有的 commit，新增 commit 即可
- Types: feat/fix/refactor/docs/test/chore/style/perf

### 📋 大改動先規劃
改 3+ 檔案、跨 package、新功能、架構變動 → 先列計劃分期，等使用者同意再做。單檔小修直接做。

### ⚠️ 改碼前必須先 read_file（最重要！）
不能憑記憶寫碼。System prompt 裡的檔案 Map 是目錄，不是原文。每次都要 read_file 確認結構再改。

### 📋 專案資訊查詢（優先使用 project_info，不要 read_file .paaw/）
- project_info(category="context") — PROJECT.md, ARCHITECTURE.md, CODING-STANDARDS.md
- project_info(category="features") — 列出所有 feature
- project_info(category="feature_detail", id="F-001") — 查 feature 完整 detail + codeFiles + APIs + tests
- project_info(category="test_map", file="src/foo.ts") — 查這檔案的測試覆蓋
- project_info(category="recent_changes") — 最近改了什麼
- project_info(category="decisions") — 架構決策 (ADR)
- project_info(category="runbook") / (category="faq") — 排障指南
- project_edit(action="issue_create/update/delete") — 開/改 issue
- project_edit(action="change_record") — 記錄變更交接
- read_file 只用來讀原始碼，不用來讀 .paaw/

### 🗺️ Feature-File Mapping（必須維護！）
改碼影響 feature 結構時，必須更新 mapping：
- 新增/刪除/重命名檔案或 API → project_edit(action="feature_update_mapping")
- 你改完 mapping 後，下次對話的 system prompt 自動更新

### 🔄 改 code 前後的工作流
**改前：** project_info(recent_changes) → project_info(test_map, file=目標檔) → read_file 確認
**改後：** bash 跑測試 → cu_refresh（只跑確定性步驟）→ action_log_add 記錄

### 📝 記錄（必須）
- **action_log_add** — 每次完成操作就記錄（Agent 交接簿）
- **agent_memory_save** — 犯錯/學到慣例/使用者偏好時更新（先 load 再加新內容，不要覆蓋）
- **record_decision** — 架構決策寫入 DECISIONS.md

### 🧹 暫存檔案清理（必須）
- 暫存檔案（scratch script、測試 snippet、probe、debug 用檔案）一律寫到 .paaw/tmp/
- **絕對不要在專案原始碼目錄寫暫存檔**（src/ lib/ packages/ 等）
- 用完的暫存檔自己刪掉：用 bash 工具執行 rm -f .paaw/tmp/xxx.mjs
- .paaw/tmp/ 每個 session 結束會自動清空，不要放重要檔案
- 正式的測試檔案（屬於專案的）正常寫，不算暫存
`;
