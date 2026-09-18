# DEPLOY — release prep 加理解層（code understanding 先行）

> 日期：2026-09-18 ｜ 上游 commit ｜ 3 檔 ｜ 純 server，重啟即生效

## 這包做什麼
EM「準備 release」工作流補上 code understanding 步驟（在跑證據**之前**）：
1. `ru_model_refresh` — 重建 feature map（RR scope 的 features/apis 統計靠它）
2. `cu_refresh` — code intelligence 刷新

`release_prep_status` 也會顯示 feature map 新鮮度（落後 commits 警告）。

## 檔案
| 狀態 | 檔案 |
|---|---|
| M | `packages/server/src/lib/paaw-agent-loop.mjs` |
| M | `data/crews/coding.em.json` |
| M | `.paaw/agents/coding.em.json` |

## 步驟
蓋 3 檔 → 重啟 server。EM 說「準備 release」會先刷理解層再跑證據。
