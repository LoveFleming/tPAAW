## tPAAW 測試筆記（Test Agent / Divya Reddy）

### TASK-055（Secretary.tsx 背後 server routes）完成重點
- **fileScope 連續三次錯靶**（TASK-053→054→055）：feature map 的 file→feature mapping 把 installed-apps/secret 的檔案錯歸。Secretary.tsx 是秘書模組 UI（dossiers/categories/briefing/sheets），非 F20261016-012（AI Settings + Distill，Distill 引擎已移除）。QA 兩輪把錯靶標為「非阻擋項」並繼續審 Secretary.tsx。
- **ADR-024 決策**：採路徑 B——測 Secretary.tsx 背後的 4 個 server route（dossiers/categories/briefing/sheets），不測 React 元件（專案無 jsdom/RTL/@vitejs/plugin-react，引入設定變動大且測 mock 無價值）。route-level 整合測試沿用專案既有慣例。
- **vi.doMock 隔離慣例（installed-apps 模組）**：installed-apps/secret/server/routes/shared.mjs 的 `PAAW_ROOT`/`TPAW_REPO_ROOT` 是 module-level const（不讀 env），用 `vi.doMock("../../installed-apps/secret/server/routes/shared.mjs", ...)` 重導到 tmpdir。必須在 dynamic import route 前 doMock。dossiers.mjs 的 ensureBuiltinCategories() 在 module load 時跑——但因為已 mock PAAW_ROOT，它會在 tmpdir 建 builtin 分類；不過 beforeEach 仍需手動重建（因 module load 只跑一次，reset 後不會重建）。
- **Node URL parser 路徑 normalization**：dossiers route 用 `new URL(req.url, "http://x")` 解析，含 `../..` 的 URL 被 parser normalize 後不再 match `/api/secret/dossiers` prefix → handled=false。這是 URL parser 的副作用，非 safeName 主動攔截。safeName 在 GET/PUT/DELETE 路徑上實際未被觸發（.. 在 URL parser 階段就被消掉）。sheets route 的 `name.includes("..")` 是 dead code（basename 已消掉 ..）。雖然實際不會逃逸（basename 保護），但檢查邏輯本身無效。
- **ISS-050 新發現**：categories.mjs slug() 的 `|| \`cat${ts}\`` fallback 使空字串永遠不回空 → `if (!id) id = slug(name)` 永遠不成立 → 無 id 時 id 永遠是 cat-xxx 而非 slug(name)。
- **defect 釘樁慣例**：QA 已指出的 defect 以 `it("DEFECT-XXX：現況行為描述")` 格式釘住，斷言現況行為（非期望行為）。developer 修復後需調整斷言。標 DEFECT- 前綴方便搜尋。
- **beforeAll vs beforeEach 衝突**：全局 beforeEach 重置目錄時，describe 內的 beforeAll 寫的檔會被清掉。改用 describe 內 beforeEach（在全局 beforeEach 之後執行）重建測試資料。
- **58 測試全綠**（RUN-20261018-011），0 回歸。基線 1454→1512 pass（+58），134 fail 不變（既有環境性）。

### TASK-053（F20261016-010 agent-logs/log-retention）完成重點
- 真檔：packages/server/src/routes/agent-logs.mjs、routes/log-retention.mjs、lib/agent-exec-logger.mjs
- ISS-044 已立：log-retention.mjs L150 `const otherDeleted` 後 `+=` → TypeError。以 it.fails 釘住。
- 環境隔離慣例（route 層測試）：`process.env.PAAW_LOG_HOME/PAAW_DATA_HOME` 必須在 import server 模組前設。
- 產品 usage 鍵是 OpenAI snake_case（prompt_tokens/completion_tokens）。
- resolveRuName 內 _normPath 會 lowercase 路徑。
- e2e 環境 102/135 環境性全紅（無 dev-server），不補 e2e。

### 通用慣例
- 跑測試一律 test_run 工具（不是 bash npm test），結果落 .paaw/test-runs/runs/RUN-*.json；讀結果用 python json（groups[].files 是 dict：{path: {passed, failed, skipped}}）。
- vitest 4.x 無 --reporter=basic，用 dot。字串內不可嵌套 `""`（rolldown parse error），用「」或跳脫。
- 工作區常有其他 agent 並行變更：git add 只加自己的檔案；commit 前先 git diff --cached --stat 核對。DECISIONS.md 是共用檔，其他 agent 的 ADR 一起 commit 合理。
- test-run ID 引用格式 RUN-YYYYMMDD-NNN；qa_record_save / action_log_add 每輪必做。
- agent-sre 是獨立 repo（/Users/steward/App/agent-sre）：vitest include server/**/*.test.mjs；write_file 受限於 tPAAW cwd，用 bash cat 寫檔。
- **fileScope 錯靶處理流程**：先查 project_info(feature_detail) 確認 file→feature mapping → read_file 確認實際內容 → 若錯靶，用 ask_user 確認範圍（loop 中無法回答時依 EM 派工記錄 + QA verdict 判斷人類意圖）→ record_decision 記錄範圍決策 → 測真正有價值的熱區。