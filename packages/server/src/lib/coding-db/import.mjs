/**
 * coding-db import — 一次性把 .paaw 舊檔匯入 SQLite（Phase A）
 * Idempotent：schema_meta.import_done 已設則跳過。
 */
import { join } from "path";
import { readFileSync, readdirSync, existsSync } from "fs";
import { openCodingDb } from "./connection.mjs";

const KNOWN_TASK_COLS = new Set([
  "id","featureId","parentId","type","title","status","priority","labels","assignee",
  "description","relatedFiles","notes","pipelineMode","pipelinePhases","autoExecute",
  "createdAt","updatedAt"
]);
const KNOWN_FEAT_COLS = new Set([
  "id","name","description","status","severity","severityComputed","riskProfile",
  "riskProfileScannedAt","aiUnderstanding","aiUnderstandingAt","documentation",
  "docsUpdatedAt","createdAt","updatedAt","retiredAt"
]);

function readJson(p) {
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf-8")); } catch { return null; }
}

/** dispatch-log.jsonl 是 pretty-print JSON 串接 → brace-balanced 切 record */
function readJsonRecords(p) {
  if (!existsSync(p)) return [];
  const text = readFileSync(p, "utf-8");
  const out = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === "{") { if (depth === 0) start = i; depth++; }
    else if (c === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        try { out.push(JSON.parse(text.slice(start, i + 1))); } catch { /* skip bad */ }
        start = -1;
      }
    }
  }
  return out;
}

function readJsonl(p) {
  if (!existsSync(p)) return [];
  const lines = readFileSync(p, "utf-8").split("\n");
  const out = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t)); } catch { /* skip bad line */ }
  }
  return out;
}

