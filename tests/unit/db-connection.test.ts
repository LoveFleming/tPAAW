/**
 * F-003 — packages/db/src/connection.ts + index.ts 單元測試
 *
 * ⚠️ 大部分是 characterization test：connection.ts 的 SqlJsDialect 缺
 * createDriver / createQueryCompiler / createIntrospector（Kysely 0.29.2
 * Dialect 介面），`new Kysely(...)` 建構即拋 TypeError（ISS-029，open）。
 * 本檔斷言「現狀」而非理想契約，修復 ISS-029 後請改寫對應測試為正向斷言。
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
  it("createDb() rejects with TypeError: dialect.createDriver is not a function", async () => {
    // ISS-029（open）：SqlJsDialect 只實作 createAdapter，缺 Kysely 0.29.2
    // Dialect 介面其餘方法 → new Kysely(...) 建構期即 TypeError。
    // 修復後請改為：const db = await createDb(path); expect(db).toBeDefined();
    await expect(createDb(join(tmpRoot, "a.sqlite"))).rejects.toThrow(
      TypeError
    );
    await expect(createDb(join(tmpRoot, "b.sqlite"))).rejects.toThrow(
      /createDriver|createQueryCompiler|createIntrospector/
    );
  });

  it("createDb() creates the parent directory before failing (mkdir side effect already done)", async () => {
    const nested = join(tmpRoot, "deep", "nest", "c.sqlite");
    await expect(createDb(nested)).rejects.toThrow();
    // mkdirSync 在建構 Kysely 之前執行，因此目錄已建立（現狀：副作用先發生）
    expect(existsSync(join(tmpRoot, "deep", "nest"))).toBe(true);
  });

  it("a failed createDb() leaks raw sql.js instance into module state (getRawDb non-null)", async () => {
    expect(getRawDb()).toBeNull(); // 乾淨起始（afterEach 已重置）
    await expect(createDb(join(tmpRoot, "leak.sqlite"))).rejects.toThrow();
    // 現狀：createDb 拋錯前已賦值 sqlJsDb —— 例外路徑沒有清理 module 狀態。
    // ISS-029 修復時應一併處理失敗清理，屆時此斷言改為 toBeNull()。
    expect(getRawDb()).not.toBeNull();
    expect(typeof (getRawDb() as unknown as { run: unknown }).run).toBe("function");
  });

  it("createDb() without explicit path derives dbPath from getDbPath() (mocked into tmp)", async () => {
    await expect(createDb()).rejects.toThrow(); // 同樣卡在 ISS-029
    // 但預設路徑已解析為 mocked getDbPath（tmpRoot/data/db/paaw.sqlite），
    // 且不會碰專案外的真實資料檔 —— 落盤位置由 closeDb 測試進一步驗證
    expect(existsSync(join(tmpRoot, "data", "db"))).toBe(true);
  });
});

describe("F-003 connection — getDb / closeDb / saveToDisk", () => {
  it("getDb() hits the same ISS-029 failure (no singleton is cached)", async () => {
    await expect(getDb()).rejects.toThrow(TypeError);
    // 失敗時 dbInstance 保持 null —— 之後的呼叫會重試而不是拿到壞實例
    expect(getRawDb()).not.toBeNull(); // raw 端有洩漏（見上），但 Kysely 端沒有
  });

  it("closeDb() saves the leaked raw db to disk as a valid SQLite file (when raw db has DDL)", async () => {
    const path = join(tmpRoot, "persist.sqlite");
    await expect(createDb(path)).rejects.toThrow(); // 洩漏 raw db + 設定 dbPathGlobal
    // 在洩漏的 raw db 上建立 schema/data，模擬「活著的 db 需要被落盤」的情境
    getRawDb()!.run("CREATE TABLE probe (a TEXT)");
    getRawDb()!.run("INSERT INTO probe VALUES ('x')");
    await closeDb(); // 內部呼叫 saveToDisk()

    expect(existsSync(path)).toBe(true);
    const buf = readFileSync(path);
    expect(buf.length).toBeGreaterThan(0);
    // SQLite 檔頭魔術字串："SQLite format 3\0"（前 16 bytes）
    expect(buf.subarray(0, 15).toString("latin1")).toBe("SQLite format 3");
  });

  it("closeDb() writes a 0-byte file for a fresh raw db with no DDL (sql.js fresh export is empty)", async () => {
    // 現狀 characterization：sql.js new Database() 在執行任何 DDL 前
    // export() 回 0 bytes —— 意即「全新 db 立刻 close」會落盤空檔。
    const path = join(tmpRoot, "empty.sqlite");
    await expect(createDb(path)).rejects.toThrow();
    await closeDb();
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path).length).toBe(0);
  });

  it("closeDb() resets module state — getRawDb() returns null afterwards", async () => {
    await expect(createDb(join(tmpRoot, "reset.sqlite"))).rejects.toThrow();
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
