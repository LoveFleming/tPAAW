/**
 * PAAW Database Migrations
 * 
 * Run with: pnpm --filter @paaw/db migrate
 */
import Database from "better-sqlite3";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { mkdirSync } from "fs";
import { getDbPath } from "./paths";
import type { PaawDB } from "./types";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function migrate(dbPath?: string): Promise<void> {
  const path = dbPath || getDbPath();
  mkdirSync(dirname(path), { recursive: true });

  const sqlite = new Database(path);
  sqlite.pragma("journal_mode=WAL");
  sqlite.pragma("foreign_keys=ON");

  console.log("[db] Running migrations...");

  // Create all tables
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      skill_id TEXT NOT NULL,
      app_id TEXT,
      workflow_id TEXT,
      workflow_run_id TEXT,
      node_id TEXT,
      cron_job_id TEXT,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL,
      runner_type TEXT NOT NULL,
      input_json TEXT NOT NULL,
      output_json TEXT,
      error_message TEXT,
      duration_ms INTEGER,
      model TEXT,
      tokens_used INTEGER,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      summary TEXT,
      tags_json TEXT,
      message_count INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL,
      last_message_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      content_type TEXT NOT NULL DEFAULT 'text',
      intent TEXT,
      actions_json TEXT,
      skill_run_ids_json TEXT,
      model TEXT,
      tokens_used INTEGER,
      latency_ms INTEGER,
      metadata_json TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS data_store (
      id TEXT PRIMARY KEY,
      model_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      data_json TEXT NOT NULL,
      deleted_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cron_logs (
      id TEXT PRIMARY KEY,
      cron_job_id TEXT NOT NULL,
      status TEXT NOT NULL,
      run_id TEXT,
      error_message TEXT,
      triggered_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS memory (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      layer TEXT NOT NULL,
      key TEXT NOT NULL,
      content TEXT NOT NULL,
      embedding BLOB,
      tags_json TEXT,
      source_type TEXT,
      source_id TEXT,
      access_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      last_accessed TEXT,
      expires_at TEXT
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      key_prefix TEXT NOT NULL,
      permissions TEXT NOT NULL,
      last_used_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS daily_summaries (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      date TEXT NOT NULL,
      summary TEXT NOT NULL,
      highlights_json TEXT,
      skills_used_json TEXT,
      intent_counts_json TEXT,
      mood TEXT NOT NULL DEFAULT 'neutral',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS skill_meta (
      skill_id TEXT PRIMARY KEY,
      total_runs INTEGER NOT NULL DEFAULT 0,
      success_rate REAL NOT NULL DEFAULT 0,
      avg_duration_ms INTEGER NOT NULL DEFAULT 0,
      last_run_at TEXT,
      peak_hours_json TEXT,
      common_inputs_json TEXT,
      error_patterns_json TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Create indexes
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_runs_skill_id ON runs(skill_id);
    CREATE INDEX IF NOT EXISTS idx_runs_user_id ON runs(user_id);
    CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
    CREATE INDEX IF NOT EXISTS idx_runs_started_at ON runs(started_at);
    CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_type ON conversations(type);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_conv_id ON chat_messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_data_store_model_id ON data_store(model_id);
    CREATE INDEX IF NOT EXISTS idx_data_store_user_id ON data_store(user_id);
    CREATE INDEX IF NOT EXISTS idx_memory_user_layer ON memory(user_id, layer);
    CREATE INDEX IF NOT EXISTS idx_daily_summaries_user_date ON daily_summaries(user_id, date);
  `);

  sqlite.close();
  console.log("[db] Migrations complete ✅");
}

// Run if called directly
migrate().catch(console.error);
