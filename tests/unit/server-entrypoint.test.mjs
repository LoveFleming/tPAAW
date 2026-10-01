/**
 * Integration tests — F-001 PAAW Server Core & HTTP Entrypoint
 *
 * paaw-server.mjs is a side-effectful entry module: importing it starts the
 * HTTP server (server.listen), the PTY WebSocket server, cron scheduler, and
 * route loading. It cannot be imported in-process for testing, so this suite
 * spawns the REAL server as a child process with fully isolated environment:
 *
 *   - PAAW_PORT / PAAW_WS_PORT  → ephemeral free ports (never 4097/4098)
 *   - PAAW_DATA_HOME            → temp dir (DB, cron jobs, notes all isolated)
 *   - PAAW_LOG_HOME             → temp dir (console tee, crash logs isolated)
 *   - BRIDGE_PORT               → unset so no bridge server is started
 *
 * Readiness is detected by watching child stdout for the
 * "[PAAW] Listening on http://127.0.0.1:<port>" log line.
 *
 * Covered behavior (dispatch order in paaw-server.mjs):
 *   1. CORS headers + OPTIONS preflight (204)
 *   2. Route-module dispatch   (GET /api/notes from routes/pocket.mjs)
 *   3. Route-module error path (POST /api/notes with invalid JSON → 500)
 *   4. Scheduler dispatch      (GET /api/cron-jobs from scheduler/cron-jobs.mjs)
 *   5. Static frontend         (/, SPA fallback, assets caching) — skipped if
 *                              packages/ui/dist is absent
 *   6. Path traversal guard    (raw ../ escapes → 404, not file content)
 *   7. 404 fallback            (unknown /api/ path and unknown non-GET path)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import { mkdtempSync, rmSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");
const SERVER_ENTRY = join(REPO_ROOT, "packages/server/src/paaw-server.mjs");
const UI_DIST = join(REPO_ROOT, "packages/ui/dist");

// ── helpers ─────────────────────────────────────────────────────────────

/** Reserve an ephemeral free port (bind :0, read port, release). */
function getFreePort() {
  return new Promise((res, rej) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => res(port));
    });
    srv.on("error", rej);
  });
}

/**
 * Raw HTTP request against the test server.
 * Uses node:http (not fetch) so unusual request targets like "/../x"
 * are sent verbatim — fetch/URL would normalise them away.
 */
function request(port, method, path, { body, headers } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const req = http.request(
      { host: "127.0.0.1", port, method, path, headers },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolvePromise({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf-8"),
          })
        );
      }
    );
    req.on("error", rejectPromise);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

function parseJson(res) {
  return JSON.parse(res.body);
}

// ── suite-scoped server lifecycle ───────────────────────────────────────

let child = null;
let PORT = 0;
let tmpRoot = null;
let serverFailedToStart = "";

beforeAll(async () => {
  const t0 = Date.now();
  tmpRoot = mkdtempSync(join(tmpdir(), "paaw-entrypoint-test-"));
  const [httpPort, wsPort] = await Promise.all([getFreePort(), getFreePort()]);

  // Sanitize env: keep PATH etc, drop anything that would start extra
  // servers (bridge) or point at real user data (PAAW_* dirs from shell).
  const env = { ...process.env };
  delete env.BRIDGE_PORT;
  delete env.PAAW_DATA_HOME;
  delete env.PAAW_LOG_HOME;

  child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: REPO_ROOT,
    env: {
      ...env,
      PAAW_PORT: String(httpPort),
      PAAW_WS_PORT: String(wsPort),
      PAAW_DATA_HOME: join(tmpRoot, "data"),
      PAAW_LOG_HOME: join(tmpRoot, "log"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  child.stdout.on("data", (d) => { stdout += d.toString(); });
  child.stderr.on("data", (d) => { stdout += d.toString(); });
  const exited = new Promise((res) => child.on("exit", (code) => res(code)));

  // Ready when the entrypoint logs its listening line; fail fast if the
  // process dies first (e.g. EADDRINUSE) so the suite reports why.
  await new Promise((res, rej) => {
    const timer = setInterval(() => {
      if (stdout.includes(`[PAAW] Listening on http://127.0.0.1:${httpPort}`)) {
        clearInterval(timer); res();
      }
    }, 100);
    const timeout = setTimeout(() => {
      clearInterval(timer);
      serverFailedToStart = `server not ready in 60s. child output:\n${stdout.slice(-2000)}`;
      res(); // don't reject — let each test fail with context
    }, 60_000);
    exited.then((code) => {
      clearInterval(timer); clearTimeout(timeout);
      if (!stdout.includes(`[PAAW] Listening on http://127.0.0.1:${httpPort}`)) {
        serverFailedToStart = `server exited early (code=${code}). child output:\n${stdout.slice(-2000)}`;
      }
      res();
    });
  });

  PORT = httpPort;

  // diagnostics — prove the child is a real, live process
  const elapsed = Date.now() - t0;
  console.log(
    `[entrypoint-test] child pid=${child.pid} ready in ${elapsed}ms on port ${httpPort} (exitCode=${child.exitCode})`
  );
}, 120_000);

afterAll(async () => {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await new Promise((res) => {
      const t = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} res(); }, 5_000);
      child.on("exit", () => { clearTimeout(t); res(); });
    });
  }
  if (tmpRoot) {
    try { rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  }
});