/** 匯入。回傳 { tables: {table: count} } */
export function importCodingDb(ruRoot, ru = ruRoot.split("/").pop()) {
  const db = openCodingDb(ruRoot);
  const done = db.prepare("SELECT value FROM schema_meta WHERE key='import_done'").get();
  if (done) return { skipped: true };

  const counts = {};
  db.exec("BEGIN");
  try {
    counts.tasks = _importTasks(db, ruRoot, ru);
    counts.features = _importFeatures(db, ruRoot, ru);
    Object.assign(counts, _importStateJson(db, ruRoot, ru));
    Object.assign(counts, _importLogs(db, ruRoot, ru));
    Object.assign(counts, _importConversations(db, ruRoot, ru));
    db.prepare("INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('import_done', ?)").run(new Date().toISOString());
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return { tables: counts };
}

function _importTasks(db, ruRoot, ru) {
  const data = readJson(join(ruRoot, ".paaw", "tasks", "TASKS.json"));
  if (!data || !Array.isArray(data.tasks)) return 0;
  const ins = db.prepare(`INSERT OR REPLACE INTO tasks
    (id, ru, feature_id, parent_id, type, title, status, priority, labels, assignee,
     description, related_files, pipeline_mode, pipeline_phases, auto_execute, payload,
     created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insNote = db.prepare("INSERT INTO task_notes (task_id, by, at, content, payload) VALUES (?,?,?,?,?)");
  let n = 0;
  for (const t of data.tasks) {
    const payload = {};
    for (const [k, v] of Object.entries(t)) {
      if (!KNOWN_TASK_COLS.has(k)) payload[k] = v;
    }
    ins.run(
      t.id, ru, t.featureId === undefined ? "\x01" : t.featureId, t.parentId ?? null, t.type ?? "dev", t.title ?? "",
      t.status ?? "open", t.priority ?? null,
      JSON.stringify(t.labels ?? []), t.assignee ?? null, t.description ?? null,
      t.relatedFiles === undefined ? "\x01" : JSON.stringify(t.relatedFiles), t.pipelineMode ?? null,
      JSON.stringify(t.pipelinePhases ?? null), t.autoExecute ? 1 : 0,
      JSON.stringify(payload), t.createdAt ?? null, t.updatedAt ?? null
    );
    for (const note of t.notes ?? []) {
      const extra = {};
      for (const [k, v] of Object.entries(note)) if (!["by","at","content"].includes(k)) extra[k] = v;
      insNote.run(t.id, note.by ?? null, note.at ?? null, note.content ?? null,
        Object.keys(extra).length ? JSON.stringify(extra) : null);
    }
    n++;
  }
  return n;
}

function _importFeatures(db, ruRoot, ru) {
  const data = readJson(join(ruRoot, ".paaw", "features", "FEATURES.json"));
  if (!data || !Array.isArray(data.features)) return 0;
  const ins = db.prepare(`INSERT OR REPLACE INTO features
    (id, ru, name, description, status, severity, severity_computed, risk_profile,
     risk_scanned_at, ai_understanding, ai_understanding_at, documentation,
     docs_updated_at, created_at, updated_at, retired_at, payload)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insFile = db.prepare("INSERT OR IGNORE INTO feature_files (feature_id, file_path) VALUES (?,?)");
  const insApi = db.prepare("INSERT OR IGNORE INTO feature_apis (feature_id, method, path, file_path) VALUES (?,?,?,?)");
  const insTest = db.prepare("INSERT OR IGNORE INTO feature_tests (feature_id, test_file) VALUES (?,?)");
  const insTag = db.prepare("INSERT OR IGNORE INTO feature_tags (feature_id, tag) VALUES (?,?)");
  let n = 0;
  for (const f of data.features) {
    const payload = {};
    for (const [k, v] of Object.entries(f)) {
      if (!KNOWN_FEAT_COLS.has(k)) payload[k] = v;
    }
    ins.run(
      f.id, ru, f.name ?? f.id, (f.description === undefined ? "\x01" : f.description), (f.status === undefined ? "\x01" : f.status),
      (f.severity === undefined ? "\x01" : f.severity), (f.severityComputed === undefined ? "\x01" : f.severityComputed),
      f.riskProfile === undefined ? "\x01" : JSON.stringify(f.riskProfile),
      (f.riskProfileScannedAt === undefined ? "\x01" : f.riskProfileScannedAt), (f.aiUnderstanding === undefined ? "\x01" : f.aiUnderstanding), (f.aiUnderstandingAt === undefined ? "\x01" : f.aiUnderstandingAt),
      (f.documentation === undefined ? "\x01" : f.documentation), (f.docsUpdatedAt === undefined ? "\x01" : f.docsUpdatedAt),
      (f.createdAt === undefined ? "\x01" : f.createdAt), (f.updatedAt === undefined ? "\x01" : f.updatedAt), (f.retiredAt === undefined ? "\x01" : f.retiredAt),
      JSON.stringify(payload)
    );
    for (const p of f.codeFiles ?? []) insFile.run(f.id, p);
    for (const a of f.apis ?? []) {
      if (typeof a === "string") { const m = a.match(/^(\S+)\s+(.+)$/); insApi.run(f.id, m ? m[1] : a, m ? m[2] : null, null); }
      else insApi.run(f.id, a.method ?? null, a.path ?? null, a.file ?? null);
    }
    for (const t of f.tests ?? []) insTest.run(f.id, t);
    for (const tag of f.tags ?? []) insTag.run(f.id, tag);
    n++;
  }
  return n;
}

function _importStateJson(db, ruRoot, ru) {
  const P = ".paaw";
  const counts = {};
  // gates
  const gates = readJson(join(ruRoot, P, "gates.json"));
  if (gates) {
    const ins = db.prepare("INSERT OR REPLACE INTO gates (ru, gate, state, evidence, updated_at) VALUES (?,?,?,?,?)");
    let n = 0;
    for (const [gate, val] of Object.entries(gates)) {
      if (gate.startsWith("_")) continue;
      const state = typeof val === "object" && val ? (val.state ?? null) : (val ?? null);
      ins.run(ru, gate, state, typeof val === "object" ? JSON.stringify(val) : null, null);
      n++;
    }
    counts.gates = n;
  }
  // handover x3
  const insH = db.prepare("INSERT OR REPLACE INTO handover (ru, kind, payload, updated_at) VALUES (?,?,?,?)");
  let hn = 0;
  for (const kind of ["brief", "remarks", "state"]) {
    const d = readJson(join(ruRoot, P, `handover-${kind}.json`));
    if (d) { insH.run(ru, kind, JSON.stringify(d), d.generatedAt ?? null); hn++; }
  }
  counts.handover = hn;
  // issues
  const iss = readJson(join(ruRoot, P, "issues", "ISSUES.json"));
  if (iss && Array.isArray(iss.issues)) {
    const ins = db.prepare("INSERT OR REPLACE INTO issues (id, ru, severity, title, status, payload, updated_at) VALUES (?,?,?,?,?,?,?)");
    for (const i of iss.issues) ins.run(i.id, ru, i.severity ?? null, i.title ?? null, i.status ?? null, JSON.stringify(i), i.updatedAt ?? null);
    counts.issues = iss.issues.length;
  }
  // release requests
  const rrDir = join(ruRoot, P, "release-requests");
  if (existsSync(rrDir)) {
    const ins = db.prepare("INSERT OR REPLACE INTO release_requests (id, ru, state, payload, created_at, updated_at) VALUES (?,?,?,?,?,?)");
    let n = 0;
    for (const f of readdirSync(rrDir)) {
      if (!f.endsWith(".json")) continue;
      const d = readJson(join(rrDir, f));
      if (!d) continue;
      ins.run(d.id ?? f.replace(".json", ""), ru, d.status ?? null, JSON.stringify(d), d.createdAt ?? null, d.createdAt ?? null);
      n++;
    }
    counts.release_requests = n;
  }
  // kv singletons
  const insKv = db.prepare("INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?,?,?)");
  let kn = 0;
  for (const [key, file] of [
    ["cu_status", "cu-status.json"],
    ["staged_changes", "staged-changes.json"],
    ["error_codes", "error-codes.json"],
    ["feature_map_meta", "features/FEATURE-MAP-META.json"],
    ["release_unit_model", "release-unit-model.json"],
  ]) {
    const d = readJson(join(ruRoot, P, file));
    if (d) { insKv.run(key, JSON.stringify(d), null); kn++; }
  }
  counts.kv = kn;
  return counts;
}

function _importLogs(db, ruRoot, ru) {
  const P = join(ruRoot, ".paaw", "coding-memory");
  const counts = {};
  const dl = readJsonRecords(join(P, "dispatch-log.jsonl"));
  const insDl = db.prepare("INSERT INTO dispatch_log (ts, ru, agent_id, task_id, event, payload) VALUES (?,?,?,?,?,?)");
  for (const r of dl) {
    const ts = r.ts ?? r.timestamp ?? r.time ?? null;
    insDl.run(
      typeof ts === "string" ? ts : (ts ? new Date(ts).toISOString() : null),
      r.ru ?? ru,
      r.agentId ?? r.agent ?? null,
      r.taskId ?? r.task ?? null,
      r.event ?? r.type ?? r.phase ?? null,
      JSON.stringify(r)
    );
  }
  counts.dispatch_log = dl.length;

  const al = readJsonl(join(P, "actions.jsonl"));
  const insAl = db.prepare("INSERT INTO action_log (ts, ru, agent_id, action, affected_files, outcome, payload) VALUES (?,?,?,?,?,?,?)");
  for (const r of al) {
    insAl.run(
      r.ts ?? null, ru, r.agent ?? r.agentId ?? null, r.action ?? null,
      JSON.stringify(r.affectedFiles ?? []), r.result ?? r.outcome ?? null, JSON.stringify(r)
    );
  }
  counts.action_log = al.length;

  const qa = readJsonl(join(P, "qa-results.jsonl"));
  const insQa = db.prepare("INSERT INTO qa_results (ts, ru, task_id, verdict, payload) VALUES (?,?,?,?,?)");
  for (const r of qa) insQa.run(r.ts ?? null, ru, r.taskId ?? null, r.verdict ?? null, JSON.stringify(r));
  counts.qa_results = qa.length;

  const ea = readJsonl(join(ruRoot, ".paaw", "exec-approval-log.jsonl"));
  const insEa = db.prepare("INSERT INTO exec_approvals (ts, ru, command, decision, payload) VALUES (?,?,?,?,?)");
  for (const r of ea) insEa.run(r.ts ?? null, ru, r.command ?? null, r.type ?? r.decision ?? null, JSON.stringify(r));
  counts.exec_approvals = ea.length;
  return counts;
}

function _importConversations(db, ruRoot, ru) {
  const convDir = join(ruRoot, ".paaw", "coding-memory", "conversations");
  const counts = { conversation_sessions: 0, conversation_messages: 0 };
  if (!existsSync(convDir)) return counts;
  const insS = db.prepare(`INSERT OR REPLACE INTO conversation_sessions
    (session_id, ru, agent_id, is_active, meta, started_at, ended_at) VALUES (?,?,?,?,?,?,?)`);
  const insM = db.prepare("INSERT OR REPLACE INTO conversation_messages (session_id, seq, role, content, ts, payload) VALUES (?,?,?,?,?,?)");
  for (const agent of readdirSync(convDir)) {
    const agentDir = join(convDir, agent);
    for (const file of readdirSync(agentDir)) {
      if (!file.endsWith(".json")) continue;
      const doc = readJson(join(agentDir, file));
      if (!doc || !Array.isArray(doc.messages)) continue;
      const isActive = file === "active.json";
      const sessionId = `${agent}:${isActive ? "active" : file.replace(/\.json$/, "")}`;
      insS.run(sessionId, ru, agent, isActive ? 1 : 0,
        doc._meta ? JSON.stringify(doc._meta) : null,
        doc._meta?.lastUpdated ?? null, isActive ? null : (doc._meta?.lastUpdated ?? null));
      let seq = 0;
      for (const m of doc.messages) {
        const payload = {};
        for (const [k, v] of Object.entries(m)) {
          if (!["role", "content", "ts"].includes(k)) payload[k] = v;
        }
        insM.run(sessionId, seq++, m.role ?? "user", m.content ?? null, m.ts ?? null,
          Object.keys(payload).length ? JSON.stringify(payload) : null);
      }
      counts.conversation_sessions++;
      counts.conversation_messages += seq;
    }
  }
  return counts;
}
