/**
 * API Tester (Postman-like) endpoints
 * Routes: /api/api-tester/*
 */

import { readFileSync, writeFileSync, unlinkSync, existsSync } from "fs";
import { resolve } from "path";
import { DATA_ROOT } from "./shared.mjs";

// ── Collection storage ──
// data/api-tester-collections.json：{ [name]: { name, createdAt, updatedAt, payloads: [{id,name,method,url,headers,body,streamMode,createdAt}] } }
// 2026-09-24 Fleming：使用者可請 AI 新增 api test payload by collection；UI 左欄 tab 顯示
const COLLECTIONS_FILE = () => resolve(DATA_ROOT, "api-tester-collections.json");

function _loadCollections() {
  try { return JSON.parse(readFileSync(COLLECTIONS_FILE(), "utf-8")) || {}; } catch { return {}; }
}

function _saveCollections(data) {
  writeFileSync(COLLECTIONS_FILE(), JSON.stringify(data, null, 2));
}

function _payloadSummary(p) {
  return { id: p.id, name: p.name, method: p.method, url: p.url, createdAt: p.createdAt };
}

export default async function apiTesterRoute(req, res) {

  // ── GET /api/api-tester/collections（無 name：摘要清單；有 name：完整 collection）──
  if (req.method === "GET" && req.url?.startsWith("/api/api-tester/collections")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const name = params.get("name");
    const data = _loadCollections();
    if (name) {
      const col = data[name];
      if (!col) { res.writeHead(404, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: `Collection not found: ${name}` })); return true; }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ collection: col }));
    } else {
      const collections = Object.values(data).map(c => ({
        name: c.name, count: (c.payloads || []).length, createdAt: c.createdAt, updatedAt: c.updatedAt,
        payloads: (c.payloads || []).map(_payloadSummary),
      }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ collections }));
    }
    return true;
  }

  // ── POST /api/api-tester/collections — 新增/覆寫 payload 進 collection（同名 payload 覆蓋）──
  // body: { collection, payload: { name, method, url, headers, body, streamMode } } 或 { collection, payloads: [...] } 批次
  if (req.method === "POST" && req.url === "/api/api-tester/collections") {
    let body;
    try { body = JSON.parse(await new Promise((ok, fail) => { let d = ""; req.on("data", c => d += c); req.on("end", () => ok(d)); req.on("error", fail); })); } catch { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return true; }
    const colName = String(body.collection || "").trim();
    if (!colName) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Missing collection name" })); return true; }
    const incoming = Array.isArray(body.payloads) ? body.payloads : (body.payload ? [body.payload] : []);
    if (incoming.length === 0) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Missing payload(s)" })); return true; }
    const data = _loadCollections();
    if (!data[colName]) data[colName] = { name: colName, createdAt: new Date().toISOString(), payloads: [] };
    const col = data[colName];
    const savedIds = [];
    for (const p of incoming) {
      const pname = String(p.name || "").trim();
      if (!pname || !p.url) continue; // name + url 必填
      const normalized = {
        id: `pl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: pname,
        method: String(p.method || "GET").toUpperCase(),
        url: String(p.url),
        headers: p.headers || [],
        body: p.body !== undefined && p.body !== null ? String(p.body) : "",
        streamMode: !!p.streamMode,
        createdAt: new Date().toISOString(),
      };
      const idx = col.payloads.findIndex(x => x.name === pname); // 同名覆蓋
      if (idx >= 0) { normalized.id = col.payloads[idx].id; normalized.createdAt = col.payloads[idx].createdAt; col.payloads[idx] = normalized; }
      else col.payloads.push(normalized);
      savedIds.push(normalized.id);
    }
    col.updatedAt = new Date().toISOString();
    _saveCollections(data);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, collection: colName, saved: savedIds.length, ids: savedIds }));
    return true;
  }

  // ── DELETE /api/api-tester/collections?name=X[&payloadId=Y] — 刪整個 collection 或單一 payload ──
  if (req.method === "DELETE" && req.url?.startsWith("/api/api-tester/collections")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const name = params.get("name");
    const payloadId = params.get("payloadId");
    if (!name) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Missing name" })); return true; }
    const data = _loadCollections();
    if (!data[name]) { res.writeHead(404, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: `Collection not found: ${name}` })); return true; }
    if (payloadId) {
      data[name].payloads = data[name].payloads.filter(p => p.id !== payloadId);
      data[name].updatedAt = new Date().toISOString();
      if (data[name].payloads.length === 0) delete data[name]; // 清空就刪 collection
      _saveCollections(data);
    } else {
      delete data[name];
      _saveCollections(data);
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }

  // ── GET /api/api-tester/project-apis ──
  // Returns the code project's own API routes + examples
  if (req.method === "GET" && req.url?.startsWith("/api/api-tester/project-apis")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const projectRoot = params.get("root") || DATA_ROOT;
    const mapFile = resolve(projectRoot, ".paaw/code-intelligence/api-function-map.json");
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
