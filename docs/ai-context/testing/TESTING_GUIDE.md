# Testing Guide

> 所有數字都可驗證

## 目前測試

### Unit Tests（4 個）

| 檔案 | 測試內容 | 驗證 |
|---|---|---|
| `tests/unit/ai-settings.test.mjs` | AI 設定 CRUD | `cat tests/unit/ai-settings.test.mjs \| head -10` |
| `tests/unit/context-engine.test.mjs` | Context Engine 組裝 | `cat tests/unit/context-engine.test.mjs \| head -10` |
| `tests/unit/providers.test.mjs` | Provider 設定 | `cat tests/unit/providers.test.mjs \| head -10` |
| `tests/unit/skill-format.test.mjs` | Skill 格式驗證 | `cat tests/unit/skill-format.test.mjs \| head -10` |

> 驗證檔案數：`ls tests/unit/ | wc -l` → 4

### E2E Tests（5 個）

| 檔案 | 測試內容 | 驗證 |
|---|---|---|
| `tests/e2e/01-smoke.spec.ts` | 基本頁面載入 | `head -10 tests/e2e/01-smoke.spec.ts` |
| `tests/e2e/02-settings.spec.ts` | 設定頁面 | `head -10 tests/e2e/02-settings.spec.ts` |
| `tests/e2e/03-notes.spec.ts` | 筆記功能 | `head -10 tests/e2e/03-notes.spec.ts` |
| `tests/e2e/04-pages.spec.ts` | 頁面導航 | `head -10 tests/e2e/04-pages.spec.ts` |
| `tests/e2e/05-api.spec.ts` | API 基本測試 | `head -10 tests/e2e/05-api.spec.ts` |

> 驗證檔案數：`ls tests/e2e/*.spec.ts | wc -l` → 5

---

## 測試覆蓋範圍

✅ 有覆蓋：
- AI 設定 CRUD
- Context Engine 基本功能
- Provider 設定
- Skill 格式
- 基本頁面載入/導航
- 設定/筆記 UI

---

## 缺少的測試

### 🔴 關鍵缺失（核心功能沒有測試）

| 缺失 | 影響 | 建議優先級 |
|---|---|---|
| Tool Engine ReAct loop | Chat 核心沒測 | P0 |
| Chat SSE streaming | 主要功能沒測 | P0 |
| App Tool 動態產生 | 工具產生邏輯沒測 | P0 |
| Agent Loop 工具執行 | Coding IDE 沒測 | P1 |
| Security Kernel 攔截 | 安全沒測 | P1 |
| LLM retry 邏輯 | 錯誤處理沒測 | P1 |

### 🟡 次要缺失

| 缺失 | 建議優先級 |
|---|---|
| App Data CRUD | P2 |
| Workflow 執行 | P2 |
| Cron 排程 | P2 |
| Bridge sync | P2 |
| Context Engine 各 target 完整覆蓋 | P2 |
| Provider adapter 串流解析 | P2 |
| i18n locale key 一致性 | P3 |

---

## 建議補充的 Unit Tests

### P0: tools/index.mjs

```js
// 建議測試案例
describe('tools/index.mjs', () => {
  it('extractFields() parses schema.properties')
  it('extractFields() parses schema.items.properties (array)')
  it('extractFields() falls back to legacy fields array')
  it('checkRequired() checks top-level required array')
  it('checkRequired() checks oneOf[].required')
  it('getDataShape() returns "array" / "object" / "none"')
  it('buildToolDefinitions() generates 5 tools for array dataShape')
  it('buildToolDefinitions() generates 2 tools for object dataShape')
  it('buildToolDefinitions() generates 1 tool for skill-based')
})
```

### P0: llm-utils.mjs

```js
describe('llm-utils.mjs', () => {
  it('sanitizeContent() removes zero-width chars')
  it('isMeaningfulContent() returns false for empty/whitespace')
  it('isMeaningfulContent() returns false for punctuation-only')
  it('calcBackoff() respects exponential + jitter range')
  it('isRetryableError() identifies 429/500/502/503/504')
  it('isRetryableError() identifies ECONNRESET/ETIMEDOUT')
})
```

### P1: tool-engine/index.mjs

```js
describe('tool-engine', () => {
  it('detectToolError() catches error/success:false/❌')
  it('verifyWriteResult() confirms add via _get')
  it('verifyWriteResult() confirms delete via _list')
  it('looksLikeFakeToolCall() detects markdown tool patterns')
})
```

### P1: security/index.mjs

```js
describe('SecurityKernel', () => {
  it('blocks rm -rf / in exec')
  it('blocks wget http:// in exec')
  it('blocks writes to /data/config/')
  it('allows normal tool calls')
  it('respects approval mode')
})
```

---

## 建議補充的 Integration Tests

### P0: Chat → Tool Engine → SSE

```js
describe('Chat integration', () => {
  it('POST /api/paaw/chat returns SSE stream')
  it('SSE stream includes text content')
  it('tool calls appear in SSE stream')
  it('tool results appear in SSE stream')
  it('stream ends with [DONE]')
})
```

### P1: App CRUD → Tool generation → Chat calling

### P1: Skill Test → Agent Loop → file output

---

## 如何避免 Regression

1. **每次改動跑：** `npm run test`
2. **改了前端：** 至少跑對應頁面的 E2E test
3. **改了 API：** 跑 E2E API test + 手動 curl
4. **改了 Tool Engine：** 手動測 chat tool calling
5. **CI 建議：** 設 GitHub Actions 跑 `npm run test && npm run test:e2e`