/** Guard every test: if the isolated server never came up, fail with the child log. */
function requireServer() {
  if (serverFailedToStart) throw new Error(serverFailedToStart);
}

// ── 1. CORS + OPTIONS preflight ─────────────────────────────────────────

describe("F-001 entrypoint: CORS / OPTIONS", () => {
  it("answers OPTIONS preflight with 204 and no body", async () => {
    requireServer();
    const res = await request(PORT, "OPTIONS", "/api/notes");
    expect(res.status).toBe(204);
    expect(res.body).toBe("");
  });

  it("sets permissive CORS headers on OPTIONS", async () => {
    requireServer();
    const res = await request(PORT, "OPTIONS", "/api/anything");
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(res.headers["access-control-allow-methods"]).toContain("DELETE");
    expect(res.headers["access-control-allow-headers"]).toContain("Content-Type");
  });

  it("sets CORS headers on normal API responses too", async () => {
    requireServer();
    const res = await request(PORT, "GET", "/api/notes");
    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });
});

// ── 2. Route-module dispatch (routes/*.mjs loop) ────────────────────────

describe("F-001 entrypoint: route module dispatch", () => {
  it("routes GET /api/notes to the pocket route module (200, notes array)", async () => {
    requireServer();
    const res = await request(PORT, "GET", "/api/notes");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    const data = parseJson(res);
    // isolated DATA_HOME → no stored notes
    expect(Array.isArray(data.notes)).toBe(true);
    expect(data.notes).toHaveLength(0);
  });

  it("matches query-string variants of a route path", async () => {
    requireServer();
    const res = await request(PORT, "GET", "/api/notes?limit=1");
    expect(res.status).toBe(200);
    expect(parseJson(res).notes).toEqual([]);
  });
});

// ── 3. Route-module error path → 500 (entrypoint catch) ─────────────────

describe("F-001 entrypoint: route handler error → 500", () => {
  it("returns 500 {error:'Internal server error'} when a route throws (invalid JSON body)", async () => {
    requireServer();
    // routes/pocket.mjs does JSON.parse(body) without its own try/catch —
    // an invalid body must be converted by the ENTRYPOINT error handler
    // into a 500 JSON response (not a crash, not a hang).
    const res = await request(PORT, "POST", "/api/notes", {
      headers: { "Content-Type": "application/json" },
      body: "this-is-not-json",
    });
    expect(res.status).toBe(500);
    expect(res.headers["content-type"]).toContain("application/json");
    const data = parseJson(res);
    expect(data.error).toBe("Internal server error");
    expect(typeof data.detail).toBe("string");
  });

  it("keeps serving requests after a route threw a 500 (process not crashed)", async () => {
    requireServer();
    await request(PORT, "POST", "/api/notes", { body: "{bad" });
    const res = await request(PORT, "GET", "/api/notes");
    expect(res.status).toBe(200);
  });
});

// ── 4. Scheduler dispatch (scheduler/cron-jobs.mjs) ──────────────────────

