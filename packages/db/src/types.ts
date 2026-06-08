/**
 * PAAW Database Types — Kysely table definitions
 */
import type { ColumnType } from "kysely";

export interface RunsTable {
  id: string;
  skill_id: string;
  app_id: string | null;
  workflow_id: string | null;
  workflow_run_id: string | null;
  node_id: string | null;
  cron_job_id: string | null;
  user_id: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  runner_type: "prompt" | "data" | "api" | "script";
  input_json: string;             // JSON string
  output_json: string | null;     // JSON string
  error_message: string | null;
  duration_ms: number | null;
  model: string | null;
  tokens_used: number | null;
  started_at: string;
  completed_at: string | null;
  created_at: ColumnType<string, string | undefined, string | undefined>;
}

export interface ConversationsTable {
  id: string;
  user_id: string;
  type: "chat" | "skill-lab" | "app-lab";
  status: "active" | "closed";
  summary: string | null;
  tags_json: string | null;        // JSON array string
  message_count: number;
  started_at: string;
  last_message_at: string;
  created_at: ColumnType<string, string | undefined, string | undefined>;
  updated_at: ColumnType<string, string | undefined, string | undefined>;
}

export interface ChatMessagesTable {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  content_type: "text" | "image" | "file" | "action";
  intent: string | null;
  actions_json: string | null;     // JSON array string
  skill_run_ids_json: string | null;
  model: string | null;
  tokens_used: number | null;
  latency_ms: number | null;
  metadata_json: string | null;
  created_at: ColumnType<string, string | undefined, string | undefined>;
}

export interface DataStoreTable {
  id: string;
  model_id: string;                // Which data model this belongs to
  user_id: string;
  data_json: string;               // JSON object string
  deleted_at: string | null;       // Soft delete
  created_at: ColumnType<string, string | undefined, string | undefined>;
  updated_at: ColumnType<string, string | undefined, string | undefined>;
}

export interface CronLogsTable {
  id: string;
  cron_job_id: string;
  status: "completed" | "failed" | "skipped";
  run_id: string | null;           // Reference to runs table
  error_message: string | null;
  triggered_at: string;
  completed_at: string | null;
}

export interface MemoryTable {
  id: string;
  user_id: string;
  layer: "profile" | "interaction" | "working" | "knowledge";
  key: string;
  content: string;
  embedding: Buffer | null;        // sqlite-vec vector
  tags_json: string | null;
  source_type: string | null;      // "chat" | "skill_run" | "document"
  source_id: string | null;
  access_count: number;
  created_at: ColumnType<string, string | undefined, string | undefined>;
  updated_at: ColumnType<string, string | undefined, string | undefined>;
  last_accessed: string | null;
  expires_at: string | null;
}

export interface ApiKeysTable {
  id: string;
  app_id: string;
  name: string;
  key_hash: string;                // Hashed API key
  key_prefix: string;              // First 8 chars for display: "tag_xxxx..."
  permissions: string;             // JSON array
  last_used_at: string | null;
  created_at: ColumnType<string, string | undefined, string | undefined>;
}

export interface DailySummariesTable {
  id: string;
  user_id: string;
  date: string;                    // "2026-06-06"
  summary: string;
  highlights_json: string;         // JSON array
  skills_used_json: string;        // JSON array
  intent_counts_json: string;      // JSON object
  mood: "neutral" | "positive" | "frustrated" | "urgent";
  created_at: ColumnType<string, string | undefined, string | undefined>;
}

export interface SkillMetaTable {
  skill_id: string;
  total_runs: number;
  success_rate: number;
  avg_duration_ms: number;
  last_run_at: string | null;
  peak_hours_json: string | null;
  common_inputs_json: string | null;
  error_patterns_json: string | null;
  updated_at: ColumnType<string, string | undefined, string | undefined>;
}

// ── Database interface ──────────────────────────────────

export interface PaawDB {
  runs: RunsTable;
  conversations: ConversationsTable;
  chat_messages: ChatMessagesTable;
  data_store: DataStoreTable;
  cron_logs: CronLogsTable;
  memory: MemoryTable;
  api_keys: ApiKeysTable;
  daily_summaries: DailySummariesTable;
  skill_meta: SkillMetaTable;
}
