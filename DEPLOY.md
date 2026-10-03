# tPAAW 更新包（packages only）— 2026-10-03

**內容**：`packages/**` + `package.json`（= dev `9116fb02`）— 專為 security scan 縮到最小面積。

含 **chat 輸入凍結修復**（貼文字/打字不再讓 Chrome「頁面沒有反應」）、移除 Workflow Builder、移除 Agentic Binding、Rust/Java 多語言 code understanding。

## 步驟

```
1. 備份公司現有 tPAAW 資料夾（覆蓋會蓋掉公司自研修改）
2. packages/ 整個資料夾覆蓋進 tPAAW（保持相對路徑）
3. 蓋 package.json（root）
4. 刪除 6 個舊檔（packages 內殘骸）：
   packages/engine/src/workflow/index.ts
   packages/server/src/lib/agentic-binding.mjs
   packages/server/src/routes/agentic-bindings.mjs
   packages/server/src/routes/workflow.mjs
   packages/ui/src/pages/WorkflowEditor.tsx
   packages/ui/src/pages/WorkflowExec.tsx
   （若 tests/unit/agentic-binding.test.mjs 存在也刪）
5. npm install          ← 必要（tree-sitter-rust 新依賴）
6. npm run build
7. npm start            ← 重啟 server 吃新 dist
```

## 驗收

- **coding app 開個對話多的 chat，貼一大段文字 / 連續打字** — 不再出現「頁面沒有反應」
- 側邊欄 Workflow 選單已消失
- coding app import 非 JS 專案 → dependency map 有數字（Rust/Java）

## 沒帶的（公司沿用現有檔案，皆無變動）

- `tsconfig.base.json`、`vitest.config.ts`、`.env*` — dev 上自 6-9 月後未變
- `data/`、`tests/`、`scripts/`、`docs/` — 產品定義與測試，需要時另出包
- `.paaw/`、`logs/` — Mac mini runtime，公司絕不帶
