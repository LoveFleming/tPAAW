/**
 * PAAW Database Connection — SQLite via sql.js (zero native deps)
 */
import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";
import { Kysely, SqliteDialectWithWorker } from "kysely";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { dirname } from "path";
import { getDbPath } from "./paths";
import type { PaawDB } from "./types";

let dbInstance: Kysely<PaawDB> | null = null;
let sqlJsDb: SqlJsDatabase | null = null;
let dbPathGlobal: string = "";

// sql.js dialect adapter for Kysely
class SqlJsDialect {
  private db: SqlJsDatabase;
  constructor(db: SqlJsDatabase) { this.db = db; }

  createAdapter() {
    const db = this.db;
    return {
      query: (sql: string, params?: any[]) => {
        const stmt = db.prepare(sql);
        if (params) stmt.bind(params);
        const rows: any[] = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        stmt.free();
        return { rows };
      },
      run: (sql: string, params?: any[]) => {
        db.run(sql, params);
        return { changes: db.getRowsModified(), insertId: NaN };
      },
    };
  }
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

  // Simple Kysely wrapper using the adapter pattern
  const adapter = new SqlJsDialect(sqlJsDb);

  // We'll use a lightweight approach: direct sql.js calls via adapter
  // Kysely doesn't have a built-in sql.js dialect, so we use a thin wrapper
  const kysely = new Kysely<PaawDB>({
    dialect: {
      createAdapter: () => ({
        acquireConnection: async () => adapter as any,
        beginTransaction: async () => {},
        commitTransaction: async () => { saveToDisk(); },
        rollbackTransaction: async () => {},
        releaseConnection: async () => {},
      }) as any,
    } as any,
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
