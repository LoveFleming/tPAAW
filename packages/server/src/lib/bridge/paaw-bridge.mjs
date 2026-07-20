/**
 * PAAW Bridge — The outside guardian
 *
 * Runs on HOST, outside the Docker sandbox.
 * Three jobs:
 *
 *   1. SYNC    — manual: diff sandbox vs host data → human review → approve
 *   2. TOOL    — proxy external API calls (API keys live here, never in sandbox)
 *   3. UPDATE  — manage PAAW container (pull image / restart / status)
 *
 * Architecture:
 *
 *   Host (outside)
 *   ┌──────────────────────────────┐
 *   │  paaw-bridge :4100            │
 *   │  • /api/sync/*                │
 *   │  • /api/tool/*                │
 *   │  • /api/update/*              │
 *   └──────────┬───────────────────┘
 *              │ Docker volume / exec
 *   ┌──────────▼───────────────────┐
 *   │  paaw-sandbox (Docker)        │
 *   │  :4097 API+UI  :4098 PTY     │
 *   │  /paaw/data/                  │
 *   └──────────────────────────────┘
 *
 * Env:
 *   BRIDGE_PORT=4100
 *   PAAW_CONTAINER=paaw           — container name
 *   PAAW_DATA_VOLUME=paaw-data    — volume name
 *   BRIDGE_TOKEN=                 — simple bearer auth for tool proxy
 *   TOOL_TOKENS_FILE=             — path to JSON with API tokens
 */

import { createServer } from "http";
import {
  existsSync, mkdirSync, readFileSync,
} from "fs";
import {
  mkdir, readdir, copyFile, rm, readFile, writeFile,
  readFile as readFileAsync, readdir as readdirAsync, stat as statAsync
} from "fs/promises";
import { join, resolve, relative, dirname } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { createHash } from "crypto";
import { fileURLToPath } from "url";

const execFileAsync = promisify(execFile);

// ── Config ──────────────────────────────────────────────

// Resolve PAAW_ROOT from module location, not process.cwd()
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);  // .../packages/server/src/lib/bridge/
const PAAW_ROOT = resolve(__dirname, "../../../../");

const PORT = parseInt(process.env.BRIDGE_PORT || "4100", 10);
const HOST = process.env.BRIDGE_HOST || "0.0.0.0";
const PAAW_CONTAINER = process.env.PAAW_CONTAINER || "paaw";
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN || "";
const HOST_DATA_DIR = resolve(PAAW_ROOT, "data");

// ── State ───────────────────────────────────────────────

const syncRequests = new Map();
let syncCounter = 0;

// ── Helpers ─────────────────────────────────────────────

async function readBody(req) {
  return new Promise((res, rej) => {
    let data = "";
    req.on("data", (c) => { data += c; });
    req.on("end", () => res(data));
    req.on("error", rej);
  });
}

function auth(req) {
  if (!BRIDGE_TOKEN) return true;
  const header = req.headers.authorization || "";
  return header === `Bearer ${BRIDGE_TOKEN}`;
}

async function fileHash(path) {
  const content = await readFileAsync(path);
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

async function walkDir(dir, base = dir) {
  const results = [];
  let entries;
  try { entries = await readdirAsync(dir, { withFileTypes: true }); }
  catch { return []; }

  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = join(dir, entry.name);
    const rel = relative(base, full);
    if (entry.isDirectory()) {
      results.push(...await walkDir(full, base));
    } else {
      try {
        const st = await statAsync(full);
        results.push({ path: rel, size: st.size, mtime: st.mtime.toISOString() });
      } catch {}
    }
  }
  return results;
}

// ── Docker helpers ──────────────────────────────────────

async function dockerExec(...args) {
  try {
    const { stdout } = await execFileAsync("docker", ["exec", PAAW_CONTAINER, ...args]);
    return stdout;
  } catch (err) {
    throw new Error(`docker exec failed: ${err.message}`);
  }
}

async function dockerCpFrom(containerPath, hostPath) {
  try {
    await execFileAsync("docker", ["cp", `${PAAW_CONTAINER}:${containerPath}`, hostPath]);
  } catch (err) {
    throw new Error(`docker cp failed: ${err.message}`);
  }
}

