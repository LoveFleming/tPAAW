/**
 * F-003 — repositories 單元測試（RunsRepo / ChatsRepo / DataStoreRepo）
 *
 * 被測對象：packages/db/src/repositories/*.ts（原生未修改）
 * Schema 來源：真實 migrate() 產出的 SQLite 檔案（非測試自訂 DDL）
 *
 * ⚠️ 測試基建說明（為什麼自建 dialect harness）：
 * connection.ts 的 createDb() 目前拋 TypeError（SqlJsDialect 不符合
 * Kysely 0.29.2 的 Dialect 介面 — 缺 createDriver/createQueryCompiler/
 * createIntrospector）。見 ISS-029。
 * 為了在「不修改產品碼」的前提下測 repository 的 CRUD 查詢，
 * 本檔提供一個正確實作 Kysely Dialect 介面的 sql.js driver harness，
 * 讓 repo 的 Kysely query builder 產生真實 SQL、跑在真實 in-memory
 * SQLite 上。ISS-029 修復後，harness 可換成 createDb()。
 *
 * 已知 bug 的 characterization test：
 *  - ChatsRepo.addMessage 的 db.fn("message_count + 1") 產生非法 SQL（ISS-030）
 *    → 對應測試斷言「現狀」，修復後請改回正向斷言。
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { readFileSync, rmSync } from "fs";
import { resolve, join } from "path";
import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";
import {
  Kysely,
  SqliteQueryCompiler,
  SqliteAdapter,
  SqliteIntrospector,
  CompiledQuery,
  type Driver,
  type DatabaseConnection,
  type CompiledQuery as CompiledQueryType,
  type QueryResult,
  type Dialect,
} from "kysely";

// ── 隔離 ISS-031 的 import 副作用（同 db-migrate.test.ts）──
const tmpRoot = vi.hoisted(() => {
  // 注意：vi.hoisted 內不能使用 top-level import（binding 尚未初始化）
  const base = process.env.PAAW_TMP || "/tmp";
  return `${base.replace(/\/+$/, "")}/db-repos-test-${process.pid}-${Date.now()}`;
});
vi.mock("../../packages/db/src/paths.ts", () => ({
  getProjectRoot: () => tmpRoot,
  getDbPath: (dbName = "paaw.sqlite") => join(tmpRoot, "data/db", dbName),
}));

import { migrate } from "../../packages/db/src/migrate";
import { RunsRepo } from "../../packages/db/src/repositories/runs";
import { ChatsRepo } from "../../packages/db/src/repositories/chats";
import { DataStoreRepo } from "../../packages/db/src/repositories/data-store";
import type { PaawDB } from "../../packages/db/src/types";

// ═══════════════════════════════════════════════════════════════
// 測試基建：Kysely × sql.js in-memory dialect harness
// ═══════════════════════════════════════════════════════════════

class SqlJsConnection implements DatabaseConnection {
  constructor(private db: SqlJsDatabase) {}
  async executeQuery<R>(compiled: CompiledQueryType): Promise<QueryResult<R>> {
    const stmt = this.db.prepare(compiled.sql);
    if (compiled.parameters && compiled.parameters.length > 0) {
      stmt.bind(compiled.parameters as unknown[]);
    }
    const rows: any[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    const numAffectedRows = BigInt(this.db.getRowsModified());
    stmt.free();
    return { rows, ...(numAffectedRows > 0n ? { numAffectedRows } : {}) } as QueryResult<R>;
  }
}

function createSqlJsDriver(sqlDb: SqlJsDatabase): Driver {
  const connection = new SqlJsConnection(sqlDb);
  return {
    init: async () => {},
    acquireConnection: async () => connection,
    releaseConnection: async () => {},
    beginTransaction: async (conn) =>
      conn.executeQuery(CompiledQuery.raw("begin")),
    commitTransaction: async (conn) =>
      conn.executeQuery(CompiledQuery.raw("commit")),
    rollbackTransaction: async (conn) =>
      conn.executeQuery(CompiledQuery.raw("rollback")),
    destroy: async () => {},
  };
}

function createKysely(sqlDb: SqlJsDatabase): Kysely<PaawDB> {
  const dialect: Dialect = {
    createDriver: () => createSqlJsDriver(sqlDb),
    createQueryCompiler: () => new SqliteQueryCompiler(),
    createAdapter: () => new SqliteAdapter(),
    createIntrospector: (db) => new SqliteIntrospector(db),
  };
  return new Kysely<PaawDB>({ dialect });
}

// ═══════════════════════════════════════════════════════════════
// Fixture：以真實 migrate() 產出的 schema 起始，每個測試獨立資料庫
// ═══════════════════════════════════════════════════════════════

let SQL: Awaited<ReturnType<typeof initSqlJs>>;
let schemaBytes: Buffer;
let sqlDb: SqlJsDatabase;
let db: Kysely<PaawDB>;

beforeAll(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  SQL = await initSqlJs();
  const schemaPath = join(tmpRoot, "schema.sqlite");
  await migrate(schemaPath);
  schemaBytes = readFileSync(schemaPath);
});

beforeEach(() => {
  // ⚠️ sql.js 的 new Database(buffer) 不會 copy Buffer 內容（跨實例共享底層記憶體），
  // 必須先複製一份，否則前一個測試的寫入會污染後續測試的資料庫。
  sqlDb = new SQL.Database(new Uint8Array(schemaBytes)); // 每個測試乾淨的 schema 複本
  sqlDb.run("PRAGMA foreign_keys=ON");
  db = createKysely(sqlDb);
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

afterEach(() => {
  sqlDb.close();
});

/** 直接插入一筆 run（帶明確 started_at，用於排序/分頁斷言） */
async function insertRun(overrides: {
  id: string; skillId: string; userId: string; startedAt: string;
  status?: string; runnerType?: string;
}) {
  await db.insertInto("runs").values({
    id: overrides.id,
    skill_id: overrides.skillId,
    app_id: null, workflow_id: null, workflow_run_id: null,
    node_id: null, cron_job_id: null,
    user_id: overrides.userId,
    status: (overrides.status ?? "completed") as any,
    runner_type: (overrides.runnerType ?? "prompt") as any,
    input_json: "{}",
    output_json: null, error_message: null,
    duration_ms: null, model: null, tokens_used: null,
    started_at: overrides.startedAt,
    completed_at: null,
  }).execute();
}

