/**
 * release-unit.mjs — Release Unit Tool API Routes（/api/ru/*）
 *
 * 總計畫：把 Release Unit API 化 — AI 派工前必讀 context、
 * 改前跑 impact、改後跑 verify。Tier 1（理解力）+ Tier 3 核心（執行力）。
 *
 * Routes:
 *   GET  /api/ru                                  — 列出所有 Release Unit（recent projects）
 *   GET  /api/ru/overview?path=                   — 高層摘要（tech stack + 規模 + .paaw 狀態）
 *   GET  /api/ru/context?path=                    — AI 完整 context（.paaw 四大文件 + standards）
 *   GET  /api/ru/architecture?path=[&refresh=1]   — 模組邊界視圖
 *   GET  /api/ru/dependencies?path=&file=&direction=[&refresh=1]
 *   POST /api/ru/impact-analysis { path, files[], changeType? }
 *   POST /api/ru/verify { path, checks[]?, skip[]? }
 *
 * 跨平台鐵律：路徑一律 normalizePath() 回前端；fs 遞迴不用 find。
 */

import { readFile, readdir, stat } from "fs/promises";
import { existsSync, readFileSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { normalizePath } from "./shared.mjs";
import { shellExec } from "../lib/shell-exec.mjs";
import { detectTechStack } from "../lib/release-unit/adapters.mjs";
import { buildDependencyGraph, queryGraph } from "../lib/release-unit/dependencies.mjs";
import { impactAnalysis } from "../lib/release-unit/impact.mjs";
import { architectureView } from "../lib/release-unit/architecture.mjs";
import { runVerify, readLastVerify } from "../lib/release-unit/verify.mjs";
import { computeMetrics, isTestFile } from "../lib/release-unit/metrics.mjs";
import { analyzeUnit } from "../lib/release-unit/analyze.mjs";
import { checkGates } from "../lib/release-unit/gates.mjs";
import { askCodebase } from "../lib/release-unit/ask.mjs";
import { extractAPIs } from "../lib/release-unit/apis.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PAAW_ROOT = resolve(__dirname, "..", "..", "..", "..");

function json(res, code, data) {
  res.status(code).json(data);
  return true;
}

function readBody(req) {
  return new Promise((r) => {
    let buf = "";
    req.on("data", (c) => { buf += c; if (buf.length > 1e6) req.destroy(); });
    req.on("end", () => { try { r(JSON.parse(buf || "{}")); } catch { r({}); } });
    req.on("error", () => r({}));
  });
}

function validRoot(p) {
  return p && existsSync(p) && p.split(/[\\/]/).length >= 2; // 必須是存在的目錄路徑
}

/** .paaw 核心文件清單（context 用） */
const CONTEXT_DOCS = [
  { file: "PROJECT.md", label: "專案概述" },
  { file: "ARCHITECTURE.md", label: "架構" },
  { file: "CODING-STANDARDS.md", label: "Coding 規範", altDir: "project" },
  { file: "DECISIONS.md", label: "技術決策" },
  { file: "CONTEXT.md", label: "長期 context" },
];

async function readDoc(root, rel) {
  const f = join(root, ".paaw", rel);
  if (!existsSync(f)) return null;
  try { return await readFile(f, "utf-8"); } catch { return null; }
}

export default async function releaseUnitRoutes(req, res, next) {
  const method = req.method;
  const rawUrl = req.url || "";
  const url = rawUrl.split("?")[0];
  const q = new URL(rawUrl, "http://localhost").searchParams;
  const path = q.get("path");
  const refresh = q.get("refresh") === "1";

  if (!url.startsWith("/api/ru")) return next?.() ?? false;

  // ── GET /api/ru — 列出所有 Release Unit ──
  if (url === "/api/ru" && method === "GET") {
    const recentFile = join(PAAW_ROOT, "data", "config", "recent-projects.json");
    let recent = [];
    try { recent = JSON.parse(readFileSync(recentFile, "utf-8")); } catch {}
    const units = [];
    for (const r of recent) {
      if (!r?.path || !existsSync(r.path)) continue;
      units.push({
        path: normalizePath(r.path),
        name: r.name || r.path.split(/[\\/]/).pop(),
        initialized: existsSync(join(r.path, ".paaw")),
        lastOpened: r.lastOpened || r.openedAt || null,
      });
    }
    return json(res, 200, { units, count: units.length });
  }

  // ── GET /api/ru/overview — 高層摘要 ──
  if (url === "/api/ru/overview" && method === "GET") {
    if (!validRoot(path)) return json(res, 400, { error: "path required" });
    const tech = await detectTechStack(path);
    const projectMd = (await readDoc(path, "PROJECT.md")) ?? (await readDoc(path, "project/PROJECT.md"));
    // 一句話描述：PROJECT.md 第一個標題/段落
    let summary = null;
    if (projectMd) {
      const m = projectMd.match(/^#\s+(.+)$/m) || projectMd.match(/^(.+)$/m);
      summary = m ? m[1].slice(0, 200) : null;
    }
    const graph = await buildDependencyGraph(path);
    return json(res, 200, {
      path: normalizePath(path),
      name: path.split(/[\\/]/).pop(),
      tech,
      summary,
      scale: { sourceFiles: graph.fileCount, edges: Object.values(graph.deps).reduce((s, a) => s + a.length, 0) },
      initialized: existsSync(join(path, ".paaw")),
      depsGraphFromCache: graph.fromCache,
    });
  }

  // ── GET /api/ru/context — AI 完整 context（派工前必讀）──
  if (url === "/api/ru/context" && method === "GET") {
    if (!validRoot(path)) return json(res, 400, { error: "path required" });
    const tech = await detectTechStack(path);
    const docs = [];
    let totalChars = 0;
    for (const d of CONTEXT_DOCS) {
      let content = await readDoc(path, d.file);
      if (content == null && d.altDir) content = await readDoc(path, `${d.altDir}/${d.file}`);
      docs.push({ file: d.file, label: d.label, found: content != null, chars: content?.length || 0 });
      if (content) totalChars += content.length;
    }
    // 實際內容：docs 參數 content=1 才帶（預設只給清單，省 payload）
    const withContent = q.get("content") === "1";
    const payload = {
      path: normalizePath(path),
      tech,
      docs,
      totalChars,
      standardsDir: existsSync(join(path, ".paaw", "standards")),
      codingStandards: await readDoc(path, "CODING-STANDARDS.md") ?? await readDoc(path, "project/CODING-STANDARDS.md") ?? null,
    };
    if (withContent) {
      payload.docContents = {};
      for (const d of CONTEXT_DOCS) {
        const c = await readDoc(path, d.file) ?? (d.altDir ? await readDoc(path, `${d.altDir}/${d.file}`) : null);
        if (c) payload.docContents[d.file] = c.slice(0, 20000); // 單檔上限 20k chars
      }
    }
    return json(res, 200, payload);
  }

  // ── GET /api/ru/architecture — 模組邊界視圖 ──
  if (url === "/api/ru/architecture" && method === "GET") {
    if (!validRoot(path)) return json(res, 400, { error: "path required" });
    try {
      const view = await architectureView(path, { refresh });
      view.path = normalizePath(path);
      return json(res, 200, view);
    } catch (e) {
      return json(res, 500, { error: "architecture scan failed", detail: e.message });
    }
  }

  // ── GET /api/ru/dependencies — 依賴查詢 ──
  if (url === "/api/ru/dependencies" && method === "GET") {
    if (!validRoot(path)) return json(res, 400, { error: "path required" });
    try {
      const graph = await buildDependencyGraph(path, { refresh });
      const file = q.get("file");
      const direction = q.get("direction") || "both";
      const out = {
        path: normalizePath(path),
        adapter: graph.adapter,
        fileCount: graph.fileCount,
        fromCache: graph.fromCache,
        generatedAt: graph.generatedAt,
      };
      if (file) {
        out.query = queryGraph(graph, file, direction);
      } else {
        // 無 file：回圖統計 + top hubs（不回整圖 — 可能幾 MB）
        const hubs = Object.entries(graph.rdeps)
          .map(([f, d]) => ({ file: f, dependents: d.length }))
          .sort((a, b) => b.dependents - a.dependents).slice(0, 20);
        out.stats = {
          edges: Object.values(graph.deps).reduce((s, a) => s + a.length, 0),
          externalPackages: Object.keys(graph.pkgCount).length,
          topPackages: Object.entries(graph.pkgCount).sort((a, b) => b[1] - a[1]).slice(0, 15)
            .map(([pkg, n]) => ({ pkg, importers: n })),
        };
        out.hubs = hubs;
      }
      return json(res, 200, out);
    } catch (e) {
      return json(res, 500, { error: "dependency scan failed", detail: e.message });
    }
  }

  // ── POST /api/ru/impact-analysis — 改動影響分析（改前必跑）──
  if (url === "/api/ru/impact-analysis" && method === "POST") {
    const body = await readBody(req);
    if (!validRoot(body.path)) return json(res, 400, { error: "path required" });
    const files = Array.isArray(body.files) ? body.files : [];
    if (!files.length) return json(res, 400, { error: "files[] required" });
    try {
      const result = await impactAnalysis(body.path, files, {
        changeType: body.changeType || "modify",
        refresh: body.refresh === true,
      });
      result.path = normalizePath(body.path);
      return json(res, 200, result);
    } catch (e) {
      return json(res, 500, { error: "impact analysis failed", detail: e.message });
    }
  }

  // ── POST /api/ru/verify — 驗證（build/lint/test/type-check，改完必跑）──
  if (url === "/api/ru/verify" && method === "POST") {
    const body = await readBody(req);
    if (!validRoot(body.path)) return json(res, 400, { error: "path required" });
    try {
      const report = await runVerify(body.path, {
        checks: body.checks,
        skip: body.skip,
        timeoutMs: body.timeoutMs,
      });
      report.path = normalizePath(body.path);
      return json(res, 200, report);
    } catch (e) {
      return json(res, 500, { error: "verify failed", detail: e.message });
    }
  }

  // ── GET /api/ru/verify — 上次 verify 結果（沒跑過回 null）──
  if (url === "/api/ru/verify" && method === "GET") {
    if (!validRoot(path)) return json(res, 400, { error: "path required" });
    const last = await readLastVerify(path);
    if (last) last.path = normalizePath(path);
    return json(res, 200, { last, found: !!last });
  }

  // ══════ Phase 2 — 觀測 + 治理 ══════

  // ── GET /api/ru/metrics — 代碼指標 ──
  if (url === "/api/ru/metrics" && method === "GET") {
    if (!validRoot(path)) return json(res, 400, { error: "path required" });
    try {
      const m = await computeMetrics(path, { refresh });
      m.path = normalizePath(path);
      return json(res, 200, m);
    } catch (e) {
      return json(res, 500, { error: "metrics failed", detail: e.message });
    }
  }

  // ── GET /api/ru/analyze — 深度分析（Code Health 2.0）──
  if (url === "/api/ru/analyze" && method === "GET") {
    if (!validRoot(path)) return json(res, 400, { error: "path required" });
    try {
      const a = await analyzeUnit(path, { refresh });
      a.path = normalizePath(path);
      return json(res, 200, a);
    } catch (e) {
      return json(res, 500, { error: "analyze failed", detail: e.message });
    }
  }

  // ── GET /api/ru/gates — 發布門檻檢查 ──
  if (url === "/api/ru/gates" && method === "GET") {
    if (!validRoot(path)) return json(res, 400, { error: "path required" });
    try {
      const g = await checkGates(path);
      g.path = normalizePath(path);
      return json(res, 200, g);
    } catch (e) {
      return json(res, 500, { error: "gates check failed", detail: e.message });
    }
  }

  // ── GET /api/ru/tests — 測試檔清單 + 上次 test 結果 ──
  if (url === "/api/ru/tests" && method === "GET") {
    if (!validRoot(path)) return json(res, 400, { error: "path required" });
    try {
      const graph = await buildDependencyGraph(path, { refresh });
      const testFiles = Object.keys(graph.deps).filter(isTestFile).sort();
      const last = await readLastVerify(path);
      return json(res, 200, {
        path: normalizePath(path),
        testFiles,
        testCount: testFiles.length,
        sourceCount: graph.fileCount,
        testRatio: graph.fileCount ? +(testFiles.length / graph.fileCount).toFixed(3) : 0,
        lastRun: last?.checks?.find(c => c.check === "test") || null,
      });
    } catch (e) {
      return json(res, 500, { error: "tests scan failed", detail: e.message });
    }
  }

  // ── GET /api/ru/features — 功能清單（.paaw/features/）──
  if (url === "/api/ru/features" && method === "GET") {
    if (!validRoot(path)) return json(res, 400, { error: "path required" });
    const dir = join(path, ".paaw", "features");
    const features = [];
    if (existsSync(dir)) {
      for (const f of (await readdir(dir)).filter(f => f.endsWith(".json")).sort()) {
        try {
          const d = JSON.parse(await readFile(join(dir, f), "utf-8"));
          features.push({
            id: d.id || f.replace(/\.json$/, ""),
            name: d.name || d.title || null,
            status: d.status || null,
            files: Array.isArray(d.files) ? d.files.length : 0,
            updatedAt: d.updatedAt || null,
          });
        } catch { /* skip corrupt */ }
      }
    }
    return json(res, 200, { path: normalizePath(path), features, count: features.length });
  }

  // ── GET /api/ru/runbooks — 操作手冊清單（.paaw/runbook/）──
  if (url === "/api/ru/runbooks" && method === "GET") {
    if (!validRoot(path)) return json(res, 400, { error: "path required" });
    const dir = join(path, ".paaw", "runbook");
    const runbooks = [];
    if (existsSync(dir)) {
      for (const f of (await readdir(dir)).filter(f => f.endsWith(".md")).sort()) {
        const content = await readFile(join(dir, f), "utf-8").catch(() => "");
        const title = content.match(/^#\s+(.+)$/m)?.[1] || f.replace(/\.md$/, "");
        runbooks.push({ id: f.replace(/\.md$/, ""), title, file: f, chars: content.length });
      }
    }
    return json(res, 200, { path: normalizePath(path), runbooks, count: runbooks.length });
  }

  // ── GET /api/ru/changes — 變更紀錄（git log 分類）──
  if (url === "/api/ru/changes" && method === "GET") {
    if (!validRoot(path)) return json(res, 400, { error: "path required" });
    const limit = Math.min(parseInt(q.get("limit") || "50", 10) || 50, 200);
    try {
      const { stdout } = await shellExec(
        `git log -${limit} --format='%h~|~%aI~|~%s'`,
        { cwd: path, timeout: 15_000, maxBuffer: 4 * 1024 * 1024 },
      );
      const lines = (stdout || "").split("\n").filter(Boolean);
      const commits = lines.map(l => {
        const [hash, date, ...msg] = l.split("~|~");
        const subject = msg.join("|||");
        const kind = /^feat/i.test(subject) ? "feat" : /^fix/i.test(subject) ? "fix"
          : /^(refactor|perf)/i.test(subject) ? "refactor" : /^(doc|chore|style|test)/i.test(subject) ? "chore" : "other";
        return { hash, date, subject: subject.slice(0, 160), kind };
      });
      const byKind = {};
      for (const c of commits) byKind[c.kind] = (byKind[c.kind] || 0) + 1;
      return json(res, 200, { path: normalizePath(path), commits, byKind, count: commits.length });
    } catch (e) {
      return json(res, 500, { error: "git log failed", detail: e.message });
    }
  }

  // ══════ Phase 3 — AI 互動 + 契約 ══════

  // ── GET /api/ru/ask?path=&q= — 自然語言問 codebase（檢索層，零 LLM）──
  if (url === "/api/ru/ask" && method === "GET") {
    if (!validRoot(path)) return json(res, 400, { error: "path required" });
    const q2 = q.get("q") || "";
    if (!q2.trim()) return json(res, 400, { error: "q required" });
    try {
      const r = await askCodebase(path, q2, { maxHits: parseInt(q.get("hits") || "15", 10) });
      r.path = normalizePath(path);
      return json(res, 200, r);
    } catch (e) {
      return json(res, 500, { error: "ask failed", detail: e.message });
    }
  }

  // ── GET /api/ru/apis?path= — API 契約掃描 ──
  if (url === "/api/ru/apis" && method === "GET") {
    if (!validRoot(path)) return json(res, 400, { error: "path required" });
    try {
      const r = await extractAPIs(path, { refresh });
      r.path = normalizePath(path);
      return json(res, 200, r);
    } catch (e) {
      return json(res, 500, { error: "apis scan failed", detail: e.message });
    }
  }

  // ── GET /api/ru/specs?path=[&id=] — 規格文件（.paaw/specs/）──
  if (url === "/api/ru/specs" && method === "GET") {
    if (!validRoot(path)) return json(res, 400, { error: "path required" });
    const dir = join(path, ".paaw", "specs");
    if (!existsSync(dir)) return json(res, 200, { path: normalizePath(path), specs: [], count: 0 });
    const id = q.get("id");
    if (id) {
      const f = join(dir, `${id.replace(/\.md$|\.json$/, "")}.md`);
      const fj = join(dir, `${id.replace(/\.md$|\.json$/, "")}.json`);
      for (const cand of [f, fj]) {
        if (existsSync(cand)) {
          const content = await readFile(cand, "utf-8");
          return json(res, 200, { path: normalizePath(path), id, file: normalizePath(cand), content });
        }
      }
      return json(res, 404, { error: `spec not found: ${id}` });
    }
    const specs = [];
    for (const f of (await readdir(dir)).sort()) {
      if (!/\.(md|json)$/.test(f)) continue;
      const st = await stat(join(dir, f)).catch(() => null);
      const head = await readFile(join(dir, f), "utf-8").then(c => c.match(/^#\s+(.+)$/m)?.[1] || null).catch(() => null);
      specs.push({ id: f.replace(/\.(md|json)$/, ""), file: f, title: head, mtime: st?.mtime?.toISOString() || null });
    }
    return json(res, 200, { path: normalizePath(path), specs, count: specs.length });
  }

  // ── GET /api/ru/releases?path= — 發布紀錄（.paaw/releases/）──
  if (url === "/api/ru/releases" && method === "GET") {
    if (!validRoot(path)) return json(res, 400, { error: "path required" });
    const dir = join(path, ".paaw", "releases");
    const releases = [];
    if (existsSync(dir)) {
      for (const f of (await readdir(dir)).filter(f => f.endsWith(".json")).sort().reverse()) {
        try {
          const r = JSON.parse(await readFile(join(dir, f), "utf-8"));
          releases.push({
            id: r.id || f.replace(/\.json$/, ""),
            releasedAt: r.releasedAt || null,
            taskId: r.taskId || null,
            title: r.title || r.evidence?.title || null,
            trustScore: r.evidence?.trustScore?.score ?? null,
            riskLevel: r.evidence?.risk?.level ?? null,
          });
        } catch { /* skip corrupt */ }
      }
    }
    releases.sort((a, b) => (b.releasedAt || "").localeCompare(a.releasedAt || ""));
    return json(res, 200, { path: normalizePath(path), releases, count: releases.length });
  }

  // ── GET /api/ru/evidence?path=[&taskId=] — 變更證據鏈 ──
  if (url === "/api/ru/evidence" && method === "GET") {
    if (!validRoot(path)) return json(res, 400, { error: "path required" });
    // releases 證據 + task pipeline 證據（TASKS.json 裡有 pipeline 的 task）
    const out = { path: normalizePath(path), releases: [], tasks: [] };
    const relDir = join(path, ".paaw", "releases");
    if (existsSync(relDir)) {
      for (const f of (await readdir(relDir)).filter(f => f.endsWith(".json")).sort().reverse()) {
        try {
          const r = JSON.parse(await readFile(join(relDir, f), "utf-8"));
          out.releases.push({
            id: r.id || f.replace(/\.json$/, ""),
            releasedAt: r.releasedAt,
            taskId: r.taskId,
            evidence: r.evidence ? {
              trustScore: r.evidence.trustScore?.score ?? null,
              risk: r.evidence.risk?.level ?? null,
              diffStat: r.evidence.changes?.diffStat ?? null,
              testResult: r.evidence.verification?.testResult ?? null,
            } : null,
          });
        } catch { /* skip */ }
      }
    }
    out.releases.sort((a, b) => (b.releasedAt || "").localeCompare(a.releasedAt || ""));
    const tasksFile = join(path, ".paaw", "tasks", "TASKS.json");
    if (existsSync(tasksFile)) {
      try {
        const data = JSON.parse(await readFile(tasksFile, "utf-8"));
        for (const t of (data.tasks || [])) {
          if (!t?.pipeline) continue;
          const phases = Object.entries(t.pipeline)
            .filter(([, p]) => p?.status === "done")
            .map(([ph]) => ph);
          if (!phases.length) continue;
          out.tasks.push({ id: t.id, title: t.title, status: t.status, donePhases: phases, updatedAt: t.updatedAt });
        }
        out.tasks.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
        out.tasks = out.tasks.slice(0, 30);
      } catch { /* skip */ }
    }
    return json(res, 200, out);
  }

  return next?.() ?? false;
}
