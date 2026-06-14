/**
 * PAAW File Service
 *
 * Standalone HTTP server for ALL filesystem operations.
 * Deployable outside the sandbox — the only way data enters/leaves the sandbox.
 *
 * Usage:
 *   node file-service.mjs              # default port 4100
 *   FILE_SERVICE_PORT=4200 node file-service.mjs
 *   FILE_SERVICE_HOST=0.0.0.0 node file-service.mjs
 */

import { createServer } from "http";
import {
  readdir, readFile, writeFile, mkdir, unlink, rm, stat, cp, rename,
} from "fs/promises";
import { createReadStream } from "fs";
import { join, resolve, dirname, basename, normalize } from "path";
import { execFile } from "child_process";

const PORT = parseInt(process.env.FILE_SERVICE_PORT || "4100", 10);
const HOST = process.env.FILE_SERVICE_HOST || "127.0.0.1";

// ── Helpers ──

function json(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

// ── Tree builder (same logic as PAAW) ──

const IGNORED = new Set([".git", "node_modules", ".DS_Store", "__pycache__", ".next", "dist", ".cache", ".turbo"]);

async function buildTree(absRoot, currentPath, maxDepth) {
  const result = {
    name: currentPath === absRoot ? basename(absRoot) : basename(currentPath),
    path: normalize(currentPath),
    type: "dir",
    children: [],
  };
  if (maxDepth <= 0) { result.children = undefined; result.lazy = true; return result; }
  let entries;
  try { entries = await readdir(currentPath, { withFileTypes: true }); } catch { return result; }
  const sorted = entries
    .filter(e => !IGNORED.has(e.name) && !e.name.startsWith("."))
    .sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });
  const capped = sorted.slice(0, 200);
  if (sorted.length > 200) {
    result.children.push({ name: `... and ${sorted.length - 200} more`, path: "__truncated__", type: "file" });
  }
  for (const entry of capped) {
    const fullPath = normalize(join(currentPath, entry.name));
    if (entry.isDirectory()) {
      const child = await buildTree(absRoot, join(currentPath, entry.name), maxDepth - 1);
      result.children.push(child);
    } else {
      result.children.push({ name: entry.name, path: fullPath, type: "file" });
    }
  }
  return result;
}

function isAbsPath(p) {
  return p.startsWith("/") || /^[A-Za-z]:/.test(p);
}

// ── File watcher (SSE) ──

function startWatcher(root, sseRes) {
  const chokidar = require("chokidar");
  const w = chokidar.watch(root, {
    ignored: /node_modules|\.git|dist|__pycache__|\.next|\.nuxt|target|build/,
    persistent: true,
    ignoreInitial: true,
    depth: 8,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
  });
  const send = (type, path) => {
    try { sseRes.write(`data: ${JSON.stringify({ type, path })}\n\n`); } catch { /* gone */ }
  };
  w.on("add", p => send("add", p));
  w.on("unlink", p => send("unlink", p));
  w.on("change", p => send("change", p));
  w.on("addDir", p => send("addDir", p));
  w.on("unlinkDir", p => send("unlinkDir", p));
  w.on("error", err => console.error(`[FS Watcher] Error: ${err.message}`));
  return w;
}

