/** tasks.repo — TASKS.json ↔ task/task_detail 表（v2：master/detail，2026-10-31 Fleming 定案）
 * 檔案仍是工作流真相（coding-tasks 流程），本 repo 做整檔同步鏡像；
 * assignee 不再是欄位 → task_detail(kind='assign')；notes → task_detail(kind='note')。 */
import { openCodingDb } from "./connection.mjs";

const KNOWN_TASK_COLS = new Set([
  "id","featureId","parentId","type","title","status","priority","labels","assignee",
  "description","relatedFiles","notes","pipelineMode","pipelinePhases","autoExecute",
  "createdAt","updatedAt",
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
    db.prepare("DELETE FROM task_detail WHERE ru=?").run(ru);
    db.prepare("DELETE FROM task WHERE ru=?").run(ru);
    const ins = db.prepare(`INSERT OR REPLACE INTO task
      (id, ru, parent_id, feature_id, type, title, status, priority, labels,
       description, related_files, payload, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insDetail = db.prepare(`INSERT INTO task_detail (ru, task_id, kind, agent, ts, content, payload, released_at)
      VALUES (?,?,?,?,?,?,?,?)`);
    for (const t of tasks) {
      const extra = {};
      for (const [k, v] of Object.entries(t)) if (!KNOWN_TASK_COLS.has(k)) extra[k] = v;
      if (t.pipelineMode != null) extra.pipelineMode = t.pipelineMode;
      if (t.pipelinePhases != null) extra.pipelinePhases = t.pipelinePhases;
      if (t.autoExecute != null) extra.autoExecute = t.autoExecute;
      ins.run(
        t.id, ru, t.parentId ?? null, t.featureId === undefined ? "\x01" : t.featureId,
        t.type ?? "dev", t.title ?? "", t.status ?? "open", t.priority ?? null,
        JSON.stringify(t.labels ?? []), t.description ?? null,
        t.relatedFiles === undefined ? "\x01" : JSON.stringify(t.relatedFiles),
        JSON.stringify(extra), t.createdAt ?? null, t.updatedAt ?? null,
      );
      if (t.assignee != null) {
        insDetail.run(ru, t.id, "assign", t.assignee, t.createdAt ?? null, "assigned", null, null);
      }
      for (const note of t.notes ?? []) {
        const nExtra = {};
        for (const [k, v] of Object.entries(note)) if (!["by","at","content"].includes(k)) nExtra[k] = v;
        insDetail.run(ru, t.id, "note", note.by ?? null, note.at ?? null, note.content ?? null,
          Object.keys(nExtra).length ? JSON.stringify(nExtra) : null, null);
      }
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
