# 已移除規則與理由（產品調校紀錄）

掃描目標：產品碼（packages/ + scripts/）。`tests/` 已列入掃描排除（測試刻意練危險 pattern）。

## missing-template-string-indicator（2026-10-02 移除）

- 原 community AST 規則：flag 模板字串內任何 `{...}`（懷疑漏 `$`）
- 全 repo 58 筆全數人工複核：**真 bug 0**。真實站點（context-engine.mjs:63、proc-ledger.mjs:130 兩筆可轉一般字串）已修；其餘皆刻意內容：
  - SSE payload 文稿 `{...}`、PowerShell 變數、`^{commit}` git 語法
  - browser init script 多行 JS（`{}` 是程式內容）
  - UI 顯示物件形狀（`{ id, path, role }`）、`<style>{`...`}` JSX CSS
- AST 無法區分「漏 $」與「刻意顯示 {…} 給使用者看」→ 雜訊率 100%，移除

## i18next 規則夾（2026-10-02 移除，見原 tombstone）

- 產品未用 i18next（自研 i18n），全誤報
