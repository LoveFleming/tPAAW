# 🛡️ SRE 室（sre module）— prototype base v0.2.0

> **Base = Fleming 提供的 `paaw-sre-prototype.zip`**（React+Vite+TS 單檔原型，繁中 UI，模擬資料）。
> 本模組把它移植成 PAAW module 頁面（`ui/pages/SreOffice.tsx`），可在 PAAW 側欄 **EXECUTION → SRE 室** 開啟。

## 目前內容（prototype）

| 位置 | 說明 |
|---|---|
| `ui/pages/SreOffice.tsx` | 原型主體（6 頁：總覽 / 自動巡檢 / Grafana 監控 / 異常事件 / AI Agent 工作區 / 設定） |
| `ui/styles/sre.css` | 原 `style.css`，**全部選擇器加 `.sre-app` 前綴**（避免污染 PAAW 全域樣式）；`@keyframes spin` → `sre-spin` |
| `ui/components/` | 舊版（server-backed 版）留下的面板元件，目前未被引用（保留供後續接線） |
| `server/routes/` | 舊版留下的 API 骨架（服務註冊表 / 檔案櫃 / sheets / Grafana 巡檢 / 簡報），目前未被原型引用 |
| `crews/` | 8 個 SRE 職能 crew 模板（mount 時同步到 `data/crews/sre.*.json`） |

## 邊界（沿用原型的設計意圖）

- **純模擬資料**（`initial` services 寫死在 `SreOffice.tsx`）
- **助理為規則式回覆**，未連接 LLM、Grafana、Prometheus、K8s、NATS
- 「執行模擬巡檢」只是 850ms timer，**不會連線或修改任何真實系統**

## 開發

```bash
# PAAW 內：改 installed-apps/sre/** 後，模組頁免 build（runtime esbuild bundle）
#   → 側欄 EXECUTION → SRE 室 重新整理即可；CSS 的「新 class」若不在既有掃描範圍才需 npm run build
npm start           # PAAW（port 4097）
```

要重新從原版產生檔案（會覆蓋 `ui/pages/SreOffice.tsx` + `ui/styles/sre.css`）：
`node <repo>/port-sre.mjs`（原始碼在 `~/Downloads/paaw-sre-prototype`）

## 下一步（接真資料時）

把 `SreOffice.tsx` 的 mock state 換成 `server/routes/*` 的 API 呼叫：
`services.mjs`（服務註冊表）→ `grafana.mjs`（真 Grafana 巡檢）→ `dossiers.mjs`（報告落檔）
→ audit trail。憑證一律放後端，前端不碰。
