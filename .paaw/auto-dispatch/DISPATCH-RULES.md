# EM 調度規則說明

> EM（Engineering Manager）是 Auto Dispatch 的決策核心。每次啟動時，EM 會讀取專案現況，規劃工作清單，分配給各 agent 執行。

## EM 決策流程

```
1. 讀取專案現況（.paaw/ + git + config）
2. 根據 autoExecute 設定排除不做的類別
3. LLM 規劃工作清單（JSON array）
4. 逐項分派給 agent
5. 結案 → 產出報告
```

## autoExecute 設定

在 `.paaw/em/config.json` 裡控制哪些類別的工作可以自動執行：

| 類別 | 說明 | false 時行為 |
|---|---|---|
| `securityFix` | 安全漏洞修復 | 不規劃進 plan |
| `refactor` | 重構/重命名/搬移 | 不規劃進 plan |
| `breakingChange` | 破壞性變更/API 移除 | 不規劃進 plan |
| `tests` | 測試撰寫 | 不規劃進 plan |
| `docs` | 文檔撰寫 | 不規劃進 plan |

**規則：加進 plan 的項目就一定會被執行。false 的根本不會出現。**

## 可調度的 Agent

| Agent | 角色 | 專業範圍 |
|---|---|---|
| `architect` (林曉薇) | 架構師 | 系統架構、技術選型、ADR |
| `developer` (Priya Sharma) | 開發者 | TS/React/Node.js 全端 |
| `tester` (Divya Reddy) | 測試工程師 | Jest/Vitest/Playwright |
| `qa` (武大安) | QA | Code Review、品質把關 |
| `doc-writer` (Megan Brooks) | 文件撰寫 | 技術文件、API 文件 |
| `helpdesk` (小春 林) | 技術支援 | Debug、環境問題、FAQ |

## Security 掃描策略

- 如果 security scan 結果超過 7 天或不存在 → 先派 tester 跑 `cu_refresh(["security-scan"])`
- 根據 scan results（`.paaw/security/scan-results.json`）規劃修復 task
- 修復時參考具體 CWE 編號和檔案行號

## EM Prompt 結構

EM 的決策 prompt 寫在 `auto-dispatch-manager.mjs` 裡，包含以下動態區塊：

1. **排除提示** — 根據 autoExecute config 自動產生
2. **Agent 清單** — 從 crew 定義讀取
3. **調度策略** — `balanced`（平衡）/ `conservative`（保守）/ `aggressive`（積極）
4. **專案階段限制** — 根據 config 的 `phases` 設定
5. **規劃範圍** — Git Status + Action Log + PROJECT.md + STATUS.md + Security Findings
6. **Security 掃描策略** — scan 過期時優先派 tester
7. **輸出格式** — 嚴格 JSON array

## Plan 結案機制

- EM session 結束時，所有 pending/running sub-task 自動標 `skipped`
- `markPlanCompleted()` 確保 plan 不會卡在 `running`
- Plan 的 `summary` 統計 done/fail/skipped 數量

## 相關檔案

- `packages/server/src/lib/auto-dispatch-manager.mjs` — EM 決策 + 執行邏輯
- `packages/server/src/lib/execution-plan.mjs` — Plan 管理
- `.paaw/em/config.json` — EM 設定
- `.paaw/auto-dispatch/plans/` — Plan JSON 檔案
- `.paaw/auto-dispatch/report.md` — 最近一次報告
