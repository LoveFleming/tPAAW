/**
 * PAAW Backup/Restore API
 *
 * 備份 data/ 下所有使用者資料（knowledge, skills, apps, notes, chats, config 等）
 * 排除暫存和系統產出（distill, system/temp）
 *
 * API:
 *   GET  /api/backup/config       — 取得備份設定
 *   PUT  /api/backup/config       — 更新備份設定（目錄、保留份數）
 *   POST /api/backup/run          — 立即執行備份
 *   GET  /api/backup/list         — 列出所有備份
 *   POST /api/backup/restore      — 從備份還原
 *   DELETE /api/backup/delete?id= — 刪除一個備份
 */

import { readFile, writeFile, readdir, mkdir, rm, stat, copyFile } from "fs/promises";
import { existsSync, createReadStream, createWriteStream } from "fs";
import { resolve, join, basename } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { execSync } from "child_process";
import { createGzip, createGunzip } from "zlib";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import { readBody } from "./shared.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PAAW_ROOT = resolve(__dirname, "../../../../");
const DATA_DIR = resolve(PAAW_ROOT, "data");
const BACKUP_DIR_DEFAULT = resolve(PAAW_ROOT, "backups");
const CONFIG_FILE = resolve(DATA_DIR, "config/backup.json");

// 要備份的子目錄
const BACKUP_DIRS = [
  "ai-settings", "apps", "app-data", "chats", "config",
  "crews", "cron", "db", "knowledge", "mindmaps", "notes",
  "skills", "workflows", "api-registry",
];

// 不備份的（暫存/系統產出）
const EXCLUDE_DIRS = ["distill", "system"];

function genId() {
  return `bk_${Date.now().toString(36)}`;
}

