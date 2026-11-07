/**
 * page-inventory.mjs — Page Route 盤點引擎（deterministic，2026-11-07 Fleming：前端也要 API-first 同款骨架）
 *
 * North Star：LLM 只推理，事實靠程式。這裡全部 deterministic：
 * 1. Route 發現（多框架）：
 *    - React Router：`<Route path="..." element={...}>` / `createBrowserRouter([{ path: "..." }])`
 *    - Next.js file-based routing：`app/…/page.tsx`、`pages/*.tsx`（[id] 動態段 → :id）
 *    - Vue Router / 泛用：routes 檔內 `path: "/..."` 屬性
 * 2. Page → Components：page 檔的相對 import 遞迴（bounded），每個組件檔查 co-located unit test
 * 3. E2E 關聯：route path ↔ 測試檔 URL（複用 e2e-inventory 的匹配語意：參數段相容、後綴降級）
 * 4. API 關聯（全棧）：page/components 內 fetch/axios URL 字面值 ↔ API Map（前後端 evidence 接線）
 *
 * 輸出餵 GET /api/coding-releases/page-inventory → Release Manager「📄 Page 盤點」表
 * 純前端 project：API 欄空（誠實 0）；全棧：frontend+server 都有時自動接 API Map。
 */

import { readdirSync, statSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { isTestFileName } from "./cu-source-scan.mjs";

const SKIP_DIR = new Set(["node_modules", "dist", "build", "target", "coverage", "vendor", ".git", ".paaw", "venv", ".venv", "__pycache__", ".next", ".nuxt", ".output", "out"]);
const SRC_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".vue", ".svelte"]);
const MAX_FILES = 900;
const MAX_ROUTE_FILES = 60;

// ── 通用小工具 ──────────────────────────────────────────────

function isParamSeg(seg) {
  return seg.startsWith(":") || /^\{[^}/]+\}$/.test(seg) || /^<[^/>]+>$/.test(seg) || /^\[[^\]/]+\]$/.test(seg);
}
function normRoute(p) {
  if (!p) return null;
  p = p.trim();
  if (p === "*" || p === "/*" || p.includes("*")) {
    // wildcard：保留語意（404/catch-all）
    return p.startsWith("/") ? p : `/${p}`;
  }
  if (!p.startsWith("/")) p = "/" + p;
  const segs = p.split("/").filter(Boolean).map((s) => (/^\[[^\]/]+\]$/.test(s) ? `:${s.slice(1, -1)}` : s)); // Next [id] → :id
  return segs.length ? "/" + segs.join("/") : "/";
}
function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

/** route 字串合法性：不吃副檔名（.md/.json…）、不吃 "."、每段非空 */
function validRouteStr(p) {
  if (!p || p === "." || p === "..") return false;
  if (/\.[A-Za-z0-9]{1,5}$/.test(p)) return false; // 副檔名（檔案路徑誤中）
  if (p.includes("...") || p === "*") return false; // 文件佔位符
  if (/\s/.test(p)) return false;
  return p.split("/").filter(Boolean).every((s) => s.length >= 1 && s.length <= 60);
}

/** route path ↔ 測試 URL 匹配（語意與 e2e-inventory.urlMatchesApi 一致） */
function urlMatchesRoute(url, route) {
  const uSegs = url.replace(/\/+$/, "").split("/").filter(Boolean);
  const rSegs = route.replace(/\/+$/, "").split("/").filter(Boolean);
  if (!uSegs.length || !rSegs.length) return false;
  const segEq = (u, r) => {
    if (u === r) return true;
    if (isParamSeg(r)) return !isParamSeg(u) || u === r;
    return false;
  };
  if (uSegs.length === rSegs.length && uSegs.every((s, i) => segEq(s, rSegs[i]))) return true;
  // 後綴降級：測試 URL 是 route 的具體化（多實值尾段）或等長字面後綴
  for (let k = 2; k <= Math.min(rSegs.length, uSegs.length); k++) {
    const rSuf = rSegs.slice(-k);
    const rSufLit = rSuf.filter((s) => !isParamSeg(s));
    if (rSufLit.length < Math.min(2, rSuf.length)) continue; // 至少 1-2 個字面段
    const uSuf = uSegs.slice(-k);
    if (uSuf.every((s, i) => segEq(s, rSuf[i]))) return true;
  }
  return false;
}

