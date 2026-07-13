# Test Evidence

> 功能驗收記錄。每次完成功能後更新。

## 驗收清單

| 日期 | 功能 | 測試方式 | 結果 | Commit |
|------|------|---------|------|--------|
| 2026-07-10 | Crew 對話持久化 | 手動：切 crew → 載入對話 → 發訊息 → 重整頁面 → 對話還在 | ✅ Pass | `4e0b70a` |
| 2026-07-10 | 歸檔系統 | 手動：點新對話 → 歸檔 → 列表看到歸檔 → 載入歸檔 → 繼續聊天 | ✅ Pass | `af498f4` |
| 2026-07-10 | Token budget | 手動：長對話 → 確認不爆 token → 確認 summary 注入 system message | ✅ Pass | `4e0b70a` |
| 2026-07-10 | Thinking history | 手動：AI 回應 → 展開 thinking → 確認 _thinkingHistory 有內容 | ✅ Pass | `20e8c5b` |
| 2026-07-10 | 6 Crew prompts | 手動：每位 crew 對話 → 確認 system prompt 含 expertise + guardrails | ✅ Pass | `783be36` |
| 2026-07-11 | 移除 risk/model/approvalMode | Build 通過 + 7 個 crew JSON 驗證無殘留欄位 | ✅ Pass | `79a9b57` |
| 2026-07-11 | expertise textarea | Build 通過 + crew JSON 格式驗證（string 非 array） | ✅ Pass | `703788a` |
| 2026-07-11 | 8 大知識檔案建立 | 8 個檔案全部存在且非空模板 | ✅ Pass | (本 commit) |

## 自動化測試

目前無自動化測試框架。每次變更以 `vite build` 為基本 smoke test：

```bash
cd packages/ui && npx vite build --mode development
# ✓ built = 前端編譯通過，無 type error
```

## 待整合
- [ ] Vitest 單元測試（packages/server, packages/ui）
- [ ] Playwright E2E 測試
- [ ] CI/CD pipeline（push → build + test）
