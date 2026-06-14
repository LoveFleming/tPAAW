# Vibe Coding 開發環境

Vibe Coding 是 PAAW 內建的程式碼開發環境，支援檔案編輯、Git 操作、API 測試、終端機。

## 核心功能

1. **檔案編輯器** — 瀏覽和編輯專案檔案，3 秒自動存檔
2. **Git 操作** — diff view, blame, commit, branch, AI code review
3. **API 測試** — Postman-like 的 HTTP 請求工具
4. **終端機** — 內建 CLI terminal session
5. **AI Chat** — 對檔案問問題

## 檔案操作

- 點擊檔案開啟編輯
- 修改後 3 秒自動存檔 (auto-save)
- 支援多 tab 編輯
- 檔案修改狀態：modified / unsaved / tracked

## Git 操作規範

- 所有 git 操作都應先查看 diff 確認變更
- commit message 應簡潔明確
- AI Review 前先查看 diff，再按「New Review」
- 不應自動 push 到遠端，需使用者確認

## API 測試

- 支援 GET / POST / PUT / DELETE
- 可設定 Headers 和 Body
- 請求歷史會保留
- 支援快速 URL 快捷鍵