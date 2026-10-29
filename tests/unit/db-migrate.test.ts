/**
 * F-003 — packages/db/src/migrate.ts 單元測試（in-memory / temp-file sql.js）
 *
 * 覆蓋：
 *  1. 全新資料庫：建立全部 9 張表 + 11 個索引
 *  2. idempotency：重跑不炸、既有資料保留
 *  3. 持久化：writeFileSync 落盤為合法 SQLite 檔案（header + 可重新載入）
 *  4. 目錄自動建立（mkdirSync recursive）
 *  5. 欄位約束：NOT NULL / DEFAULT
 *  6. 省略 dbPath 時使用 getDbPath() 預設值
 *
 * ⚠️ ISS-031：migrate.ts 檔尾有頂層 `migrate()` 呼叫（import 即執行副作用），
 * 且 getProjectRoot() 從 repo root 執行時解析到專案目錄之外。
 * 因此本檔必須 vi.mock("./paths.ts") 把副作用導向暫存目錄。
 * 修復 ISS-031 後可移除 mock。
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { existsSync, readFileSync, rmSync, statSync } from "fs";
import { resolve, join } from "path";
import initSqlJs, { type Database } from "sql.js";

// ── 把 getProjectRoot/getDbPath 導向暫存目錄（隔離 ISS-031 的 import 副作用）──
const tmpRoot = vi.hoisted(() => {
  // 注意：vi.hoisted 內不能使用 top-level import（binding 尚未初始化）
  const base = process.env.PAAW_TMP || "/tmp";
  return `${base.replace(/\/+$/, "")}/db-migrate-test-${process.pid}-${Date.now()}`;
});
vi.mock("../../packages/db/src/paths.ts", () => ({
  getProjectRoot: () => tmpRoot,
  getDbPath: (dbName = "paaw.sqlite") => join(tmpRoot, "data/db", dbName),
}));

// migrate.ts 被 import 的當下頂層 migrate() 就會跑一次（mock 已導向 tmp，無害）
import { migrate } from "../../packages/db/src/migrate";

const EXPECTED_TABLES = [
  "runs",
  "conversations",
  "chat_messages",
  "data_store",
  "cron_logs",
  "memory",
  "api_keys",
  "daily_summaries",
  "skill_meta",
];

const EXPECTED_INDEXES = [
  "idx_runs_skill_id",
  "idx_runs_user_id",
  "idx_runs_status",
  "idx_runs_started_at",
  "idx_conversations_user_id",
  "idx_conversations_type",
  "idx_chat_messages_conv_id",
  "idx_data_store_model_id",
  "idx_data_store_user_id",
  "idx_memory_user_layer",
  "idx_daily_summaries_user_date",
];

let SQL: Awaited<ReturnType<typeof initSqlJs>>;

/** 開啟 migrate 產出的檔案為 in-memory sql.js Database */
async function openFile(path: string): Promise<Database> {
  const bytes = readFileSync(path);
  return new SQL.Database(bytes);
}

function tableNames(db: Database): string[] {
  const res = db.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
  return (res[0]?.values ?? []).map((v) => String(v[0]));
}

function indexNames(db: Database): string[] {
  const res = db.exec("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name");
  return (res[0]?.values ?? []).map((v) => String(v[0]));
}

