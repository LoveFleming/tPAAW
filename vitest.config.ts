/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  // 2026-10-17：vite 啟動會從 envDir 載入 .env；根目錄 .env 是沙箱機密防讀路徑
  // （deniedPaths）→ 沙箱內跑 vitest 必炸 EPERM、被判 sandbox_fs_deny、整批派工 blocked。
  // 改指到 tests/env（不含機密）— 測試要環境變數就自己在測試裡設/mock。
  envDir: path.resolve(__dirname, "tests/env"),
  test: {
    include: ["tests/unit/**/*.test.{mjs,js,ts}"],
    environment: "node",
    globals: true,
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
  resolve: {
    alias: {
      "@server": path.resolve(__dirname, "packages/server/src"),
      "@shared": path.resolve(__dirname, "packages/shared/src"),
    },
  },
});
