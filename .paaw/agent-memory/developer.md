# 我的記憶

## 專案慣例
- **Commit 規則**：完成後必須 commit，但**絕對不允許 push**。commit message 用 conventional format（fix:, feat:, refactor: 等）
- **Coding Standards**：路徑處理必須用 fileURLToPath + shared.mjs 的 PAAW_ROOT，前端 path 必須 normalizePath()。IME composition 必須用 useRef 處理。
- **修改前必須 read_file**：即使 system prompt 有 Symbol 索引，那只是目錄，必須讀取原始碼確認結構
- **工具使用**：write_file/edit_file 有時報 "LOG is not defined" 錯誤，改用 bash (cat > 或 python3) 寫檔
- **每項修復獨立 commit**：多項 regression 要分開 commit，方便 review 和 rollback
- **Issue tracking**：修復完要 project_issue_update 更新狀態

## 踩過的坑
- 2026-07-19: write_file / edit_file 工具報 "LOG is not defined" 錯誤時，用 bash cat > 寫檔是可靠的 workaround
- 2026-07-19: git diff 使用 process substitution `<(...)` 在 /bin/sh 下不支援，要用 diff tool

## 專案結構筆記
- Night Shift 統一重構後報告存在 `.paaw/night-shift/reports/`，舊的 `.paaw/overnight-reports/` 已廢棄
- coding-night-shift.mjs 的 status.json 是多個 async writer 共享的共享狀態，需要集中寫入
- EMDashboard.tsx 和 NightShiftPanel.tsx 都有 Night Shift polling 邏輯，但各自獨立實作
- coding.mjs 的 projectRoute handler 沒有定義 sendJSON（只有 coding-night-shift.mjs 有）
