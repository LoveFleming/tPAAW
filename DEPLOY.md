# Deploy — EM 派工 ⚡ Tool Calls 全修復包（2026-09-30 v5）

上游：dev `be582cfc`

## 症狀 → 修復對照

| 症狀 | 修復 |
|---|---|
| 502 → run 死掉要手動開新對話 | 5xx/408 全鏈路進 fallback，同一 run 跑完 |
| EM chat 有 tool calls、開發 tab 只顯示思考中 | **message/send（EM 派工路徑）註冊 streamState 側車** — agent tab 面板復活（本包核心） |
| 面板凍結（run done 後不再更新） | poller done 後 10s 慢速續投，新 run 自動接回 |
| 接回時短 run 事件消失 | 重拉不再要求 run 未結束 |
| 分不清內容是哪個 agent 的 | 面板標題顯示 `agent · 時間 · N calls` |

## 覆蓋檔案（6 檔：5M server + 1M UI）

| 狀態 | 路徑 | 說明 |
|---|---|---|
| M | `packages/server/src/routes/a2a.mjs` | **本包核心** — message/send 註冊側車 + onEvent 映射 |
| M | `packages/server/src/lib/paaw-agent-loop.mjs` | agent 執行層 5xx/408 fallback |
| M | `packages/server/src/lib/llm-utils.mjs` | callLLMWithRetry 4xx/5xx fallback |
| M | `packages/server/src/lib/em-orchestrator.mjs` | EM 決策 fallbacks 空時用預設鏈 |
| M | `packages/server/src/lib/auto-dispatch-manager.mjs` | EM 規劃同上 |
| M | `packages/ui/src/pages/CodingIDE.tsx` | 面板凍結 + 接回 race + run 身份標籤 |

## 步驟（公司 SOP）

1. 六個檔案照相對路徑蓋到 tPAAW
2. `npm run build`（有 UI 檔，必跑）
3. 重啟 server（有 server 檔，必跑）
4. `node scripts\pack.mjs --skip-build`
5. 瀏覽器 **Ctrl+Shift+R** 硬重整

## 驗收

- EM 派工期間切到 developer tab：⚡ 面板出現（標籤：`developer · 時間 · N calls`），工具即時更新
- 502 → log `trying fallback` → 同一任務跑完，不用開新對話
- 已在本機煙霧測試：message/send 派工中 `exists:true`，事件鏈 tool→tool_result→thinking→content 齊全

## 備註

- `data/config/user.json` → `preferences.*Fallback` 舊值（無 -0731）補 `-0731` 或刪 key
- 502 fallback 前提：providers.json / user.json 至少一組公司 LLM 以外的備援