beforeAll(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {}); // 靜音 migrate 的輸出
  SQL = await initSqlJs();
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("F-003 migrate — schema 初始化", () => {
  it("creates all 9 tables on a fresh database file", async () => {
    const path = join(tmpRoot, "fresh.sqlite");
    await migrate(path);

    expect(existsSync(path)).toBe(true);
    const db = await openFile(path);
    expect(tableNames(db).sort()).toEqual([...EXPECTED_TABLES].sort());
    db.close();
  });

  it("creates all 11 secondary indexes", async () => {
    const path = join(tmpRoot, "indexes.sqlite");
    await migrate(path);

    const db = await openFile(path);
    expect(indexNames(db).sort()).toEqual([...EXPECTED_INDEXES].sort());
    db.close();
  });

  it("creates missing parent directories recursively", async () => {
    const path = join(tmpRoot, "deep/a/b/c/nested.sqlite");
    await migrate(path);

    expect(existsSync(path)).toBe(true);
    expect(statSync(path).size).toBeGreaterThan(0);
  });

  it("persists a valid SQLite file (header + reloadable)", async () => {
    const path = join(tmpRoot, "header.sqlite");
    await migrate(path);

    const bytes = readFileSync(path);
    expect(bytes.subarray(0, 16).toString("utf8")).toBe("SQLite format 3\u0000");

    // 重新載入後 schema 仍完整
    const db = await openFile(path);
    expect(tableNames(db)).toContain("runs");
    db.close();
  });
});

describe("F-003 migrate — idempotency 與資料保留", () => {
  it("running migrate twice on the same file succeeds and keeps existing rows", async () => {
    const path = join(tmpRoot, "idempotent.sqlite");
    await migrate(path);

    // 既有資料
    const db1 = await openFile(path);
    db1.run(
      `INSERT INTO runs (id, skill_id, user_id, status, runner_type, input_json, started_at)
       VALUES ('run_keep', 'skill-x', 'user-1', 'completed', 'prompt', '{}', '2026-01-01T00:00:00Z')`
    );
    const data = db1.export();
    const { writeFileSync } = await import("fs");
    writeFileSync(path, Buffer.from(data));
    db1.close();

    // 重跑 migration
    await expect(migrate(path)).resolves.toBeUndefined();

    const db2 = await openFile(path);
    const res = db2.exec("SELECT COUNT(*) FROM runs WHERE id = 'run_keep'");
    expect(res[0].values[0][0]).toBe(1);
    db2.close();
  });
});

describe("F-003 migrate — 欄位約束", () => {
  it("enforces NOT NULL on runs.skill_id", async () => {
    const path = join(tmpRoot, "notnull.sqlite");
    await migrate(path);

    const db = await openFile(path);
    expect(() => db.run("INSERT INTO runs (id) VALUES ('r1')")).toThrow(/NOT NULL/i);
    db.close();
  });

  it("applies defaults: conversations.status='active', message_count=0", async () => {
    const path = join(tmpRoot, "defaults.sqlite");
    await migrate(path);

    const db = await openFile(path);
    db.run(
      `INSERT INTO conversations (id, user_id, type, started_at, last_message_at)
       VALUES ('conv-1', 'user-1', 'chat', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`
    );
    const res = db.exec("SELECT status, message_count, created_at FROM conversations WHERE id='conv-1'");
    const [status, messageCount, createdAt] = res[0].values[0] as [string, number, string];
    expect(status).toBe("active");
    expect(messageCount).toBe(0);
    expect(createdAt).toBeTruthy(); // DEFAULT datetime('now')
    db.close();
  });

  it("applies default content_type='text' on chat_messages", async () => {
    const path = join(tmpRoot, "defaults2.sqlite");
    await migrate(path);

    const db = await openFile(path);
    db.run(
      `INSERT INTO chat_messages (id, conversation_id, role, content)
       VALUES ('msg-1', 'conv-1', 'user', 'hello')`
    );
    const res = db.exec("SELECT content_type FROM chat_messages WHERE id='msg-1'");
    expect(res[0].values[0][0]).toBe("text");
    db.close();
  });
});

describe("F-003 migrate — 預設路徑", () => {
  it("falls back to getDbPath() when dbPath is omitted", async () => {
    // mock 過的 getDbPath() 指向 <tmpRoot>/data/db/paaw.sqlite
    await expect(migrate()).resolves.toBeUndefined();
    expect(existsSync(join(tmpRoot, "data/db/paaw.sqlite"))).toBe(true);
  });
});