// ═══════════════════════════════════════════════════════════════
// RunsRepo
// ═══════════════════════════════════════════════════════════════

describe("F-003 RunsRepo", () => {
  const repo = () => new RunsRepo(db);

  it("create() persists a pending run with serialized input and run_-prefixed id", async () => {
    const id = await repo().create({
      skillId: "web-search", userId: "user-1", runnerType: "prompt",
      input: { query: "hello" },
    });

    expect(id.startsWith("run_")).toBe(true);
    const row = await repo().getById(id);
    expect(row).toBeDefined();
    expect(row!.status).toBe("pending");
    expect(row!.skill_id).toBe("web-search");
    expect(JSON.parse(row!.input_json)).toEqual({ query: "hello" });
    expect(row!.started_at).toBeTruthy();
    expect(row!.completed_at).toBeNull();
  });

  it("create() stores null for optional fields when omitted", async () => {
    const id = await repo().create({
      skillId: "s", userId: "u", runnerType: "script", input: {},
    });
    const row = await repo().getById(id);
    expect(row!.app_id).toBeNull();
    expect(row!.workflow_id).toBeNull();
    expect(row!.cron_job_id).toBeNull();
    expect(row!.model).toBeNull();
    expect(row!.output_json).toBeNull();
  });

  it("start() transitions pending → running", async () => {
    const id = await repo().create({ skillId: "s", userId: "u", runnerType: "prompt", input: {} });
    await repo().start(id);
    expect((await repo().getById(id))!.status).toBe("running");
  });

  it("complete() sets output, duration, tokens and completed_at", async () => {
    const id = await repo().create({ skillId: "s", userId: "u", runnerType: "prompt", input: {} });
    await repo().complete(id, { answer: 42 }, 1500, 77);

    const row = await repo().getById(id);
    expect(row!.status).toBe("completed");
    expect(JSON.parse(row!.output_json!)).toEqual({ answer: 42 });
    expect(row!.duration_ms).toBe(1500);
    expect(row!.tokens_used).toBe(77);
    expect(row!.completed_at).toBeTruthy();
  });

  it("complete() without tokensUsed stores null tokens_used", async () => {
    const id = await repo().create({ skillId: "s", userId: "u", runnerType: "prompt", input: {} });
    await repo().complete(id, {}, 10);
    expect((await repo().getById(id))!.tokens_used).toBeNull();
  });

  it("fail() sets status failed with error message", async () => {
    const id = await repo().create({ skillId: "s", userId: "u", runnerType: "prompt", input: {} });
    await repo().fail(id, "boom", 5);
    const row = await repo().getById(id);
    expect(row!.status).toBe("failed");
    expect(row!.error_message).toBe("boom");
  });

  it("cancel() sets status cancelled with completed_at", async () => {
    const id = await repo().create({ skillId: "s", userId: "u", runnerType: "prompt", input: {} });
    await repo().cancel(id);
    const row = await repo().getById(id);
    expect(row!.status).toBe("cancelled");
    expect(row!.completed_at).toBeTruthy();
  });

  it("getById() returns undefined for unknown id", async () => {
    expect(await repo().getById("run_nonexistent")).toBeUndefined();
  });

  it("listByUser() filters by skillId and status", async () => {
    await insertRun({ id: "r1", skillId: "alpha", userId: "u1", startedAt: "2026-01-01T00:00:00Z", status: "completed" });
    await insertRun({ id: "r2", skillId: "alpha", userId: "u1", startedAt: "2026-01-02T00:00:00Z", status: "failed" });
    await insertRun({ id: "r3", skillId: "beta",  userId: "u1", startedAt: "2026-01-03T00:00:00Z", status: "completed" });

    const bySkill = await repo().listByUser("u1", { skillId: "alpha" });
    expect(bySkill.map((r) => r.id).sort()).toEqual(["r1", "r2"]);

    const byStatus = await repo().listByUser("u1", { status: "completed" });
    expect(byStatus.map((r) => r.id).sort()).toEqual(["r1", "r3"]);
  });

  it("listByUser() excludes other users' runs", async () => {
    await insertRun({ id: "r1", skillId: "s", userId: "u1", startedAt: "2026-01-01T00:00:00Z" });
    await insertRun({ id: "r2", skillId: "s", userId: "u2", startedAt: "2026-01-02T00:00:00Z" });

    const rows = await repo().listByUser("u1");
    expect(rows.map((r) => r.id)).toEqual(["r1"]);
  });

  it("listByUser() orders by started_at desc", async () => {
    await insertRun({ id: "oldest", skillId: "s", userId: "u1", startedAt: "2026-01-01T00:00:00Z" });
    await insertRun({ id: "newest", skillId: "s", userId: "u1", startedAt: "2026-01-03T00:00:00Z" });
    await insertRun({ id: "middle", skillId: "s", userId: "u1", startedAt: "2026-01-02T00:00:00Z" });

    const rows = await repo().listByUser("u1");
    expect(rows.map((r) => r.id)).toEqual(["newest", "middle", "oldest"]);
  });

  it("listByUser() paginates with limit and offset", async () => {
    for (let i = 1; i <= 5; i++) {
      await insertRun({
        id: `r${i}`, skillId: "s", userId: "u1",
        startedAt: `2026-01-0${i}T00:00:00Z`, // r5 最新 → 排最前
      });
    }
    const page = await repo().listByUser("u1", { limit: 2, offset: 1 });
    expect(page.map((r) => r.id)).toEqual(["r4", "r3"]);
  });
});

