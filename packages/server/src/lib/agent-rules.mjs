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
## 工作規則

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
`;