function timestampLabel() {
  const d = new Date();
  return d.toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

// ── Config ──

async function loadConfig() {
  try {
    return JSON.parse(await readFile(CONFIG_FILE, "utf-8"));
  } catch {
    return {
      backupDir: BACKUP_DIR_DEFAULT,
      retentionCount: 7,
      enabled: true,
      scheduleHour: 0, // 00:00
      lastBackupAt: null,
    };
  }
}

async function saveConfig(config) {
  await mkdir(resolve(CONFIG_FILE, ".."), { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
}

// ── Backup ──

async function runBackup(config) {
  const backupDir = config.backupDir || BACKUP_DIR_DEFAULT;
  await mkdir(backupDir, { recursive: true });

  const label = timestampLabel();
  const tarFile = resolve(backupDir, `backup-${label}.tar.gz`);

  // 構建 tar 命令：只包含要備份的目錄
  const includes = BACKUP_DIRS.filter(d => existsSync(resolve(DATA_DIR, d)));
  if (includes.length === 0) throw new Error("No data directories to backup");

  // 用 tar 打包
  const tarCmd = `cd "${DATA_DIR}" && tar czf "${tarFile}" ${includes.join(" ")}`;
  console.log(`[Backup] Running: ${tarCmd}`);

  try {
    execSync(tarCmd, { maxBuffer: 50 * 1024 * 1024 });
  } catch (err) {
    throw new Error(`Backup tar failed: ${err.message}`);
  }

  // 驗證檔案
  if (!existsSync(tarFile)) throw new Error("Backup file not created");
  const stats = await stat(tarFile);

  // 清理超過保留數量的舊備份
  await cleanupOldBackups(config);

  // 更新 lastBackupAt
  config.lastBackupAt = new Date().toISOString();
  await saveConfig(config);

  const result = {
    id: genId(),
    filename: basename(tarFile),
    path: tarFile,
    size: stats.size,
    createdAt: new Date().toISOString(),
    dirs: includes,
  };

  // 存一份 metadata
  const metaFile = resolve(backupDir, `backup-${label}.json`);
  await writeFile(metaFile, JSON.stringify(result, null, 2), "utf-8");

  console.log(`[Backup] Done: ${tarFile} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);
  return result;
}

// ── Cleanup ──

async function cleanupOldBackups(config) {
  const backupDir = config.backupDir || BACKUP_DIR_DEFAULT;
  const retention = config.retentionCount || 7;
  if (!existsSync(backupDir)) return;

  const files = await readdir(backupDir);
  const backups = files
    .filter(f => f.startsWith("backup-") && f.endsWith(".tar.gz"))
    .map(f => ({ name: f, path: resolve(backupDir, f) }))
    .sort((a, b) => b.name.localeCompare(a.name)); // 新→舊

  // 保留最新的 N 個，刪掉其餘的
  const toDelete = backups.slice(retention);
  for (const f of toDelete) {
    try {
      await rm(f.path);
      // 也刪對應的 metadata json
      const metaPath = f.path.replace(".tar.gz", ".json");
      if (existsSync(metaPath)) await rm(metaPath);
      console.log(`[Backup] Cleaned up old: ${f.name}`);
    } catch {}
  }
}

// ── List backups ──

async function listBackups(config) {
  const backupDir = config.backupDir || BACKUP_DIR_DEFAULT;
  if (!existsSync(backupDir)) return [];

  const files = await readdir(backupDir);
  const backups = [];

  for (const f of files.filter(f => f.startsWith("backup-") && f.endsWith(".tar.gz"))) {
    const fullPath = resolve(backupDir, f);
    const metaPath = fullPath.replace(".tar.gz", ".json");
    let meta = {};

    try {
      meta = JSON.parse(await readFile(metaPath, "utf-8"));
    } catch {}

    try {
      const stats = await stat(fullPath);
      backups.push({
        id: meta.id || f,
        filename: f,
        size: stats.size,
        createdAt: meta.createdAt || stats.mtime.toISOString(),
        dirs: meta.dirs || [],
      });
    } catch {}
  }

  backups.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  return backups;
}

// ── Restore ──

async function restoreBackup(config, filename) {
  const backupDir = config.backupDir || BACKUP_DIR_DEFAULT;
  const tarFile = resolve(backupDir, filename);

  if (!existsSync(tarFile)) throw new Error(`Backup file not found: ${filename}`);
  if (!filename.startsWith("backup-") || !filename.endsWith(".tar.gz")) {
    throw new Error("Invalid backup filename");
  }

  // 先建立一個還原前的自動備份（安全網）
  console.log("[Restore] Creating pre-restore backup...");
  await runBackup({ ...config, retentionCount: config.retentionCount + 1 });

  // 解壓到 data/ （覆蓋現有檔案）
  const tarCmd = `cd "${DATA_DIR}" && tar xzf "${tarFile}" --overwrite`;
  console.log(`[Restore] Running: ${tarCmd}`);

  try {
    execSync(tarCmd, { maxBuffer: 50 * 1024 * 1024 });
  } catch (err) {
    throw new Error(`Restore tar failed: ${err.message}`);
  }

  console.log(`[Restore] Done from: ${filename}`);
  return { ok: true, restoredFrom: filename };
}

// ════════════════════════════════════════
// Route Handler
// ════════════════════════════════════════

async function handleBackupRoutes(req, res) {
  const url = req.url || "";
  const method = req.method;
  const parsedUrl = new URL(url, "http://localhost");
  const path = parsedUrl.pathname;

  if (method === "OPTIONS") return false;

  // GET /api/backup/config
  if (path === "/api/backup/config" && method === "GET") {
    const config = await loadConfig();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ config }));
    return true;
  }

  // PUT /api/backup/config
  if (path === "/api/backup/config" && method === "PUT") {
    const body = JSON.parse(await readBody(req));
    const config = await loadConfig();
    if (body.backupDir !== undefined) config.backupDir = body.backupDir;
    if (body.retentionCount !== undefined) config.retentionCount = body.retentionCount;
    if (body.enabled !== undefined) config.enabled = body.enabled;
    if (body.scheduleHour !== undefined) config.scheduleHour = body.scheduleHour;
    await saveConfig(config);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, config }));
    return true;
  }

  // POST /api/backup/run
  if (path === "/api/backup/run" && method === "POST") {
    try {
      const config = await loadConfig();
      const result = await runBackup(config);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, backup: result }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // GET /api/backup/list
  if (path === "/api/backup/list" && method === "GET") {
    const config = await loadConfig();
    const backups = await listBackups(config);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ backups }));
    return true;
  }

  // POST /api/backup/restore
  if (path === "/api/backup/restore" && method === "POST") {
    const body = JSON.parse(await readBody(req));
    if (!body.filename) {
      res.writeHead(400); res.end(JSON.stringify({ error: "filename required" })); return true;
    }
    try {
      const config = await loadConfig();
      const result = await restoreBackup(config, body.filename);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // DELETE /api/backup/delete?filename=
  if (path === "/api/backup/delete" && method === "DELETE") {
    const filename = parsedUrl.searchParams.get("filename");
    if (!filename) {
      res.writeHead(400); res.end(JSON.stringify({ error: "filename required" })); return true;
    }
    const config = await loadConfig();
    const backupDir = config.backupDir || BACKUP_DIR_DEFAULT;
    const tarPath = resolve(backupDir, filename);
    const metaPath = tarPath.replace(".tar.gz", ".json");

    try {
      if (existsSync(tarPath)) await rm(tarPath);
      if (existsSync(metaPath)) await rm(metaPath);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  return false;
}

export default handleBackupRoutes;