async function dockerCpTo(hostPath, containerPath) {
  try {
    await execFileAsync("docker", ["cp", hostPath, `${PAAW_CONTAINER}:${containerPath}`]);
  } catch (err) {
    throw new Error(`docker cp failed: ${err.message}`);
  }
}

async function containerRunning() {
  try {
    const { stdout } = await execFileAsync("docker", ["inspect", "--format", "{{.State.Running}}", PAAW_CONTAINER]);
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

// ── 1. SYNC (Review Gate) ───────────────────────────────
//
// Diffs sandbox container data against host data/ directory.
// Human reviews changes, then approves to write into host data/.

async function createSyncRequest(subPath, label) {
  const id = `sync-${++syncCounter}`;
  const containerDir = `/paaw/data/${subPath}`;
  const baselineDir = resolve(HOST_DATA_DIR, subPath);

  if (!existsSync(baselineDir)) {
    throw new Error(`No baseline data for ${subPath} at ${baselineDir}`);
  }

  // Copy current container data to temp for comparison
  const tempDir = resolve(PAAW_ROOT, ".sync-temp", id, subPath);
  await mkdir(tempDir, { recursive: true });
  try {
    await execFileAsync("docker", ["cp", `${PAAW_CONTAINER}:${containerDir}/.`, tempDir]);
  } catch (err) {
    throw new Error(`Cannot read ${containerDir} from container: ${err.message}`);
  }

  // Generate diff
  const changes = await generateDiff(tempDir, baselineDir);

  const request = {
    id,
    subPath,
    label: label || `Sync ${subPath} ${id}`,
    containerDir,
    baselineDir,
    stagingDir: tempDir,
    changes,
    status: "pending",
    createdAt: new Date().toISOString(),
    reviewedAt: null,
    reviewedBy: null,
  };

  syncRequests.set(id, request);
  console.log(`[BRIDGE] Sync request ${id}: ${changes.length} changes in ${subPath}`);
  return request;
}

async function generateDiff(dirA, dirB) {
  try {
    const { stdout } = await execFileAsync("diff", ["-rq", "--brief", dirA, dirB]);
    return parseDiffBrief(stdout, dirA, dirB);
  } catch (err) {
    if (err.stdout) return parseDiffBrief(err.stdout, dirA, dirB);
    return await hashBasedDiff(dirA, dirB);
  }
}

function parseDiffBrief(output, dirA, dirB) {
  const changes = [];
  for (const line of output.split("\n").filter(Boolean)) {
    let m = line.match(/^Files (.+) and (.+) differ$/);
    if (m) {
      const path = relative(dirA, m[1]);
      changes.push({ type: "modified", path });
      continue;
    }
    m = line.match(/^Only in (.+?): (.+)$/);
    if (m) {
      const isInA = m[1].startsWith(dirA);
      const relPath = isInA
        ? relative(dirA, join(m[1], m[2]))
        : relative(dirB, join(m[1], m[2]));
      changes.push({ type: isInA ? "added" : "removed", path: relPath });
    }
  }
  return changes;
}

async function hashBasedDiff(dirA, dirB) {
  const changes = [];
  const filesA = await walkDir(dirA);
  const filesB = await walkDir(dirB);
  const mapA = new Map(filesA.map(f => [f.path, f]));
  const mapB = new Map(filesB.map(f => [f.path, f]));

  for (const [path] of mapA) {
    if (!mapB.has(path)) changes.push({ type: "added", path });
    else {
      const hA = await fileHash(join(dirA, path));
      const hB = await fileHash(join(dirB, path));
      if (hA !== hB) changes.push({ type: "modified", path });
    }
  }
  for (const [path] of mapB) {
    if (!mapA.has(path)) changes.push({ type: "removed", path });
  }
  return changes;
}

async function approveSync(id, reviewedBy) {
  const req = syncRequests.get(id);
  if (!req) throw new Error("Sync request not found");
  if (req.status !== "pending") throw new Error(`Already ${req.status}`);

  // Write synced files to host data dir
  for (const change of req.changes) {
    const srcFile = join(req.stagingDir, change.path);
    const destFile = resolve(HOST_DATA_DIR, req.subPath, change.path);

    if (change.type === "added" || change.type === "modified") {
      await mkdir(dirname(destFile), { recursive: true });
      await copyFile(srcFile, destFile);
    } else if (change.type === "removed") {
      try { await rm(destFile); } catch {}
    }
  }

  req.status = "approved";
  req.reviewedAt = new Date().toISOString();
  req.reviewedBy = reviewedBy || "user";

  console.log(`[BRIDGE] Sync ${id} approved: ${req.changes.length} files saved to host data`);
  return req;
}

async function rejectSync(id, reviewedBy, reason) {
  const req = syncRequests.get(id);
  if (!req) throw new Error("Sync request not found");
  req.status = "rejected";
  req.reviewedAt = new Date().toISOString();
  req.reviewedBy = reviewedBy || "user";
  req.reason = reason || "";

  // Clean up staging
  try { await rm(req.stagingDir, { recursive: true }); } catch {}

  console.log(`[BRIDGE] Sync ${id} rejected`);
  return req;
}

// ── 2. TOOL PROXY ───────────────────────────────────────
//
// Sandbox calls this to reach external APIs.
// API keys are stored here on the host, never inside sandbox.
//
// POST /api/tool/proxy
//   { url, method, headers, body, timeout }
//   → Authorization header injected from TOOL_TOKENS

const TOOL_TOKENS = (() => {
  try {
    const f = process.env.TOOL_TOKENS_FILE || resolve(HOST_DATA_DIR, ".tool-tokens.json");
    if (existsSync(f)) return JSON.parse(readFileSync(f, "utf-8"));
  } catch {}
  return {};
})();

// ── 3. UPDATE ───────────────────────────────────────────

async function updateContainer(action) {
  switch (action) {
    case "status": {
      const running = await containerRunning();
      return { running, container: PAAW_CONTAINER };
    }
    case "restart": {
      await execFileAsync("docker", ["restart", PAAW_CONTAINER]);
      return { ok: true, action: "restart" };
    }
    case "stop": {
      await execFileAsync("docker", ["stop", PAAW_CONTAINER]);
      return { ok: true, action: "stop" };
    }
    case "start": {
      await execFileAsync("docker", ["start", PAAW_CONTAINER]);
      return { ok: true, action: "start" };
    }
    case "rebuild": {
      const cwd = PAAW_ROOT;
      await execFileAsync("docker", ["compose", "build", "--no-cache", "paaw"], { cwd });
      await execFileAsync("docker", ["compose", "up", "-d", "paaw"], { cwd });
      return { ok: true, action: "rebuild" };
    }
    default:
      throw new Error(`Unknown update action: ${action}`);
  }
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
    const running = await containerRunning();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      service: "paaw-bridge",
      port: PORT,
      container: PAAW_CONTAINER,
      containerRunning: running,
    }));
    return;
  }

  // ══════════════════════════════════════════════════════
  // 1. SYNC (Review Gate)
  // ══════════════════════════════════════════════════════

  // Create sync request
  if (req.method === "POST" && path === "/api/sync/request") {
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    try {
      const req2 = await createSyncRequest(body.subPath || "skills", body.label);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(req2));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // List pending syncs
  if (req.method === "GET" && path === "/api/sync/pending") {
    const pending = Array.from(syncRequests.values())
      .filter(r => r.status === "pending");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ requests: pending }));
    return;
  }

  // Get diff detail
  if (req.method === "GET" && path.startsWith("/api/sync/diff/")) {
    const id = path.split("/").pop();
    const req2 = syncRequests.get(id);
    if (!req2) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    const details = [];
    for (const change of req2.changes.slice(0, 100)) {
      const sandboxFile = join(req2.stagingDir, change.path);
      const baselineFile = resolve(req2.baselineDir, change.path);
      let diffContent = "";
      try {
        if (change.type === "added") {
          diffContent = await readFileAsync(sandboxFile, "utf-8");
          diffContent = diffContent.slice(0, 2000);
          diffContent = `(new file)\n${diffContent}`;
        } else if (change.type === "modified") {
          const { stdout } = await execFileAsync("diff", ["-u", baselineFile, sandboxFile]).catch(e => ({ stdout: e.stdout || "" }));
          diffContent = stdout.slice(0, 5000);
        } else {
          diffContent = "File deleted in sandbox";
        }
      } catch {
        diffContent = "(unable to read)";
      }
      details.push({ ...change, diff: diffContent });
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ...req2, changes: details }));
    return;
  }

  // Approve
  if (req.method === "POST" && path.startsWith("/api/sync/approve/")) {
    const id = path.split("/").pop();
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    try {
      const result = await approveSync(id, body.reviewedBy);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Reject
  if (req.method === "POST" && path.startsWith("/api/sync/reject/")) {
    const id = path.split("/").pop();
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    try {
      const result = await rejectSync(id, body.reviewedBy, body.reason);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ══════════════════════════════════════════════════════
  // 2. TOOL PROXY
  // ══════════════════════════════════════════════════════

  if (req.method === "POST" && path === "/api/tool/proxy") {
    if (!auth(req)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }

    const { url: targetUrl, method = "GET", headers = {}, body: reqBody, timeout = 30000 } = body;

    if (!targetUrl) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "url required" }));
      return;
    }

    try {
      const hostname = new URL(targetUrl).hostname;
      const token = TOOL_TOKENS[hostname];
      const finalHeaders = { ...headers };
      if (token) {
        if (token.startsWith("Bearer ") || token.startsWith("token ")) {
          finalHeaders["Authorization"] = token;
        } else {
          finalHeaders["Authorization"] = `Bearer ${token}`;
        }
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      const fetchOpts = {
        method,
        headers: { "Content-Type": "application/json", ...finalHeaders },
        signal: controller.signal,
      };
      if (method !== "GET" && method !== "HEAD" && reqBody) {
        fetchOpts.body = typeof reqBody === "string" ? reqBody : JSON.stringify(reqBody);
      }

      const response = await fetch(targetUrl, fetchOpts);
      clearTimeout(timer);

      const contentType = response.headers.get("content-type") || "";
      let responseBody;
      if (contentType.includes("application/json")) {
        responseBody = await response.json();
      } else {
        responseBody = await response.text();
      }

      res.writeHead(response.ok ? 200 : response.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        status: response.status,
        ok: response.ok,
        body: responseBody,
        headers: Object.fromEntries(response.headers.entries()),
      }));
    } catch (err) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // List registered tool tokens (hostnames only, not the keys!)
  if (req.method === "GET" && path === "/api/tool/tokens") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      hosts: Object.keys(TOOL_TOKENS),
      note: "Token values are hidden. Configure via TOOL_TOKENS_FILE env.",
    }));
    return;
  }

  // ══════════════════════════════════════════════════════
  // 3. UPDATE
  // ══════════════════════════════════════════════════════

  if (req.method === "POST" && path.startsWith("/api/update/")) {
    const action = path.split("/").pop();
    try {
      const result = await updateContainer(action);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (req.method === "GET" && path === "/api/update/status") {
    try {
      const result = await updateContainer("status");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ── 404 ──
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found", path }));
});

// ── Start ───────────────────────────────────────────────

// DO NOT auto-listen on import! Export start() so the main server
// can call it AFTER .env is loaded.
export function startBridge() {
  server.listen(PORT, HOST, () => {
    console.log(`[BRIDGE] Listening on http://${HOST}:${PORT}`);
    console.log(`[BRIDGE] Container: ${PAAW_CONTAINER}`);
    console.log(`[BRIDGE] Host data dir: ${HOST_DATA_DIR}`);
  });
}

// Auto-start only if BRIDGE_AUTO_START=1 or running as standalone entry point
if (process.env.BRIDGE_AUTO_START === "1" || process.argv[1]?.endsWith("paaw-bridge.mjs")) {
  startBridge();
}

// ── Graceful shutdown ──

process.on("SIGINT", () => {
  console.log("\n[BRIDGE] Shututting down...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  process.exit(0);
});
