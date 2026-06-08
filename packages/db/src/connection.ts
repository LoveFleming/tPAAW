/**
 * PAAW Database Connection — SQLite + Kysely
 */
import Database from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import { mkdirSync } from "fs";
import { dirname } from "path";
import { getDbPath } from "./paths";
import type { PaawDB } from "./types";

let dbInstance: Kysely<PaawDB> | null = null;

export function createDb(dbPath?: string): Kysely<PaawDB> {
  const path = dbPath || getDbPath();
  
  mkdirSync(dirname(path), { recursive: true });
  
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode=WAL");
  sqlite.pragma("foreign_keys=ON");
  sqlite.pragma("busy_timeout=5000");

  const dialect = new SqliteDialect({ database: sqlite });

  return new Kysely<PaawDB>({ dialect });
}

export function getDb(dbPath?: string): Kysely<PaawDB> {
  if (!dbInstance) {
    dbInstance = createDb(dbPath);
  }
  return dbInstance;
}

export async function closeDb(): Promise<void> {
  if (dbInstance) {
    await dbInstance.destroy();
    dbInstance = null;
  }
}
