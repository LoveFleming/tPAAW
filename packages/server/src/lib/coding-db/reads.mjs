/**
 * coding-db reads — Phase B：db 為主要讀取來源（檔案 fallback，db 缺資料時回讀檔）
 * reconstruct 保證：讀回來的物件與原 JSON 檔形狀一致（UI 無感切換）
 */
import { join } from "path";
import { readFileSync, existsSync, readdirSync } from "fs";
import { openCodingDb } from "./connection.mjs";

const _ru = (ruRoot) => ruRoot.split("/").pop();

/** features 全量 reconstruct（v2：子表內容在 payload）— 順序 = 寫入順序，形狀與 FEATURES.json 一致 */
export function readFeatures(ruRoot) {
  const db = openCodingDb(ruRoot);
  const rows = db.prepare("SELECT * FROM features WHERE ru=? ORDER BY rowid").all(_ru(ruRoot));
  if (!rows.length) return null; // fallback 信號
  return rows.map(r => {
    const f = { ...JSON.parse(r.payload || "{}") };
    f.id = r.id; f.name = r.name;
    if (r.description !== "\x01") f.description = r.description;
    if (r.status !== "\x01") f.status = r.status;
    if (r.severity !== "\x01") f.severity = r.severity;
    if (r.risk_profile && r.risk_profile !== "\x01") f.riskProfile = JSON.parse(r.risk_profile);
    if (r.ai_understanding !== "\x01") f.aiUnderstanding = r.ai_understanding;
    if (r.documentation !== "\x01") f.documentation = r.documentation;
    if (r.created_at !== "\x01") f.createdAt = r.created_at;
    if (r.updated_at !== "\x01") f.updatedAt = r.updated_at;
    f.codeFiles = f.codeFiles ?? [];
    if (!("apis" in f)) f.apis = []; // payload 有原形（含 string-form）優先
    f.tests = f.tests ?? [];
    f.tags = f.tags ?? [];
    return f;
  });
}

/** tasks 全量 reconstruct（v2：task + task_detail），回傳 { tasks, loopMode }（對應 TASKS.json wrapper） */
export function readTasks(ruRoot) {
  const db = openCodingDb(ruRoot);
  const ru = _ru(ruRoot);
  const rows = db.prepare("SELECT * FROM task WHERE ru=? ORDER BY rowid").all(ru);
  if (!rows.length) return null;
  const details = db.prepare("SELECT * FROM task_detail WHERE ru=? ORDER BY rowid").all(ru);
  const notesByTask = new Map();
  const assignByTask = new Map(); // 最新一筆 assign（還原 v1 assignee 欄位形狀）
  for (const d of details) {
    if (d.kind === "note") {
      if (!notesByTask.has(d.task_id)) notesByTask.set(d.task_id, []);
      const note = d.payload ? JSON.parse(d.payload) : {};
      if (d.agent != null) note.by = d.agent;
      if (d.ts != null) note.at = d.ts;
      if (d.content != null) note.content = d.content;
      notesByTask.get(d.task_id).push(note);
    } else if (d.kind === "assign" && d.agent != null) {
      assignByTask.set(d.task_id, d.agent);
    }
  }
  const meta = db.prepare("SELECT value FROM kv WHERE key='tasks_meta'").get();
  let loopMode = meta ? (JSON.parse(meta.value).loopMode ?? undefined) : undefined;
  if (loopMode === undefined) { try { loopMode = JSON.parse(readFileSync(join(ruRoot, ".paaw", "tasks", "TASKS.json"), "utf-8")).loopMode; } catch { /* 檔案不存在 */ } }
  const tasks = rows.map(r => {
    const t = { ...JSON.parse(r.payload || "{}") };
    t.id = r.id;
    if (r.feature_id !== "\x01") t.featureId = r.feature_id;
    t.parentId = r.parent_id;
    t.type = r.type; t.title = r.title; t.status = r.status;
    t.priority = r.priority;
    t.labels = JSON.parse(r.labels || "[]");
    if (assignByTask.has(r.id)) t.assignee = assignByTask.get(r.id);
    t.description = r.description;
    if (r.related_files !== "\x01" && r.related_files !== "") t.relatedFiles = JSON.parse(r.related_files);
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
