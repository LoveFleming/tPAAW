# DEPLOY — 2026-10-05（週一）更新包

> 範圍：dev `e2dbbe5b..9ee918d2`（10/3 App Module Platform 起兩日全部）
> 本次主打：**秘書室 + 產品經理室 兩個 profession package（demo 用）**，公司端開箱即用

## 內容摘要

1. **App Module Platform S1-S5** — installed-apps/ 可組裝模組底座（掛載/scaffold/manifest/nav）
2. **🕴️ Secret module（秘書室）**（側欄含專家團隊區，結構同 PM） — 總管 + 6 builtin 分類專家（行程/報表/會議/公文/行政/人事）+ 檔案樹側欄；掛載時自動 ensure 分類（空機開箱即用）
3. **🎯 PM module（產品經理室）** — 首席 PM + 6 職能專家（策略/研究/需求/數據/上市/對齊）+ 報表官 + 產品檔案櫃（一產品一管家）+ 需求池/截止雷達/晨間簡報/產品總覽；掛載時自動 ensure 職能櫃
4. **📚 Learning module** — 小元寶學習空間模組掛載（課程目錄樹）
5. **Multi-model review MR1/MR2 + Review 委員會**（EM dashboard 設定 UI）
6. **側欄重整** — Execution/Management/Reports/Plugins/File Mounts 分組；🧩App 模組入口
7. **Coding app** — Load from Module + 🧩➕ New Module（scaffold→註冊 RU→切換一鍵到底）
8. **ES log shipping**（選配）— .env 設 `PAAW_ES_URL` 才開啟 agent log 送 ES；不設 = 完全不影響
9. 林雨晴（my.assistant）rolePrompt 加入 PAAW 定位

## 公司 SOP

1. 本 branch 檔案照 tPAAW 相對路徑覆蓋（95 檔）
2. `npm install`（保險，本次無新依賴）
3. `npm run build`
4. 重啟 server（看 log：`[AppModule] ✅ secret/pm/learning 已掛載`）
5. 驗證：
   - 側欄 Execution 出現 📚學習空間 / 🎯產品經理室 / 🕴️秘書
   - Management 出現 🧩App 模組；Reports 分組（LLM 日誌/Agent 執行記錄/Usage Report）
   - File Mounts（原 Workspaces）
   - 秘書室：7 個分類自動生成（含總管可聊）
   - 產品經理室：專家團隊 7 人 + 產品檔案櫃（ai-portal 櫃 Mac 端才有，公司端新增產品即可）
   - Coding app：🧩➕ New Module 按鈕

## 注意

- `data/installed-apps/` 為 runtime 資料不進包 — 秘書/PM 分類由模組掛載時自動 ensure 生成
- ES shipping 為選配：不設 `PAAW_ES_URL` 即關閉，零影響
- crews 在 `data/crews/`（本包內）— secret.* ×8、pm.* ×8、my.assistant 已含

## 檔案清單

### 新增（67）
data/crews/pm.ai-portal.json
data/crews/pm.alignment.json
data/crews/pm.chief.json
data/crews/pm.data.json
data/crews/pm.launch.json
data/crews/pm.reports.json
data/crews/pm.requirements.json
data/crews/pm.research.json
data/crews/pm.strategy.json
data/crews/secret.admin.json
data/crews/secret.chief.json
data/crews/secret.documents.json
data/crews/secret.hrliaison.json
data/crews/secret.meetings.json
data/crews/secret.reports.json
data/crews/secret.schedule.json
data/knowledge/app-modules.md
installed-apps/learning/manifest.json
installed-apps/learning/server/data-home.mjs
installed-apps/learning/server/entry.mjs
installed-apps/learning/server/lib/coding-security.mjs
installed-apps/learning/server/lib/stable-hash.mjs
installed-apps/learning/server/routes/exam-vault.mjs
installed-apps/learning/server/routes/learning-practice.mjs
installed-apps/learning/server/routes/quiz-session.mjs
installed-apps/learning/server/routes/shared.mjs
installed-apps/learning/ui/components/CurriculumView.tsx
installed-apps/learning/ui/components/ExamVault.tsx
installed-apps/learning/ui/components/LearningPractice.tsx
installed-apps/learning/ui/components/SplitChatLayout.tsx
installed-apps/learning/ui/components/TeacherChatPanel.tsx
installed-apps/learning/ui/components/quiz/QuizComposer.tsx
installed-apps/learning/ui/components/quiz/QuizReport.tsx
installed-apps/learning/ui/components/quiz/QuizRunner.tsx
installed-apps/learning/ui/components/quiz/QuizWorkspace.tsx
installed-apps/learning/ui/components/quiz/types.ts
installed-apps/learning/ui/pages/LearningSpace.tsx
installed-apps/pm/manifest.json
installed-apps/pm/server/entry.mjs
installed-apps/pm/server/routes/briefing.mjs
installed-apps/pm/server/routes/dossiers.mjs
installed-apps/pm/server/routes/projects.mjs
installed-apps/pm/server/routes/shared.mjs
installed-apps/pm/server/routes/sheets.mjs
installed-apps/pm/ui/components/ExpertChatPanel.tsx
installed-apps/pm/ui/components/SheetPreview.tsx
installed-apps/pm/ui/pages/ProjectOffice.tsx
installed-apps/secret/manifest.json
installed-apps/secret/server/entry.mjs
installed-apps/secret/server/routes/briefing.mjs
installed-apps/secret/server/routes/categories.mjs
installed-apps/secret/server/routes/dossiers.mjs
installed-apps/secret/server/routes/shared.mjs
installed-apps/secret/server/routes/sheets.mjs
installed-apps/secret/ui/components/ExpertChatPanel.tsx
installed-apps/secret/ui/components/SheetPreview.tsx
installed-apps/secret/ui/pages/Secretary.tsx
packages/server/src/lib/app-modules.mjs
packages/server/src/lib/coding-review-runner.mjs
packages/server/src/lib/es-shipper.mjs
packages/server/src/lib/secretary-tools.mjs
packages/ui/src/components/ModulePickerModal.tsx
packages/ui/src/pages/AppModules.tsx
tests/unit/db-connection.test.ts
tests/unit/multi-model-review.test.mjs
tests/unit/pm-module.test.mjs
tests/unit/secretary-module.test.mjs

### 修改（28）
.env.example
.gitignore
data/crews/coding.em.json
data/crews/my.assistant.json
data/knowledge/coding-app.md
packages/server/package.json
packages/server/src/lib/agent-exec-logger.mjs
packages/server/src/lib/domain-agent-registry.mjs
packages/server/src/lib/em-config.mjs
packages/server/src/lib/llm-utils.mjs
packages/server/src/lib/paaw-agent-loop.mjs
packages/server/src/paaw-server.mjs
packages/server/src/routes/apps.mjs
packages/ui/src/App.tsx
packages/ui/src/components/EMDashboard.tsx
packages/ui/src/components/MarkdownText.tsx
packages/ui/src/components/SidebarFileTree.tsx
packages/ui/src/components/ui/shared.tsx
packages/ui/src/i18n/locales/en.json
packages/ui/src/i18n/locales/ja.json
packages/ui/src/i18n/locales/zh-mix.json
packages/ui/src/i18n/locales/zh.json
packages/ui/src/pages/CodingIDE.tsx
packages/ui/src/pages/FileViewer.tsx
packages/ui/tailwind.config.js
packages/ui/tsconfig.json
packages/ui/vite.config.ts
tests/unit/db-repositories.test.ts
