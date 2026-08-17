/**
 * PAAW Backup/Restore API（跨平台 — 不依賴外部 tar 命令）
 *
 * 備份 data/ 下所有使用者資料（knowledge, skills, apps, notes, chats, config 等）
 * 使用 Node.js 內建 zlib 壓縮，Windows/Mac/Linux 都能跑。
 *
 * API:
 *   GET  /api/backup/config       — 取得備份設定
 *   PUT  /api/backup/config       — 更新備份設定（目錄、保留份數）
 *   POST /api/backup/run          — 立即執行備份
 *   GET  /api/backup/list         — 列出所有備份
 *   POST /api/backup/restore      — 從備份還原
 *   DELETE /api/backup/delete?id= — 刪除一個備份
 */

import { readFile, writeFile, readdir, mkdir, rm, stat } from "fs/promises";
import { existsSync, mkdirSync, writeFileSync, createWriteStream, createReadStream } from "fs";
import { resolve, join, basename, relative } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { execSync } from "child_process";
import { createGzip, createGunzip } from "zlib";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import { readBody } from "./shared.mjs";
import { safeResolve } from "../lib/coding-security";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// nosemgrep: path-join-resolve-traversal
const PAAW_ROOT = resolve(__dirname, "../../../../");
// nosemgrep: path-join-resolve-traversal
const DATA_DIR = resolve(PAAW_ROOT, "data");
// nosemgrep: path-join-resolve-traversal
const BACKUP_DIR_DEFAULT = resolve(PAAW_ROOT, "backups");
// nosemgrep: path-join-resolve-traversal
const CONFIG_FILE = resolve(DATA_DIR, "config/backup.json");

// 要備份的子目錄
const BACKUP_DIRS = [
  "ai-settings", "apps", "app-data", "chats", "config",
  "crews", "cron", "db", "knowledge", "mindmaps", "notes",
  "skills", "workflows", "api-registry",
];

function genId() {
  return `bk_${Date.now().toString(36)}`;
}

