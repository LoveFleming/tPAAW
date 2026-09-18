# DEPLOY — RR checklist 擴充七項：security scan + ops + handover

> 日期：2026-09-18 ｜ 上游 `12edf146` ｜ 3 檔
> **純 server 變更：蓋檔後重啟 server 即可（UI 不用 rebuild）**

## 這包做什麼

Release Request checklist 從四項變七項（Fleming 定案：維運/交接/安全掃描進 release 流程，保持簡單不 加審批序列）：

- 🔒 **security** — 讀 `.paaw/security/scan-results.json`（semgrep 掃描結果），只計這次 release 動到的檔案；ERROR→fail、WARNING→warn；掃描後有新 commits 會警告過期
- 🔧 **ops** — 找部署/回滾文檔（DEPLOY.md / README）；依賴變更（package.json 等）會加提醒；verdict = 維運簽核
- 🤝 **handover** — 讀 handover state 新鮮度；verdict = 接手方簽核

既有 RR 單自動補齊新三項（已結案的舊單記 waived + 註記，進行中的等人審）。

## 檔案清單

| 狀態 | 檔案 |
|---|---|
| M | `packages/server/src/lib/release-requests.mjs` |
| M | `data/crews/coding.rm.json`（rolePrompt 七項描述 + promptRev） |
| M | `.paaw/agents/coding.rm.json`（override 補 RR 工作流 rolePrompt — override 是完整覆蓋，global 加了會被蓋掉） |

## 步驟
1. 蓋 3 檔 → 重啟 server
2. 測：打開 Coding app → Release Manager → 展開任一 RR → checklist 應為七項

## 備註
- ⚠️ 其他 RU 有自己的 `.paaw/agents/coding.rm.json` override 的，rolePrompt 也要手動補 RR 工作流段落（或刪掉 override 讀 global）
- security 證據源是 `.paaw/security/scan-results.json` — 先跑過 semgrep 掃描（coding app 的 security 功能）才有數字
