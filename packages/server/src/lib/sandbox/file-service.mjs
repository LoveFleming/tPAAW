/**
 * File Service — Host file manager with Review Gate
 *
 * Runs OUTSIDE the sandbox (on host). Manages:
 * 1. Push: host real files → sandbox staging area
 * 2. Pull: sandbox changes → review queue (NOT directly to real files)
 * 3. Review Gate: diff preview → human approve → write to real files
 *
 * Endpoints:
 *   GET    /health                       — Health check
 *
 *   POST   /api/files/push                — Copy host dir → sandbox staging
 *   GET    /api/files/staging/: jobId     — List staging files
 *   DELETE /api/files/staging/: jobId     — Clear staging
 *
 *   POST   /api/files/sync-request        — Request to sync staging → real
 *   GET    /api/files/pending             — List pending sync requests
 *   GET    /api/files/diff/: requestId    — Get diff for review
 *   POST   /api/files/approve/: requestId — Approve & write to real files
 *   POST   /api/files/reject/: requestId  — Reject & discard
 *
 *   GET    /api/files/real/*              — Read real host files (API gateway)
 */

import { createServer } from "http";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import {
  readFile as readFileAsync,
  stat as statAsync,
  readdir as readdirAsync,
  mkdir as mkdirAsync,
  rm as rmAsync,
  copyFile as copyFileAsync
} from "fs/promises";
import { join, resolve, relative, dirname, basename } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { createHash } from "crypto";

const execFileAsync = promisify(execFile);

const PORT = parseInt(process.env.FILE_SERVICE_PORT || "4100", 10);
const HOST = process.env.FILE_SERVICE_HOST || "0.0.0.0";

// Directories
const STAGING_ROOT = resolve(process.env.FILE_SERVICE_STAGING || "./.paaw-staging");
const REVIEW_ROOT = resolve(process.env.FILE_SERVICE_REVIEW || "./.paaw-review");

// Ensure dirs exist
mkdirSync(STAGING_ROOT, { recursive: true });
mkdirSync(REVIEW_ROOT, { recursive: true });

// ── State ──

const syncRequests = new Map(); // requestId → { id, jobId, files, status, createdAt, reviewedBy }
let jobCounter = 0;
let requestCounter = 0;

// ── Helpers ──

async function readBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => resolveBody(data));
    req.on("error", rejectBody);
  });
}

async function fileHash(filePath) {
  const content = await readFileAsync(filePath);
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

async function walkDir(dir, base = dir) {
  const results = [];
  const entries = await readdirAsync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relPath = relative(base, fullPath);
    if (entry.isDirectory()) {
      // Skip common ignore patterns
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".paaw-staging" || entry.name === ".paaw-review") continue;
      results.push(...await walkDir(fullPath, base));
    } else {
      const st = await statAsync(fullPath);
      const hash = await fileHash(fullPath);
      results.push({ path: relPath, size: st.size, hash, mtime: st.mtime.toISOString() });
    }
  }
  return results;
}

async function copyDir(src, dest) {
  await mkdirAsync(dest, { recursive: true });
  const entries = await readdirAsync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await copyFileAsync(srcPath, destPath);
    }
  }
}

async function generateDiff(stagingDir, realDir) {
  // Use diff command if available, otherwise fallback to hash comparison
  try {
    const { stdout } = await execFileAsync("diff", ["-rq", "--brief", stagingDir, realDir]);
    // diff returns 0 = same, 1 = different, 2 = error
    // stdout has lines like "Files a/x and b/x differ" or "Only in a: x"
    return parseDiffBrief(stdout, stagingDir, realDir);
  } catch (err) {
    if (err.stdout) {
      return parseDiffBrief(err.stdout, stagingDir, realDir);
    }
    // Fallback: hash-based comparison
    return hashBasedDiff(stagingDir, realDir);
  }
}

