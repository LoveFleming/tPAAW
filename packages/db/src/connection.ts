/**
 * PAAW Database Connection — SQLite via sql.js (zero native deps)
 *
 * sql.js gives us a pure-WASM SQLite (no native build step). Kysely ships a
 * built-in `SqliteDialect`, but it expects a better-sqlite3-shaped driver
 * (`SqliteDatabase` = { close, prepare }). We bridge sql.js's API to that
 * shape so we can use Kysely's real dialect (driver + compiler + introspector)
 * instead of a hand-rolled pseudo-dialect.
 */
import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";
import { Kysely, SqliteDialect } from "kysely";
import type { SqliteDatabase, SqliteStatement } from "kysely";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { dirname } from "path";
import { getDbPath } from "./paths";
import type { PaawDB } from "./types";

let dbInstance: Kysely<PaawDB> | null = null;
let sqlJsDb: SqlJsDatabase | null = null;
let dbPathGlobal: string = "";

/**
 * Adapt a single sql.js prepared statement to Kysely's `SqliteStatement`
 * contract (all / run / iterate + reader flag).
 */
function adaptStatement(stmt: ReturnType<SqlJsDatabase["prepare"]>): SqliteStatement {
  return {
    // sql.js statements don't expose a "reader" flag; infer from column count.
    get reader(): boolean {
      return stmt.getColumnNames().length > 0;
    },
    all(parameters: ReadonlyArray<unknown>): unknown[] {
      if (parameters.length > 0) stmt.bind(parameters as any[]);
      const rows: unknown[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();
      return rows;
    },
    run(parameters: ReadonlyArray<unknown>) {
      if (parameters.length > 0) stmt.bind(parameters as any[]);
      stmt.step();
      const changes = (stmt as any).getRowsModified?.() ?? 0;
      stmt.free();
      return { changes, lastInsertRowid: 0n };
    },
    *iterate(parameters: ReadonlyArray<unknown>): IterableIterator<unknown> {
      if (parameters.length > 0) stmt.bind(parameters as any[]);
      while (stmt.step()) yield stmt.getAsObject();
      stmt.free();
    },
  } as SqliteStatement;
}

/**
 * Adapt sql.js's `Database` to the better-sqlite3-shaped interface Kysely's
 * `SqliteDialect` expects.
 */
function adaptDatabase(db: SqlJsDatabase): SqliteDatabase {
  return {
    close(): void {
      db.close();
    },
    prepare(sql: string): SqliteStatement {
      return adaptStatement(db.prepare(sql));
    },
  };
}

// Save to disk periodically and on close
function saveToDisk() {
  if (sqlJsDb && dbPathGlobal) {
    const data = sqlJsDb.export();
    writeFileSync(dbPathGlobal, Buffer.from(data));
  }
}

export async function createDb(dbPath?: string): Promise<Kysely<PaawDB>> {
  const path = dbPath || getDbPath();
  dbPathGlobal = path;
  mkdirSync(dirname(path), { recursive: true });

  const SQL = await initSqlJs();

  // Load existing DB or create new
  const dbData = existsSync(path) ? readFileSync(path) : undefined;
  sqlJsDb = new SQL.Database(dbData);

  // Enable foreign keys
  sqlJsDb.run("PRAGMA foreign_keys=ON");

  const kysely = new Kysely<PaawDB>({
    dialect: new SqliteDialect({
      database: adaptDatabase(sqlJsDb),
      // Persist to disk on the first connection so writes survive.
      onCreateConnection: async () => {
        saveToDisk();
      },
    }),
  });

  return kysely;
}

export async function getDb(dbPath?: string): Promise<Kysely<PaawDB>> {
  if (!dbInstance) {
    dbInstance = await createDb(dbPath);
  }
  return dbInstance;
}

/** Get raw sql.js database for direct queries */
export function getRawDb(): SqlJsDatabase | null {
  return sqlJsDb;
}

export async function closeDb(): Promise<void> {
  saveToDisk();
  if (dbInstance) {
    await dbInstance.destroy();
    dbInstance = null;
  }
  if (sqlJsDb) {
    sqlJsDb.close();
    sqlJsDb = null;
  }
}

export { saveToDisk };
