# PAAW Testing Guide

> E2E + Unit tests 讓你改碼時有安全網。改壠了會先亮紅燈，不用等到跑起來才發現。
>
> 最後更新：2026-07-01

---

## 快速開始

```bash
# Unit tests（不需要 server，秒跑）
npm test

# E2E tests（需要 PAAW server 在 localhost:4097 跑著）
npm run test:e2e

# 全部跑
npm run test:all

# E2E 互動模式（瀏覽器視窗，可慢動作看每步）
npm run test:e2e:ui
```

---

## 測試架構

```
tests/
├── unit/                        # Vitest — 不需要 server
│   ├── context-engine.test.mjs  # Context Engine 7 個 target
│   ├── ai-settings.test.mjs     # AI Settings 檔案完整性
│   ├── providers.test.mjs       # providers.json 結構
│   └── skill-format.test.mjs    # SKILL.md 解析 + 格式
│
└── e2e/                         # Playwright — 需要 server
    ├── 01-smoke.spec.ts         # App 載入、導航
    ├── 02-settings.spec.ts      # Settings 頁面
    ├── 03-notes.spec.ts         # Notes 頁面 + model selector
    ├── 04-pages.spec.ts         # Mind Map, Projects, Skill Builder
    └── 05-api.spec.ts           # API 端點健康檢查（13 個）
```

---

## Unit Tests (Vitest)

### 覆蓋範圍

| 檔案 | 測什麼 | 測試數 |
|------|--------|--------|
| `context-engine.test.mjs` | 7 個 target 都能組出 systemPrompt | 10 |
| `ai-settings.test.mjs` | 所有必要的 prompt 檔案存在且非空 | 13 |
| `providers.test.mjs` | providers.json 結構正確 | 4 |
| `skill-format.test.mjs` | SKILL.md frontmatter 解析 + 實際檔案 | 4 |
| **合計** | | **31** |

### 特色
- **不需要 server** — 直接 import 後端模組
- **100ms 跑完** — 比 E2E 快 300 倍
- **測 prompt 檔案完整性** — 有人不小心刪掉 prompt 檔，測試會亮紅

### 加新 unit test

```javascript
// tests/unit/your-feature.test.mjs
import { describe, it, expect } from "vitest";
import { yourFunction } from "../../packages/server/src/routes/your-feature.mjs";

describe("Your Feature", () => {
  it("should do X", () => {
    expect(yourFunction()).toBe(true);
  });
});
```

---

## E2E Tests (Playwright)

### 覆蓋範圍

| 檔案 | 測什麼 | 測試數 |
|------|--------|--------|
| `01-smoke.spec.ts` | App 載入無 JS 錯誤、Sidebar 導航 | 3 |
| `02-settings.spec.ts` | Settings 頁面渲染、Provider 配置 | 2 |
| `03-notes.spec.ts` | Notes 頁面、model selector 🤖 按鈕 | 2 |
| `04-pages.spec.ts` | Mind Map、Projects、Skill Builder 頁面 | 3 |
| `05-api.spec.ts` | 13 個 API 端點回應 200 + 正確格式 | 13 |
| **合計** | | **23** |

### 前置條件
- PAAW server 在 `localhost:4097` 跑著
- 如果 server 沒跑，API tests 會 fail，UI tests 會 timeout

### 加新 E2E test

```typescript
// tests/e2e/06-your-feature.spec.ts
import { test, expect } from "@playwright/test";

test("your feature works", async ({ page }) => {
  await page.goto("/");
  await page.waitForTimeout(2000);
  // Click into your page
  await page.getByText("Your Feature").click();
  await page.waitForTimeout(1000);
  // Assert something
  await expect(page.locator("body")).toBeVisible();
  await page.screenshot({ path: "tests/e2e/screenshots/your-feature.png" });
});
```

---

## CI/CD 建議

在 GitHub Actions 或類似環境裡：

```yaml
# .github/workflows/test.yml（未來加）
jobs:
  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - run: npm test  # vitest, 不需要 server

  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - run: npm run build
      - run: npm run dev:server &
      - run: npx playwright install chromium
      - run: npx playwright test
```

---

## 何時跑測試

| 場景 | 跑什麼 |
|------|--------|
| 改了後端邏輯 | `npm test`（unit） |
| 改了前端 UI | `npm run test:e2e` |
| 改了 AI Settings prompt | `npm test`（ai-settings.test.mjs） |
| 改了 context-engine | `npm test`（context-engine.test.mjs） |
| 加了新 API 端點 | 加到 `05-api.spec.ts` |
| 加了新 UI 頁面 | 加到 `04-pages.spec.ts` |
| Push 前 | `npm run test:all` |
