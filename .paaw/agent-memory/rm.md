# Release Manager 記憶（Piotr Nowak）

## 放行決策記錄

### Release #2026.08.23 — ❌ 不建議放行（首次發布，二次審查維持）
- **最大風險**：F-017 interrupt 修復（NO TESTS、abort 併發邏輯）× F-014 429 fallback（橫切 12 檔所有 LLM 路徑）複合失效。最壞情況：Night Shift 無人值守時段 zombie stream 級聯燒 token，察覺盲區 6-8 小時。
- **新增卡點（02:49 審查確認）**：12 failing 根因 = `auto-dispatch-shared.mjs:87` PaawProject 未 import 的**生產 bug**，到審查時仍未修 → F-008 Night Shift 上線即壞（gatherContext 是 EM 規劃第一步）。我實跑 vitest 重現 12✗/302✓。
- **abortSignal wiring 已核對正確**：runAgentLoop(3374) → callLLM(2925) → fetchStreamWithRetry(2999) 直通 fetch。code 是對的，但零 regression test，行為未驗證。
- **補強清單（半天）**：一行 import 修復 → unit 全綠 → npm run build + type-check → interrupt regression test。完成後降 MEDIUM 改口放行。
- **回滾錨點**：首次發布無 prior release，部署前必須先 `git tag pre-release-2026.08.23`，出事只能 hotfix-forward。
- **手動驗證順序（若勉強上線）**：Night Shift 啟動（會撞 PaawProject crash）→ 長任務按停止看 stream 秒停 → 限流一個 provider 看 fallback。

## 審查手法（可複用）

1. **實跑重現測試數字，不信報告** — 證據包報告 hash 全 undefined、test gate 顯示 pass 但實際 12 failed（gate 只看 pass-rate）。數字類證據一律抽查重跑。
2. **failing tests 要看錯誤類型分類** — `ReferenceError: X is not defined` 在 import 鏈上 = 生產 bug，不是 test 寫錯。12/12 同一錯誤 = 單一根因，修一行即全綠。
3. **「tests ✓」的 feature 也要驗測試本身是綠的** — F-008 標 tests ✓，但它的測試正在 failing。risk-signal 只看「有沒有對應測試」，不看「測試有沒有過」。
4. **removed endpoint 要 grep 殘留呼叫** — F-008 移除 em-run endpoint，grep ui+server 零殘留才算乾淨。
5. **clean-tree warn 要分類 dirty 檔案** — dirty 檔若是 runtime state（.paaw/ cache、logs/、data/）屬低風險雜訊。
6. **NO TESTS 併發修復仍要核對 wiring** — 不能只看 risk-signal 就假設 code 有問題；grep signal 傳遞鏈（loop→callLLM→fetch）確認接線正確，剩下的風險才是「行為未驗證」而非「code 錯」。
7. **複合風險大於單項風險** — 無測試併發邏輯 × 橫切面大的變更，同一 release 上線要視為放大器。

## 專案慣例

- 老闆固定問題格式：「最大風險是什麼？最壞情況？」/「測試涵蓋了什麼？沒測到什麼？」→ 回答必帶：受影響功能清單 + 察覺時間表 / 涵蓋層級矩陣 + 補測成本估計。
- gates 狀態 build/type-check not-run 在本專案是常見欠帳，審查時列為硬門檻。
- vitest `--reporter=basic` 在本環境會 ERR_LOAD_URL，用預設 reporter 跑。
