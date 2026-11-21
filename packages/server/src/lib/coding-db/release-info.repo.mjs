/**
 * release-info repo — Release Info 版本進 sqlite（coding-db v9，Fleming 2026-11-21）
 *
 * 產生 info-vN.json 的同時寫一行進 coding.db（UNIQUE(rr_id, version)，重跑同版覆蓋）。
 * json 欄位存原文（changes/features/git），查詢用 SQL、內容用 JSON.parse。
 */
import { openCodingDb } from "./connection.mjs";

/** 寫入（或同版覆蓋）一版 Release Info */
export function writeReleaseInfo(ruRoot, rec) {
  const db = openCodingDb(ruRoot);
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO release_infos (rr_id, version, schema, app_version, release_date, summary,
      changes_json, features_json, git_json, matrix_summary, ai_source, test_run_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(rr_id, version) DO UPDATE SET
      schema = excluded.schema, app_version = excluded.app_version, release_date = excluded.release_date,
      summary = excluded.summary, changes_json = excluded.changes_json, features_json = excluded.features_json,
      git_json = excluded.git_json, matrix_summary = excluded.matrix_summary, ai_source = excluded.ai_source,
      test_run_id = excluded.test_run_id, created_at = excluded.created_at
  `).run(
    rec.rrId, rec.v, rec.schema || null, rec.appVersion || null, rec.releaseDate || null,
    rec.summary || null, JSON.stringify(rec.changes || []), JSON.stringify(rec.features || []),
    JSON.stringify(rec.git || {}), rec.matrixSummary ? JSON.stringify(rec.matrixSummary) : null,
    rec.aiSource || null, rec.testRunId || null, now,
  );
}

/** 讀某 RR 全部版本（新 → 舊）；decode json 欄位 */
export function listReleaseInfosDb(ruRoot, rrId) {
  const db = openCodingDb(ruRoot);
  const rows = db.prepare("SELECT * FROM release_infos WHERE rr_id = ? ORDER BY version DESC").all(rrId);
  return rows.map((r) => ({ ...r, changes: JSON.parse(r.changes_json || "[]"), features: JSON.parse(r.features_json || "[]"), git: JSON.parse(r.git_json || "{}"), matrix_summary: r.matrix_summary ? JSON.parse(r.matrix_summary) : null }));
}
