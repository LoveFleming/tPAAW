/**
 * PAAW Janitor — runtime log/垃圾清理（2026-09-06 Fleming 定調：三目錄架構）
 *
 * 架構（2026-09-06）：
 *   data/      = 使用者資產（每日備份）— logs/llm、logs/agent 永不刪（成本核算資料源）
 *   log/       = PAAW runtime 垃圾（不備份、定時清）— 本模組主要戰場
 *   {ru}/.paaw = RU 資產（版控）— 絕不碰
 *
 * 白名單制 — 只碰以下位置：
 *   log/semgrep/<ru>/       → 保留最新 N 組 timestamp（預設 3）
 *   log/app-console/<ru>/   → 保留最新 N 份日期檔（預設 7）
 *   log/tmp/<ru>/           → 清空（agent loop 每 session 自動清之外的每日保險）
 *   log/cu-debug.log        → 刪（CU debug 殘留）
 *   log/versions/<ru>/      → 保留最新 N 個版本目錄（更新備份，預設 3）
 *   {ru}/versions/          → 同上（legacy 位置 — 寫入者不明，雙保險都清）
 *   data/uploads/           → 未被對話引用且超過 N 天才刪（預設 90）
 *
 * Legacy sweep（2026-09-06 架構搬家後的舊位置 — 直接刪，Fleming：刪掉都可以）：
 *   {ru}/.paaw/logs/（整個目錄）、{ru}/.paaw/tmp/、{ru}/.paaw/api-logs/
 *   {ru}/.paaw/{deps-cache,metrics-cache}.json、{ru}/.paaw/cu-debug.log
 *   data/logs/ 的 runtime 殘留（cli/cron/browser/browser-executor/crash、
 *   server-console*、server-heartbeat*、cu-debug.log、janitor.log）— 只留 llm/ agent/
 *
 * 觸發：POST /api/logs/purge（每日 cron system-daily-log-purge 03:00）或 POST /api/janitor/run
 * 設定：data/config/janitor.json（UI：Terminal tab 🧹 清理面板）
 */

import { readFile, writeFile, mkdir, readdir, stat, unlink, rm, appendFile, rmdir } from "fs/promises";
import { existsSync } from "fs";
import { resolve, join } from "path";
import { DATA_HOME, LOG_HOME, logSlug } from "../data-home.mjs";

const CONFIG_FILE = resolve(DATA_HOME, "config/janitor.json");
const JANITOR_LOG = join(LOG_HOME, "janitor.log");
const RELEASE_UNITS_FILE = resolve(DATA_HOME, "config/release-units.json");

export const DEFAULTS = {
  enabled: true,
  semgrepKeep: 3,        // log/semgrep/<ru>/ 保留組數
  appConsoleKeep: 7,     // log/app-console/<ru>/app-console-YYYY-MM-DD.log 保留份數
  appConsoleMaxMb: 5,    // 舊固定名 console 截尾上限（log/ 殘留用）
  versionsKeep: 3,       // 更新備份保留版數（log/versions/<ru>/ + {ru}/versions/ legacy）
  uploadsDays: 90,       // data/uploads 保留天數（未被引用才刪）
};

