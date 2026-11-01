/** ui-features.repo — 前端 route-first feature map（2026-11-01 Fleming）
 *
 * 一列 = 一個前端進入點（route/頁面）。schema 與 api_features 不同（走前端語意）：
 * route / uiFlow / components / stateMgmt / apiCalls（這頁打哪些後端 API — 前後端 impact 橋樑）。
 * 全量替換寫入（同 saveApiFeatures 哲學）。
 */
import { openCodingDb } from "./connection.mjs";

const _now = () => new Date().toISOString();

/** 存 UI features：全量替換。list = [{id, category, route, name, description, uiFlow,
 *  components, stateMgmt, apiCalls, codeFiles, tests, severity, custom}] */
export function saveUiFeatures(ruRoot, list) {
  const db = openCodingDb(ruRoot);
  const items = Array.isArray(list) ? list : [];
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM ui_features").run();
    const ins = db.prepare(`INSERT INTO ui_features
      (id, category, route, name, description, ui_flow, components, state_mgmt,
       api_calls, code_files, tests, severity, custom, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const f of items) {
      if (!f.route) continue; // 沒有 route 就不是前端進入點
      ins.run(
        f.id ?? null,
        f.category || "uncategorized",
        f.route,
        f.name || f.route,
        f.description ?? null,
        f.uiFlow === undefined ? null : JSON.stringify(f.uiFlow),
        f.components === undefined ? null : JSON.stringify(f.components),
        f.stateMgmt ?? null,
        f.apiCalls === undefined ? null : JSON.stringify(f.apiCalls),
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
  return items.filter(f => f.route).length;
}

function _row(r) {
  return {
    id: r.id, category: r.category, route: r.route, name: r.name,
    description: r.description,
    uiFlow: r.ui_flow ? JSON.parse(r.ui_flow) : [],
    components: r.components ? JSON.parse(r.components) : [],
    stateMgmt: r.state_mgmt,
    apiCalls: r.api_calls ? JSON.parse(r.api_calls) : [],
    codeFiles: r.code_files ? JSON.parse(r.code_files) : [],
    tests: r.tests ? JSON.parse(r.tests) : [],
    severity: r.severity,
    custom: r.custom ? JSON.parse(r.custom) : {},
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

/** 讀全部 UI features（category 排序） */
export function readUiFeatures(ruRoot) {
  try {
    const db = openCodingDb(ruRoot);
    return db.prepare("SELECT * FROM ui_features ORDER BY category, rowid").all().map(_row);
  } catch { return []; }
}

/** 反查：某後端 API entry 被哪些前端 route 呼叫（impact 跨端分析用） */
export function findUiByApiCall(ruRoot, entry) {
  const all = readUiFeatures(ruRoot);
  const want = String(entry).toLowerCase();
  return all.filter(u => (u.apiCalls || []).some(c => String(c).toLowerCase() === want));
}