function parseDiffBrief(output, stagingDir, realDir) {
  const changes = [];
  for (const line of output.split("\n").filter(Boolean)) {
    // "Files staging/x and real/x differ"
    let m = line.match(/^Files (.+) and (.+) differ$/);
    if (m) {
      const stagingPath = relative(stagingDir, m[1]);
      changes.push({ type: "modified", path: stagingPath });
      continue;
    }
    // "Only in staging: x"
    m = line.match(/^Only in (.+?): (.+)$/);
    if (m) {
      const dir = m[1];
      const file = m[2];
      const relPath = relative(stagingDir, join(dir, file));
      const isInStaging = dir.startsWith(stagingDir);
      changes.push({
        type: isInStaging ? "added" : "removed",
        path: isInStaging ? relPath : relative(realDir, join(dir, file)),
      });
    }
  }
  return changes;
}

async function hashBasedDiff(stagingDir, realDir) {
  const changes = [];
  let stagingFiles = [];
  let realFiles = [];

  try { stagingFiles = await walkDir(stagingDir); } catch {}
  try { realFiles = await walkDir(realDir); } catch {}

  const stagingMap = new Map(stagingFiles.map(f => [f.path, f.hash]));
  const realMap = new Map(realFiles.map(f => [f.path, f.hash]));

  // Added or modified
  for (const [path, hash] of stagingMap) {
    if (!realMap.has(path)) {
      changes.push({ type: "added", path });
    } else if (realMap.get(path) !== hash) {
      changes.push({ type: "modified", path });
    }
  }
  // Removed
  for (const [path] of realMap) {
    if (!stagingMap.has(path)) {
      changes.push({ type: "removed", path });
    }
  }

  return changes;
}

// ── HTTP Server ─────────────────────────────────────────

