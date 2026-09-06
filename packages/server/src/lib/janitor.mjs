/**
 * PAAW Janitor — per-RU runtime 垃圾清理（2026-09-06 Fleming 定調：硬碟不撐爆）
 *
 * 白名單制 — 只碰以下位置，絕不碰 .paaw 資產：
 *   {ru}/.paaw/logs/semgrep-*          → 保留最新 N 組 timestamp（預設 3）
 *   {ru}/.paaw/logs/app-console-*.log  → 保留最新 N 份（log4j 式日期檔名，預設 7）
 *   {ru}/.paaw/logs/app-console.log / dev-console.log（舊固定名）→ 超過上限截尾（預設 5MB）
 *   {ru}/.paaw/cu-debug.log            → 刪（legacy 殘留；現行 CU debug 寫中央 data/logs/）
 *   {ru}/.paaw/tmp/*                   → 清（agent session 自動清之外的每日保險）
 *   {ru}/versions/*                    → 保留最新 N 個版本目錄（更新備份是最肥的殺手，預設 3）
 *   data/uploads/*                     → 超過 N 天刪（預設 90）
 *
 * 觸發：POST /api/logs/purge（每日 cron system-daily-log-purge 03:00 已接）
 * 設定：data/config/janitor.json（可調參數，出廠預設即用；enabled:false 全部跳過）
 */

import { readFile, writeFile, mkdir, readdir, stat, unlink, rm, appendFile } from "fs/promises";
import { existsSync } from "fs";
import { resolve, join } from "path";
import { DATA_HOME } from "../data-home.mjs";

const CONFIG_FILE = resolve(DATA_HOME, "config/janitor.json");
const JANITOR_LOG = resolve(DATA_HOME, "logs/janitor.log");
const RELEASE_UNITS_FILE = resolve(DATA_HOME, "config/release-units.json");

const DEFAULTS = {
  enabled: true,
  semgrepKeep: 3,        // semgrep raw 輸出保留組數
  appConsoleKeep: 7,     // app-console-YYYY-MM-DD.log 保留份數（log4j 式）
  appConsoleMaxMb: 5,    // 舊固定名 console 截尾上限
  versionsKeep: 3,       // versions/<v>/ 更新備份保留版數
  uploadsDays: 90,       // data/uploads 保留天數
};

export async function loadConfig() {
  try {
    const raw = JSON.parse(await readFile(CONFIG_FILE, "utf-8"));
    const cfg = { ...DEFAULTS };
    for (const k of Object.keys(DEFAULTS)) {
      if (raw[k] !== undefined) {
        const n = Number(raw[k]);
        if (Number.isFinite(n) && n >= 0) cfg[k] = raw[k];
      }
    }
    if (raw.enabled === false) cfg.enabled = false;
    return cfg;
  } catch {
    return { ...DEFAULTS };
  }
}

