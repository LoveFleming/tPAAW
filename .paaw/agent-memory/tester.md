# Test Agent (Divya) — 長期記憶

## 專案慣例
- 測試檔案放在 `tests/unit/` 目錄，命名為 `*.test.mjs`
- 使用 Vitest 測試框架，設定在 `vitest.config.ts`
- 測試風格：`import { describe, it, expect, vi } from "vitest"`
- 使用 `vi.mock()` 來 mock 外部相依模組
- Module-level 常數（非 export）不能直接測試，要用公式驗證方式測
- Feature mapping 維護：新增測試檔案需要 update_mapping 到對應 feature

## 踩過的坑
- `_agentCfgDefaults` 是內部常數，沒有被 export，不能對其做 `.toBeDefined()` 
- `write_file` tool 在某些情況下會報 `snapshotTaken is not defined` 錯誤，可能是內部執行環境問題
- 用 `cat > file` 寫檔比 `write_file` 穩定

## 測試策略筆記
- 測試 `effectiveMaxTurns` 邏輯時，因為 `runAgentLoop`/`runAgentLoopStream` 內部會 call LLM API 且有複雜狀態（snapshot、file tracking 等），完整 mock 整支函式風險較高
- 更好的策略：測試公式本身（nullish coalescing）+ 測試 loop boundary + 測試模組匯出
- AAA 模式：Arrange（準備參數）/ Act（執行公式）/ Assert（驗證結果）