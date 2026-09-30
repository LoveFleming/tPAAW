# Deploy — 502 全鏈路防護 + ⚡ Tool Calls 面板三連修（2026-09-30 v4）

上游：dev `ced0fbff`

## 這包修什麼

### ① 公司 LLM 502 → agent loop 停住（主修復）
502 重試用完後舊邏輯不進 fallback → 整單死（chat UI 印 error、要手動開新對話）。
本包讓全鏈路（規劃/決策/agent 執行/審核）遇 5xx/408 都切 fallback，同一個 run 跑完。

### ② ⚡ 面板凍結（run done 後停止輪詢）
舊 poller 看到 run done 就永久停止 → 後續 run（自動重派/下一張 task）的 tool calls 永遠接不回。
改為 done 後 10s 慢速續投，新 run 自動接回重播。

### ③ 接回 race（短 run 事件整包丟失）
新 run 在接回重拉前就 done → 舊條件把事件丟掉 → 面板空。改為 events 有料就吃。

### ④ ⚡ 面板加 run 身份標籤（新功能）
面板標題顯示 `agent · 開始時間 · N calls` — 直接辨識內容屬於哪個 agent/run，
「看起來像別的 agent 的內容」一眼現形或排除。

## 覆蓋檔案（5 檔：4M server + 1M UI）

| 狀態 | 路徑 | 說明 |
|---|---|---|
| M | `packages/server/src/lib/paaw-agent-loop.mjs` | agent 執行層 5xx/408 fallback |
| M | `packages/server/src/lib/llm-utils.mjs` | callLLMWithRetry 4xx/5xx fallback |
| M | `packages/server/src/lib/em-orchestrator.mjs` | EM 決策 fallbacks 空時用預設鏈 |
| M | `packages/server/src/lib/auto-dispatch-manager.mjs` | EM 規劃同上 |
| M | `packages/ui/src/pages/CodingIDE.tsx` | 面板凍結 + 接回 race + run 身份標籤 |

## 步驟（公司 SOP）

1. 五個檔案照相對路徑蓋到 tPAAW
2. `npm run build`（**有 UI 檔，必跑**）
3. 重啟 server
4. `node scripts\pack.mjs --skip-build`
5. 瀏覽器**硬重整**（Ctrl+Shift+R）— 舊 index.html 快取會繼續載舊 JS

## 驗收

- 502 → log `trying fallback` → 同一任務跑完，不用開新對話
- EM 派工切到該 agent 的 tab：⚡ 面板出現，標題有 agent 名 + 時間 + call 數
- 連續派工/自動重派的後續 run：面板自動接回，不用切 tab 重進
- 面板標籤的 agent 名和所在 tab 一致 → 若不一致 = 找到交叉污染，回報 OpenClaw

## 備註

- `data/config/user.json` → `preferences.*Fallback` 舊值 `...v4-flash`（無 -0731）改成 `-0731` 或刪 key
- 502 fallback 前提：providers.json / user.json 至少一組公司 LLM 以外的備援