// ── Request handler ──

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const path = url.pathname;
  const method = req.method;

  // ── CORS preflight ──
  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  try {
    // ── GET /api/fs/browse?path=... ──
    if (method === "GET" && path === "/api/fs/browse") {
      const dirPath = url.searchParams.get("path") || "";
      const absPath = dirPath ? resolve(dirPath) : resolve(process.env.USERPROFILE || process.env.HOME || "/");
      const s = await stat(absPath);
      if (!s.isDirectory()) { json(res, { error: "Not a directory" }, 400); return; }
      const entries = await readdir(absPath, { withFileTypes: true });
      const ignored = new Set([".git", "node_modules", ".DS_Store", ".cache", ".Trash", ".npm", ".vite"]);
      const dirs = entries
        .filter(e => e.isDirectory() && !ignored.has(e.name) && !e.name.startsWith("."))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(e => ({ name: e.name, path: join(absPath, e.name) }));
      const parent = (absPath !== "/" && !/^[A-Za-z]:\\$/.test(absPath)) ? dirname(absPath) : null;
      json(res, { currentPath: absPath, parent, directories: dirs });
      return;
    }

    // ── GET /api/fs/tree?root=... ──
    if (method === "GET" && path === "/api/fs/tree") {
      const root = url.searchParams.get("root");
      if (!root) { json(res, { error: "Missing 'root' query param" }, 400); return; }
      const absRoot = resolve(root);
      if (!isAbsPath(absRoot)) { json(res, { error: "Only absolute paths allowed" }, 400); return; }
      const tree = await buildTree(absRoot, absRoot, 2);
      json(res, tree);
      return;
    }

    // ── GET /api/fs/tree-deep?root=...&subpath=... ──
    if (method === "GET" && path === "/api/fs/tree-deep") {
      const root = url.searchParams.get("root");
      const subpath = url.searchParams.get("subpath") || "";
      if (!root) { json(res, { error: "Missing 'root' query param" }, 400); return; }
      const absDir = resolve(join(root, subpath));
      const children = await buildTree(absDir, absDir, 1);
      json(res, children);
      return;
    }

    // ── GET /api/fs/file?path=... ──
    if (method === "GET" && path === "/api/fs/file") {
      const filePath = url.searchParams.get("path");
      if (!filePath) { json(res, { error: "Missing 'path' query param" }, 400); return; }
      const absPath = resolve(filePath);
      if (!isAbsPath(absPath)) { json(res, { error: "Only absolute paths allowed" }, 400); return; }
      const s = await stat(absPath);
      const ext = absPath.split(".").pop()?.toLowerCase() ?? "";
      const imageExts = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"];
      const isImage = imageExts.includes(ext);
      if (isImage && s.size > 10 * 1024 * 1024) {
        json(res, { error: "Image too large (max 10MB)" }, 413);
        return;
      }
      if (!isImage && s.size > 1024 * 1024) {
        json(res, { error: "File too large (max 1MB)" }, 413);
        return;
      }
      if (isImage) {
        const mimeMap = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
          gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
          bmp: "image/bmp", ico: "image/x-icon" };
        const data = await readFile(absPath);
        res.writeHead(200, {
          "Content-Type": mimeMap[ext] || "application/octet-stream",
          "Content-Length": s.size,
          "Cache-Control": "public, max-age=3600",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(data);
      } else {
        const content = await readFile(absPath, "utf-8");
        json(res, { path: absPath, content, size: s.size });
      }
      return;
    }

    // ── PUT /api/fs/file?path=... ──
    if (method === "PUT" && path === "/api/fs/file") {
      const filePath = url.searchParams.get("path");
      if (!filePath) { json(res, { error: "Missing 'path' query param" }, 400); return; }
      const absPath = resolve(filePath);
      if (!isAbsPath(absPath)) { json(res, { error: "Only absolute paths allowed" }, 400); return; }
      const body = JSON.parse(await readBody(req));
      await writeFile(absPath, body.content || "", "utf-8");
      json(res, { ok: true });
      return;
    }

    // ── POST /api/fs/mkdir ──
    if (method === "POST" && path === "/api/fs/mkdir") {
      const { path: dirPath } = JSON.parse(await readBody(req));
      if (!dirPath) { json(res, { error: "Missing path" }, 400); return; }
      const abs = resolve(dirPath);
      await mkdir(abs, { recursive: true });
      json(res, { ok: true, path: abs });
      return;
    }

    // ── POST /api/fs/create-file ──
    if (method === "POST" && path === "/api/fs/create-file") {
      const { path: filePath, content = "" } = JSON.parse(await readBody(req));
      if (!filePath) { json(res, { error: "Missing path" }, 400); return; }
      const abs = resolve(filePath);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, content, "utf-8");
      json(res, { ok: true, path: abs });
      return;
    }

    // ── POST /api/fs/rename ──
    if (method === "POST" && path === "/api/fs/rename") {
      const { oldPath, newPath } = JSON.parse(await readBody(req));
      if (!oldPath || !newPath) { json(res, { error: "Missing oldPath or newPath" }, 400); return; }
      const absOld = resolve(oldPath);
      const absNew = resolve(newPath);
      await rename(absOld, absNew);
      json(res, { ok: true, oldPath: absOld, newPath: absNew });
      return;
    }

    // ── POST /api/fs/copy ──
    if (method === "POST" && path === "/api/fs/copy") {
      const { srcPath, destPath } = JSON.parse(await readBody(req));
      if (!srcPath || !destPath) { json(res, { error: "Missing srcPath or destPath" }, 400); return; }
      const absSrc = resolve(srcPath);
      const absDest = resolve(destPath);
      await cp(absSrc, absDest, { recursive: true });
      json(res, { ok: true, srcPath: absSrc, destPath: absDest });
      return;
    }

    // ── DELETE /api/fs/item?path=... ──
    if (method === "DELETE" && path === "/api/fs/item") {
      const targetPath = url.searchParams.get("path");
      if (!targetPath) { json(res, { error: "Missing 'path' query param" }, 400); return; }
      const absPath = resolve(targetPath);
      if (!isAbsPath(absPath)) { json(res, { error: "Only absolute paths allowed" }, 400); return; }
      const s = await stat(absPath);
      if (s.isDirectory()) await rm(absPath, { recursive: true, force: true });
      else await unlink(absPath);
      json(res, { ok: true, path: absPath });
      return;
    }

    // ── GET /api/fs/pick-folder ── native OS folder picker
    if (method === "GET" && path === "/api/fs/pick-folder") {
      const platform = process.platform;
      let result;
      if (platform === "darwin") {
        result = await new Promise((resolve, reject) => {
          execFile("osascript", ["-e", 'set chosenFolder to choose folder with prompt "Select a project folder"\nreturn POSIX path of chosenFolder'], (err, stdout) => {
            if (err) reject(err); else resolve(stdout.toString().trim());
          });
        });
      } else if (platform === "linux") {
        try {
          result = await new Promise((resolve, reject) => {
            execFile("zenity", ["--file-selection", "--directory", "--title=Select a project folder"], (err, stdout) => {
              if (err) reject(err); else resolve(stdout.toString().trim());
            });
          });
        } catch {
          result = await new Promise((resolve, reject) => {
            execFile("kdialog", ["--getexistingdirectory", process.env.HOME || process.env.USERPROFILE || "/", "Select a project folder"], (err, stdout) => {
              if (err) reject(err); else resolve(stdout.toString().trim());
            });
          });
        }
      } else if (platform === "win32") {
        result = await new Promise((resolve, reject) => {
          execFile("powershell", [
            "-NoProfile", "-Command",
            'Add-Type -AssemblyName System.Windows.Forms; $fb = New-Object System.Windows.Forms.FolderBrowserDialog; $fb.Description = "Select a project folder"; $fb.ShowNewFolderButton = $false; if ($fb.ShowDialog() -eq "OK") { $fb.SelectedPath } else { exit 1 }',
          ], { maxBuffer: 1024 * 1024 }, (err, stdout) => {
            if (err) reject(err); else resolve(stdout.toString().trim());
          });
        });
      } else {
        json(res, { error: `Unsupported platform: ${platform}` }, 500);
        return;
      }
      json(res, { path: result });
      return;
    }

    // ── POST /api/fs/import-workspace ── copy directory, used by workspace import
    if (method === "POST" && path === "/api/fs/import-workspace") {
      const { source, target } = JSON.parse(await readBody(req));
      if (!source || !target) { json(res, { error: "source and target required" }, 400); return; }
      const absSource = resolve(source);
      const absTarget = resolve(target);
      // Validate source exists
      try { await stat(absSource); } catch { json(res, { error: `Source not found: ${absSource}` }, 404); return; }
      // Copy
      await mkdir(dirname(absTarget), { recursive: true });
      await cp(absSource, absTarget, { recursive: true });
      json(res, { ok: true, source: absSource, target: absTarget });
      return;
    }

    // ── DELETE /api/fs/remove-workspace?path=... ── delete workspace directory
    if (method === "DELETE" && path === "/api/fs/remove-workspace") {
      const targetPath = url.searchParams.get("path");
      if (!targetPath) { json(res, { error: "Missing 'path' query param" }, 400); return; }
      const absPath = resolve(targetPath);
      if (!isAbsPath(absPath)) { json(res, { error: "Only absolute paths allowed" }, 400); return; }
      await rm(absPath, { recursive: true, force: true });
      json(res, { ok: true });
      return;
    }

    // ── SSE: GET /api/fs/watch?root=... ──
    if (method === "GET" && path === "/api/fs/watch") {
      const root = url.searchParams.get("root");
      if (!root) { json(res, { error: "Missing root" }, 400); return; }
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });
      res.write("\n");
      const watcher = startWatcher(root, res);
      req.on("close", () => { watcher.close(); res.end(); });
      return;
    }

    // ── 404 ──
    json(res, { error: "Not found", path }, 404);
  } catch (err) {
    json(res, { error: err.message }, 500);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[File Service] Listening on http://${HOST}:${PORT}`);
  console.log(`[File Service] PID: ${process.pid}`);
});
