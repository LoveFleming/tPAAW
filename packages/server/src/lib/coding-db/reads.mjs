/**
 * coding-db reads — Phase B：db 為主要讀取來源（檔案 fallback，db 缺資料時回讀檔）
 * reconstruct 保證：讀回來的物件與原 JSON 檔形狀一致（UI 無感切換）
 */
import { join } from "path";
import { readFileSync, existsSync, readdirSync } from "fs";
import { openCodingDb } from "./connection.mjs";

const _ru = (ruRoot) => ruRoot.split("/").pop();

/** features 全量 reconstruct（順序 = 寫入順序，extras 合併回顶层） */
export function readFeatures(ruRoot) {
  const db = openCodingDb(ruRoot);
  const rows = db.prepare("SELECT * FROM features WHERE ru=? ORDER BY rowid").all(_ru(ruRoot));
  if (!rows.length) return null; // fallback 信號
  const filesByFid = _group(db, "feature_files", "feature_id", "file_path");
  const apisByFid = _groupObjects(db, "feature_apis", "feature_id", ["method", "path", "file"]);
  const testsByFid = _group(db, "feature_tests", "feature_id", "test_file");
  const tagsByFid = _group(db, "feature_tags", "feature_id", "tag");
  return rows.map(r => {
    const f = { ...JSON.parse(r.payload || "{}") };
    f.id = r.id; f.name = r.name;
    f.description = r.description;
    f.status = r.status;
    f.severity = r.severity;
    f.severityComputed = r.severity_computed;
    if (r.risk_profile != null) f.riskProfile = JSON.parse(r.risk_profile); // 無值 = key 不存在（severity-auto-scan 測試依賴 undefined 語意）
    f.riskProfileScannedAt = r.risk_scanned_at;
    f.aiUnderstanding = r.ai_understanding;
    f.aiUnderstandingAt = r.ai_understanding_at;
    f.documentation = r.documentation;
    f.docsUpdatedAt = r.docs_updated_at;
    f.createdAt = r.created_at;
    f.updatedAt = r.updated_at;
    f.retiredAt = r.retired_at;
    f.codeFiles = filesByFid.get(r.id) ?? [];
    f.apis = apisByFid.get(r.id) ?? [];
    f.tests = testsByFid.get(r.id) ?? [];
    f.tags = tagsByFid.get(r.id) ?? [];
    return f;
  });
}

/** tasks 全量 reconstruct，回傳 { tasks, loopMode } 形狀（對應 TASKS.json wrapper） */
export function readTasks(ruRoot) {
  const db = openCodingDb(ruRoot);
  const ru = _ru(ruRoot);
  const rows = db.prepare("SELECT * FROM tasks WHERE ru=? ORDER BY rowid").all(ru);
  if (!rows.length) return null;
  const notesByTask = new Map();
  for (const n of db.prepare("SELECT * FROM task_notes ORDER BY rowid").all()) {
    if (!notesByTask.has(n.task_id)) notesByTask.set(n.task_id, []);
    const note = { by: n.by, at: n.at, content: n.content };
    if (n.payload) Object.assign(note, JSON.parse(n.payload));
    notesByTask.get(n.task_id).push(note);
  }
  const meta = db.prepare("SELECT value FROM kv WHERE key='tasks_meta'").get();
  let loopMode = meta ? (JSON.parse(meta.value).loopMode ?? undefined) : undefined;
  if (loopMode === undefined) { try { loopMode = JSON.parse(readFileSync(join(ruRoot, ".paaw", "tasks", "TASKS.json"), "utf-8")).loopMode; } catch { /* 檔案不存在 */ } }
  const tasks = rows.map(r => {
    const t = { ...JSON.parse(r.payload || "{}") };
    t.id = r.id;
    t.featureId = r.feature_id;
    t.parentId = r.parent_id;
    t.type = r.type; t.title = r.title; t.status = r.status;
    t.priority = r.priority;
    t.labels = JSON.parse(r.labels || "[]");
    t.assignee = r.assignee;
    t.description = r.description;
    t.relatedFiles = JSON.parse(r.related_files || "[]");
    if (r.pipeline_mode != null) t.pipelineMode = r.pipeline_mode;
    const ph = JSON.parse(r.pipeline_phases || "null");
    if (ph != null) t.pipelinePhases = ph;
    if (r.auto_execute) t.autoExecute = true;
    t.createdAt = r.created_at;
    t.updatedAt = r.updated_at;
    t.notes = notesByTask.get(r.id) ?? [];
    return t;
  });
  return { tasks, loopMode };
}

