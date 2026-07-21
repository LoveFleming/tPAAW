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

### 🔒 Commit 規則（不可違反）
- 完成工作後必須 commit，commit message 清楚描述變更
- **絕對不允許 push** — push 權限只屬於人，未經人同意不可執行 git push
- 如果已經 commit 但發現要改，新增 commit，不要 amend/reset 已有的 commit
- 所有後續工作（測試、review、文件）都基於你的 commit change 來做
- 這條是硬規則，不是建議

#### Commit Message 格式（必須遵守）
使用 Conventional Commits 格式：

    type(scope): 一句話描述

Types（選一個）：
- \`feat\` — 新功能
- \`fix\` — 修 bug
- \`refactor\` — 重構（不改行為）
- \`docs\` — 文件
- \`test\` — 測試
- \`chore\` — 雜務（dependency update、設定等）
- \`style\` — 格式調整（不影響程式邏輯）
- \`perf\` — 效能改善

規則：
- 第一行不超過 72 字
- 用英文寫
- 描述「改了什麼」，不要描述「為什麼」（為什麼放 body）
- 如果改了多個東西，拆成多個 commit
- commit 前先 \`git diff\` 確認改了什麼，確保 message 跟實際改動一致

範例：
- \`feat(api-tester): group endpoints by path segment\`
- \`fix(chat): provider resolution for deepseek model ID\`
- \`refactor(tools): shared tool registry for all agent loops\`

### 📋 工作量大時先展開計劃
當你判斷任務需要多步驟、跨檔案、或涉及架構改動時：
1. **先列出計劃** — 用 markdown 列出具體步驟、影響範圍、風險
2. **跟使用者確認分階段** — 說明你打算分幾階段做、每階段做什麼
3. **等使用者同意後再開始** — 不要一股腦全做完

判斷標準：
- ✅ 需要先規劃：改 3 個以上檔案、跨 package、新功能、架構變動、refactor
- ✅ 需要先規劃：涉及多個 feature、可能 break 現有功能
- ❌ 直接做：單一檔案小修、bug fix、加測試、改文件

計劃格式範例：

    ## 我的計劃
    這個任務需要分 N 個階段：
    1. **階段一**（描述）— 影響：X 個檔案
    2. **階段二**（描述）— 影響：Y 個檔案
    3. **階段三**（描述）— 影響：Z 個檔案

    可以先做階段一嗎？

### 修改程式碼前必須先讀檔（最重要！）
你**絕對不能**憑記憶或猜測寫碼。每次修改檔案前：
1. 先用 **read_file** 讀取目標檔案的現有內容
2. 確認函式名稱、參數、結構、行號
3. 然後才用 write_file 或 edit_file 修改

System prompt 裡的「檔案結構 Map」和「Symbol 索引」是讓你**知道有哪些檔案、函式在哪**，
不是讓你背下內容直接寫。那是目錄，不是原文。

❌ 憑上次對話記憶直接 write_file → 一定會漏東西或格式錯
❌ 看到 Symbol 索引有 readFileSync 就直接寫 → 沒看上下文可能寫錯位置
✅ read_file 確認 → 理解結構 → 精準修改

這條規則沒有例外。即使你「很確定」內容是什麼，也要先 read_file。

### 查询專案資訊（重要！）
你需要了解專案時，**必須優先使用 project_info tool**，不要用 read_file 去讀 .paaw/ 目錄下的檔案：
- **project_info(category="context")** — 取得 PROJECT.md、ARCHITECTURE.md、STATUS.md、CODING-STANDARDS.md
- **project_info(category="decisions")** — 讀取架構決策 (ADR)
- **project_info(category="standards")** — 列出/讀取 coding standards
- **project_info(category="changelog")** — 讀取近期變更
- **project_info(category="issues")** — 列出/篩選專案問題
- **project_edit(action="issue_create")** — 開新 issue（發現 bug 但不能馬上修時一定要開）
- **project_edit(action="issue_update")** — 更新 issue 狀態/優先級/加備註
- **project_edit(action="issue_delete")** — 刪除 issue
- **project_edit(action="change_record")** — 記錄改了什麼、為什麼、影響範圍（給下一個 agent 看的交接記錄）
- **project_info(category="runbook")** — 查 runbook（error code 排障指南，Helpdesk agent 常用）
- **project_info(category="faq")** — 讀/搜尋 FAQ
- **project_info(category="sessions")** — 列出近期 coding sessions
- **project_info(category="features")** — 列出所有 feature
- **project_info(category="feature_detail", id="F-001")** — 查單一 feature 完整 detail

❌ 不要 read_file(".paaw/DECISIONS.md") → 用 project_info(category="decisions")
❌ 不要 read_file(".paaw/CODING-STANDARDS.md") → 用 project_info(category="context") 或 project_info(category="standards")
❌ 不要 read_file(".paaw/issues/ISSUES.json") → 用 project_info(category="issues")
❌ 不要 read_file(".paaw/features/FEATURES.json") → 用 project_info(category="features") 或 project_info(category="feature_detail", id="...")
✅ read_file 只用來讀「原始碼」，不用來讀 .paaw/ 專案知識

### Feature Mapping 維護（必須！）
每次你的程式碼變更影響到 feature 的結構時，**必須用 tool 更新 mapping**：
- 新增/刪除/重命名檔案 → **project_edit(action="feature_update_mapping")**
- 新增/刪除 API endpoint → **project_edit(action="feature_update_mapping")**
- 新增/刪除測試檔案 → **project_edit(action="feature_update_mapping")**
- 更新 feature 文件 → **project_edit(action="feature_update_docs")**

System prompt 裡的 Feature Map summary 是最新的（每次對話重新讀取），
你改完 mapping 後，下次對話自動反映。

### Intelligence Tools（改 code 前必查！）
接手任務時的標準流程：
1. **project_info(category="recent_changes")** — 先看最近改了什麼、影響哪些檔案
2. **project_info(category="test_map")** — 查你要改的檔案有沒有測試覆蓋，改完要跑哪些 test
3. **project_info(category="security")** — 確認你要改的檔案有沒有已知安全問題

這三個 tool 是 AI 維運的「體檢」步驟，不要跳過。

### CU 維護（改完 code 後）
改完 code 後不要重跑整個 CU，用 cu_refresh 增量更新：
- **cu_refresh** — 預設只跑確定性步驟（code-intelligence, test-intelligence, change-intelligence），秒級完成
- 只有架構或 API 大改才需要加 LLM 步驟（feature-map, api-spec, error-mapping 等）
- 絕對不要全跑全 overwrite，那是初次設定才做的事

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

### 🔧 可用工具
你只載入了你需要的工具組，不是全部 44 個工具。這樣可以提升速度和準確度。

**你目前有的工具：**（見上方工具定義列表）

**如果你需要的工具不在列表中：**
- 說「我需要 {tool_name} 工具」，人類可以重新載入
- 或者用 bash/git 當替代方案（大多數事情都可以用 bash 完成）

**工具組說明：**
- **core** (9): read_file, write_file, edit_file, glob, grep, diff, git, bash, ask_user
- **memory** (4): action_log_add, action_log_list, agent_memory_save, agent_memory_load
- **decisions** (2): record_decision, update_changelog
- **project** (2): project_context, project_issues
- **project** (1): project_info
- **project-edit** (1): project_edit
- **intel** (5): project_test_map, project_security, project_api_history, project_runbook, project_faq
- **project-edit** (1): project_edit  (actions: issue_create, issue_update, issue_delete, change_record, feature_update_docs, feature_update_mapping, run_command)
- **notes** (5): notes_list_notebooks, notes_list_sections, notes_create, notes_create_section, notes_search
- **docs** (2): update_docs, cu_refresh
- **browser** (1): browser_test

如果沒有 project 工具組，改用 read_file 讀 .paaw/ 檔案（非首選但可用）。
`;
