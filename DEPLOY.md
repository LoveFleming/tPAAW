# DEPLOY — 第 8 包：Release Request v2（UI）+ v3（RM agent 建議 + per-task 自動 RR）

> 日期：2026-09-18 ｜ 上游 `8efd63ba`（v2）+ `ff0c08ad`（v3）｜ 15 檔
> **含 UI 變更：蓋檔後要 `npm run build` + 重啟 server**

## 這包做什麼

**v2 — Release Manager UI 操作面**：Release Manager 頁（🚦）新增「📋 Release Requests」區（最上方）：
建單（baseline 下拉：自動建議 + 最近 20 commits）→ 開審（鎖 baseline）→ checklist 四項證據審查
（pass / fail / waive，waive 必填原因）→ 結案放行。原本 per-task approve 待放行區保留共存。

**v3 — RM agent 整合**：
- 「🤖 請 AI 審查建議」：RM side chat 用 `rr_get` 讀證據 → `rr_suggest` 寫建議 verdict（每項附理由）
- 每項建議顯示徽章；「⚡ 一鍵套用 AI 建議」只套 pending 項（人下過 verdict 不覆蓋）— **AI 只建議，人決定**
- per-task approve（快速路徑）自動建一張已結案的 RR — 審計軌跡統一，scope 限定該 task 不誤放行
- approve 寫的 REL 現在也存 target SHA（之後 auto baseline 精確銜接）

## 檔案清單（蓋到 tPAAW 相對路徑）

| 狀態 | 檔案 |
|---|---|
| M | `packages/server/src/lib/release-requests.mjs` |
| M | `packages/server/src/routes/coding-releases.mjs` |
| M | `packages/server/src/lib/paaw-agent-loop.mjs` |
| A | `packages/ui/src/components/ReleaseRequests.tsx` |
| M | `packages/ui/src/components/ReleaseManagerPanel.tsx` |
| M | `packages/ui/src/i18n/locales/zh.json` |
| M | `packages/ui/src/i18n/locales/en.json` |
| M | `packages/ui/src/i18n/locales/ja.json` |
| M | `packages/ui/src/i18n/locales/zh-mix.json` |
| M | `data/crews/coding.rm.json`（+release-requests group；rolePrompt 加 RR 審查流程） |
| M | `data/crews/coding.em.json`（+release-requests group） |
| M | `data/crews/coding.architect.json`（+release-requests group） |
| M | `.paaw/agents/coding.rm.json`（override +release-requests group） |
| M | `.paaw/agents/coding.em.json`（override +release-requests group） |
| M | `.paaw/agents/coding.architect.json`（override +release-requests group） |

## 步驟

1. 照上表蓋檔（A = 新檔）
2. `npm run build`（UI 有變更）
3. 重啟 server（`node src/paaw-server.mjs`）
4. 冒煙：打開 Coding app → Release Manager 🚦 → 最上方出現「📋 Release Requests」區；
   `GET /api/coding-releases/requests?path=<專案>` 回 JSON

## 新 API / 新 tool

```
POST /api/coding-releases/requests/:id/suggest   AI 建議 verdict { path, items:[{itemId,verdict,reason}] }
GET  /api/coding-releases/requests/:id?light=1   唯讀單張（不觸發 auto 重跑 — UI 輪詢用）

agent tools（release-requests group — rm/em/architect）：
  rr_list     列 RR（id/status/checklist verdicts）
  rr_get      單張完整證據（scope + checklist auto 明細 + 既有建議）
  rr_suggest  寫建議 { id, items:[{itemId, verdict, reason}] } — 只建議，人類 UI 確認
```

## 備註

- ⚠️ 其他 RU（agent-sre 等）若有自己的 `.paaw/agents/*.json` override，要手動把
  `release-requests` 加進 rm/em/architect 的 `toolGroups`（不加就沒這三個 tool，不影響其他功能）
- per-task approve 自動 RR：在 approve 主流程「寫完 REL、寫 TASKS.json 之前」插入 —
  此時磁碟上 task 仍 pending，scope 才抓得到；失敗不擋批准（console.warn）
- AI 建議輪詢用 `?light=1`（5s × 最長 2.5 分），建議落地即停 — 不會狂重跑 auto 檢查
- RR runtime 資料在 `.paaw/release-requests/`（不進 git）