// ═══════════════════════════════════════════════════════════════
// ChatsRepo
// ═══════════════════════════════════════════════════════════════

describe("F-003 ChatsRepo", () => {
  const repo = () => new ChatsRepo(db);

  it("createConversation() applies defaults: type=chat, status=active, message_count=0", async () => {
    const id = await repo().createConversation({ userId: "user-1" });
    expect(id.startsWith("conv_")).toBe(true);

    const rows = await db.selectFrom("conversations").selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("chat");
    expect(rows[0].status).toBe("active");
    expect(rows[0].message_count).toBe(0);
    expect(rows[0].summary).toBeNull();
  });

  it("createConversation() accepts an explicit type", async () => {
    const id = await repo().createConversation({ userId: "user-1", type: "skill-lab" });
    const row = await db.selectFrom("conversations").selectAll().executeTakeFirst();
    expect(row!.type).toBe("skill-lab");
    expect(id).toBeTruthy();
  });

  /**
   * ⚠️ CHARACTERIZATION TEST — ISS-030（勿直接「修綠」此測試）
   * addMessage() 的 `this.db.fn("message_count + 1")` 產生非法 SQL，
   * 導致 conversation 統計更新的 UPDATE 拋錯；但 chat_messages 的 INSERT
   * 已先落庫（部分寫入）。
   * 修復 ISS-030 後請改為正向斷言：
   *   - await addMessage(...) 成功、回傳 msg_ 前綴 id
   *   - message_count 遞增、last_message_at 更新
   */
  it("addMessage() [current behavior — ISS-030] rejects on invalid SQL but leaves the message row inserted", async () => {
    const convId = await repo().createConversation({ userId: "user-1" });

    await expect(
      repo().addMessage({ conversationId: convId, role: "user", content: "hi" })
    ).rejects.toThrow(/syntax error/i);

    const msgs = await db.selectFrom("chat_messages").selectAll().execute();
    expect(msgs).toHaveLength(1); // INSERT 已落庫（部分寫入）
    expect(msgs[0].role).toBe("user");
    expect(msgs[0].content).toBe("hi");

    const conv = await db.selectFrom("conversations").selectAll().executeTakeFirst();
    expect(conv!.message_count).toBe(0); // 統計未更新（bug 現狀）
  });

  it("getMessages() orders by created_at asc and paginates", async () => {
    const convId = "conv-test";
    await db.insertInto("conversations").values({
      id: convId, user_id: "u1", type: "chat", status: "active", summary: null,
      tags_json: null, message_count: 0,
      started_at: "2026-01-01T00:00:00Z", last_message_at: "2026-01-01T00:00:00Z",
    }).execute();
    // 明確 created_at（避開 datetime('now') 秒級精度導致排序不穩）
    for (let i = 1; i <= 3; i++) {
      await db.insertInto("chat_messages").values({
        id: `m${i}`, conversation_id: convId, role: "user", content: `msg-${i}`,
        content_type: "text", intent: null, actions_json: null,
        skill_run_ids_json: null, model: null, tokens_used: null,
        latency_ms: null, metadata_json: null,
        created_at: `2026-01-01T00:00:0${i}Z`,
      }).execute();
    }

    const all = await repo().getMessages(convId);
    expect(all.map((m) => m.id)).toEqual(["m1", "m2", "m3"]); // asc

    const page = await repo().getMessages(convId, { limit: 2, offset: 1 });
    expect(page.map((m) => m.id)).toEqual(["m2", "m3"]);
  });

  it("getMessages() only returns messages of the given conversation", async () => {
    for (const cid of ["conv-a", "conv-b"]) {
      await db.insertInto("conversations").values({
        id: cid, user_id: "u1", type: "chat", status: "active", summary: null,
        tags_json: null, message_count: 0,
        started_at: "2026-01-01T00:00:00Z", last_message_at: "2026-01-01T00:00:00Z",
      }).execute();
    }
    await db.insertInto("chat_messages").values({
      id: "ma", conversation_id: "conv-a", role: "user", content: "a",
      content_type: "text", intent: null, actions_json: null, skill_run_ids_json: null,
      model: null, tokens_used: null, latency_ms: null, metadata_json: null,
      created_at: "2026-01-01T00:00:00Z",
    }).execute();
    await db.insertInto("chat_messages").values({
      id: "mb", conversation_id: "conv-b", role: "user", content: "b",
      content_type: "text", intent: null, actions_json: null, skill_run_ids_json: null,
      model: null, tokens_used: null, latency_ms: null, metadata_json: null,
      created_at: "2026-01-01T00:00:00Z",
    }).execute();

    const rows = await repo().getMessages("conv-a");
    expect(rows.map((m) => m.id)).toEqual(["ma"]);
  });

  it("listConversations() filters by type, orders by last_message_at desc, applies limit", async () => {
    // 明確 last_message_at 以穩定排序斷言
    const fixture: Array<[string, string, string]> = [
      ["c1", "chat",      "2026-01-01T00:00:00Z"],
      ["c2", "skill-lab", "2026-01-03T00:00:00Z"],
      ["c3", "chat",      "2026-01-02T00:00:00Z"],
    ];
    for (const [id, type, last] of fixture) {
      await db.insertInto("conversations").values({
        id, user_id: "u1", type: type as any, status: "active", summary: null,
        tags_json: null, message_count: 0,
        started_at: last, last_message_at: last,
      }).execute();
    }

    const all = await repo().listConversations("u1");
    expect(all.map((c) => c.id)).toEqual(["c2", "c3", "c1"]); // desc by last_message_at

    const chats = await repo().listConversations("u1", { type: "chat" });
    expect(chats.map((c) => c.id)).toEqual(["c3", "c1"]);

    const limited = await repo().listConversations("u1", { limit: 2 });
    expect(limited).toHaveLength(2);
  });

  it("closeConversation() sets status closed", async () => {
    const convId = await repo().createConversation({ userId: "user-1" });
    await repo().closeConversation(convId);
    const row = await db.selectFrom("conversations").selectAll().executeTakeFirst();
    expect(row!.status).toBe("closed");
  });
});

