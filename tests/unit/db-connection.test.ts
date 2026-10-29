/**
 * F-003 — packages/db/src/connection.ts + index.ts 單元測試
 *
 * 2026-10-29：ISS-029 已修（SqliteDialect + adaptDatabase 橋接 sql.js），
 * 原本記錄壞掉現狀的 characterization 測試已改寫為正向斷言。
 *
 * 覆蓋的匯出路徑：
 *  - connection.ts：createDb / getDb / getRawDb / closeDb / saveToDisk
 *  - index.ts：9 個 re-export 是否齊全（barrel 完整性）
 *
 * ⚠️ paths.ts 必須 mock：getDbPath() 預設解析到 process.cwd() 上兩層
 * （ISS-031），從 repo root 跑測試會指向專案目錄之外的真實資料檔
 * （<home>/data/db/paaw.sqlite），closeDb() 會把它 load→export 回寫。
 * mock 後所有落盤都限制在本檔的 PAAW_TMP 暫存目錄。
 *
 * Module state 注意：connection.ts 的 sqlJsDb / dbPathGlobal / dbInstance
 * 是 module-level 單例，本檔每個 case 用 closeDb() 重置（afterEach）。
 */
import { describe, it, expect, vi, afterAll, afterEach } from "vitest";
import { existsSync, readFileSync, rmSync } from "fs";
import { join } from "path";

const tmpRoot = vi.hoisted(() => {
  const base = process.env.PAAW_TMP || "/tmp";
  return `${base.replace(/\/+$/, "")}/db-connection-test-${process.pid}-${Date.now()}`;
});
vi.mock("../../packages/db/src/paths.ts", () => ({
  getProjectRoot: () => tmpRoot,
  getDbPath: (dbName = "paaw.sqlite") => join(tmpRoot, "data/db", dbName),
}));

import {
  createDb,
  getDb,
  getRawDb,
  closeDb,
  saveToDisk,
} from "../../packages/db/src/connection";
import * as dbIndex from "../../packages/db/src/index";

afterEach(async () => {
  // 重置 connection.ts 的 module 單例，讓每個 case 從乾淨狀態開始
  await closeDb();
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("F-003 connection — createDb (ISS-029 characterization)", () => {
  it("createDb() resolves with a working Kysely instance (ISS-029 fixed)", async () => {
    const db = await createDb(join(tmpRoot, "a.sqlite"));
    expect(db).toBeDefined();
    // module 狀態：raw sql.js 已掛載且可操作
    expect(getRawDb()).not.toBeNull();
    getRawDb()!.run("CREATE TABLE probe (a TEXT)");
    getRawDb()!.run("INSERT INTO probe VALUES ('x')");
    const rows = getRawDb()!.exec("SELECT a FROM probe");
    expect((rows[0].values[0] as unknown[])[0]).toBe("x");
  });

  it("createDb() creates nested parent directories before opening the db", async () => {
    const nested = join(tmpRoot, "deep", "nest", "c.sqlite");
    const db = await createDb(nested);
    expect(db).toBeDefined();
    expect(existsSync(join(tmpRoot, "deep", "nest"))).toBe(true);
  });

  it("module state is clean before open and reset on failure-free close", async () => {
    expect(getRawDb()).toBeNull(); // 乾淨起始（afterEach 已重置）
    await createDb(join(tmpRoot, "leak.sqlite"));
    expect(getRawDb()).not.toBeNull();
    expect(typeof (getRawDb() as unknown as { run: unknown }).run).toBe("function");
  });

  it("createDb() without explicit path derives dbPath from getDbPath() (mocked into tmp)", async () => {
    const db = await createDb();
    expect(db).toBeDefined();
    // 預設路徑解析為 mocked getDbPath（tmpRoot/data/db/paaw.sqlite），
    // 不會碰專案外的真實資料檔 —— 落盤位置由 closeDb 測試進一步驗證
    expect(existsSync(join(tmpRoot, "data", "db"))).toBe(true);
  });
});

describe("F-003 connection — getDb / closeDb / saveToDisk", () => {
  it("getDb() caches a singleton — same instance on repeated calls", async () => {
    const db1 = await getDb();
    const db2 = await getDb();
    expect(db1).toBe(db2);
    expect(getRawDb()).not.toBeNull();
  });

  it("closeDb() saves the raw db to disk as a valid SQLite file (when db has DDL)", async () => {
    const path = join(tmpRoot, "persist.sqlite");
    await createDb(path);
    getRawDb()!.run("CREATE TABLE probe (a TEXT)");
    getRawDb()!.run("INSERT INTO probe VALUES ('x')");
    await closeDb(); // 內部呼叫 saveToDisk()

    expect(existsSync(path)).toBe(true);
    const buf = readFileSync(path);
    expect(buf.length).toBeGreaterThan(0);
    // SQLite 檔頭魔術字串："SQLite format 3\0"（前 16 bytes）
    expect(buf.subarray(0, 15).toString("latin1")).toBe("SQLite format 3");
  });

  it("closeDb() writes a 0-byte file for a fresh db with no DDL (sql.js fresh export is empty)", async () => {
    // 現狀 characterization：sql.js new Database() 在執行任何 DDL 前
    // export() 回 0 bytes —— 意即「全新 db 立刻 close」會落盤空檔。
    const path = join(tmpRoot, "empty.sqlite");
    await createDb(path);
    await closeDb();
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path).length).toBe(0);
  });

  it("closeDb() resets module state — getRawDb() returns null afterwards", async () => {
    await createDb(join(tmpRoot, "reset.sqlite"));
    expect(getRawDb()).not.toBeNull();
    await closeDb();
    expect(getRawDb()).toBeNull();
  });

  it("closeDb() resolves without error when nothing is loaded (idempotent)", async () => {
    expect(getRawDb()).toBeNull();
    await expect(closeDb()).resolves.toBeUndefined();
    await expect(closeDb()).resolves.toBeUndefined(); // 二次呼叫同樣安全
  });

  it("saveToDisk() is a no-op (no throw) when nothing is loaded", async () => {
    expect(getRawDb()).toBeNull();
    expect(() => saveToDisk()).not.toThrow();
  });
});

describe("F-003 index.ts barrel re-exports", () => {
  it("exports all 9 expected names from the db package surface", () => {
    const expected = [
      "createDb",
      "getDb",
      "closeDb",
      "migrate",
      "getProjectRoot",
      "getDbPath",
      "RunsRepo",
      "ChatsRepo",
      "DataStoreRepo",
    ];
    for (const name of expected) {
      expect(dbIndex, `index.ts should export "${name}"`).toHaveProperty(name);
    }
    // function/class 層級的可用性（types 僅型別，無 runtime 綁定）
    expect(typeof dbIndex.migrate).toBe("function");
    expect(typeof dbIndex.getProjectRoot).toBe("function");
    expect(typeof dbIndex.getDbPath).toBe("function");
    expect(typeof dbIndex.createDb).toBe("function");
    expect(typeof dbIndex.RunsRepo).toBe("function");
    expect(typeof dbIndex.ChatsRepo).toBe("function");
    expect(typeof dbIndex.DataStoreRepo).toBe("function");
  });

  it("re-exported functions are the same implementations as the source modules", async () => {
    const conn = await import("../../packages/db/src/connection");
    const paths = await import("../../packages/db/src/paths");
    expect(dbIndex.createDb).toBe(conn.createDb);
    expect(dbIndex.closeDb).toBe(conn.closeDb);
    expect(dbIndex.getDbPath).toBe(paths.getDbPath);
  });
});
