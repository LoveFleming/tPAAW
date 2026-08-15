/**
 * release-unit/apis.mjs — API endpoint 提取（Tier 2 #8 契約查詢）
 *
 * 從原始碼掃 route 定義（不執行、零成本）：
 *   - PAAW 風格：url === "/api/..." / url.startsWith(...) + method 判斷
 *   - Express：app.get("/path", ...) / router.post(...)
 *   - Fastify：fastify.get("/path"...
 * 也抓前端呼叫端：fetch(`${API_BASE}/api/...`) — 契約兩端都看得到。
 */

import { readFile } from "fs/promises";
import { join } from "path";
import { detectAdapter } from "./adapters.mjs";
import { walkSources } from "./dependencies.mjs";

// server 端 route 定義
const SERVER_RES = [
  // PAAW 風格：url === "/api/x" / cleanUrl !== "/x" / pathname ===
  /(?:url|cleanUrl|pathname|path)\s*(?:===|!==)\s*["']((?:\/api\/|\/a2a\/|\/ws)[^"']*)["']/g,
  // startsWith 前綴路由
  /(?:url|cleanUrl|pathname|path)\s*\.startsWith\(\s*["']((?:\/api\/|\/a2a\/)[^"']*)["']\s*\)/g,
  // Express / Fastify：app.get("...") / router.post(...) / fastify.put(...)
  /\.\s*(get|post|put|patch|delete|all)\s*\(\s*["'](\/[^"']+)["']/g,
];
// 前端呼叫
const CLIENT_RES = [
  /fetch\(\s*[`"'][^`"']*?((?:\/api\/|\/a2a\/)[^`"']*)/g,
  /\$\{API_BASE\}((?:\/api\/|\/a2a\/)[^`"'?]*)/g,
];

function lineOf(content, index) {
  return content.slice(0, index).split("\n").length;
}

/**
 * 掃 API endpoints
 * @returns { endpoints: [{path, file, line, kind: "exact"|"prefix"|"express", methods:[]}],
 *            clientCalls: [{path, file, line}], stats }
 */
export async function extractAPIs(root, opts = {}) {
  const adapter = await detectAdapter(root);
  const files = await walkSources(root, adapter.sourceExts, opts.maxFiles);

  const endpoints = [];
  const clientCalls = [];

  for (const f of files) {
    const isRouteish = /routes?\/|server|api|backend/i.test(f.rel) || f.rel.endsWith(".server.ts");
    let content;
    try { content = await readFile(f.abs, "utf-8"); } catch { continue; }

    if (isRouteish) {
      // PAAW: exact / prefix + 鄰近 method 判斷
      for (const re of [SERVER_RES[0]]) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(content)) !== null) {
          const methods = nearMethods(content, m.index);
          endpoints.push({ path: m[1], file: f.rel, line: lineOf(content, m.index), kind: "exact", methods });
        }
      }
      for (const re of [SERVER_RES[1]]) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(content)) !== null) {
          endpoints.push({ path: m[1], file: f.rel, line: lineOf(content, m.index), kind: "prefix", methods: nearMethods(content, m.index) });
        }
      }
      for (const re of [SERVER_RES[2]]) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(content)) !== null) {
          endpoints.push({ path: m[2], file: f.rel, line: lineOf(content, m.index), kind: "express", methods: [m[1].toUpperCase()] });
        }
      }
    }

    for (const re of CLIENT_RES) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(content)) !== null) {
        const p = (m[1] || "").replace(/\$\{[^}]*\}/g, "{var}").replace(/`/g, "");
        if (!p || p.length < 2) continue;
        clientCalls.push({ path: p, file: f.rel, line: lineOf(content, m.index) });
      }
    }
  }

  // 去重（同 path+file+line 合併 methods）
  const seen = new Map();
  for (const e of endpoints) {
    const key = `${e.file}:${e.path}:${e.kind}`;
    const prev = seen.get(key);
    if (prev) {
      for (const m of e.methods) if (!prev.methods.includes(m)) prev.methods.push(m);
    } else seen.set(key, { ...e, line: [e.line] });
  }
  for (const v of seen.values()) v.line = Math.min(...v.line);

  const list = [...seen.values()].sort((a, b) => a.path.localeCompare(b.path));
  return {
    root: String(root),
    generatedAt: new Date().toISOString(),
    endpoints: list,
    endpointCount: list.length,
    clientCallCount: clientCalls.length,
    stats: {
      exact: list.filter(e => e.kind === "exact").length,
      prefix: list.filter(e => e.kind === "prefix").length,
      express: list.filter(e => e.kind === "express").length,
    },
  };
}

/** 從命中點往後 300 字抓 method === "GET" 等 */
function nearMethods(content, from) {
  const win = content.slice(from, from + 400);
  const methods = new Set();
  for (const m of win.matchAll(/\bmethod\s*(?:===|!==)\s*["'](GET|POST|PUT|PATCH|DELETE)["']/g)) {
    methods.add(m[1]);
  }
  return [...methods];
}