/** 設定寫回（route PUT 用 — 只接受白名單鍵：數字 >=0 + enabled boolean） */
export async function saveConfig(patch) {
  const cfg = { ...(await loadConfig()) };
  for (const k of Object.keys(DEFAULTS)) {
    if (patch[k] === undefined) continue;
    if (k === "enabled") {
      if (typeof patch[k] === "boolean") cfg.enabled = patch[k];
    } else {
      const n = Number(patch[k]);
      if (Number.isFinite(n) && n >= 0) cfg[k] = n;
    }
  }
  const { writeFile: wf, mkdir: mk } = await import("fs/promises");
  await mk(resolve(DATA_HOME, "config"), { recursive: true });
  await wf(CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf-8");
  return cfg;
}

/** janitor.log 尾端 N 行（UI 看） */
export async function tailJanitorLog(lines = 200) {
  try {
    const txt = await readFile(JANITOR_LOG, "utf-8");
    return txt.split("\n").filter(Boolean).slice(-lines);
  } catch { return []; }
}

/** RU 清單：PAAW_ROOT 自己 + release-units.json 註冊的每個單元 */
async function listRuRoots() {
  const roots = new Set();
  const { PAAW_ROOT } = await import("../routes/shared.mjs");
  roots.add(resolve(PAAW_ROOT));
  try {
    const reg = JSON.parse(await readFile(RELEASE_UNITS_FILE, "utf-8"));
    for (const u of reg.units || []) {
      if (u.path && existsSync(u.path)) roots.add(resolve(u.path));
    }
  } catch { /* 註冊表不在就只清 PAAW_ROOT */ }
  return [...roots];
}

/** .paaw/logs/ 清理：semgrep 組 + 日期版 app-console + 舊固定名截尾 + cu-debug 殘留 */
async function cleanPaawLogs(root, cfg) {
  const out = { semgrepDeleted: 0, appConsoleDeleted: 0, appConsoleTruncated: 0, legacyDeleted: 0 };
  const dir = join(root, ".paaw", "logs");
  if (!existsSync(dir)) { /* logs 不在仍可能要清 cu-debug 殘留 */ }
  const files = await readdir(dir).catch(() => []);

  // semgrep-<timestamp>-{stdout.json,sh} — 以 timestamp 前綴分組，保留最新 N 組
  const prefixes = new Set(
    files.filter(f => f.startsWith("semgrep-"))
      .map(f => f.replace(/-(stdout\.json|\.sh)$/, ""))
  );
  const keepPrefixes = new Set([...prefixes].sort().slice(-cfg.segrepKeep));
  for (const f of files) {
    if (!f.startsWith("semgrep-")) continue;
    const prefix = f.replace(/-(stdout\.json|\.sh)$/, "");
    if (!keepPrefixes.has(prefix)) {
      try { await unlink(join(dir, f)); out.semgrepDeleted++; } catch {}
    }
  }

  // app-console-YYYY-MM-DD.log — 檔名排序保留最新 N 份
  const dated = files.filter(f => /^app-console-\d{4}-\d{2}-\d{2}\.log$/.test(f)).sort();
  for (const f of dated.slice(0, Math.max(0, dated.length - cfg.appConsoleKeep))) {
    try { await unlink(join(dir, f)); out.appConsoleDeleted++; } catch {}
  }

  // 舊固定名（app-console.log / dev-console.log）— 超過上限截尾保留 tail（人看的是最後輸出）
  const maxBytes = cfg.appConsoleMaxMb * 1024 * 1024;
  for (const legacy of ["app-console.log", "dev-console.log"]) {
    const p = join(dir, legacy);
    try {
      if (!existsSync(p)) continue;
      const s = await stat(p);
      if (s.size > maxBytes) {
        const fh = await import("fs/promises").then(m => m.open(p, "r"));
        const len = maxBytes;
        const buf = Buffer.alloc(len);
        await fh.read(buf, 0, len, s.size - len);
        await fh.close();
        await writeFile(p, buf);
        out.appConsoleTruncated++;
      }
    } catch {}
  }

  // cu-debug.log legacy 殘留（.paaw 根目錄）— 現行寫中央 data/logs/cu-debug.log
  const cuDebug = join(root, ".paaw", "cu-debug.log");
  if (existsSync(cuDebug)) {
    try { await unlink(cuDebug); out.legacyDeleted++; } catch {}
  }
  return out;
}

/** .paaw/tmp/ — 每日保險清空（agent loop 每次開 session 已自動清） */
async function cleanTmp(root) {
  let cleared = 0;
  const dir = join(root, ".paaw", "tmp");
  if (!existsSync(dir)) return cleared;
  const entries = await readdir(dir).catch(() => []);
  for (const e of entries) {
    try { await rm(join(dir, e), { recursive: true, force: true }); cleared++; } catch {}
  }
  return cleared;
}

/** versions/<v>/ — 保留最新 N 個版本目錄（依 mtime，最新 = 最近被更新/使用） */
async function cleanVersions(root, cfg) {
  let deleted = 0;
  const dir = join(root, "versions");
  if (!existsSync(dir)) return deleted;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const dirs = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    try { const s = await stat(join(dir, e.name)); dirs.push({ name: e.name, mtime: s.mtimeMs }); } catch {}
  }
  dirs.sort((a, b) => a.mtime - b.mtime); // 舊 → 新
  for (const d of dirs.slice(0, Math.max(0, dirs.length - cfg.versionsKeep))) {
    try { await rm(join(dir, d.name), { recursive: true, force: true }); deleted++; } catch {}
  }
  return deleted;
}

