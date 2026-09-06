## agent-sre 測試筆記（Test Agent / Divya Reddy）
- agent-sre 是獨立 repo（/Users/steward/App/agent-sre），與 tPAAW workspace 分開；write_file/read_file 工具被限制在 tPAAW cwd，要用 bash cat/printf 寫檔、bash cat 讀檔。
- vitest 設定在 vitest.config.mjs，include `server/**/*.test.mjs`，`npm test` = vitest run。
- 三個近期 security fix：TASK-005 conversation.mjs 加 sanitizeId；TASK-006 routes.mjs 改用 safeResolve；TASK-007 tool-loader.mjs 加 nosemgrep 註解。
- routes.mjs 靜態檔透過 safeResolve(UI_DIR, path) 且在 catch 後 fall through 回 404 — 是測試 path traversal 的好切入點。
- 新增 server/routes.test.mjs（14 tests）後總數 94 tests 全綠。測試用 createServer + registerRoutes 起 127.0.0.1:0（隨機 port）真實 http server，結束 close。