/**
 * coding-db — SQLite storage for coding app (.paaw data)
 * Spec: memory/paaw-docs/architecture/CODING_DB_SCHEMA.md (v1)
 *
 * One db per RU: <ruRoot>/.paaw/coding.db
 * Uses node:sqlite (Node 22.5+), zero new dependencies.
 */
import { join } from "path";
import { existsSync, mkdirSync } from "fs";
import { DatabaseSync } from "node:sqlite";
import { MIGRATIONS } from "./migrate.mjs";

/** module-level cache: one connection per db path (avoid double-handle readonly issues) */
const _open = new Map();

export function codingDbPath(ruRoot) {
  return join(ruRoot, ".paaw", "coding.db");
}

/**
 * Open (and migrate if needed) the coding db for a RU.
 * @param {string} ruRoot absolute project root
 * @returns {import("node:sqlite").DatabaseSync}
 */
export function openCodingDb(ruRoot) {
  const dbPath = codingDbPath(ruRoot);
  const dir = join(ruRoot, ".paaw");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  let db = _open.get(dbPath);
  if (db) return db;
  db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec("PRAGMA busy_timeout=5000;");
  db.exec("PRAGMA foreign_keys=ON;");
  _migrate(db);
  _open.set(dbPath, db);
  return db;
}

export function closeCodingDb(ruRoot) {
  const dbPath = codingDbPath(ruRoot);
  const db = _open.get(dbPath);
  if (!db) return;
  try { db.exec("PRAGMA wal_checkpoint(TRUNCATE);"); } catch { /* best effort */ }
  db.close();
  _open.delete(dbPath);
}

/** Commit 前 checkpoint，讓 -wal 清空（git 紀律：sidecar 永不進 git） */
export function checkpointCodingDb(ruRoot) {
  const db = _open.get(codingDbPath(ruRoot));
  if (db) db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
}

function _migrate(db) {
  db.exec("CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT)");
  const row = db.prepare("SELECT value FROM schema_meta WHERE key='schema_version'").get();
  let current = row ? Number(row.value) : 0;
  for (const m of MIGRATIONS) {
    if (m.version > current) {
      try {
        db.exec("BEGIN");
        try {
          db.exec(m.sql);
        } catch (ddlErr) {
          // 2026-11-02：舊 db（v2 schema 落地前由各 repo 直接建表，如 guardrail-hub 實案例）
          // 已有同名表 → CREATE TABLE 报 already exists。逐句重跑、容忍 already exists/duplicate column，
          // 其餘錯誤照舊 bubble（不搞不清楚的靜默吞掉）。
          if (!/already exists|duplicate column/i.test(ddlErr.message)) throw ddlErr;
          for (const stmt of m.sql.split(";")) {
            const s = stmt.trim();
            if (!s) continue;
            try { db.exec(s); }
            catch (e) { if (!/already exists|duplicate column/i.test(e.message)) throw e; }
          }
        }
        db.prepare("INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('schema_version', ?)").run(String(m.version));
        db.exec("COMMIT");
        current = m.version;
      } catch (err) {
        db.exec("ROLLBACK");
        throw new Error(`coding-db migrate v${m.version} failed: ${err.message}`);
      }
    }
  }
}
