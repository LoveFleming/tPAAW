/**
 * Shared agent rules — injected into every crew's system prompt
 * 
 * Used by: a2a.mjs, coding.mjs
 * 
 * These rules teach AI agents:
 * 1. When to use action_log_add (always — handoff log)
 * 2. When to use agent_memory_save (when learning something new)
 * 3. The difference between memory / action log / decision records
 */

export const AGENT_RULES = `
## 工作规则

### 查询專案資訊（重要！）
你需要了解專案時，**必須優先使用 project_* tools**，不要用 read_file 去讀 .paaw/ 目錄下的檔案：
- **project_context** — 取得 PROJECT.md、ARCHITECTURE.md、STATUS.md、CODING-STANDARDS.md
- **project_decisions** — 讀取架構決策 (ADR)
- **project_standards** — 列出/讀取 coding standards
- **project_changelog** — 讀取近期變更
- **project_issues** — 列出/篩選專案問題
- **project_sessions** — 列出近期 coding sessions
- **project_features** — 列出所有 feature（每次對話 system prompt 已注入最新 summary）
- **project_feature_detail** — 查單一 feature 完整 detail

❌ 不要 read_file(".paaw/DECISIONS.md") → 用 project_decisions
❌ 不要 read_file(".paaw/CODING-STANDARDS.md") → 用 project_context 或 project_standards
❌ 不要 read_file(".paaw/issues/ISSUES.json") → 用 project_issues
❌ 不要 read_file(".paaw/features/FEATURES.json") → 用 project_features 或 project_feature_detail
✅ read_file 只用來讀「原始碼」，不用來讀 .paaw/ 專案知識

### Feature Mapping 維護（必須！）
每次你的程式碼變更影響到 feature 的結構時，**必須用 tool 更新 mapping**：
- 新增/刪除/重命名檔案 → **project_feature_update_mapping**
- 新增/刪除 API endpoint → **project_feature_update_mapping**
- 新增/刪除測試檔案 → **project_feature_update_mapping**
- 更新 feature 文件 → **project_feature_update_docs**

System prompt 裡的 Feature Map summary 是最新的（每次對話重新讀取），
你改完 mapping 後，下次對話自動反映。

### 動作記錄（必須）
完成任務後，你**必須**用 action_log_add 記錄你的操作。這是 Agent 之間的交接簿，其他 Agent 會根據你的紀錄繼續工作。

### 長期記憶（重要）
你有自己的長期記憶檔。在以下情況，你**必須**用 agent_memory_save 更新記憶：
1. **犯了錯或踩了坑** — 記下什麼錯、為什麼、怎麼修，避免下次再犯
2. **學到專案慣例** — 例如 commit 格式、命名規則、某個 pattern
3. **使用者告訴你偏好** — 例如「不要用 tag input」「改完要 push」
4. **發現重複模式** — 例如每次改 UI 都要加 i18n t()

記憶格式：用 markdown，分類整理：
\`\`\`markdown
# 我的記憶

## 專案慣例
- ...

## 踩過的坑
- YYYY-MM-DD: ...

## 使用者偏好
- ...
\`\`\`

注意：記憶是累積的。用 agent_memory_load 讀取現有記憶，加上新內容，再 agent_memory_save 存回去。不要覆蓋掉舊記憶。

### 記憶、動作記錄、決策記錄的差別
- **agent_memory** = 你個人的長期記憶（教訓、偏好、慣例）
- **action_log** = 這次操作的記錄（做了什麼、改了哪些檔）
- **record_decision** = 架構決策（為什麼選 A 不選 B）→ 寫入 DECISIONS.md
- **project_*** = 結構化讀取 .paaw/ 專案知識（不透過 read_file）
`;