describe("F-001 entrypoint: scheduler dispatch", () => {
  it("routes GET /api/cron-jobs to the cron scheduler module (200, JSON)", async () => {
    requireServer();
    const res = await request(PORT, "GET", "/api/cron-jobs");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    // server startup auto-provisions the daily log-purge system job
    const jobs = parseJson(res);
    expect(Array.isArray(jobs)).toBe(true);
    expect(jobs.some((j) => j._systemLogPurge)).toBe(true);
  });
});

// ── 5. Static frontend serving ───────────────────────────────────────────

describe("F-001 entrypoint: static frontend (packages/ui/dist)", () => {
  // dist is a build artifact — the suite still passes without it
  const hasDist = existsSync(UI_DIST);

  it.skipIf(!hasDist)("serves index.html at / with no-cache (200, text/html)", async () => {
    requireServer();
    const res = await request(PORT, "GET", "/");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.headers["cache-control"]).toBe("no-cache");
    expect(res.body.toLowerCase()).toContain("<html");
  });

  it.skipIf(!hasDist)("falls back to index.html for unknown non-API pages (SPA routing)", async () => {
    requireServer();
    const res = await request(PORT, "GET", "/some/spa-route-that-is-not-a-file");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body.toLowerCase()).toContain("<html");
  });

  it.skipIf(!hasDist)("serves /assets/* with immutable long-cache headers", async () => {
    requireServer();
    const assetFile = readdirSync(join(UI_DIST, "assets")).find((f) => /\.(js|css)$/.test(f));
    expect(assetFile).toBeTruthy();
    const res = await request(PORT, "GET", `/assets/${assetFile}`);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
  });

  it.skipIf(!hasDist)("never serves static files for /api/ paths (unknown API → 404 JSON, not index.html)", async () => {
    requireServer();
    const res = await request(PORT, "GET", "/api/definitely-not-a-real-endpoint");
    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(parseJson(res).error).toBe("Not found");
  });
});

// ── 6. Path traversal guard ──────────────────────────────────────────────

describe("F-001 entrypoint: path traversal guard", () => {
  const hasDist = existsSync(UI_DIST);

  it.skipIf(!hasDist)("blocks raw ../ traversal with 404 (safeResolve escape)", async () => {
    requireServer();
    // sent verbatim via node:http — a URL-based client would normalise it
    const res = await request(PORT, "GET", "/../server/src/paaw-server.mjs");
    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).toContain("application/json");
    const data = parseJson(res);
    expect(data.error).toBe("Not found");
    // must NOT leak source file content
    expect(res.body).not.toContain("createServer");
  });

  it.skipIf(!hasDist)("falls back to index.html for percent-encoded traversal (no file leak)", async () => {
    requireServer();
    const res = await request(PORT, "GET", "/..%2f..%2fpackage.json");
    // %2f is not decoded by the static resolver → unknown file → SPA
    // fallback. Either way the package.json content must not be served.
    expect([200, 404]).toContain(res.status);
    expect(res.body).not.toContain("\"scripts\"");
    if (res.status === 200) {
      expect(res.headers["content-type"]).toContain("text/html");
    }
  });
});

// ── 7. 404 fallback ──────────────────────────────────────────────────────

describe("F-001 entrypoint: 404 fallback", () => {
  it("returns 404 JSON {error, path} for unknown GET /api/ path", async () => {
    requireServer();
    const res = await request(PORT, "GET", "/api/definitely-not-a-real-endpoint");
    expect(res.status).toBe(404);
    const data = parseJson(res);
    expect(data.error).toBe("Not found");
    expect(data.path).toBe("/api/definitely-not-a-real-endpoint");
  });

  it("returns 404 for unknown non-GET paths (static serving is GET-only)", async () => {
    requireServer();
    const res = await request(PORT, "POST", "/no-such-page");
    expect(res.status).toBe(404);
    expect(parseJson(res).error).toBe("Not found");
  });

  it("never serves static for /.well-known/ paths (excluded branch → 404)", async () => {
    requireServer();
    const res = await request(PORT, "GET", "/.well-known/nothing-here");
    expect(res.status).toBe(404);
    expect(parseJson(res).error).toBe("Not found");
  });
});
