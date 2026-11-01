/** api-features.repo — API-first feature map（2026-11-01 Fleming 定案）
 *
 * 一列 = 一個後端進入點（API 為主）。取代 feature-first 的 features 表成為掃描主目標。
 * 全量替換寫入（同 saveFeatures 哲學：交易式、乾淨、無歷史包袱）。
 * 舊 features 表留著不動（不 migration，舊資料不管）。
 */
import { openCodingDb } from "./connection.mjs";

const _now = () => new Date().toISOString();

/** 存 API features：全量替換。list = [{id, category, entry, name, description, bizLogic,
 *  processFlow, validation, dataTouch, aiUnderstanding, codeFiles, tests, severity, custom}] */
export function saveApiFeatures(ruRoot, list) {
  const db = openCodingDb(ruRoot);
  const items = Array.isArray(list) ? list : [];
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM api_features").run();
    const ins = db.prepare(`INSERT INTO api_features
      (id, category, entry, name, description, biz_logic, process_flow, validation,
       data_touch, ai_understanding, code_files, tests, severity, custom, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const f of items) {
      if (!f.entry) continue; // 沒有進入點就不是 API feature
      ins.run(
        f.id ?? null,
        f.category || "uncategorized",
        f.entry,
        f.name || f.entry,
        f.description ?? null,
        f.bizLogic ?? null,
        f.processFlow === undefined ? null : JSON.stringify(f.processFlow),
        f.validation === undefined ? null : JSON.stringify(f.validation),
        f.dataTouch === undefined ? null : JSON.stringify(f.dataTouch),
        f.aiUnderstanding ?? null,
        f.codeFiles === undefined ? null : JSON.stringify(f.codeFiles),
        f.tests === undefined ? null : JSON.stringify(f.tests),
        f.severity ?? null,
        f.custom === undefined ? null : JSON.stringify(f.custom),
        f.createdAt ?? _now(),
        _now(),
      );
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/** 檔案→API 反向索引寫入 ru_docs（doc_key = fileApiMap）：release report impact 分析用 */
export function buildFileApiMap(list) {
  const map = {};
  for (const f of list) {
    const files = new Set([...(f.codeFiles || []), ...(f.tests || [])]);
    for (const file of files) {
      const norm = String(file).replace(/\\/g, "/").replace(/^\.\//, "");
      if (!norm) continue;
      if (!map[norm]) map[norm] = [];
      if (!map[norm].some(x => x.id === f.id)) map[norm].push({ id: f.id, entry: f.entry, name: f.name });
    }
  }
  return map;
}
