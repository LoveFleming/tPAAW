/**
 * F-003 — packages/db/src/paths.ts 單元測試
 *
 * getProjectRoot / getDbPath 是純路徑計算函數，不觸發檔案系統寫入。
 * 契約：root 一律是 resolve(process.cwd(), "../../")（見原始碼實作與註解），
 *       DB 檔案位於 <root>/data/db/<dbName>。
 *
 * 注意（ISS-031）：getProjectRoot 從 repo root 執行時會解析到專案外，
 * 此測試只驗證「現行契約」本身，不對該行為做價值判斷。
 */
import { describe, it, expect } from "vitest";
import { resolve } from "path";
import { getProjectRoot, getDbPath } from "../../packages/db/src/paths";

describe("F-003 paths", () => {
  it("getProjectRoot resolves to two levels above cwd (current contract)", () => {
    expect(getProjectRoot()).toBe(resolve(process.cwd(), "../../"));
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
