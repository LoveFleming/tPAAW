/**
 * F-003 — packages/db/src/paths.ts 單元測試
 *
 * getProjectRoot / getDbPath 是純路徑計算函數，不觸發檔案系統寫入。
 * 契約（ISS-031 修復後）：root = 從 module 位置向上走找到含 packages/ 的目錄
 *       （import.meta.url 錨定，與 cwd 無關），DB 檔案位於 <root>/data/db/<dbName>。
 */
import { describe, it, expect } from "vitest";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import { getProjectRoot, getDbPath } from "../../packages/db/src/paths";

describe("F-003 paths", () => {
  it("getProjectRoot resolves to the repo root containing packages/ (cwd-independent, ISS-031 fixed)", () => {
    // 從測試檔位置推導 repo root（tests/unit → 上兩層），與 cwd 無關
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
    const root = getProjectRoot();
    expect(existsSync(join(root, "packages"))).toBe(true);
    expect(root).toBe(repoRoot);
  });

  it("getDbPath defaults to <root>/data/db/paaw.sqlite", () => {
    expect(getDbPath()).toBe(resolve(getProjectRoot(), "data/db", "paaw.sqlite"));
  });

  it("getDbPath accepts a custom database name", () => {
    expect(getDbPath("custom.sqlite")).toBe(
      resolve(getProjectRoot(), "data/db", "custom.sqlite")
    );
  });

  it("getDbPath returns absolute paths", () => {
    expect(getDbPath()).toMatch(/^\//);
  });
});
