/** tasks.repo — TASKS.json ↔ tasks/task_notes 表（整檔同步：檔案是真相時無 incremental 風險） */
import { openCodingDb } from "./connection.mjs";

const KNOWN_TASK_COLS = new Set([
  "id","featureId","parentId","type","title","status","priority","labels","assignee",
  "description","relatedFiles","notes","pipelineMode","pipelinePhases","autoExecute",
  "createdAt","updatedAt"
]);

/** 把整包 TASKS.json payload 同步進 db（replace 全量） */
export function saveTasks(ruRoot, payload, ru = ruRoot.split("/").pop()) {
  const db = openCodingDb(ruRoot);
  const tasks = Array.isArray(payload) ? payload : (payload?.tasks ?? []);
  if (!Array.isArray(payload)) {
    db.prepare("INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?,?,?)")
      .run("tasks_meta", JSON.stringify({ loopMode: payload?.loopMode ?? undefined, config: payload?.config ?? undefined }), new Date().toISOString());
  }
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM tasks WHERE ru=?").run(ru);
    const ins = db.prepare(`INSERT OR REPLACE INTO tasks
      (id, ru, feature_id, parent_id, type, title, status, priority, labels, assignee,
       description, related_files, pipeline_mode, pipeline_phases, auto_execute, payload,
       created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insNote = db.prepare("INSERT INTO task_notes (task_id, by, at, content, payload) VALUES (?,?,?,?,?)");
    for (const t of tasks) {
      const extra = {};
      for (const [k, v] of Object.entries(t)) if (!KNOWN_TASK_COLS.has(k)) extra[k] = v;
      ins.run(
        t.id, ru, t.featureId === undefined ? "\x01" : t.featureId, t.parentId ?? null, t.type ?? "dev", t.title ?? "",
        t.status ?? "open", t.priority ?? null, JSON.stringify(t.labels ?? []),
        t.assignee ?? null, t.description ?? null, t.relatedFiles === undefined ? "\x01" : JSON.stringify(t.relatedFiles),
        t.pipelineMode ?? null, JSON.stringify(t.pipelinePhases ?? null),
        t.autoExecute ? 1 : 0, JSON.stringify(extra), t.createdAt ?? null, t.updatedAt ?? null
      );
      for (const note of t.notes ?? []) {
      const extra = {};
      for (const [k, v] of Object.entries(note)) if (!["by","at","content"].includes(k)) extra[k] = v;
      insNote.run(t.id, note.by ?? null, note.at ?? null, note.content ?? null,
        Object.keys(extra).length ? JSON.stringify(extra) : null);
    }
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
