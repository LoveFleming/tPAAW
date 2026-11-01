/**
 * docs.repo — ru_docs 表讀寫（feature tab 文件型資料的單一真相，2026-11-01 Fleming 定案）
 *
 * 收容：FILE-FEATURES / CROSSCUT-CONCEPTS / TEST-SIGNALS / FEATURE-MAP-META
 * 語意：
 *  - readDoc：db 為準；db 沒有且從未 bootstrap → 讀舊 .paaw/features/<file>.json 一次匯入，之後 db 是真相
 *  - writeDoc：只寫 db（舊 .json 檔不再寫，留在原地當歷史快照，不再是資料來源）
 */
import { join } from "path";
import { readFileSync, existsSync } from "fs";
import { openCodingDb } from "./connection.mjs";

/** doc_key → 舊檔名（bootstrap 用；新寫入一律走 db） */
export const DOC_FILES = {
  fileFeatures: "FILE-FEATURES.json",
  crosscut: "CROSSCUT-CONCEPTS.json",
  testSignals: "TEST-SIGNALS.json",
  mapMeta: "FEATURE-MAP-META.json",
};

const _ru = (ruRoot) => ruRoot.split("/").pop();

function _docPath(ruRoot, docKey) {
  const file = DOC_FILES[docKey];
  if (!file) throw new Error(`unknown doc_key: ${docKey}`);
  return join(ruRoot, ".paaw", "features", file);
}

/**
 * 讀 doc。db 有 → 直接回；db 沒有 → 嘗試從舊檔 bootstrap（一次性）→ 都沒有回 fallback。
 * 回傳 parsed 物件（或 fallback），絕不 throw（呼叫端多為 best-effort 讀）。
 */
export function readDoc(ruRoot, docKey, fallback = null) {
  const db = openCodingDb(ruRoot);
  const ru = _ru(ruRoot);
  const row = db.prepare("SELECT payload FROM ru_docs WHERE ru=? AND doc_key=?").get(ru, docKey);
  if (row) {
    try { return JSON.parse(row.payload); } catch { return fallback; }
  }
  // bootstrap：db 無資料 → 舊檔一次性匯入
  const p = _docPath(ruRoot, docKey);
  if (existsSync(p)) {
    try {
      const obj = JSON.parse(readFileSync(p, "utf-8"));
      writeDoc(ruRoot, docKey, obj);
      return obj;
    } catch { /* 壞檔回 fallback */ }
  }
  return fallback;
}

/** 寫 doc（只寫 db；payload 必為可 JSON 化物件） */
export function writeDoc(ruRoot, docKey, obj) {
  const db = openCodingDb(ruRoot);
  db.prepare("INSERT OR REPLACE INTO ru_docs (ru, doc_key, payload, updated_at) VALUES (?,?,?,?)")
    .run(_ru(ruRoot), docKey, JSON.stringify(obj ?? {}), new Date().toISOString());
}

/** doc 是否存在（db 或舊檔任一）— 呼叫端區分「還沒掃過」與「空資料」用 */
export function hasDoc(ruRoot, docKey) {
  const db = openCodingDb(ruRoot);
  const row = db.prepare("SELECT 1 FROM ru_docs WHERE ru=? AND doc_key=?").get(_ru(ruRoot), docKey);
  if (row) return true;
  return existsSync(_docPath(ruRoot, docKey));
}

/** doc 最後更新時間（ staleness 比較用；無資料回 null） */
export function readDocUpdatedAt(ruRoot, docKey) {
  const db = openCodingDb(ruRoot);
  const row = db.prepare("SELECT updated_at FROM ru_docs WHERE ru=? AND doc_key=?").get(_ru(ruRoot), docKey);
  return row?.updated_at ?? null;
}

/** 刪 doc（db row + 舊檔一起清 — CU 重掃等語意用） */
export function deleteDoc(ruRoot, docKey) {
  const db = openCodingDb(ruRoot);
  db.prepare("DELETE FROM ru_docs WHERE ru=? AND doc_key=?").run(_ru(ruRoot), docKey);
}