const server = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  // ── Health ──
  if (req.method === "GET" && path === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "file-service", port: PORT }));
    return;
  }

  // ══════════════════════════════════════════════════════
  // PUSH: host → sandbox staging
  // ══════════════════════════════════════════════════════

  if (req.method === "POST" && path === "/api/files/push") {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }

    const { sourceDir, label } = body;
    if (!sourceDir) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "sourceDir required" }));
      return;
    }

    try {
      const jobId = `job-${++jobCounter}`;
      const stagingDir = resolve(STAGING_ROOT, jobId, "workspace");
      await copyDir(sourceDir, stagingDir);

      // Snapshot the file list
      const files = await walkDir(stagingDir);

      console.log(`[FILE-SVC] Push ${jobId}: ${files.length} files from ${sourceDir} → ${stagingDir}`);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        jobId,
        stagingDir,
        label: label || basename(sourceDir),
        sourceDir,
        fileCount: files.length,
        files,
        createdAt: new Date().toISOString(),
      }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ── List staging files ──
  if (req.method === "GET" && path.startsWith("/api/files/staging/")) {
    const jobId = path.split("/").pop();
    const stagingDir = resolve(STAGING_ROOT, jobId, "workspace");
    try {
      const files = await walkDir(stagingDir);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jobId, stagingDir, files }));
    } catch {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Staging job not found" }));
    }
    return;
  }

  // ── Clear staging ──
  if (req.method === "DELETE" && path.startsWith("/api/files/staging/")) {
    const jobId = path.split("/").pop();
    const stagingDir = resolve(STAGING_ROOT, jobId);
    try {
      await rmAsync(stagingDir, { recursive: true });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, cleared: jobId }));
    } catch {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Staging job not found" }));
    }
    return;
  }

  // ══════════════════════════════════════════════════════
  // REVIEW GATE: sync-request → diff → approve/reject
  // ══════════════════════════════════════════════════════

  // ── Create sync request ──
  if (req.method === "POST" && path === "/api/files/sync-request") {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }

    const { jobId, targetDir, label } = body;
    if (!jobId || !targetDir) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "jobId and targetDir required" }));
      return;
    }

    const requestId = `req-${++requestCounter}`;
    const stagingDir = resolve(STAGING_ROOT, jobId, "workspace");

    try {
      // Generate diff immediately
      const changes = await generateDiff(stagingDir, targetDir);

      const request = {
        id: requestId,
        jobId,
        stagingDir,
        targetDir,
        label: label || `Sync ${requestId}`,
        changes,
        status: "pending", // pending | approved | rejected
        createdAt: new Date().toISOString(),
        reviewedAt: null,
        reviewedBy: null,
      };

      syncRequests.set(requestId, request);

      console.log(`[FILE-SVC] Sync request ${requestId}: ${changes.length} changes`);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(request));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ── List pending requests ──
  if (req.method === "GET" && path === "/api/files/pending") {
    const pending = Array.from(syncRequests.values())
      .filter(r => r.status === "pending")
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ requests: pending }));
    return;
  }

  // ── Get all requests ──
  if (req.method === "GET" && path === "/api/files/requests") {
    const all = Array.from(syncRequests.values())
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ requests: all }));
    return;
  }

  // ── Get diff / detail ──
  if (req.method === "GET" && path.startsWith("/api/files/diff/")) {
    const requestId = path.split("/").pop();
    const request = syncRequests.get(requestId);
    if (!request) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Request not found" }));
      return;
    }

    // Get full diff content for each changed file
    const diffDetails = [];
    for (const change of request.changes) {
      const stagingFile = join(request.stagingDir, change.path);
      const targetFile = join(request.targetDir, change.path);
      let detail = { ...change };

      try {
        if (change.type === "added" || change.type === "modified") {
          // Get unified diff
          const { stdout } = await execFileAsync("diff", ["-u", targetFile, stagingFile]).catch(e => ({ stdout: e.stdout || "" }));
          detail.diff = stdout || "(new file)";
          detail.stagingHash = await fileHash(stagingFile);
        } else if (change.type === "removed") {
          detail.diff = `File removed in staging: ${change.path}`;
          detail.targetHash = await fileHash(targetFile);
        }
      } catch {
        detail.diff = "(unable to generate diff)";
      }

      diffDetails.push(detail);
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ...request, changes: diffDetails }));
    return;
  }

  // ── Approve ──
  if (req.method === "POST" && path.startsWith("/api/files/approve/")) {
    const requestId = path.split("/").pop();
    const request = syncRequests.get(requestId);
    if (!request) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Request not found" }));
      return;
    }
    if (request.status !== "pending") {
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Request already ${request.status}` }));
      return;
    }

    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}

    try {
      let applied = 0;
      for (const change of request.changes) {
        const stagingFile = join(request.stagingDir, change.path);
        const targetFile = join(request.targetDir, change.path);

        if (change.type === "added" || change.type === "modified") {
          await mkdirAsync(dirname(targetFile), { recursive: true });
          await copyFileAsync(stagingFile, targetFile);
          applied++;
        } else if (change.type === "removed") {
          await rmAsync(targetFile, { force: true });
          applied++;
        }
      }

      request.status = "approved";
      request.reviewedAt = new Date().toISOString();
      request.reviewedBy = body.reviewedBy || "user";
      request.appliedCount = applied;

      console.log(`[FILE-SVC] Approved ${requestId}: ${applied}/${request.changes.length} files synced`);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, request, applied }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ── Reject ──
  if (req.method === "POST" && path.startsWith("/api/files/reject/")) {
    const requestId = path.split("/").pop();
    const request = syncRequests.get(requestId);
    if (!request) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Request not found" }));
      return;
    }

    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}

    request.status = "rejected";
    request.reviewedAt = new Date().toISOString();
    request.reviewedBy = body.reviewedBy || "user";
    request.reason = body.reason || "";

    console.log(`[FILE-SVC] Rejected ${requestId}`);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, request }));
    return;
  }

  // ══════════════════════════════════════════════════════
  // REAL FILE ACCESS (for PAAW to read host files)
  // ══════════════════════════════════════════════════════

  if (req.method === "GET" && path.startsWith("/api/files/real/")) {
    const filePath = decodeURIComponent(path.replace("/api/files/real/", ""));
    try {
      const content = await readFileAsync(filePath, "utf-8");
      const st = await statAsync(filePath);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        path: filePath,
        content,
        size: st.size,
        mtime: st.mtime.toISOString(),
      }));
    } catch (err) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ── 404 ──
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found", path }));
});

// ── Start ──

server.listen(PORT, HOST, () => {
  console.log(`[FILE-SVC] Listening on http://${HOST}:${PORT}`);
  console.log(`[FILE-SVC] Staging: ${STAGING_ROOT}`);
  console.log(`[FILE-SVC] Review:  ${REVIEW_ROOT}`);
});