/** action log：db 讀（回傳原 record 形狀），ru 過濾 + 新→舊 + limit */
export function readActionLog(ruRoot, { agent, actions, limit } = {}) {
  const db = openCodingDb(ruRoot);
  const ru = _ru(ruRoot);
  let sql = "SELECT payload FROM action_log WHERE ru=?";
  const args = [ru];
  if (agent) { sql += " AND agent_id=?"; args.push(agent); }
  if (actions && actions.length) {
    sql += ` AND action IN (${actions.map(() => "?").join(",")})`;
    args.push(...actions);
  }
  sql += " ORDER BY id DESC LIMIT ?";
  args.push(limit ?? 20);
  return db.prepare(sql).all(...args).map(r => JSON.parse(r.payload));
}

/** conversation 讀取：list agents / sessions / messages */
export function readConversationAgents(ruRoot) {
  const db = openCodingDb(ruRoot);
  return db.prepare("SELECT DISTINCT agent_id FROM conversation_sessions WHERE ru=? ORDER BY agent_id").all(_ru(ruRoot)).map(r => r.agent_id);
}

export function readConversationSessions(ruRoot, agentId) {
  const db = openCodingDb(ruRoot);
  const rows = db.prepare(
    "SELECT session_id, agent_id, is_active, meta, started_at, ended_at FROM conversation_sessions WHERE ru=? AND agent_id=? ORDER BY started_at DESC"
  ).all(_ru(ruRoot), agentId);
  return rows.map(r => ({
    sessionId: r.session_id.split(":").slice(1).join(":"),
    agentId: r.agent_id,
    active: !!r.is_active,
    meta: r.meta ? JSON.parse(r.meta) : {},
    lastUpdated: r.started_at,
    archivedAt: r.ended_at,
  }));
}

export function readConversation(ruRoot, agentId, sessionId = "active") {
  const db = openCodingDb(ruRoot);
  const sid = `${agentId}:${sessionId}`;
  const s = db.prepare("SELECT * FROM conversation_sessions WHERE session_id=?").get(sid);
  if (!s) return null;
  const msgs = db.prepare("SELECT role, content, ts, payload FROM conversation_messages WHERE session_id=? ORDER BY seq").all(sid)
    .map(m => {
      const msg = { role: m.role, content: m.content };
      if (m.ts) msg.ts = m.ts;
      if (m.payload) Object.assign(msg, JSON.parse(m.payload));
      return msg;
    });
  return { _meta: s.meta ? JSON.parse(s.meta) : { crewId: agentId }, messages: msgs };
}

/** 檔案 fallback 讀取（db 尚無資料時用） */
export function readFileFeatures(ruRoot) {
  const p = join(ruRoot, ".paaw", "features", "FEATURES.json");
  if (!existsSync(p)) return [];
  try {
    const d = JSON.parse(readFileSync(p, "utf-8"));
    const f = Array.isArray(d) ? d : (d.features || []);
    return Object.values(f);
  } catch { return []; }
}

export function readFileTasks(ruRoot) {
  const p = join(ruRoot, ".paaw", "tasks", "TASKS.json");
  if (!existsSync(p)) return { tasks: [] };
  try { return JSON.parse(readFileSync(p, "utf-8")); } catch { return { tasks: [] }; }
}

export function readFileConversations(ruRoot) {
  const dir = join(ruRoot, ".paaw", "coding-memory", "conversations");
  const out = {};
  if (!existsSync(dir)) return out;
  for (const agent of readdirSync(dir)) {
    const a = {};
    for (const f of readdirSync(join(dir, agent))) {
      if (!f.endsWith(".json")) continue;
      try { a[f.replace(/\.json$/, "")] = JSON.parse(readFileSync(join(dir, agent, f), "utf-8")); } catch {}
    }
    out[agent] = a;
  }
  return out;
}

function _group(db, table, keyCol, valCol) {
  const m = new Map();
  for (const r of db.prepare(`SELECT ${keyCol} k, ${valCol} v FROM ${table}`).all()) {
    if (!m.has(r.k)) m.set(r.k, []);
    m.get(r.k).push(r.v);
  }
  return m;
}

function _groupObjects(db, table, keyCol, cols) {
  const m = new Map();
  const sel = cols.map(c => c === "file" ? "file_path AS file" : c).join(", ");
  for (const r of db.prepare(`SELECT ${keyCol} k, ${sel} FROM ${table}`).all()) {
    if (!m.has(r.k)) m.set(r.k, []);
    const o = {};
    for (const c of cols) if (r[c] != null) o[c] = r[c];
    m.get(r.k).push(o);
  }
  return m;
}