export async function loadConfig() {
  try {
    const raw = JSON.parse(await readFile(CONFIG_FILE, "utf-8"));
    const cfg = { ...DEFAULTS };
    for (const k of Object.keys(DEFAULTS)) {
      if (raw[k] !== undefined) {
        const n = Number(raw[k]);
        if (Number.isFinite(n) && n >= 0) cfg[k] = n;
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
  await mkdir(resolve(DATA_HOME, "config"), { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf-8");
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

/** 目錄內檔案刪到剩最新 N 份（檔名排序，log4j 式日期檔名） */
async function keepNewestFiles(dir, pattern, keep, out, key) {
  if (!existsSync(dir)) return;
  const files = (await readdir(dir).catch(() => [])).filter(f => pattern.test(f)).sort();
  for (const f of files.slice(0, Math.max(0, files.length - keep))) {
    try { await unlink(join(dir, f)); out[key]++; } catch {}
  }
}

/** 版本目錄群保留最新 N 個（mtime 排序） */
async function keepNewestDirs(dir, keep, counter) {
  let deleted = 0;
  if (!existsSync(dir)) return deleted;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const dirs = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    try { const s = await stat(join(dir, e.name)); dirs.push({ name: e.name, mtime: s.mtimeMs }); } catch {}
  }
  dirs.sort((a, b) => a.mtime - b.mtime); // 舊 → 新
  for (const d of dirs.slice(0, Math.max(0, dirs.length - keep))) {
    try { await rm(join(dir, d.name), { recursive: true, force: true }); deleted++; } catch {}
  }
  counter.deleted += deleted;
  return deleted;
}

/** log/ 中央各 RU 子目錄清理：semgrep 組數 + app-console 份數 + versions 版數 */
async function cleanLogGroups(slug, cfg, report) {
  const out = { semgrepDeleted: 0, appConsoleDeleted: 0, appConsoleTruncated: 0, versionsDeleted: 0 };

  // semgrep-<ts>-* — 以 timestamp 前綴分組保留最新 N 組
  const sgDir = join(LOG_HOME, "semgrep", slug);
  if (existsSync(sgDir)) {
    // 檔名：semgrep-<ts>-stdout.json/-stderr.txt/-error.txt（dash）+ semgrep-<ts>.sh/.bat（無 dash）
    const strip = (f) => f.replace(/-(stdout[.]json|stderr[.]txt|error[.]txt)$/, "").replace(/[.](sh|bat)$/, "");
    const keepN = Math.max(0, Math.floor(Number(cfg.semgrepKeep) || 0));
    const files = await readdir(sgDir).catch(() => []);
    const prefixes = [...new Set(files.filter(f => f.startsWith("semgrep-")).map(strip))].sort();
    const keepSet = new Set(prefixes.slice(Math.max(0, prefixes.length - keepN)));
    for (const f of files) {
      if (!f.startsWith("semgrep-")) continue;
      if (!keepSet.has(strip(f))) {
        try { await unlink(join(sgDir, f)); out.semgrepDeleted++; } catch {}
      }
    }
  }

  // app-console-YYYY-MM-DD.log — 保留最新 N 份
  await keepNewestFiles(join(LOG_HOME, "app-console", slug), /^app-console-\d{4}-\d{2}-\d{2}\.log$/, cfg.appConsoleKeep, out, "appConsoleDeleted");

  // 舊固定名殘留（app-console.log / dev-console.log）— 截尾不刪（人看最後輸出）
  const maxBytes = cfg.appConsoleMaxMb * 1024 * 1024;
  for (const legacy of ["app-console.log", "dev-console.log"]) {
    const p = join(LOG_HOME, "app-console", slug, legacy);
    try {
      if (!existsSync(p)) continue;
      const s = await stat(p);
      if (s.size > maxBytes) {
        const fh = await (await import("fs/promises")).open(p, "r");
        const buf = Buffer.alloc(maxBytes);
        await fh.read(buf, 0, maxBytes, s.size - maxBytes);
        await fh.close();
        await writeFile(p, buf);
        out.appConsoleTruncated++;
      }
    } catch {}
  }

  // log/versions/<ru>/ 更新備份
  await keepNewestDirs(join(LOG_HOME, "versions", slug), cfg.versionsKeep, out);

  report.semgrepDeleted += out.semgrepDeleted;
  report.appConsoleDeleted += out.appConsoleDeleted;
  report.appConsoleTruncated += out.appConsoleTruncated;
  report.versionsDeleted += out.versionsDeleted;
  return out;
}

/** log/tmp/<ru>/ — 每日保險清空（agent loop 每 session 開頭已自動清） */
async function cleanTmp(slug) {
  let cleared = 0;
  const dir = join(LOG_HOME, "tmp", slug);
  if (!existsSync(dir)) return cleared;
  const entries = await readdir(dir).catch(() => []);
  for (const e of entries) {
    try { await rm(join(dir, e), { recursive: true, force: true }); cleared++; } catch {}
  }
  return cleared;
}

/** Legacy sweep — 架構搬家後 .paaw 與 data/logs 的 runtime 殘留，直接刪 */
async function legacySweep(root, cfg, report) {
  let deleted = 0;
  const slug = logSlug(root);

  // {ru}/.paaw 內的 runtime 殘留（.paaw 現在只放資產）
  const kill = [
    join(root, ".paaw", "logs"),
    join(root, ".paaw", "tmp"),
    join(root, ".paaw", "api-logs"),
    join(root, ".paaw", "cu-debug.log"),
    join(root, ".paaw", "deps-cache.json"),
    join(root, ".paaw", "metrics-cache.json"),
  ];
  for (const p of kill) {
    if (!existsSync(p)) continue;
    try { await rm(p, { recursive: true, force: true }); deleted++; } catch {}
  }

  // {ru}/versions/ legacy 位置（寫入者不明 — 有就照版數清）
  const legacyVersions = { deleted: 0 };
  await keepNewestDirs(join(root, "versions"), cfg.versionsKeep, legacyVersions);
  report.versionsDeleted += legacyVersions.deleted;

  // data/logs runtime 殘留（llm/agent 除外 — 資產）
  const oldLogs = resolve(DATA_HOME, "logs");
  if (existsSync(oldLogs)) {
    const killNames = ["cli", "cron", "browser", "browser-executor", "crash",
      "server-console.log", "server-console.log.old", "server-heartbeat.log", "server-heartbeat.log.old",
      "cu-debug.log", "janitor.log"];
    for (const n of killNames) {
      const p = join(oldLogs, n);
      if (!existsSync(p)) continue;
      try { await rm(p, { recursive: true, force: true }); deleted++; } catch {}
    }
    // 空目錄收尾
    for (const sub of ["cli", "cron", "browser", "browser-executor", "crash"]) {
      try { await rmdir(join(oldLogs, sub)); } catch {}
    }
  }

  report.legacyDeleted += deleted;
  return deleted;
}

/** log/cu-debug.log — 刪（CU debug 不留） */
async function cleanCuDebug() {
  try { await unlink(join(LOG_HOME, "cu-debug.log")); return 1; } catch { return 0; }
}

/** 收集「仍被對話資產引用」的中央圖檔名 — 這些絕不刪（對話在圖就在）
 *  掃描：{ru}/.paaw/coding-memory/conversations/*.json + data/chats/*.json */
async function collectReferencedUploadNames(ruRoots) {
  const refs = new Set();
  const dirs = [];
  for (const root of ruRoots) dirs.push(join(root, ".paaw", "coding-memory", "conversations"));
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

  // slug 清單 = LOG_HOME 各管理子目錄實際存在的（孤兒也清）∪ 註冊 RU 的 slug
  const slugs = new Set();
  for (const sub of ["semgrep", "app-console", "versions", "tmp"]) {
    const dir = join(LOG_HOME, sub);
    if (!existsSync(dir)) continue;
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (e.isDirectory()) slugs.add(e.name);
    }
  }
  const rootBySlug = new Map();
  for (const root of ruRoots) {
    const slug = logSlug(root);
    slugs.add(slug);
    rootBySlug.set(slug, root);
  }
  for (const slug of slugs) {
    try {
      const groups = await cleanLogGroups(slug, cfg, report);
      const tmp = await cleanTmp(slug);
      report.tmpCleared += tmp;
      const root = rootBySlug.get(slug);
      if (root) report.roots.push({ root, slug, ...groups, tmpCleared: tmp });
    } catch { /* 單一 slug 失敗不中斷 */ }
  }

  // legacy sweep（每 RU 一輪；data/logs 部分冪等）
  for (const root of ruRoots) {
    try { await legacySweep(root, cfg, report); } catch {}
  }

  try { report.legacyDeleted += await cleanCuDebug(); } catch {}
  try { report.uploadsDeleted += await cleanUploads(cfg, ruRoots); } catch {}

  // 摘要落 log/janitor.log（每日一行）
  try {
    await mkdir(LOG_HOME, { recursive: true });
    const total = report.semgrepDeleted + report.appConsoleDeleted + report.versionsDeleted
      + report.legacyDeleted + report.tmpCleared + report.uploadsDeleted;
    await appendFile(JANITOR_LOG,
      `${report.ranAt} deleted=${total} (semgrep:${report.semgrepDeleted} appConsole:${report.appConsoleDeleted}+${report.appConsoleTruncated}截尾 legacy:${report.legacyDeleted} tmp:${report.tmpCleared} versions:${report.versionsDeleted} uploads:${report.uploadsDeleted})\n`,
      "utf-8");
  } catch { /* janitor.log 寫不進去就算了 */ }
  return report;
}
