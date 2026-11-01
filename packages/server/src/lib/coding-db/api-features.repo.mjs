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

/** API feature 歸類合併（agent 用 api_map_update 工具的唯一合法寫入路徑，同 feature-map-store 哲學）
 * entries: [{file, apiId}] — 把 file 併入該 API 的 codeFiles，並重建 fileApiMap 反向索引。 */
export function mergeApiMappings(ruRoot, entries = [], writeDoc) {
  const db = openCodingDb(ruRoot);
  const apis = db.prepare("SELECT id, code_files FROM api_features").all();
  const byId = new Map(apis.map(r => [r.id, r.code_files ? JSON.parse(r.code_files) : []]));
  let merged = 0;
  const skipped = [];
  for (const e of entries) {
    const file = String(e.file || "").replace(/\\/g, "/").replace(/^\.\//, "");
    if (!file || file.startsWith("/") || file.split("/").includes("..")) { skipped.push({ file: e.file, reason: "不合法路徑" }); continue; }
    const cur = byId.get(e.apiId);
    if (!cur) { skipped.push({ file, reason: `apiId 不存在：${e.apiId}` }); continue; }
    if (cur.includes(file)) { skipped.push({ file, reason: "已歸類（冪等）" }); continue; }
    cur.push(file); byId.set(e.apiId, cur); merged++;
  }
  if (merged > 0) {
    const upd = db.prepare("UPDATE api_features SET code_files=?, updated_at=? WHERE id=?");
    const now = new Date().toISOString();
    for (const [id, files] of byId) {
      if (apis.find(r => r.id === id) && JSON.stringify(files) !== (apis.find(r => r.id === id).code_files || "[]")) upd.run(JSON.stringify(files), now, id);
    }
    // 重建反向索引
    const all = db.prepare("SELECT id, entry, name, code_files, tests FROM api_features").all().map(r => ({
      id: r.id, entry: r.entry, name: r.name,
      codeFiles: r.code_files ? JSON.parse(r.code_files) : [],
      tests: r.tests ? JSON.parse(r.tests) : [],
    }));
    if (writeDoc) writeDoc(ruRoot, "fileApiMap", { files: buildFileApiMap(all), updatedAt: now });
  }
  return { merged, skipped };
}