// ═══════════════════════════════════════════════════════════════
// DataStoreRepo
// ═══════════════════════════════════════════════════════════════

describe("F-003 DataStoreRepo", () => {
  const repo = () => new DataStoreRepo(db);

  it("create() returns ds_-prefixed id and read() returns the record", async () => {
    const id = await repo().create("model-1", "user-1", { name: "Alice", age: 30 });
    expect(id.startsWith("ds_")).toBe(true);

    const row = await repo().read(id);
    expect(row).toBeDefined();
    expect(row!.model_id).toBe("model-1");
    expect(row!.user_id).toBe("user-1");
    expect(JSON.parse(row!.data_json)).toEqual({ name: "Alice", age: 30 });
    expect(row!.deleted_at).toBeNull();
  });

  it("read() returns undefined for unknown id", async () => {
    expect(await repo().read("ds_nonexistent")).toBeUndefined();
  });

  it("read() returns undefined for soft-deleted records", async () => {
    const id = await repo().create("model-1", "user-1", { name: "Bob" });
    await repo().softDelete(id);
    expect(await repo().read(id)).toBeUndefined();
  });

  it("update() shallow-merges partial data into existing JSON", async () => {
    const id = await repo().create("model-1", "user-1", { name: "Alice", age: 30, city: "Taipei" });
    await repo().update(id, { age: 31 });

    const row = await repo().read(id);
    expect(JSON.parse(row!.data_json)).toEqual({ name: "Alice", age: 31, city: "Taipei" });
  });

  it("update() throws for a missing record", async () => {
    await expect(repo().update("ds_nonexistent", { x: 1 })).rejects.toThrow(/Record not found/);
  });

  it("softDelete() hides the record from read() and search()", async () => {
    const id = await repo().create("model-1", "user-1", { name: "Alice" });
    await repo().softDelete(id);

    const result = await repo().search("model-1", "user-1");
    expect(result.items).toHaveLength(0);
    expect(result.pagination.total).toBe(0);
  });

  it("search() scopes results by model_id and user_id", async () => {
    await repo().create("model-1", "user-1", { name: "A" });
    await repo().create("model-1", "user-2", { name: "B" }); // 別的使用者
    await repo().create("model-2", "user-1", { name: "C" }); // 別的 model

    const result = await repo().search("model-1", "user-1");
    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe("A");
  });

  it("search() filters by equality on data fields", async () => {
    await repo().create("m", "u1", { name: "Alice", role: "admin" });
    await repo().create("m", "u1", { name: "Bob", role: "user" });

    const result = await repo().search("m", "u1", { filters: { role: "admin" } });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe("Alice");
  });

  it("search() matches text query case-insensitively across values", async () => {
    await repo().create("m", "u1", { name: "Alice", note: "likes GREEN tea" });
    await repo().create("m", "u1", { name: "Bob", note: "coffee only" });

    const byLower = await repo().search("m", "u1", { query: "alice" });
    expect(byLower.items).toHaveLength(1);

    const byUpper = await repo().search("m", "u1", { query: "GREEN" });
    expect(byUpper.items).toHaveLength(1);
    expect(byUpper.items[0].name).toBe("Alice");

    const none = await repo().search("m", "u1", { query: "espresso" });
    expect(none.items).toHaveLength(0);
  });

  it("search() sorts by data field asc and desc", async () => {
    await repo().create("m", "u1", { name: "Charlie" });
    await repo().create("m", "u1", { name: "Alice" });
    await repo().create("m", "u1", { name: "Bob" });

    const asc = await repo().search("m", "u1", { sort: { field: "name", order: "asc" } });
    expect(asc.items.map((i) => i.name)).toEqual(["Alice", "Bob", "Charlie"]);

    const desc = await repo().search("m", "u1", { sort: { field: "name", order: "desc" } });
    expect(desc.items.map((i) => i.name)).toEqual(["Charlie", "Bob", "Alice"]);
  });

  it("search() paginates with page/pageSize and reports total/totalPages", async () => {
    for (let i = 1; i <= 5; i++) {
      await repo().create("m", "u1", { name: `item-${i}` });
    }

    const page1 = await repo().search("m", "u1", { page: 1, pageSize: 2, sort: { field: "name", order: "asc" } });
    expect(page1.items.map((i) => i.name)).toEqual(["item-1", "item-2"]);
    expect(page1.pagination).toEqual({ page: 1, pageSize: 2, total: 5, totalPages: 3 });

    const page3 = await repo().search("m", "u1", { page: 3, pageSize: 2, sort: { field: "name", order: "asc" } });
    expect(page3.items.map((i) => i.name)).toEqual(["item-5"]);

    const defaults = await repo().search("m", "u1"); // 預設 page=1, pageSize=20
    expect(defaults.items).toHaveLength(5);
    expect(defaults.pagination.page).toBe(1);
    expect(defaults.pagination.pageSize).toBe(20);
  });
});

