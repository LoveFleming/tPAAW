/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
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
