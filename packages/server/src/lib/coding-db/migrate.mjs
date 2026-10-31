/** coding-db schema v1 — full DDL. See CODING_DB_SCHEMA.md */

export const MIGRATIONS = [
  {
    version: 1,
    sql: `
CREATE TABLE tasks (
  id           TEXT PRIMARY KEY,
  ru           TEXT NOT NULL,
  feature_id   TEXT,
  parent_id    TEXT,
  type         TEXT NOT NULL DEFAULT 'dev',
  title        TEXT NOT NULL,
  status       TEXT NOT NULL,
  priority     TEXT,
  labels       TEXT,
  assignee     TEXT,
  description  TEXT,
  related_files TEXT,
  pipeline_mode TEXT,
  pipeline_phases TEXT,
  auto_execute INTEGER DEFAULT 0,
  payload      TEXT,
  created_at   TEXT,
  updated_at   TEXT
);
CREATE INDEX idx_tasks_ru_status ON tasks(ru, status);

CREATE TABLE task_notes (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id  TEXT NOT NULL,
  by       TEXT,
  at       TEXT,
  content  TEXT,
  payload  TEXT,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE TABLE features (
  id          TEXT PRIMARY KEY,
  ru          TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  status      TEXT,
  severity    TEXT,
  severity_computed TEXT,
  risk_profile TEXT,
  risk_scanned_at TEXT,
  ai_understanding TEXT,
  ai_understanding_at TEXT,
  documentation TEXT,
  docs_updated_at TEXT,
  created_at  TEXT,
  updated_at  TEXT,
  retired_at  TEXT,
  payload     TEXT
);
CREATE INDEX idx_features_ru ON features(ru);

CREATE TABLE feature_files (
  feature_id TEXT NOT NULL,
  file_path  TEXT NOT NULL,
  PRIMARY KEY (feature_id, file_path),
  FOREIGN KEY (feature_id) REFERENCES features(id) ON DELETE CASCADE
);
CREATE INDEX idx_ff_path ON feature_files(file_path);

CREATE TABLE feature_apis (
  feature_id TEXT NOT NULL,
  method     TEXT,
  path       TEXT,
  file_path  TEXT,
  PRIMARY KEY (feature_id, method, path),
  FOREIGN KEY (feature_id) REFERENCES features(id) ON DELETE CASCADE
);

CREATE TABLE feature_tests (
  feature_id TEXT NOT NULL,
  test_file  TEXT NOT NULL,
  PRIMARY KEY (feature_id, test_file),
  FOREIGN KEY (feature_id) REFERENCES features(id) ON DELETE CASCADE
);

CREATE TABLE feature_tags (
  feature_id TEXT NOT NULL,
  tag        TEXT NOT NULL,
  PRIMARY KEY (feature_id, tag),
  FOREIGN KEY (feature_id) REFERENCES features(id) ON DELETE CASCADE
);

CREATE TABLE gates (
  ru          TEXT NOT NULL,
  gate        TEXT NOT NULL,
  state       TEXT,
  evidence    TEXT,
  updated_at  TEXT,
  PRIMARY KEY (ru, gate)
);

CREATE TABLE handover (
  ru        TEXT NOT NULL,
  kind      TEXT NOT NULL,
  payload   TEXT NOT NULL,
  updated_at TEXT,
  PRIMARY KEY (ru, kind)
);

CREATE TABLE issues (
  id         TEXT PRIMARY KEY,
  ru         TEXT NOT NULL,
  severity   TEXT,
  title      TEXT,
  status     TEXT,
  payload    TEXT,
  updated_at TEXT
);

CREATE TABLE release_requests (
  id         TEXT PRIMARY KEY,
  ru         TEXT NOT NULL,
  state      TEXT,
  payload    TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE error_codes (
  code    TEXT PRIMARY KEY,
  message TEXT,
  rule    TEXT
);

CREATE TABLE conversation_sessions (
  session_id TEXT PRIMARY KEY,
  ru         TEXT NOT NULL,
  agent_id   TEXT NOT NULL,
  is_active  INTEGER NOT NULL DEFAULT 0,
  meta       TEXT,
  started_at TEXT,
  ended_at   TEXT
);
CREATE UNIQUE INDEX idx_conv_active ON conversation_sessions(ru, agent_id) WHERE is_active = 1;
CREATE INDEX idx_conv_agent ON conversation_sessions(ru, agent_id, started_at);

CREATE TABLE conversation_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  seq        INTEGER NOT NULL,
  role       TEXT NOT NULL,
  content    TEXT,
  ts         TEXT,
  payload    TEXT,
  UNIQUE (session_id, seq),
  FOREIGN KEY (session_id) REFERENCES conversation_sessions(session_id) ON DELETE CASCADE
);

CREATE TABLE dispatch_log (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  ts       TEXT,
  ru       TEXT,
  agent_id TEXT,
  task_id  TEXT,
  event    TEXT,
  payload  TEXT
);
CREATE INDEX idx_dl_ts ON dispatch_log(ts);
CREATE INDEX idx_dl_ru_task ON dispatch_log(ru, task_id);

CREATE TABLE action_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         TEXT,
  ru         TEXT,
  agent_id   TEXT,
  action     TEXT,
  affected_files TEXT,
  outcome    TEXT,
  payload    TEXT
);
CREATE INDEX idx_al_ts ON action_log(ts);

CREATE TABLE qa_results (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  ts       TEXT,
  ru       TEXT,
  task_id  TEXT,
  verdict  TEXT,
  payload  TEXT
);
CREATE INDEX idx_qa_ts ON qa_results(ts);

CREATE TABLE exec_approvals (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  ts       TEXT,
  ru       TEXT,
  command  TEXT,
  decision TEXT,
  payload  TEXT
);

CREATE TABLE kv (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE ru_info (
  ru              TEXT PRIMARY KEY,
  name            TEXT,
  repo_path       TEXT,
  description     TEXT,
  ai_overview     TEXT,
  ai_architecture TEXT,
  ai_updated_at   TEXT,
  imported_at     TEXT
);
`,
  },
];