// ═══════════════════════════════════════════════════════════════
// 交易行為（commit / rollback）— TASK-044 驗收項目 4
//
// 被測標的：Kysely `db.transaction()` 在本專案 sql.js SQLite 上的語意
// （BEGIN / COMMIT / ROLLBACK 由 harness driver 送到底層 sql.js）。
// sql.js 不支援巢狀交易（"cannot start a transaction within a transaction"），
// 因此每個 case 都是獨立單層交易。
// ═══════════════════════════════════════════════════════════════

describe("F-003 transactions (commit/rollback)", () => {
  it("committed transaction persists inserted rows", async () => {
    await db.transaction().execute(async (trx) => {
      await trx.insertInto("runs").values({
        id: "tx-commit-1", skill_id: "s", user_id: "u1",
        status: "completed", runner_type: "prompt",
        input_json: "{}", started_at: "2026-01-01T00:00:00Z",
      }).execute();
    });

    const row = await db.selectFrom("runs").where("id", "=", "tx-commit-1").selectAll().executeTakeFirst();
    expect(row).toBeDefined();
    expect(row!.status).toBe("completed");
  });

  it("committed transaction persists updates (update visible after commit)", async () => {
    await insertRun({ id: "tx-commit-2", skillId: "s", userId: "u1", startedAt: "2026-01-01T00:00:00Z", status: "pending" });

    await db.transaction().execute(async (trx) => {
      await trx.updateTable("runs").set({ status: "running" }).where("id", "=", "tx-commit-2").execute();
    });

    expect((await db.selectFrom("runs").where("id", "=", "tx-commit-2").selectAll().executeTakeFirst())!.status)
      .toBe("running");
  });

  it("controlled transaction: explicit rollback().execute() discards inserted rows", async () => {
    // Kysely 0.29.2 的 callback 式 db.transaction() 不提供 trx.rollback()；
    // 明確控制交易用 ControlledTransaction（startTransaction）。
    const trx = await db.startTransaction().execute();
    await trx.insertInto("runs").values({
      id: "tx-rollback-1", skill_id: "s", user_id: "u1",
      status: "completed", runner_type: "prompt",
      input_json: "{}", started_at: "2026-01-01T00:00:00Z",
    }).execute();
    await trx.rollback().execute();

    const row = await db.selectFrom("runs").where("id", "=", "tx-rollback-1").selectAll().executeTakeFirst();
    expect(row).toBeUndefined();
  });

  it("controlled transaction: explicit commit().execute() persists inserted rows", async () => {
    const trx = await db.startTransaction().execute();
    await trx.insertInto("runs").values({
      id: "tx-commit-ctrl", skill_id: "s", user_id: "u1",
      status: "completed", runner_type: "prompt",
      input_json: "{}", started_at: "2026-01-01T00:00:00Z",
    }).execute();
    await trx.commit().execute();

    expect(await db.selectFrom("runs").where("id", "=", "tx-commit-ctrl").selectAll().executeTakeFirst())
      .toBeDefined();
  });

  it("throwing inside db.transaction() auto-rollbacks and rethrows", async () => {
    await expect(
      db.transaction().execute(async (trx) => {
        await trx.insertInto("runs").values({
          id: "tx-auto-rollback", skill_id: "s", user_id: "u1",
          status: "completed", runner_type: "prompt",
          input_json: "{}", started_at: "2026-01-01T00:00:00Z",
        }).execute();
        throw new Error("boom mid-transaction");
      })
    ).rejects.toThrow("boom mid-transaction");

    expect(await db.selectFrom("runs").where("id", "=", "tx-auto-rollback").selectAll().executeTakeFirst())
      .toBeUndefined();
  });

  it("rollback discards the whole transaction — earlier writes in the same trx are undone too", async () => {
    await expect(
      db.transaction().execute(async (trx) => {
        await trx.insertInto("runs").values({
          id: "tx-early", skill_id: "s", user_id: "u1",
          status: "completed", runner_type: "prompt",
          input_json: "{}", started_at: "2026-01-01T00:00:00Z",
        }).execute();
        // 第二筆違反 PRIMARY KEY（同 id）→ 拋錯 → 第一筆也必須回滾
        await trx.insertInto("runs").values({
          id: "tx-early", skill_id: "s", user_id: "u1",
          status: "failed", runner_type: "prompt",
          input_json: "{}", started_at: "2026-01-02T00:00:00Z",
        }).execute();
      })
    ).rejects.toThrow();

    expect(await db.selectFrom("runs").where("id", "=", "tx-early").selectAll().executeTakeFirst())
      .toBeUndefined();
  });

  it("RunsRepo operations participate in a committed transaction", async () => {
    const runsRepo = new RunsRepo(db);
    await db.transaction().execute(async (trx) => {
      const repo = new RunsRepo(trx as unknown as Kysely<PaawDB>);
      const id = await repo.create({ skillId: "s", userId: "u1", runnerType: "prompt", input: { q: 1 } });
      await repo.start(id);
      await repo.complete(id, { answer: "ok" }, 42);
    });

    const rows = await runsRepo.listByUser("u1");
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("completed");
    expect(rows[0].duration_ms).toBe(42);
    expect(JSON.parse(rows[0].output_json!)).toEqual({ answer: "ok" });
  });

  it("RunsRepo writes are discarded when the transaction rolls back", async () => {
    const runsRepo = new RunsRepo(db);
    await expect(
      db.transaction().execute(async (trx) => {
        const repo = new RunsRepo(trx as unknown as Kysely<PaawDB>);
        await repo.create({ skillId: "s", userId: "u1", runnerType: "prompt", input: {} });
        await repo.create({ skillId: "s", userId: "u1", runnerType: "script", input: {} });
        throw new Error("abort after two repo writes");
      })
    ).rejects.toThrow("abort after two repo writes");

    expect(await runsRepo.listByUser("u1")).toHaveLength(0);
  });

  it("database remains usable for new queries after a rollback", async () => {
    await expect(
      db.transaction().execute(async (trx) => {
        await trx.insertInto("runs").values({
          id: "tx-doomed", skill_id: "s", user_id: "u1",
          status: "completed", runner_type: "prompt",
          input_json: "{}", started_at: "2026-01-01T00:00:00Z",
        }).execute();
        throw new Error("rollback please");
      })
    ).rejects.toThrow();

    // rollback 後同一連線可繼續正常讀寫
    await insertRun({ id: "after-rollback", skillId: "s", userId: "u1", startedAt: "2026-01-02T00:00:00Z" });
    expect(await db.selectFrom("runs").selectAll().execute()).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// connection.ts — 目前被 ISS-029 阻斷，先以 todo 記錄應補的契約
// （detail 見 tests/unit/db-connection.test.ts — 本任務已補 characterization）
// ═══════════════════════════════════════════════════════════════

describe("F-003 connection (blocked by ISS-029)", () => {
  it.todo("createDb() returns a working Kysely<PaawDB> after ISS-029 fix");
  it.todo("getDb() returns cached singleton without re-initializing");
  it.todo("closeDb() persists sql.js export to the db file on disk");
});