/** 收集「仍被對話資產引用」的中央圖檔名 — 這些絕不刪（對話在圖就在）
 *  掃描：{ru}/.paaw/coding-memory/conversations/*.json + data/chats/*.json */
async function collectReferencedUploadNames(ruRoots) {
  const refs = new Set();
  const dirs = [];
  for (const root of ruRoots) dirs.push(join(root, ".paaw", "coding-memory", "conversations"));
  const { DATA_HOME } = await import("../data-home.mjs");
  dirs.push(resolve(DATA_HOME, "chats"));
  const re = /(?:paaw-)?uploads\/([A-Za-z0-9][A-Za-z0-9._-]*)/g;
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    const files = await readdir(dir).catch(() => []);
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const txt = await readFile(join(dir, f), "utf-8");
        let m;
        while ((m = re.exec(txt)) !== null) refs.add(m[1]);
      } catch {}
    }
  }
  return refs;
}

/** data/uploads/（中央）— 未被引用且超過 N 天才刪（mtime）
 *  ⚠️ RU 資產圖在 {ru}/.paaw/uploads/ — 永不清理（不在本函式範圍，白名單制保證） */
async function cleanUploads(cfg, ruRoots) {
  let deleted = 0;
  const { uploadsDir } = await import("../routes/uploads.mjs");
  const dir = uploadsDir();
  if (!existsSync(dir)) return deleted;
  const referenced = await collectReferencedUploadNames(ruRoots);
  const cutoff = Date.now() - cfg.uploadsDays * 24 * 60 * 60 * 1000;
  const entries = await readdir(dir).catch(() => []);
  for (const e of entries) {
    const full = join(dir, e);
    try {
      if (referenced.has(e)) continue; // 對話還在引用 — 保留
      const s = await stat(full);
      if (s.mtimeMs < cutoff && s.isFile()) { await unlink(full); deleted++; }
    } catch {}
  }
  return deleted;
}

/** 主入口 — 回傳清理報告；任何單項失敗不影響其他項 */
export async function runJanitor() {
  const cfg = await loadConfig();
  const report = {
    ranAt: new Date().toISOString(),
    enabled: cfg.enabled,
    roots: [],
    semgrepDeleted: 0, appConsoleDeleted: 0, appConsoleTruncated: 0,
    legacyDeleted: 0, tmpCleared: 0, versionsDeleted: 0, uploadsDeleted: 0,
  };
  if (!cfg.enabled) return report;

  const ruRoots = await listRuRoots();
  for (const root of ruRoots) {
    try {
      const logs = await cleanPaawLogs(root, cfg);
      const tmp = await cleanTmp(root);
      const versions = await cleanVersions(root, cfg);
      report.semgrepDeleted += logs.semgrepDeleted;
      report.appConsoleDeleted += logs.appConsoleDeleted;
      report.appConsoleTruncated += logs.appConsoleTruncated;
      report.legacyDeleted += logs.legacyDeleted;
      report.tmpCleared += tmp;
      report.versionsDeleted += versions;
      report.roots.push({ root, ...logs, tmpCleared: tmp, versionsDeleted: versions });
    } catch { /* 單一 RU 失敗不中斷 */ }
  }
  try { report.uploadsDeleted += await cleanUploads(cfg, ruRoots); } catch {}

  // 摘要落 data/logs/janitor.log（每日一行）
  try {
    await mkdir(resolve(JANITOR_LOG, ".."), { recursive: true });
    const total = report.semgrepDeleted + report.appConsoleDeleted + report.versionsDeleted
      + report.legacyDeleted + report.tmpCleared + report.uploadsDeleted;
    await appendFile(JANITOR_LOG,
      `${report.ranAt} deleted=${total} (semgrep:${report.semgrepDeleted} appConsole:${report.appConsoleDeleted}+${report.appConsoleTruncated}截尾 legacy:${report.legacyDeleted} tmp:${report.tmpCleared} versions:${report.versionsDeleted} uploads:${report.uploadsDeleted})\n`,
      "utf-8");
  } catch { /* janitor.log 寫不進去就算了 */ }
  return report;
}
