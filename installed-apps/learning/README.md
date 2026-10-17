# learning 模組 — 小元寶學習空間

> Persona app module（`installed-apps/learning/`）。掛載於 PAAW 單一底座（4097），資料隔離在 `data/installed-apps/learning/`（gitignored）。
> 模組開發通則（scaffold、shim、鐵律）見 `data/knowledge/app-modules.md`；本 README 記錄**本模組的 API 契約與 UI 行為契約**。

## 組成

| 層 | 檔案 | 說明 |
| --- | --- | --- |
| 主頁面 | `ui/pages/LearningSpace.tsx` | 學習空間工作台（課程樹、練習、對話） |
| 元件 | `ui/components/ExamVault.tsx` | 試卷金庫：收件 → LLM 解析 → 校訂 → 發佈 → 錯題本 |
| 元件 | `ui/components/TeacherChatPanel.tsx` 等 | 科目教師對話、課程表、測驗引擎（`quiz/`） |
| Server | `server/routes/exam-vault.mjs` `learning-practice.mjs` `quiz-session.mjs` | URL 前綴 `/api/exam-vault/*` 與 `/api/learning/*`（quiz 與 practice 共用 learning 前綴） |

## ExamVault API 契約（前端呼叫視角）

所有呼叫經 `ExamVault.tsx` 的 `api()` helper：統一 JSON 解析、`!r.ok` 時 throw `d.error || HTTP <status>`、**AbortController timeout**（見下節）。

| Endpoint | Method | 用途 | 前端 timeout |
| --- | --- | --- | --- |
| `/api/exam-vault/subjects` | GET | 科目清單 | 30s |
| `/api/exam-vault/units?subject=` | GET | 單元清單 | 30s |
| `/api/exam-vault/exams?subject=` | GET | 試卷清單（`parsing` 狀態時每 4s 輪詢） | 30s |
| `/api/exam-vault/exams/:id` | GET / PATCH / DELETE | 單卷詳情 / 校訂 / 刪除 | 30s |
| `/api/exam-vault/exams/:id/publish` | POST | 發佈（未發佈才可） | 30s |
| `/api/exam-vault/exams/:id/reparse` | POST | 重新解析（LLP 長時操作） | 30s |
| `/api/exam-vault/questions/:id` | PATCH | 題目校訂 | 30s |
| `/api/exam-vault/wrong?subject=&...` | GET | 錯題本查詢 | 30s |
| `/api/exam-vault/upload` | POST | 圖片上傳收件（dataUrl pages） | **120s** |
| `/api/exam-vault/url` | POST | URL 收件 | 30s |
| `/api/exam-vault/backup` | POST | 備份 | **120s** |

### Timeout 行為（TASK-168 M1，commit 2219de72）

- `api(path, init, timeoutMs = 30000)`：以 `AbortController` 實作；逾時 abort 後 throw `API_TIMEOUT_ERROR` 常數，呼叫端經 `apiErrText()` 轉成在地化訊息 `exam-vault.error.timeout`（i18n 四語系）。
- **為什麼**：`/reparse` 等長時 LLM 操作若 server hang，busy 狀態會永久卡死、按鈕永久 disabled；timeout 保證 busy 一律釋放。
- **放寬規則**：只有 server 端已知長時的操作放寬——`upload`/`backup` 120s（對齊 server `execFile` timeout 120s）。新增端點時預設 30s，確有長時需求才放寬並在呼叫點註明原因。
- 錯誤顯示：`catch` 一律走 `apiErrText(e)` — timeout 顯示在地化訊息，其餘顯示 server error 或 `HTTP <status>`。

## UI 行為契約（TASK-168，2026-10-18 起）

### 鍵盤與可達性（M2/M3）

- **課程樹**（`LearningSpace.tsx` 左欄 subject/unit/concept 列）：每列 `role="button"` + `tabIndex` + `aria-expanded`，Enter/Space 觸發展開/選取；keydown 有 IME `isComposing` guard（輸入法組字中不誤觸）。
- **Escape 關閉**：
  - `ExamVault` 原圖對照 modal（wrongImg）：Escape 或點外部關閉；
  - `ExamVault` 教師對話浮動面板（teacherChat）：Escape 關閉；
  - 兩者皆在 IME composition 中不觸發，關閉時**焦點歸還開啟前的觸發元素**（鍵盤用戶不會「掉出」文件）。
- **emoji-only 按鈕**（🗑 🔄 ◀ ▶ ✕ 等 7 顆）：皆掛 `aria-label`，文案走 `exam-vault.action.*` i18n keys（zh/zh-mix/en/ja 四檔）。

### 對話存檔與原子性（M4）

- 自動存檔（debounce）：檢查 `res.ok`，失敗以 `console.warn` 記錄（供 debug），**不打斷使用者輸入**；server 狀態由下一次輪詢/存檔自然恢復。
- `startNewConversation`（開新對話）三步驟**原子化**：POST 存檔 → DELETE active → 清空 UI。任一步 `!res.ok` 即中止且**不清 UI**——避免「POST 成功、DELETE 失敗」造成 UI 已清空但 server 仍有 active 對話的分歧。

## 測試

`tests/unit/learning-task168-hardening.test.mjs`（42 tests，TASK-051 tester 階段，commit 4378a9f7）以雙層策略釘住上述行為契約：

- **Layer A 靜態契約掃描**：讀原始碼文字斷言 M1–M4 修復存在（timeout、鍵盤屬性、Escape/focus、原子化存檔）；未來改壞任一修復即紅燈。
- **Layer B 可執行語意重現**：以 mock fetch / fake timers 重現 `api()` wrapper、`apiErrText`、Escape 判斷、三步驟歸檔、debounce 存檔的行為（happy path / 失敗 / IME 邊界）。
- 為何不直接 import 元件：vitest workspace 跑在 node 環境（無 jsdom/@testing-library），且沙箱禁止安裝新依賴——同 ADR-022 先例。

## 變更記錄

- **2026-10-18** TASK-168（TASK-051 retrofit）：修復 QA qr-20261017-162804-uvyl 4 項 Major（M1 timeout / M2 鍵盤 / M3 Escape+aria / M4 原子化），commit `2219de72`；測試 `4378a9f7`。行為契約以本文件為準。
