# DEPLOY — release-prep 工具組：EM 一句話自動準備 release

> 日期：2026-09-18 ｜ 上游 `124b1b08` ｜ 5 檔
> **純 server 變更：蓋檔後重啟 server（UI 不用 rebuild）**

## 這包做什麼

跟 EM side chat 說「**準備 release**」（或「下班前把 release 弄好」），EM 自動：
1. 盤點（git 乾淨度 / open tasks / 證據缺口）
2. dispatch developer 收未 commit 的 code
3. 全部 commit 後依序補證據：測試全套 → semgrep 掃描 → verify → handover refresh
4. dispatch qa 做 QA review 落檔
5. 全綠回報「可以開 RR」

人的部分不變：Release Manager UI 開單 → AI 建議 → 簽核 → 結案。

## 新工具（release-prep group，em/rm 可用）
- `release_prep_status` — 一鍵盤點證據現況
- `test_run` — 跑全套測試落檔（同步等完成）
- `security_scan` — semgrep 掃描落檔
- `handover_refresh` — handover state 對齊 HEAD

## 順帶修復
`ru_verify` 等四個 release-unit 工具從未掛進 TOOL_GROUP_MAP（對所有 agent 不可見）— 已補。

## 檔案清單

| 狀態 | 檔案 |
|---|---|
| M | `packages/server/src/lib/paaw-agent-loop.mjs` |
| M | `data/crews/coding.em.json`（+工作流 rolePrompt + release-prep/release-unit group） |
| M | `data/crews/coding.rm.json`（+release-prep group） |
| M | `.paaw/agents/coding.em.json`（override 同步兩項） |
| M | `.paaw/agents/coding.rm.json`（override 同步） |

## 步驟
1. 蓋 5 檔 → 重啟 server
2. 測：EM side chat 輸入「準備 release」→ 看它跑 release_prep_status 開始盤點

## 備註
- ⚠️ 其他 RU 有自己的 coding.em/rm override 的要手動加 `release-prep`（要 verify 的話加 `release-unit`）進 toolGroups
- 公司舊版：EM 沒這些工具就只會照舊回答，不會壞
