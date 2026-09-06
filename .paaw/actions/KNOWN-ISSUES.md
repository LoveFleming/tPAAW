# Known Issues

> 已知問題清單。解決後標記 ✅ 並記錄解法。

## 🔴 Open

### KI-001: AGENT-MEMORY 目錄為空
- **影響：** AI 沒有跨對話記憶，每次新對話從零開始
- **Workaround：** 對話持久化可 partially 彌補（載入舊對話繼續）
- **優先級：** Medium
- **相關：** `agent_memory_save` / `agent_memory_load` tool 已存在但未被使用

### KI-002: 無自動化測試
- **影響：** 改完碼只能手動驗證，regression 風險高
- **Workaround：** 每次改完跑 `vite build` 當 smoke test
- **優先級：** High
- **相關：** TEST-EVIDENCE.md 待整合 section

### KI-003: Token budget 估算不精確
- **影響：** CJK 內容實際 token 數偏高（每字 ~2-3 token，估算用 4 chars/token）
- **Workaround：** 12000 budget 偏保守，安全側誤差
- **優先級：** Low
- **相關：** ADR-001

### KI-004: 跨平台路徑問題歷史債
- **影響：** Windows 上路徑處理容易出錯（`new URL().pathname` → `/C:/path`）
- **Workaround：** 已建立 CODING-STANDARDS.md 規範，但舊 code 可能殘留
- **優先級：** Medium
- **相關：** CODING-STANDARDS.md, MEMORY.md 跨平台路徑紀律

### KI-005: i18n 可能有硬編碼字串
- **影響：** 部分舊 UI code 可能有中文硬編碼，未走 `t()` 
- **Workaround：** 2026-07-01 已做一次完整 i18n 補全
- **優先級：** Low
- **相關：** CODING-STANDARDS.md i18n section

## ✅ Resolved

### KI-000: slice(-20) 上下文截斷
- **解法：** Token budget + 修剪消息總結（ADR-001）
- **解決日期：** 2026-07-10

### KI-RESOLVED-001: per-crew model 管理混亂
- **解法：** 移除 chatConfig.model，統一用 PAAW fallback chain（ADR-003）
- **解決日期：** 2026-07-11

### KI-RESOLVED-002: guardrails 用 tag 限制表達力
- **解法：** 改為 textarea（ADR-004）
- **解決日期：** 2026-07-11
