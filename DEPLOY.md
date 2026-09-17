# DEPLOY — 第 7 包：Release Request API（上游 5a7316b8）

> 日期：2026-09-17 ｜ 3 檔 ｜ 純 server，**免 npm run build，重啟 server 即生效**

## 這包做什麼

Release Manager 新增 **Release Request（RR）單**：準備 release 時先請一張單，
baseline 用 commit SHA（上次 release 的 HEAD / 第一個 commit / 自選），
checklist 四項證據（tests / gates / QA 記錄 / 風險）全部 pass 或 waive 才能結案。
結案自動快照 REL + 批次放行範圍內 pending tasks。

## 檔案清單（蓋到 tPAAW 相對路徑）

| 狀態 | 檔案 |
|---|---|
| M | `packages/server/src/lib/change-intelligence.mjs` |
| A | `packages/server/src/lib/release-requests.mjs` |
| M | `packages/server/src/routes/coding-releases.mjs` |

## 步驟

1. 照上表蓋檔（A = 新檔）
2. 重啟 server（`node src/paaw-server.mjs`）
3. 冒煙：`GET /api/coding-releases/baseline-candidates?path=<專案>` 回 JSON 即可

## 新 API 一覽

```
POST   /api/coding-releases/request                 建單 { path, title?, baseline?: "auto"|SHA }
GET    /api/coding-releases/requests?path=&status=  列表
GET    /api/coding-releases/requests/:id?path=      單張（自動 refresh：target 前進 + auto 重跑）
PATCH  /api/coding-releases/requests/:id            draft 改 title / baseline
POST   /api/coding-releases/requests/:id/open       draft → reviewing（鎖 baseline）
POST   /api/coding-releases/requests/:id/checklist  審查一項 { path, itemId, verdict, note? }
POST   /api/coding-releases/requests/:id/close      結案 { path, note? }（全 pass/waived 才准）
POST   /api/coding-releases/requests/:id/cancel     作廢 { path, reason }
GET    /api/coding-releases/baseline-candidates     挑 baseline 用（auto + 最近 20 commits）
```

## 備註

- baseline auto 順序：上次 release 的 target SHA（新 REL 有存）→ 舊 REL 用日期抓當時 HEAD → first commit
- waiver 一定留 note；close 時 server 重跑自動檢查，fail 未 waive → 409 擋下
- checklist 項目定位：`tests`=上次 test run 真實數字+stale、`gates`=verify 門檻、
  `qa-records`=.paaw/coding-memory/qa-results.jsonl 未解決 fail、`risk`=readiness heuristic
- gates 指令推斷：JS/TS 全套、Python（pytest+ruff）、Go（build/vet/test）；其他語言暫 not-run
- RR runtime 資料在 `.paaw/release-requests/`（不進 git）
