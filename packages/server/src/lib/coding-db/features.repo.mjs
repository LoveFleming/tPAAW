/** features.repo — FEATURES.json ↔ features 表（v2：子表收 payload，2026-10-31 Fleming 定案）*/
import { openCodingDb } from "./connection.mjs";

const KNOWN_FEAT_COLS = new Set([
  "id","name","description","status","severity","severityComputed","riskProfile",
  "riskProfileScannedAt","aiUnderstanding","aiUnderstandingAt","documentation",
  "docsUpdatedAt","createdAt","updatedAt","retiredAt","codeFiles","apis","tests","tags",
]);

export function saveFeatures(ruRoot, features, ru = ruRoot.split("/").pop()) {
  const db = openCodingDb(ruRoot);
  const list = Array.isArray(features) ? features : (features?.features ?? []);
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM features WHERE ru=?").run(ru);
    const ins = db.prepare(`INSERT OR REPLACE INTO features
      (id, ru, name, description, status, severity, risk_profile,
       ai_understanding, documentation, payload, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const f of list) {
      const extra = {};
      for (const [k, v] of Object.entries(f)) {
        if (KNOWN_FEAT_COLS.has(k)) continue;
        extra[k] = v;
      }
      // v2：時間戳 + 子表內容收 payload（report 少單獨查；反查需求出現再加表）
      if (f.severityComputed !== undefined) extra.severityComputed = f.severityComputed;
      if (f.riskProfileScannedAt !== undefined) extra.riskScannedAt = f.riskProfileScannedAt;
      if (f.aiUnderstandingAt !== undefined) extra.aiUnderstandingAt = f.aiUnderstandingAt;
      if (f.docsUpdatedAt !== undefined) extra.docsUpdatedAt = f.docsUpdatedAt;
      if (f.retiredAt !== undefined) extra.retiredAt = f.retiredAt;
      extra.codeFiles = f.codeFiles ?? [];
      extra.apis = f.apis ?? [];
      extra.tests = f.tests ?? [];
      extra.tags = f.tags ?? [];
      ins.run(
        f.id, ru, f.name ?? f.id,
        (f.description === undefined ? "\x01" : f.description),
        (f.status === undefined ? "\x01" : f.status),
        (f.severity === undefined ? "\x01" : f.severity),
        f.riskProfile === undefined ? "\x01" : JSON.stringify(f.riskProfile),
        (f.aiUnderstanding === undefined ? "\x01" : f.aiUnderstanding),
        (f.documentation === undefined ? "\x01" : f.documentation),
        JSON.stringify(extra),
        (f.createdAt === undefined ? "\x01" : f.createdAt),
        (f.updatedAt === undefined ? "\x01" : f.updatedAt),
      );
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
