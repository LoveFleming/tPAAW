/** stores.repo — logs/kv/gates/handover/issues/RR/conversations 的 append 與 upsert */
import { openCodingDb } from "./connection.mjs";

const _ru = (ruRoot) => ruRoot.split("/").pop();

export function appendDispatchRecord(ruRoot, record) {
  const db = openCodingDb(ruRoot);
  const ts = record?.ts ?? record?.timestamp ?? record?.time ?? null;
  db.prepare("INSERT INTO dispatch_log (ts, ru, agent_id, task_id, event, payload) VALUES (?,?,?,?,?,?)").run(
    typeof ts === "string" ? ts : (ts ? new Date(ts).toISOString() : null),
    record?.ru ?? _ru(ruRoot), record?.agentId ?? record?.agent ?? null,
    record?.taskId ?? record?.task ?? null, record?.event ?? record?.type ?? null,
    JSON.stringify(record ?? {})
  );
}

export function appendActionRecord(ruRoot, record) {
  const db = openCodingDb(ruRoot);
  db.prepare("INSERT INTO action_log (ts, ru, agent_id, action, affected_files, outcome, payload) VALUES (?,?,?,?,?,?,?)").run(
    record?.ts ?? null, _ru(ruRoot), record?.agent ?? record?.agentId ?? null,
    record?.action ?? null, JSON.stringify(record?.affectedFiles ?? []),
    record?.result ?? record?.outcome ?? null, JSON.stringify(record ?? {})
  );
}

export function appendQaResult(ruRoot, record) {
  const db = openCodingDb(ruRoot);
  db.prepare("INSERT INTO qa_results (ts, ru, task_id, verdict, payload) VALUES (?,?,?,?,?)").run(
    record?.ts ?? null, _ru(ruRoot), record?.taskId ?? null, record?.verdict ?? null,
    JSON.stringify(record ?? {})
  );
}

export function appendExecApproval(ruRoot, record) {
  const db = openCodingDb(ruRoot);
  db.prepare("INSERT INTO exec_approvals (ts, ru, command, decision, payload) VALUES (?,?,?,?,?)").run(
    record?.ts ?? null, _ru(ruRoot), record?.command ?? null,
    record?.type ?? record?.decision ?? null, JSON.stringify(record ?? {})
  );
}

export function setKv(ruRoot, key, value) {
  const db = openCodingDb(ruRoot);
  db.prepare("INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?,?,?)").run(
    key, JSON.stringify(value), new Date().toISOString()
  );
}

export function setGates(ruRoot, gates) {
  const db = openCodingDb(ruRoot);
  const ins = db.prepare("INSERT OR REPLACE INTO gates (ru, gate, state, evidence, updated_at) VALUES (?,?,?,?,?)");
  for (const [gate, val] of Object.entries(gates ?? {})) {
    if (gate.startsWith("_")) continue;
    const state = typeof val === "object" && val ? (val.state ?? null) : (val ?? null);
    ins.run(_ru(ruRoot), gate, state, typeof val === "object" ? JSON.stringify(val) : null, new Date().toISOString());
  }
}

export function setHandover(ruRoot, kind, payload) {
  const db = openCodingDb(ruRoot);
  db.prepare("INSERT OR REPLACE INTO handover (ru, kind, payload, updated_at) VALUES (?,?,?,?)").run(
    _ru(ruRoot), kind, JSON.stringify(payload ?? {}), new Date().toISOString()
  );
}

export function saveIssue(ruRoot, issue) {
  const db = openCodingDb(ruRoot);
  db.prepare("INSERT OR REPLACE INTO issues (id, ru, severity, title, status, payload, updated_at) VALUES (?,?,?,?,?,?,?)").run(
    issue.id, _ru(ruRoot), issue.severity ?? null, issue.title ?? null, issue.status ?? null,
    JSON.stringify(issue), issue.updatedAt ?? null
  );
}

export function saveReleaseRequest(ruRoot, rr) {
  const db = openCodingDb(ruRoot);
  db.prepare("INSERT OR REPLACE INTO release_requests (id, ru, state, payload, created_at, updated_at) VALUES (?,?,?,?,?,?)").run(
    rr.id, _ru(ruRoot), rr.status ?? null, JSON.stringify(rr), rr.createdAt ?? null, rr.createdAt ?? null
  );
}

/** 儲存 conversation（active 或指定 session 檔）；doc = {_meta, messages} */
export function saveConversation(ruRoot, agentId, doc, { session = "active" } = {}) {
  const db = openCodingDb(ruRoot);
  const ru = _ru(ruRoot);
  const sessionId = `${agentId}:${session}`;
  const isActive = session === "active";
  db.exec("BEGIN");
  try {
    if (isActive) {
      db.prepare("UPDATE conversation_sessions SET is_active=0, ended_at=? WHERE ru=? AND agent_id=? AND is_active=1")
        .run(new Date().toISOString(), ru, agentId);
    }
    db.prepare(`INSERT OR REPLACE INTO conversation_sessions
      (session_id, ru, agent_id, is_active, meta, started_at, ended_at) VALUES (?,?,?,?,?,?,?)`)
      .run(sessionId, ru, agentId, isActive ? 1 : 0,
        doc?._meta ? JSON.stringify(doc._meta) : null,
        doc?._meta?.lastUpdated ?? null, null);
    db.prepare("DELETE FROM conversation_messages WHERE session_id=?").run(sessionId);
    const insM = db.prepare("INSERT INTO conversation_messages (session_id, seq, role, content, ts, payload) VALUES (?,?,?,?,?,?)");
    let seq = 0;
    for (const m of doc?.messages ?? []) {
      const extra = {};
      for (const [k, v] of Object.entries(m)) if (!["role", "content", "ts"].includes(k)) extra[k] = v;
      insM.run(sessionId, seq++, m.role ?? "user", m.content ?? null, m.ts ?? null,
        Object.keys(extra).length ? JSON.stringify(extra) : null);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/** archive：active 設 0 + ended_at，另存新 session（原 active 內容搬到新 session_id） */
export function archiveConversation(ruRoot, agentId, archiveSessionId) {
  const db = openCodingDb(ruRoot);
  const ru = _ru(ruRoot);
  db.exec("BEGIN");
  try {
    const row = db.prepare("SELECT session_id FROM conversation_sessions WHERE ru=? AND agent_id=? AND is_active=1").get(ru, agentId);
    if (row) {
      const target = `${agentId}:${archiveSessionId ?? new Date().toISOString()}`;
      db.prepare("UPDATE conversation_messages SET session_id=? WHERE session_id=?").run(target, row.session_id);
      db.prepare("UPDATE conversation_sessions SET session_id=?, is_active=0, ended_at=? WHERE session_id=?")
        .run(target, new Date().toISOString(), row.session_id);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
