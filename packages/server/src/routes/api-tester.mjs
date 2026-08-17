/**
 * API Tester (Postman-like) endpoints
 * Routes: /api/api-tester/*
 */

import { readFileSync, writeFileSync, unlinkSync } from "fs";
import { resolve } from "path";
import { DATA_ROOT } from "./shared.mjs";

export default async function apiTesterRoute(req, res) {

  // ── GET /api/api-tester/project-apis ──
  // Returns the code project's own API routes + examples
  if (req.method === "GET" && req.url?.startsWith("/api/api-tester/project-apis")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const projectRoot = params.get("root") || DATA_ROOT;
// nosemgrep: path-join-resolve-traversal
    const mapFile = resolve(projectRoot, ".paaw/code-intelligence/api-function-map.json");  // nosemgrep: path-join-resolve-traversal
// nosemgrep: path-join-resolve-traversal
    const examplesFile = resolve(projectRoot, ".paaw/code-intelligence/api-examples.json");
    try {
      const data = JSON.parse(readFileSync(mapFile, "utf-8"));
      const routes = (data.routes || []).map(r => ({ method: r.method, path: r.path, file: r.file }));
      let examples = [];
      try {
        examples = JSON.parse(readFileSync(examplesFile, "utf-8"));
      } catch {}
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ routes, examples }));
    } catch {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ routes: [], examples: [] }));
    }
    return true;
  }

  // ── POST /api/api-tester/proxy ──
  if (req.method === "POST" && req.url === "/api/api-tester/proxy") {
    let body;
    try { body = JSON.parse(await new Promise((ok, fail) => { let d = ""; req.on("data", c => d += c); req.on("end", () => ok(d)); req.on("error", fail); })); } catch { res.writeHead(400); res.end(JSON.stringify({ error: "Invalid JSON" })); return true; }
    const { method: tMethod, url: tUrl, headers: tHeaders = {}, body: tBody, followRedirects = true } = body;
    if (!tUrl) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Missing url" })); return true; }
    const startTime = Date.now();
    try {
      const fetchOpts = { method: tMethod || "GET", headers: tHeaders, redirect: followRedirects ? "follow" : "manual" };
      if (tBody && tMethod !== "GET" && tMethod !== "HEAD") fetchOpts.body = typeof tBody === "string" ? tBody : JSON.stringify(tBody);
      const tRes = await fetch(tUrl, fetchOpts);
      const elapsed = Date.now() - startTime;
      const respHeaders = {};
      tRes.headers.forEach((v, k) => { respHeaders[k] = v; });
      const contentType = tRes.headers.get("content-type") || "";
      let respBody;
      if (contentType.includes("json") || contentType.includes("text") || contentType.includes("xml") || contentType.includes("html") || contentType.includes("javascript")) {
        respBody = await tRes.text();
      } else {
        const buf = await tRes.arrayBuffer();
        respBody = `[Binary data: ${buf.byteLength} bytes]`;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: tRes.status, statusText: tRes.statusText, headers: respHeaders, body: respBody, elapsed, size: respBody.length }));
    } catch (err) {
      const elapsed = Date.now() - startTime;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: 0, statusText: "Network Error", headers: {}, body: String(err.message || err), elapsed, error: true }));
    }
    return true;
  }

  // ── GET /api/api-tester/history ──
  if (req.method === "GET" && req.url?.startsWith("/api/api-tester/history")) {
// nosemgrep: path-join-resolve-traversal
    const histFile = resolve(DATA_ROOT, "api-tester-history.json");
    try {
      const data = JSON.parse(readFileSync(histFile, "utf-8"));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ history: data }));
    } catch {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ history: [] }));
    }
    return true;
  }

  // ── DELETE /api/api-tester/history ──
  if (req.method === "DELETE" && req.url?.startsWith("/api/api-tester/history")) {
// nosemgrep: path-join-resolve-traversal
    const histFile = resolve(DATA_ROOT, "api-tester-history.json");
    try { unlinkSync(histFile); } catch {}
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }

  // ── POST /api/api-tester/save ──
  if (req.method === "POST" && req.url === "/api/api-tester/save") {
    let body;
    try { body = JSON.parse(await new Promise((ok, fail) => { let d = ""; req.on("data", c => d += c); req.on("end", () => ok(d)); req.on("error", fail); })); } catch { res.writeHead(400); res.end("Invalid JSON"); return true; }
// nosemgrep: path-join-resolve-traversal
    const histFile = resolve(DATA_ROOT, "api-tester-history.json");
    let history = [];
    try { history = JSON.parse(readFileSync(histFile, "utf-8")); } catch {}
    history.unshift({ ...body, id: `req-${Date.now()}`, ts: new Date().toISOString() });
    if (history.length > 100) history = history.slice(0, 100);
    writeFileSync(histFile, JSON.stringify(history, null, 2));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }

  // ── POST /api/api-tester/stream ──
  if (req.method === "POST" && req.url === "/api/api-tester/stream") {
    let body;
    try { body = JSON.parse(await new Promise((ok, fail) => { let d = ""; req.on("data", c => d += c); req.on("end", () => ok(d)); req.on("error", fail); })); } catch { res.writeHead(400); res.end(JSON.stringify({ error: "Invalid JSON" })); return true; }
    const { method: tMethod, url: tUrl, headers: tHeaders = {}, body: tBody } = body;
    if (!tUrl) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Missing url" })); return true; }

    try {
      const fetchOpts = { method: tMethod || "GET", headers: tHeaders, redirect: "follow" };
      if (tBody && tMethod !== "GET" && tMethod !== "HEAD") fetchOpts.body = typeof tBody === "string" ? tBody : JSON.stringify(tBody);

      const tRes = await fetch(tUrl, fetchOpts);

      const respHeaders = {
        "Content-Type": tRes.headers.get("content-type") || "text/event-stream",
        "X-Response-Status": String(tRes.status),
        "X-Response-Status-Text": tRes.statusText || "",
      };
      for (const hk of ["x-request-id", "openai-organization", "openai-processing-ms", "cf-ray"]) {
        const hv = tRes.headers.get(hk);
        if (hv) respHeaders[`X-Upstream-${hk}`] = hv;
      }
      res.writeHead(200, respHeaders);

      const reader = tRes.body?.getReader();
      if (!reader) { res.end(); return true; }
      const pump = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
          }
        } catch (err) {
          res.write(`\n[STREAM_ERROR] ${String(err.message || err)}\n`);
        }
        res.end();
      };
      pump();
      return true;
    } catch (err) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: 0, statusText: "Network Error", headers: {}, body: String(err.message || err), elapsed: 0, error: true }));
      return true;
    }
  }

  return false;
}
