/**
 * coding-db verify — Phase A 匯入驗證：逐表 count vs 原檔筆數 + 抽樣比對
 */
import { join } from "path";
import { readFileSync, readdirSync, existsSync } from "fs";
import { openCodingDb } from "./connection.mjs";

function readJson(p) { try { return JSON.parse(readFileSync(p, "utf-8")); } catch { return null; } }

export function verifyCodingDb(ruRoot, ru = ruRoot.split("/").pop()) {
  const db = openCodingDb(ruRoot);
  const P = join(ruRoot, ".paaw");
  const result = { checks: [], ok: true };

  const check = (name, expected, actual) => {
    const pass = expected === actual;
    if (!pass) result.ok = false;
    result.checks.push({ name, expected, actual, pass });
  };

  // counts
  const tasks = readJson(join(P, "tasks", "TASKS.json"));
  check("task", tasks?.tasks?.length ?? 0, _count(db, "task"));
  const feats = readJson(join(P, "features", "FEATURES.json"));
  check("features", feats?.features?.length ?? 0, _count(db, "features"));
  const insFile = feats?.features?.reduce((s, f) => s + (f.codeFiles?.length ?? 0), 0) ?? 0;
  const featFilesInPayload = db.prepare("SELECT payload FROM features").all()
    .reduce((s, r) => s + ((JSON.parse(r.payload || "{}").codeFiles ?? []).length), 0);
  check("feature codeFiles (in payload)", insFile, featFilesInPayload);
  const iss = readJson(join(P, "issues", "ISSUES.json"));
  check("issues", iss?.issues?.length ?? 0, _count(db, "issues"));
  const rrDir = join(P, "release-requests");
  const rrCount = existsSync(rrDir) ? readdirSync(rrDir).filter(f => f.endsWith(".json")).length : 0;
  check("release_requests", rrCount, _count(db, "release_requests"));

  // sample equality: first task title, first feature name, first message content
  if (tasks?.tasks?.length) {
    const t0 = tasks.tasks[0];
    const row = db.prepare("SELECT title, status FROM task WHERE id=?").get(t0.id);
    check(`sample task ${t0.id}`, true, !!(row && row.title === t0.title && row.status === t0.status));
  }
  if (feats?.features?.length) {
    const f0 = feats.features[0];
    const row = db.prepare("SELECT name FROM features WHERE id=?").get(f0.id);
    check(`sample feature ${f0.id}`, true, !!(row && row.name === f0.name));
  }
  const convDir = join(P, "coding-memory", "conversations");
  if (existsSync(convDir)) {
    const em = readJson(join(convDir, "coding.em", "active.json"));
    if (em?.messages?.length) {
      const row = db.prepare(
        "SELECT content FROM conversation_messages m JOIN conversation_sessions s ON m.session_id=s.session_id WHERE s.agent_id='coding.em' AND s.is_active=1 AND m.seq=?"
      ).get(em.messages.length - 1);
      check("sample last em message", true, !!(row && row.content === em.messages[em.messages.length - 1].content));
    }
  }
  // dispatch_log 查詢可用性
  const dl = db.prepare("SELECT COUNT(*) c FROM dispatch_log WHERE ts IS NOT NULL").get();
  result.checks.push({ name: "dispatch_log ts parseable", expected: ">0", actual: dl.c, pass: dl.c > 0 });
  if (dl.c === 0) result.ok = false;

  return result;
}

function _count(db, table) {
  return db.prepare(`SELECT COUNT(*) c FROM ${table}`).get().c;
}
