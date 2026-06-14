# Git 操作指引

## 基本流程

1. 修改檔案 → 自動偵測變更
2. 查看 diff → 確認變更內容
3. Stage 需要的檔案
4. 下 commit message → commit
5. （選擇性）AI Review → 檢查程式碼品質
6. Push（需使用者確認）

## Commit 規範

- commit message 格式：`type(scope): description`
- type: feat / fix / refactor / docs / test / chore
- scope: 影響的模組或目錄
- 描述用中文或英文，前後一致

## Branch 管理

- main / dev 為主線
- feature 分支命名：`feature/描述`
- bugfix 分支命名：`fix/描述`
- 完成後 squash merge 回 dev

## AI Code Review

- 先點 Diff 查看變更
- 按「New Review」讓 AI 分析
- Review 內容包含：架構、安全、效能、可讀性
- Review 結果可作為 commit 參考