/** API 關聯：fetch/axios URL 字面值 ↔ API entry（複用 e2e-inventory 的匹配核心） */
function extractApiCallUrls(src) {
  const urls = new Set();
  for (const m of src.matchAll(/(?:fetch|axios(?:\.\w+)?\(|\.(?:get|post|put|patch|delete)\()\s*[`"']([^`"'\s]{3,180})[`"']/g)) urls.add(m[1]);
  for (const m of src.matchAll(/[`"'](\/api\/[A-Za-z0-9_\-{}.:]{2,160}(?:\/[A-Za-z0-9_\-{}.:]*)*)[`"']/g)) urls.add(m[1]); // API_BASE 拼接殘段
  for (const m of src.matchAll(/url:\s*[`"'](\/[^`'"\s]{2,180})[`"']/g)) urls.add(m[1]); // SDK client url: '/api/v1/...' 
  return [...urls].filter((u) => u.startsWith("/") || /^https?:/.test(u)).slice(0, 60);
}
function urlMatchesApiEntry(url, entry) {
  const entryPath = entry.split(/\s+/).length > 1 ? entry.split(/\s+/).slice(1).join(" ") : entry;
  if (!entryPath.startsWith("/")) return false;
  const uSegs = url.replace(/^https?:\/\/[^/]+/, "").replace(/\/+$/, "").split("/").filter(Boolean);
  const aSegs = entryPath.replace(/\/+$/, "").split("/").filter(Boolean);
  if (!uSegs.length || !aSegs.length) return false;
  const segEq = (u, a) => u === a || (isParamSeg(a) && !isParamSeg(u));
  if (uSegs.length === aSegs.length && uSegs.every((s, i) => segEq(s, aSegs[i]))) return true;
  for (let k = 2; k <= Math.min(aSegs.length, uSegs.length); k++) {
    const aSuf = aSegs.slice(-k);
    if (aSuf.some(isParamSeg)) continue;
    const uSuf = uSegs.slice(-k);
    if (uSuf.every((s, i) => s === aSuf[i])) return true;
  }
  return false;
}

// ── 檔案走訪 ──────────────────────────────────────────────

function walkSrc(root, maxDepth = 10) {
  const out = [];
  const walk = (dir, depth, prefix) => {
    if (depth > maxDepth || out.length >= MAX_FILES) return;
    let ents; try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.name.startsWith(".") || SKIP_DIR.has(e.name)) continue;
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1, rel);
      else if (e.isFile()) {
        const ext = rel.slice(rel.lastIndexOf("."));
        if (SRC_EXT.has(ext)) out.push({ rel, full });
      }
    }
  };
  walk(root, 0, "");
  return out;
}

function readSafe(full) {
  try { const c = readFileSync(full, "utf-8"); return c.length > 900000 ? null : c; } catch { return null; }
}

// ── 1) Route 發現 ──────────────────────────────────────────

/** React Router / 泛用 config 抽 route — 泛用 `path:` 只在 Router 脈絡檔跑（防誤中文件/測試碼） */
function extractRoutesFromCode(src, kind) {
  const routes = new Set();
  const add = (p) => { if (validRouteStr(p)) { const r = normRoute(p); if (r) routes.add(r); } };
  for (const m of src.matchAll(/<Route\b[^>]*?path=["']([^"'{}\s]+)["']/g)) add(m[1]);
  if (kind === "router-config") {
    // 只抽 routes 陣列裡的 path（含巢狀 children）— 限定在 routes:[ ... ] 區塊內，避免整檔亂抓
    for (const blk of src.matchAll(/routes\s*[:=]\s*\[([\s\S]{0,20000}?)\n\s*\]/g)) {
      for (const m of blk[1].matchAll(/path:\s*["']([^"'{}\s]+)["']/g)) add(m[1]);
    }
  }
  return [...routes].slice(0, 80);
}

/** TanStack Router file-based：routes/ 目錄（__root=根、index.tsx=同名父路徑、$param 動態、_xxx layout 前綴、.route.tsx 顯式） */
function tanstackRoutes(files) {
  const routes = [];
  const isTanstack = files.some((f) => {
    const segs = f.rel.split("/");
    const i = segs.lastIndexOf("routes");
    return i >= 0 && segs.slice(i).some((x) => x === "__root.tsx" || x === "__root.ts" || /\$\w+\.(tsx|ts)$/.test(x) || /\.(route|lazy)\.(tsx|ts)$/.test(x));
  });
  if (!isTanstack) return routes;
  for (const f of files) {
    const segs = f.rel.split("/");
    const ri = segs.lastIndexOf("routes");
    if (ri < 0) continue;
    const last = segs[segs.length - 1];
    if (!SRC_EXT.has("." + last.split(".").pop())) continue;
    let parts = last.replace(/\.(tsx|ts|jsx|js)$/, "").split(".");
    parts = parts.filter((p) => p !== "route" && p !== "lazy"); // x.route.tsx → x
    if (parts[0] === "__root") parts = [];
    const parts2 = segs.slice(ri + 1, -1).concat(parts).filter((p) => !/^_[A-Za-z0-9_]*$/.test(p)); // _auth layout 不貢獻路徑
    if (parts2.length === 1 && parts2[0] === "index") parts2.pop();
    if (parts2[parts2.length - 1] === "index") parts2.pop();
    const segStr = parts2.map((p) => (/^\$/.test(p) ? ":" + p.slice(1) : p)).join("/");
    routes.push({ route: segStr ? "/" + segStr : "/", page: f, kind: "tanstack" });
  }
  return routes;
}

/** Next.js file-based：app/…/page.tsx | pages/*.tsx → route */
function fileBasedRoutes(files) {
  const routes = [];
  for (const f of files) {
    const segs = f.rel.split("/");
    if (segs[0] === "app" || segs.includes("(app)") ) {
      const i = segs.findIndex((s, idx) => s === "page.tsx" || s === "page.ts" || s === "page.jsx" || s === "page.js");
      if (i > 0) {
        const parts = segs.slice(1, i).filter((s) => !/^\(.*\)$/.test(s));
        routes.push({ route: parts.length ? "/" + parts.map((s) => (/^\[[^\]/]+\]$/.test(s) ? `:${s.slice(1, -1)}` : s)).join("/") : "/", page: f, kind: "next-app" });
      }
    } else if (segs[0] === "pages" && SRC_EXT.has("." + segs[segs.length - 1].split(".").pop())) {
      const parts = segs.slice(1, -1).concat(segs[segs.length - 1].replace(/\.(tsx?|jsx?)$/, ""));
      if (parts.length === 1 && parts[0] === "index") parts.pop();
      routes.push({ route: parts.length ? "/" + parts.map((s) => (/^\[[^\]/]+\]$/.test(s) ? `:${s.slice(1, -1)}` : s)).join("/") : "/", page: f, kind: "next-pages" });
    }
  }
  return routes;
}

/** 找出「router 定義檔」：含 <Route / createBrowserRouter / new Router / routes 陣列 且抽得到 path */
function findRouterFiles(files) {
  const out = [];
  for (const f of files) {
    const c = readSafe(f.full);
    if (!c) continue;
    const isRR = /<Route\b|createBrowserRouter|createRoutesFromElements|<Routes\b/.test(c);
    const isCfg = (/routes\s*[:=]\s*\[/.test(c) && /path:\s*["']/.test(c) && /element\s*[:=]|component\s*[:=]|children\s*:|new\s+(Vue)?Router|RouterOptions/.test(c));
    if (isRR || isCfg) {
      const kind = isRR ? "react-router" : "router-config";
      const routes = extractRoutesFromCode(c, kind);
      if (routes.length) out.push({ file: f, routes, kind });
    }
    if (out.length >= MAX_ROUTE_FILES) break;
  }
  return out;
}

// ── 2) Page → Components（相對 import 遞迴） ────────────────

function resolveImport(fromRel, spec, filesByRel) {
  // 相對 import 解析：./x ../x → 副檔名試探
  if (!spec.startsWith(".")) return null;
  const baseParts = fromRel.split("/").slice(0, -1);
  const parts = spec.split("/");
  const joined = [...baseParts];
  for (const p of parts) {
    if (p === ".") continue;
    else if (p === "..") joined.pop();
    else joined.push(p);
  }
  const base = joined.join("/");
  for (const ext of ["", ".tsx", ".ts", ".jsx", ".js", ".mjs", ".vue", "/index.tsx", "/index.ts", "/index.jsx", "/index.js"]) {
    const cand = base + ext;
    if (filesByRel.has(cand)) return cand;
  }
  return null;
}

/** alias import（@/x → src/x）：回傳相對路徑（對 filesByRel 內 rel 以 /x 結尾者） */
function resolveAlias(spec, filesByRel) {
  const m = spec.match(/^[@a-zA-Z][\w-]*\/(.+)$/);
  if (!m) return null;
  const target = m[1];
  for (const ext of ["", ".tsx", ".ts", ".jsx", ".js", ".mjs", ".vue", "/index.tsx", "/index.ts", "/index.jsx", "/index.js"]) {
    const cand = target + ext;
    if (filesByRel.has(cand)) return cand;
    const hits = [...filesByRel.keys()].filter((rel) => rel === cand || rel.endsWith("/" + cand) || rel.endsWith("src/" + cand));
    if (hits.length) return hits.sort((x, y) => x.length - y.length)[0]; // 最短路徑優先（src/client/index.ts < src/client/client/index.ts）
  }
  return null;
}

function importGraph(rel, filesByRel, cache, depth = 0) {
  if (cache.has(rel)) return cache.get(rel);
  const acc = { files: new Set([rel]) };
  cache.set(rel, acc); // 先設防循環
  if (depth >= 6) return acc;
  const src = readSafe(filesByRel.get(rel)?.full || "");
  if (src) {
    for (const m of src.matchAll(/(?:^|\n)\s*(?:import\s+(?:[^"'`]*?from\s+)?|export\s+(?:type\s+)?\*\s*from\s+|export\s+\{[^}]*\}\s*from\s+)["']([^"']+)["']/g)) {
      const r = resolveImport(rel, m[1], filesByRel) || resolveAlias(m[1], filesByRel);
      if (r && !acc.files.has(r)) {
        const sub = importGraph(r, filesByRel, cache, depth + 1);
        for (const f of sub.files) acc.files.add(f);
      }
    }
  }
  return acc;
}

function unitTestFor(relFile, testIndex) {
  // co-located：Xxx.tsx → Xxx.test.tsx / Xxx.test.ts / __tests__/Xxx.*
  const noExt = relFile.slice(0, relFile.lastIndexOf("."));
  for (const c of [`${noExt}.test.tsx`, `${noExt}.test.ts`, `${noExt}.test.jsx`, `${noExt}.spec.tsx`, `${noExt}.spec.ts`]) if (testIndex.has(c)) return c;
  const segs = noExt.split("/");
  const base = segs[segs.length - 1];
  for (const c of testIndex) {
    const cSegs = c.split("/");
    if (cSegs[cSegs.length - 1].replace(/\.(test|spec)\.(tsx?|jsx?)$/, "") === base) return c;
  }
  return null;
}

// ── 3) E2E URL 收集（複用 e2e-inventory 的抽取語意，本地輕量版） ──

function collectE2eUrls(root) {
  const urls = []; // { file, url }
  const walk = (dir, depth, prefix) => {
    if (depth > 10 || urls.length > 3000) return;
    let ents; try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.name.startsWith(".") || SKIP_DIR.has(e.name)) continue;
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1, rel);
      else if (e.isFile() && (isTestFileName(e.name) || rel.split("/").slice(0, -1).some((s) => ["e2e", "tests", "test", "spec", "__tests__"].includes(s)))) {
        const c = readSafe(full);
        if (!c) continue;
        for (const m of c.matchAll(/["'`](\/[A-Za-z0-9_\-{}.:]{2,160}(?:\/[A-Za-z0-9_\-{}.:]*)*)["'`]/g)) urls.push({ file: rel, url: m[1] });
      }
    }
  };
  walk(root, 0, "");
  return urls;
}

// ── 主入口 ──────────────────────────────────────────────

/**
 * 建 Page 盤點
 * @param {string} root 專案根
 * @param {Array<{entry:string,name?:string}>} apis API Map rows（可空 = 純前端）
 */
export function buildPageInventory(root, apis = [], opts = {}) {
  const files = walkSrc(root, opts.maxDepth ?? 10);
  const filesByRel = new Map(files.map((f) => [f.rel, f]));
  const testIndex = new Set(files.filter((f) => isTestFileName(f.rel.split("/").pop()) || f.rel.split("/").slice(0, -1).includes("__tests__")).map((f) => f.rel));
  const apiEntries = apis.map((a) => ({ entry: a.entry, name: a.name || a.entry }));

  // 偵測專案型態：API Map 有料 + repo 有後端線索（server/backend 目錄、Node web 框架、或 python/go/java manifest）= 全棧
  const pkg = readSafe(join(root, "package.json")) || "";
  const hasServer = files.some((f) => /(^|\/)(server|backend|api|routes)(\/|$)/i.test(f.rel))
    || /express|fastify|koa|@nestjs/.test(pkg)
    || ["main.py", "app.py", "go.mod", "pom.xml", "build.gradle", "requirements.txt"].some((m) => existsSync(join(root, m)));
  const frontendType = apiEntries.length && hasServer ? "fullstack" : "frontend-only";

  // 1) Route 發現：file-based + router-config 合併（同 route 去重，file-based 優先）
  const rows = new Map(); // route → row
  for (const r of [...fileBasedRoutes(files), ...tanstackRoutes(files)]) {
    rows.set(r.route, { route: r.route, kind: r.kind, page: r.page.rel, sources: [r.page.rel] });
  }
  for (const rf of findRouterFiles(files)) {
    for (const rt of rf.routes) {
      if (rows.has(rt)) { rows.get(rt).kind = rows.get(rt).kind === "next-app" || rows.get(rt).kind === "next-pages" ? rows.get(rt).kind : rf.kind; rows.get(rt).sources.push(rf.file.rel); continue; }
      rows.set(rt, { route: rt, kind: rf.kind, page: rf.file.rel, sources: [rf.file.rel] });
    }
  }

  // 2) components + unit tests（router 型：以 router 檔 import graph 為 sources；file-based：page 檔）
  const gCache = new Map();
  for (const row of rows.values()) {
    const comps = new Set();
    for (const s of row.sources) {
      for (const f of importGraph(s, filesByRel, gCache).files) comps.add(f);
    }
    const compArr = [...comps].filter((c) => !isTestFileName(c.split("/").pop()));
    row.components = compArr.slice(0, 120);
    row.componentCount = compArr.length;
    const tested = compArr.filter((c) => unitTestFor(c, testIndex));
    row.unitTestedCount = tested.length;
    row.unitTestFiles = tested.map((c) => unitTestFor(c, testIndex)).slice(0, 40);
  }

  // 0) Service class → API map（SDK 型間接：page 呼叫 ItemsService.readItems → sdk.gen class 內 url）
  //    deterministic 歸因：class 區塊內的 url: '...' 屬於該 class，page 用什麼 Service 就掛什麼 API
  const serviceUrls = new Map(); // ClassName → [url,...]
  for (const f of files) {
    if (!/\.gen\.(ts|js)$/.test(f.rel) && !/(sdk|api-client|client)\.(ts|js)$/.test(f.rel)) continue;
    const src = readSafe(f.full);
    if (!src) continue;
    for (const cm of src.matchAll(/(?:export\s+)?class\s+(\w+)[\s\S]{0,20000}?\n\}/g)) {
      const urls = [...cm[0].matchAll(/url:\s*[`"'](\/[^`'"\s]{2,180})[`"']/g)].map((x) => x[1]);
      if (urls.length) serviceUrls.set(cm[1], urls.slice(0, 40));
    }
  }

  // 3) E2E 關聯 + 4) API 關聯（掃 components 內的 fetch/axios URL + Service 呼叫）
  const e2eUrls = collectE2eUrls(root);
  const e2eByFile = new Map();
  for (const { file, url } of e2eUrls) { if (!e2eByFile.has(file)) e2eByFile.set(file, new Set()); e2eByFile.get(file).add(url); }
  for (const row of rows.values()) {
    // E2E：任何測試檔 URL 命中 route
    const e2eFiles = new Set();
    for (const [file, urls] of e2eByFile) for (const u of urls) { if (urlMatchesRoute(u, row.route)) { e2eFiles.add(file); break; } }
    row.e2eFiles = [...e2eFiles].slice(0, 20);
    // API calls：components 內 fetch/axios URL ↔ API Map；SDK 間接時 Service 呼叫 → serviceUrls 歸因（避免 SDK 單體全掛）
    const svcCalls = new Set();
    const plainUrlFiles = [];
    for (const c of row.components) {
      const src = readSafe(filesByRel.get(c)?.full || "");
      if (!src) continue;
      if (/\.gen\.(ts|js)$/.test(c) || /(sdk|api-client)\.(ts|js)$/.test(c)) continue; // SDK 檔本身不算頁面直接呼叫
      let plain = false;
      for (const u of extractApiCallUrls(src)) { plain = true; svcCalls.add("__plain__" + u); }
      if (plain) plainUrlFiles.push(c);
      for (const m of src.matchAll(/\b([A-Z]\w{1,40}(?:Service|Client|Api|API))\.[a-z]\w{0,40}\(/g)) svcCalls.add(m[1]);
    }
    const apiHits = new Set();
    for (const key of svcCalls) {
      const urls = key.startsWith("__plain__") ? [key.slice(9)] : serviceUrls.get(key.slice(0, 0) || key) || [];
      for (const u of urls) for (const a of apiEntries) if (urlMatchesApiEntry(u, a.entry)) apiHits.add(a.entry);
    }
    row.plainApiUrlFiles = plainUrlFiles.slice(0, 10); // 頁面直接寫死的 URL 檔（SDK 間接之外的）
    row.apiCalls = [...apiHits].slice(0, 30);
  }

  const list = [...rows.values()].sort((a, b) => a.route.localeCompare(b.route));
  const unitTestedPages = list.filter((r) => r.unitTestedCount > 0).length;
  const e2eCovered = list.filter((r) => r.e2eFiles.length > 0).length;
  return {
    frontendType,
    rows: list,
    summary: {
      totalRoutes: list.length,
      kindBreakdown: list.reduce((m, r) => { m[r.kind] = (m[r.kind] || 0) + 1; return m; }, {}),
      pagesWithUnitTest: unitTestedPages,
      pagesWithE2e: e2eCovered,
      orphanApiFree: list.filter((r) => !r.apiCalls.length).length, // 沒接任何 API 的頁（純前端正常、全棧可關注）
      apiLinkedRoutes: list.filter((r) => r.apiCalls.length).length,
      e2eUrlCount: e2eUrls.length,
      componentTotal: list.reduce((n, r) => n + r.componentCount, 0),
    },
  };
}
