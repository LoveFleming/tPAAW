/**
 * Feature Risk Scan — deterministic 構成面掃描（2026-10-10 Fleming：by feature 標嚴重度）
 *
 * 鐵律（North Star）：事實靠程式 — SQL 資料異動 / API 介面 / 外部服務呼叫全部 regex 掃描產生，
 * LLM 只做嚴重度推理（suggestSeverity 在 coding-features.mjs），人做最終確認。
 *
 * 嚴重度計算（deterministic baseline）：
 *   S2 🔴 — DDL/migration（CREATE/ALTER/DROP TABLE/COLUMN）或 DELETE FROM（不可逆異動）
 *   S1 🟡 — INSERT/UPDATE（可逆性中）或對外 mutating 呼叫（method POST/PUT/PATCH/DELETE）
 *   S0 🟢 — 純 SELECT / 無資料異動
 */

import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { resolve, basename } from "path";

const MAX_FILE_BYTES = 800_000; // 單檔掃描上限（超大檔只掃前 800KB）
const MAX_FILES = 80;           // 單 feature 最多掃描檔數
const MAX_TABLES = 60;          // dataTouch 目標數上限

// ── SQL 資料異動偵測 ──

const SQL_PATTERNS = [
  { op: "select", re: /\bSELECT\s+[\s\S]{0,300}?\bFROM\s+[`"'\[]?([A-Za-z0-9_.\-]+)/gi },
  { op: "insert", re: /\bINSERT\s+(?:OR\s+\w+\s+)?INTO\s+[`"'\[]?([A-Za-z0-9_.\-]+)/gi },
  { op: "update", re: /\bUPDATE\s+[`"'\[]?([A-Za-z0-9_.\-]+)\s+SET\b/gi },
  { op: "delete", re: /\bDELETE\s+FROM\s+[`"'\[]?([A-Za-z0-9_.\-]+)/gi },
];

const DDL_RE = /\b(CREATE\s+(?:TEMP(?:ORARY)?\s+)?TABLE|ALTER\s+TABLE|DROP\s+TABLE|ADD\s+COLUMN|DROP\s+COLUMN|CREATE\s+(?:UNIQUE\s+)?INDEX|DROP\s+INDEX)\b/gi;

// 對外 mutating 呼叫（fetch/axios 帶 POST/PUT/PATCH/DELETE）
const OUTBOUND_MUTATING_RE = /(?:fetch\s*\(|axios\s*\.\s*(?:post|put|patch|delete)\s*\(|method\s*:\s*["'`](?:POST|PUT|PATCH|DELETE)["'`])/gi;

// 外部 URL → host
const URL_RE = /https?:\/\/([A-Za-z0-9.\-]+(?::\d+)?)/g;

// API 介面字串（raw-http / express 皆為 "/api/..." 字串面量）
const API_PATH_RE = /["'`](\/api\/[A-Za-z0-9\-_/:]{1,120})/g;

function normalizeTarget(raw) {
  let t = String(raw || "").replace(/[`"'\]]/g, "").replace(/\s+.*/s, "");
  if (!t) return null;
  // SQLite 檔名.table 形式保留；schema.table 保留
  if (t.length > 80) t = t.slice(0, 80);
  // 排除 SQL 關鍵字誤捕（FROM SELECT 等）
  if (/^(select|insert|update|delete|set|values|where|from|into|table|index|if|not|exists|temp|temporary)$/i.test(t)) return null;
  return t;
}

/** 掃單一檔案內容 → 累加到 acc（in-place） */
function scanContent(content, acc) {
  for (const { op, re } of SQL_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(content)) !== null) {
      const target = normalizeTarget(m[1]);
      if (!target) continue;
      if (!acc.dataOps.has(target)) acc.dataOps.set(target, new Set());
      acc.dataOps.get(target).add(op);
    }
  }
  DDL_RE.lastIndex = 0;
  if (DDL_RE.test(content)) acc.hasDDL = true;
  DDL_RE.lastIndex = 0;
  OUTBOUND_MUTATING_RE.lastIndex = 0;
  if (OUTBOUND_MUTATING_RE.test(content)) acc.hasMutatingOutbound = true;

  URL_RE.lastIndex = 0;
  let m;
  while ((m = URL_RE.exec(content)) !== null) {
    const host = m[1].toLowerCase();
    if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|::1)/.test(host)) continue; // 內部
    acc.hosts.set(host, (acc.hosts.get(host) || 0) + 1);
  }

  API_PATH_RE.lastIndex = 0;
  while ((m = API_PATH_RE.exec(content)) !== null) {
    let p = m[1];
    // 去雜訊：截斷 /:id 樣式變數段與尾斜線 — 只做呈現
    p = p.replace(/\/:[A-Za-z0-9_]+(?=\/|$)/g, "").replace(/\/+$/, "");
    if (p) acc.apiPaths.add(p);
  }
}

/** migration 檔名/路徑判定 */
function looksLikeMigrationFile(file) {
  return /migration|migrations|schema[-_.]|\.sql$/i.test(file);
}

/**
 * 掃描 feature 的構成面。
 * @returns {Promise<{
 *   dataTouch: {target:string, ops:string[], migration:boolean}[],
 *   apiSurface: string[],
 *   externalCalls: string[],
 *   mutatingOutbound: boolean,
 *   fileCount: number,
 *   computedSeverity: "S0"|"S1"|"S2",
 *   computedReason: string,
 * }>}
 */
export async function scanFeatureRisk(projectPath, feature) {
  const acc = { dataOps: new Map(), hosts: new Map(), apiPaths: new Set(), hasDDL: false, hasMutatingOutbound: false, migrationFiles: 0 };
  const files = (feature.codeFiles || []).slice(0, MAX_FILES);
  let scanned = 0;
  for (const rel of files) {
    const abs = resolve(projectPath, rel);
    if (!existsSync(abs)) continue;
    try {
      const buf = await readFile(abs);
      const content = buf.slice(0, MAX_FILE_BYTES).toString("utf-8");
      scanContent(content, acc);
      scanned++;
      if (looksLikeMigrationFile(rel) && acc.dataOps.size >= 0) acc.migrationFiles++; // SQL/migration 檔本身就值得標記
    } catch { /* 單檔失敗不擋掃描 */ }
  }

  const dataTouch = [];
  for (const [target, opsSet] of acc.dataOps) {
    dataTouch.push({ target, ops: [...opsSet], migration: false });
    if (dataTouch.length >= MAX_TABLES) break;
  }
  const hasMigration = acc.hasDDL || acc.migrationFiles > 0;

  const hasDelete = [...acc.dataOps.values()].some(s => s.has("delete"));
  const hasWrite = [...acc.dataOps.values()].some(s => s.has("insert") || s.has("update"));
  const computedSeverity = hasMigration || hasDelete ? "S2" : hasWrite || acc.hasMutatingOutbound ? "S1" : "S0";

  const computedReason = buildReason(computedSeverity, { hasMigration, dataTouch, hasMutatingOutbound: acc.hasMutatingOutbound, hosts: acc.hosts });

  return {
    dataTouch,
    apiSurface: [...acc.apiPaths].slice(0, 80),
    externalCalls: [...acc.hosts.keys()].slice(0, 40),
    mutatingOutbound: acc.hasMutatingOutbound,
    migration: hasMigration,
    fileCount: scanned,
    computedSeverity,
    computedReason,
  };
}

function buildReason(sev, { hasMigration, dataTouch, hasMutatingOutbound, hosts }) {
  const delTables = [...dataTouch.filter(d => d.ops.includes("delete")).map(d => d.target)].slice(0, 5);
  const mutTables = [...dataTouch.filter(d => d.ops.some(o => o === "insert" || o === "update")).map(d => d.target)].slice(0, 5);
  if (sev === "S2") return hasMigration
    ? `含 schema migration / DDL（CREATE/ALTER/DROP）— 資料結構異動，回滾成本最高${delTables.length ? `；DELETE：${delTables.join(", ")}` : ""}`
    : `含 DELETE 資料刪除（${delTables.join(", ") || "?"}）— 不可逆異動`;
  if (sev === "S1") return hasMutatingOutbound && mutTables.length === 0
    ? "含對外 mutating 呼叫（POST/PUT/PATCH/DELETE）— 外部副作用"
    : `含 INSERT/UPDATE 資料寫入（${mutTables.join(", ") || "?"}）${hasMutatingOutbound ? "；另有對外 mutating 呼叫" : ""}`;
  return dataTouch.length
    ? `僅讀取（SELECT：${dataTouch.slice(0, 4).map(d => d.target).join(", ")}）— 無資料寫入`
    : "未偵測到資料庫異動 — 純邏輯/UI";
}

export const SEVERITY_LEVELS = ["S0", "S1", "S2"];
export function isValidSeverity(s) { return SEVERITY_LEVELS.includes(s); }