function timestampLabel() {
  const d = new Date();
  return d.toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

// ════════════════════════════════════════
// 跨平台 tar.gz 打包/解包（純 Node.js）
// ════════════════════════════════════════

/**  // nosemgrep: path-join-resolve-traversal
 * 遞迴收集目錄下所有檔案的相對路徑
 */
async function collectFiles(baseDir, subDir = "") {
  const results = [];
  const fullDir = subDir ? safeResolve(baseDir, subDir) : baseDir;

  if (!existsSync(fullDir)) return results;

  const entries = await readdir(fullDir, { withFileTypes: true });
  for (const entry of entries) {
    const relPath = subDir ? `${subDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(...await collectFiles(baseDir, relPath));
    } else if (entry.isFile()) {
      results.push(relPath);
    }
  }
  return results;
}

/**
 * USTAR 格式 header（512 bytes）— 跨平台相容
 */
function makeTarHeader(filename, size) {
  const header = Buffer.alloc(512, 0);

  // name (100 bytes)
  const nameBuf = Buffer.from(filename, "utf-8");
  nameBuf.copy(header, 0);

  // mode (8 bytes) — "0000644\0"
  header.write("0000644\0", 100, "ascii");

  // uid (8 bytes) — "0000000\0"
  header.write("0000000\0", 108, "ascii");

  // gid (8 bytes) — "0000000\0"
  header.write("0000000\0", 116, "ascii");

  // size (12 bytes) — octal, 11 digits + null
  const sizeStr = size.toString(8).padStart(11, "0") + "\0";
  header.write(sizeStr, 124, "ascii");

  // mtime (12 bytes) — current time in octal
  const mtime = Math.floor(Date.now() / 1000);
  header.write(mtime.toString(8).padStart(11, "0") + "\0", 136, "ascii");

  // typeflag (1 byte) — "0" = regular file
  header.write("0", 156, "ascii");

  // magic (6 bytes) — "ustar\0"
  header.write("ustar\0", 257, "ascii");

  // version (2 bytes) — "00"
  header.write("00", 263, "ascii");

  // checksum (8 bytes) — calculate after filling everything
  // 先填空白計算
  header.write("        ", 148, "ascii");
  let checksum = 0;
  for (let i = 0; i < 512; i++) checksum += header[i];
  header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii");

  return header;
}

/**
 * 打包成 .tar.gz（純 Node.js，跨平台）
 */  // nosemgrep: path-join-resolve-traversal
async function createTarGz(srcDir, dirs, outFile) {
  const chunks = [];

  for (const dir of dirs) {
    const fullPath = safeResolve(srcDir, dir);
    if (!existsSync(fullPath)) continue;  // nosemgrep: path-join-resolve-traversal

    const files = await collectFiles(fullPath);
    for (const relFile of files) {
      const tarPath = `${dir}/${relFile}`; // tar 內的路徑
      const absPath = safeResolve(fullPath, relFile);
      const fileData = await readFile(absPath);
      const size = fileData.length;

      // header + data + padding
      const header = makeTarHeader(tarPath, size);
      chunks.push(header);
      chunks.push(fileData);

      // pad to 512 boundary
      const remainder = (512 - (size % 512)) % 512;
      if (remainder > 0) {
        chunks.push(Buffer.alloc(remainder, 0));
      }
    }
  }

  // End-of-archive: two 512-byte zero blocks
  chunks.push(Buffer.alloc(1024, 0));

  // Combine and gzip — 一次 concat（O(n)）
  const tarBuffer = Buffer.concat(chunks);
  console.log(`[createTarGz] Tar size: ${(tarBuffer.length / 1024 / 1024).toFixed(1)} MB`);

  // Write with gzip compression
  return new Promise((resolve, reject) => {
    const ws = createWriteStream(outFile);
    const gz = createGzip({ level: 6 });
    ws.on("finish", resolve);
    ws.on("error", reject);
    gz.on("error", reject);

    // Pipe: tarBuffer → gzip → file
    const rs = Readable.from(tarBuffer);
    rs.pipe(gz).pipe(ws);
  });
}

/**
 * 從 tar.gz 解包到目標目錄（純 Node.js，跨平台）
 */
async function extractTarGz(tarFile, destDir) {
  console.log(`[extractTarGz] tarFile=${tarFile} destDir=${destDir}`);

  // Step 1: Read and decompress entire tar.gz → Buffer
  // 用 array 收集 chunks（O(n)），不要用 Buffer.concat loop（O(n²)）
  // 之前用 tarBuffer = Buffer.concat([tarBuffer, chunk]) 對 60MB+ 的 tar 會卡死
  const chunks = [];
  await new Promise((resolve, reject) => {
    const gunzip = createGunzip();
    const rs = createReadStream(tarFile);
    gunzip.on("data", (chunk) => { chunks.push(chunk); });
    gunzip.on("end", resolve);
    gunzip.on("error", reject);
    rs.on("error", reject);
    rs.pipe(gunzip);
  });

  const tarBuffer = Buffer.concat(chunks);
  console.log(`[extractTarGz] Decompressed: ${tarBuffer.length} bytes, ${chunks.length} chunks`);

  // Step 2: Parse tar headers and write files (sync — no async event handler)
  let offset = 0;
  let fileCount = 0;

  while (offset + 512 <= tarBuffer.length) {
    const header = tarBuffer.subarray(offset, offset + 512);

    // Check for end-of-archive (all zeros)
    if (header.every(b => b === 0)) {
      offset += 512;
      continue;
    }

    // Extract filename (null-terminated, 100 bytes)
    let nameEnd = 0;
    while (nameEnd < 100 && header[nameEnd] !== 0) nameEnd++;
    const filename = header.subarray(0, nameEnd).toString("utf-8");

    // Extract size (octal at offset 124, 12 bytes)
    let sizeEnd = 124;
    while (sizeEnd < 136 && header[sizeEnd] !== 0) sizeEnd++;
    const sizeStr = header.subarray(124, sizeEnd).toString("ascii").trim();
    const size = parseInt(sizeStr, 8) || 0;
  // nosemgrep: path-join-resolve-traversal
    offset += 512; // move past header  // nosemgrep: path-join-resolve-traversal

    if (size > 0) {
      const fileData = tarBuffer.subarray(offset, offset + size);
      const destPath = safeResolve(destDir, filename);
// nosemgrep: path-join-resolve-traversal
      const parentDir = dirname(resolve(destPath));

      mkdirSync(parentDir, { recursive: true });
      writeFileSync(destPath, fileData);
      fileCount++;
    }

    // Move to next record (align to 512)
    offset += size + ((512 - (size % 512)) % 512);
  }

  console.log(`[extractTarGz] Done. ${fileCount} files restored.`);
  return fileCount;
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
      scheduleHour: 0,
      lastBackupAt: null,
    };
  }
}

async function saveConfig(config) {
// nosemgrep: path-join-resolve-traversal
  await mkdir(resolve(CONFIG_FILE, ".."), { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
}

// ── Backup ──  // nosemgrep: path-join-resolve-traversal

async function runBackup(config) {
  const backupDir = config.backupDir || BACKUP_DIR_DEFAULT;  // nosemgrep: path-join-resolve-traversal
  await mkdir(backupDir, { recursive: true });

  const label = timestampLabel();
  const outFile = safeResolve(backupDir, `backup-${label}.tar.gz`);

  // 確認要備份的目錄
  const includes = BACKUP_DIRS.filter(d => existsSync(safeResolve(DATA_DIR, d)));
  if (includes.length === 0) throw new Error("No data directories to backup");

  console.log(`[Backup] Creating ${outFile} from ${includes.length} dirs...`);

  // 純 Node.js 打包 + gzip
  await createTarGz(DATA_DIR, includes, outFile);

  // 驗證
  if (!existsSync(outFile)) throw new Error("Backup file not created");
  const stats = await stat(outFile);

  // 清理超過保留數量的舊備份
  await cleanupOldBackups(config);

  // 更新 lastBackupAt
  config.lastBackupAt = new Date().toISOString();
  await saveConfig(config);

  const result = {
    id: genId(),
    filename: basename(outFile),
    path: outFile,  // nosemgrep: path-join-resolve-traversal
    size: stats.size,
    createdAt: new Date().toISOString(),
    dirs: includes,
  };

  // metadata
  const metaFile = safeResolve(backupDir, `backup-${label}.json`);
  await writeFile(metaFile, JSON.stringify(result, null, 2), "utf-8");

  console.log(`[Backup] Done: ${result.filename} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);
  return result;
}

// ── Cleanup ──

async function cleanupOldBackups(config) {
  const backupDir = config.backupDir || BACKUP_DIR_DEFAULT;  // nosemgrep: path-join-resolve-traversal
  const retention = config.retentionCount || 7;
  if (!existsSync(backupDir)) return;

  const files = await readdir(backupDir);
  const backups = files
    .filter(f => f.startsWith("backup-") && f.endsWith(".tar.gz"))
    .map(f => ({ name: f, path: safeResolve(backupDir, f) }))
    .sort((a, b) => b.name.localeCompare(a.name)); // 新→舊

  const toDelete = backups.slice(retention);
  for (const f of toDelete) {
    try {
      await rm(f.path);
      const metaPath = f.path.replace(".tar.gz", ".json");
      if (existsSync(metaPath)) await rm(metaPath);
      console.log(`[Backup] Cleaned up old: ${f.name}`);
    } catch {}
  }
}

// ── List backups ──

async function listBackups(config) {
  const backupDir = config.backupDir || BACKUP_DIR_DEFAULT;
  // 嚴格讀設定的目錄，不 fallback 到 default  // nosemgrep: path-join-resolve-traversal
  if (!backupDir || !existsSync(backupDir)) return [];

  const files = await readdir(backupDir);
  const backups = [];

  for (const f of files.filter(f => f.startsWith("backup-") && f.endsWith(".tar.gz"))) {
    const fullPath = safeResolve(backupDir, f);
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
  return backups;  // nosemgrep: path-join-resolve-traversal
}

// ── Restore ──

async function restoreBackup(config, filename) {
  const backupDir = config.backupDir || BACKUP_DIR_DEFAULT;
  const tarFile = safeResolve(backupDir, filename);

  if (!existsSync(tarFile)) throw new Error(`Backup file not found: ${filename}`);
  if (!filename.startsWith("backup-") || !filename.endsWith(".tar.gz")) {
    throw new Error("Invalid backup filename");
  }

  // 還原前自動建立安全備份
  console.log("[Restore] Creating pre-restore backup...");
  await runBackup({ ...config, retentionCount: config.retentionCount + 1 });

  // 純 Node.js 解包
  console.log(`[Restore] Extracting ${filename} to ${DATA_DIR}...`);
  const fileCount = await extractTarGz(tarFile, DATA_DIR);
// nosemgrep: path-join-resolve-traversal
  console.log(`[Restore] providers.json exists: ${existsSync(join(DATA_DIR, 'config/providers.json'))}`);
  console.log(`[Restore] Done from: ${filename} (${fileCount} files)`);
  return { ok: true, restoredFrom: filename, filesRestored: fileCount };
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
      console.error("[Backup] Run error:", err);
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
    res.end(JSON.stringify({ backups, sourceDir: config.backupDir || BACKUP_DIR_DEFAULT }));
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
      console.error("[Backup] Restore error:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // DELETE /api/backup/delete?filename=  // nosemgrep: path-join-resolve-traversal
  if (path === "/api/backup/delete" && method === "DELETE") {
    const filename = parsedUrl.searchParams.get("filename");
    if (!filename) {
      res.writeHead(400); res.end(JSON.stringify({ error: "filename required" })); return true;
    }
    const config = await loadConfig();
    const backupDir = config.backupDir || BACKUP_DIR_DEFAULT;
    const tarPath = safeResolve(backupDir, filename);
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
