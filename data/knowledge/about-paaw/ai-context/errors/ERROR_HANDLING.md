# Error Handling Guide

> 每個錯誤處理都附驗證指令

## 錯誤類型總覽

| 錯誤類型 | 來源 | 位置 | 驗證 |
|---|---|---|---|
| LLM API 連線失敗 | llm-utils.mjs | `fetchWithRetry()` | `grep "RETRYABLE_STATUS\|RETRYABLE_ERR_CODES" packages/server/src/lib/llm-utils.mjs` |
| LLM 回空白/隱藏字元 | llm-utils.mjs | `isMeaningfulContent()` | `grep "isMeaningfulContent\|sanitizeContent" packages/server/src/lib/llm-utils.mjs` |
| LLM 假裝 tool call | tool-engine/index.mjs | `looksLikeFakeToolCall()` | `grep "looksLikeFakeToolCall\|FAKE_TOOL_PATTERNS" packages/server/src/lib/tool-engine/index.mjs` |
| Provider 無 API key | chat.mjs | 直接 400 | `grep "apiKey.*na\|No API key" packages/server/src/routes/chat.mjs` |
| Tool 執行失敗 | tool-engine/index.mjs | `detectToolError()` | `grep "detectToolError" packages/server/src/lib/tool-engine/index.mjs` |
| 寫入驗證失敗 | tool-engine/index.mjs | `verifyWriteResult()` | `grep "verifyWriteResult" packages/server/src/lib/tool-engine/index.mjs` |
| Security 攔截 | security/index.mjs | Policy pipeline | `grep "blocked.*true\|SecurityKernel" packages/server/src/lib/security/index.mjs` |
| 檔案不存在 | routes/*.mjs | try/catch fallback | `grep "catch.*return.*\[\]" packages/server/src/routes/apps.mjs` |
| WS 斷線 | ws-handler.mjs | PTY kill | `grep "ws.on.*close\|pty.kill" packages/server/src/websocket/ws-handler.mjs` |

---

## Retry 機制詳解

### llm-utils.mjs 的 fetchWithRetry

- **最多 5 次 retry**
- **Exponential backoff**：base 2000ms, max 30000ms, jitter 50%~100%
- **Retryable HTTP status**：408, 429, 500, 502, 503, 504
- **Retryable error codes**：ECONNRESET, ECONNREFUSED, ETIMEDOUT, ENOTFOUND, EAI_AGAIN, EPIPE, EHOSTUNREACH, ENETUNREACH, UND_ERR_*
- **尊重 Retry-After header**（cap 60s）

> 驗證：`grep -n "DEFAULT_MAX_RETRIES\|DEFAULT_BASE_DELAY\|RETRYABLE_STATUS\|RETRYABLE_ERR_CODES" packages/server/src/lib/llm-utils.mjs`

### callLLMWithRetry（非串流版）

- 內層 fetch **不 retry**（maxRetries=0），由外層統一控制
- 空白/隱藏字元回應也算 retry 條件
- 最終仍空白 → 回傳空字串讓 caller 處理

> 驗證：`grep "maxRetries: 0\|validateContent\|isMeaningfulContent" packages/server/src/lib/llm-utils.mjs`

---

## 內容驗證機制

### sanitizeContent() — 清理隱藏字元

移除：BOM (U+FEFF), Zero-width spaces (U+200B-D), Invisible chars (U+00AD, U+2061-4), Direction marks, 連續空行

> 驗證：`grep -n "\\\\uFEFF\|\\\\u200B\|\\\\u200C" packages/server/src/lib/llm-utils.mjs | head -5`

### isMeaningfulContent() — 檢查有實質內容

- 空白/換行/tab → false
- 只有標點符號 → false
- 至少有非空白非標點 → true

> 驗證：`grep -A5 "function isMeaningfulContent" packages/server/src/lib/llm-utils.mjs`

---

## 假 Tool Call 偵測

**FAKE_TOOL_PATTERNS：**
- `> 🔧 **...**` — 假裝用 markdown 列出 tool call
- `> 📝 **...**` / `> 📋 **...**`
- `[Tool Call]` / `[Calling tool...]`
- `tool_call.*executing`

**處理方式：** 從 totalText 扣掉假的部分，追加提示要求用正確格式重試

> 驗證：`grep -A5 "FAKE_TOOL_PATTERNS" packages/server/src/lib/tool-engine/index.mjs`

---

## Result Validation

### Error Detection — detectToolError()

檢查 tool result 是否有：
- `result.error === true`
- `result.success === false`
- `result.text.startsWith('❌')`
- `result` 是 null/undefined

失敗時附加 `_instruction` 告訴 LLM 要如實告知使用者

### Success Verification — verifyWriteResult()

只對寫入操作（_add, _update, _set, _delete）：
- _add → 用 _get 回查 record.id
- _update → 用 _get 回查 args.id
- _delete → 用 _list 確認已不存在

> 驗證：`grep -n "extractVerifyId\|getVerifyToolName" packages/server/src/lib/tool-engine/index.mjs`

---

## 使用者體驗

| 情境 | 使用者看到 |
|---|---|
| LLM 正常回文字 | 串流文字逐字顯示 |
| LLM 呼叫工具 | 「🔧 pocket_add...」→ 「✅ pocket_add: 結果」 |
| 工具失敗 | AI 會說「操作失敗」而非假裝成功 |
| 連線錯誤 | 等待後收到 error SSE |
| Security 攔截 | AI 說「安全性攔截」 |
| Provider 未設定 | 頁面提示設定 API key |
