/** features.repo — FEATURES.json ↔ features 相關表（整檔同步） */
import { openCodingDb } from "./connection.mjs";

const KNOWN_FEAT_COLS = new Set([
  "id","name","description","status","severity","severityComputed","riskProfile",
  "riskProfileScannedAt","aiUnderstanding","aiUnderstandingAt","documentation",
  "docsUpdatedAt","createdAt","updatedAt","retiredAt"
]);

export function saveFeatures(ruRoot, features, ru = ruRoot.split("/").pop()) {
  const db = openCodingDb(ruRoot);
  const list = Array.isArray(features) ? features : (features?.features ?? []);
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM features WHERE ru=?").run(ru);
    const ins = db.prepare(`INSERT OR REPLACE INTO features
      (id, ru, name, description, status, severity, severity_computed, risk_profile,
       risk_scanned_at, ai_understanding, ai_understanding_at, documentation,
       docs_updated_at, created_at, updated_at, retired_at, payload)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insFile = db.prepare("INSERT OR IGNORE INTO feature_files (feature_id, file_path) VALUES (?,?)");
    const insApi = db.prepare("INSERT OR IGNORE INTO feature_apis (feature_id, method, path, file_path) VALUES (?,?,?,?)");
    const insTest = db.prepare("INSERT OR IGNORE INTO feature_tests (feature_id, test_file) VALUES (?,?)");
    const insTag = db.prepare("INSERT OR IGNORE INTO feature_tags (feature_id, tag) VALUES (?,?)");
    for (const f of list) {
      const extra = {};
      for (const [k, v] of Object.entries(f)) if (!KNOWN_FEAT_COLS.has(k)) extra[k] = v;
      ins.run(
        f.id, ru, f.name ?? f.id, (f.description === undefined ? "\x01" : f.description), (f.status === undefined ? "\x01" : f.status),
        (f.severity === undefined ? "\x01" : f.severity), (f.severityComputed === undefined ? "\x01" : f.severityComputed),
        f.riskProfile === undefined ? "\x01" : JSON.stringify(f.riskProfile),
        (f.riskProfileScannedAt === undefined ? "\x01" : f.riskProfileScannedAt), (f.aiUnderstanding === undefined ? "\x01" : f.aiUnderstanding), (f.aiUnderstandingAt === undefined ? "\x01" : f.aiUnderstandingAt),
        (f.documentation === undefined ? "\x01" : f.documentation), (f.docsUpdatedAt === undefined ? "\x01" : f.docsUpdatedAt),
        (f.createdAt === undefined ? "\x01" : f.createdAt), (f.updatedAt === undefined ? "\x01" : f.updatedAt), (f.retiredAt === undefined ? "\x01" : f.retiredAt), JSON.stringify(extra)
      );
      for (const p of f.codeFiles ?? []) insFile.run(f.id, p);
      for (const a of f.apis ?? []) {
        if (typeof a === "string") { const m = a.match(/^(\S+)\s+(.+)$/); insApi.run(f.id, m ? m[1] : a, m ? m[2] : null, null); }
        else insApi.run(f.id, a.method ?? null, a.path ?? null, a.file ?? null);
      }
      for (const t of f.tests ?? []) insTest.run(f.id, t);
      for (const tag of f.tags ?? []) insTag.run(f.id, tag);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
