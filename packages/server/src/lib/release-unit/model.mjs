/**
 * release-unit/model.mjs — Release Unit Model builder（R2）
 *
 * 把散裝的情報源接成一份 model（單一事實來源，程式生成，零 LLM）：
 *   .paaw/features/FEATURES.json        → features + codeFiles
 *   .paaw/features/FILE-FEATURES.json   → file→feature 反查
 *   .paaw/code-intelligence/api-function-map.json → APIs + callChain
 *   .paaw/code-intelligence/test-code-map.json    → test↔production 映射
 *   .paaw/code-intelligence/dependency-graph.json → 檔案規模
 *   git log --name-only                 → change→feature 關聯（核心增量）
 *
 * 產出 .paaw/release-unit-model.json，附 headSha staleness 檢查。
 *
 * 關係層（north star: Release Unit Model）：
 *   feature → api    = route.file ∈ feature.codeFiles
 *   test → feature   = mapping.productionFile ∈ feature.codeFiles
 *   change → feature = commit 觸及檔案 ∩ feature files
 *   api → feature    = route.file 經 fileToFeature 反查（fallback）
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { shellExec } from "../shell-exec.mjs";

const MODEL_FILE = ["release-unit-model.json"];

function _readJson(file, fallback) {
  if (!existsSync(file)) return fallback;
  try { return JSON.parse(readFileSync(file, "utf-8")); } catch { return fallback; }
}

function _norm(p) {
  return String(p || "").replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

// ── git log 解析（附每 commit 觸及檔案）──

async function _gitLogWithFiles(root, limit = 200) {
  try {
    const { stdout } = await shellExec(
      `git log -${limit} --format="%h|%aI|%s" --name-only`,
      { cwd: root, timeout: 30_000, maxBuffer: 16 * 1024 * 1024 },
    );
    const commits = [];
    let cur = null;
    for (const line of (stdout || "").split("\n")) {
      if (!line.trim()) continue;
      const meta = line.match(/^([0-9a-f]{7,})\|(.+?)\|(.*)$/);
      if (meta) {
        if (cur) commits.push(cur);
        cur = { hash: meta[1], date: meta[2], subject: meta[3].slice(0, 160), files: [] };
      } else if (cur) {
        cur.files.push(_norm(line));
      }
    }
    if (cur) commits.push(cur);
    return commits;
  } catch {
    return [];
  }
}

async function _gitHead(root) {
  try {
    const { stdout } = await shellExec("git rev-parse --short HEAD", { cwd: root, timeout: 10_000 });
    return stdout.trim() || null;
  } catch { return null; }
}

// ── Builder ──

/**
 * 建構 Release Unit Model。
 * @param {string} root — 專案 root
 * @param {object} [opts] — { commitLimit=200, save=true }
 */
export async function buildReleaseUnitModel(root, opts = {}) {
  const commitLimit = opts.commitLimit ?? 200;
  const save = opts.save !== false;

  const ciDir = join(root, ".paaw", "code-intelligence");
  const featuresData = _readJson(join(root, ".paaw", "features", "FEATURES.json"), null);
  const fileFeatures = _readJson(join(root, ".paaw", "features", "FILE-FEATURES.json"), {});
  const apiMap = _readJson(join(ciDir, "api-function-map.json"), { routes: [] });
  const testMap = _readJson(join(ciDir, "test-code-map.json"), { mappings: [] });
  const depGraph = _readJson(join(ciDir, "dependency-graph.json"), { files: [], edges: [] });

  const features = (featuresData?.features || (Array.isArray(featuresData) ? featuresData : []));
  const fileToFeature = fileFeatures.files || fileFeatures; // { path: [{id,name}] }

  // file → feature ids（複來源：FILE-FEATURES 直查 + feature.codeFiles 成員）
  const fIdsByFile = new Map();
  const addFileFeature = (file, id) => {
    const f = _norm(file);
    if (!f) return;
    if (!fIdsByFile.has(f)) fIdsByFile.set(f, new Set());
    fIdsByFile.get(f).add(id);
  };
  for (const [p, feats] of Object.entries(fileToFeature)) {
    for (const ft of (Array.isArray(feats) ? feats : [])) addFileFeature(p, ft.id || ft.name);
  }
  for (const feat of features) {
    for (const cf of (feat.codeFiles || feat.files || [])) addFileFeature(cf, feat.id);
  }

  // ── APIs + feature 歸屬 ──
  const routes = (apiMap.routes || []);
  const apis = routes.map(r => {
    const file = _norm(r.file);
    const ids = fIdsByFile.get(file) ? [...fIdsByFile.get(file)] : [];
    return {
      method: r.method, path: r.path, file,
      handler: r.handler || null,
      featureIds: ids,
    };
  });
  const apisWithFeature = apis.filter(a => a.featureIds.length > 0).length;

  // ── Tests → feature ──
  const mappings = testMap.mappings || [];
  const testRelations = mappings.map(m => {
    const prod = _norm(m.productionFile);
    const ids = fIdsByFile.get(prod) ? [...fIdsByFile.get(prod)] : [];
    return { testFile: _norm(m.testFile), productionFile: prod, testCount: m.testCount ?? 0, featureIds: ids };
  });

  // ── Changes → feature（git log）──
  const commits = await _gitLogWithFiles(root, commitLimit);
  const headSha = await _gitHead(root);
  const changes = commits.map(c => {
    const touched = new Set();
    for (const f of c.files) {
      for (const id of (fIdsByFile.get(f) || [])) touched.add(id);
    }
    const subject = c.subject || "";
    const kind = /^feat/i.test(subject) ? "feat" : /^fix/i.test(subject) ? "fix"
      : /^(refactor|perf)/i.test(subject) ? "refactor"
      : /^(doc|chore|style|test)/i.test(subject) ? "chore" : "other";
    return { hash: c.hash, date: c.date, subject, kind, files: c.files.length, featureIds: [...touched] };
  });

  // feature 維度統計
  const changeStats = new Map(); // id → { count, lastAt }
  for (const c of changes) {
    for (const id of c.featureIds) {
      const s = changeStats.get(id) || { count: 0, lastAt: null };
      s.count += 1;
      if (!s.lastAt || c.date > s.lastAt) s.lastAt = c.date;
      changeStats.set(id, s);
    }
  }

  // ── Feature 完整視圖 ──
  const featureViews = features.map(f => {
    const files = (f.codeFiles || f.files || []).map(_norm).filter(Boolean);
    const fileSet = new Set(files);
    const fApis = apis.filter(a => fileSet.has(a.file) || a.featureIds.includes(f.id));
    const fTests = testRelations.filter(t => fileSet.has(t.productionFile) || t.featureIds.includes(f.id));
    const declaredApis = Array.isArray(f.apis) ? f.apis : [];
    const st = changeStats.get(f.id) || { count: 0, lastAt: null };
    const gaps = [];
    if (fTests.filter(t => t.testCount > 0).length === 0) gaps.push("no-tests");
    if (fApis.length === 0 && declaredApis.length === 0) gaps.push("no-api-mapped");
    if (!(f.runbooks || []).length) gaps.push("no-runbook");
    return {
      id: f.id, name: f.name || f.title || f.id, status: f.status || null,
      description: f.description || null,
      fileCount: files.length,
      files,
      apis: fApis.map(a => `${a.method} ${a.path}`),
      apiCount: fApis.length,
      tests: fTests.map(t => t.testFile),
      testCount: fTests.reduce((s, t) => s + (t.testCount || 0), 0),
      changeCount: st.count,
      lastChangeAt: st.lastAt,
      knowledgeGaps: gaps,
    };
  });

  // ── Knowledge gaps（全專案層）──
  const NOISE_RE = /^(\.paaw\/|logs\/|node_modules\/)/;
  const mappedFiles = new Set([...fIdsByFile.keys()]);
  // dependency-graph 結構：{ files: { path: {path,...} }, edges: [{from,to}] }
  const depFiles = Array.isArray(depGraph.files)
    ? depGraph.files.map(f => _norm(typeof f === "string" ? f : f.file || f.path || f.id)).filter(Boolean)
    : Object.keys(depGraph.files || {}).map(_norm);
  const codeFiles = depFiles.filter(f => !NOISE_RE.test(f) && /\.(mjs|js|ts|tsx|jsx|java|py|go|rs)$/.test(f));
  const unmapped = codeFiles.filter(f => !mappedFiles.has(f));
  // 常改但沒 feature 的檔（hot unmapped）
  const churnByFile = new Map();
  for (const c of commits) for (const f of c.files) {
    if (NOISE_RE.test(f)) continue;
    churnByFile.set(f, (churnByFile.get(f) || 0) + 1);
  }
  const hotUnmapped = [...churnByFile.entries()]
    .filter(([f]) => !mappedFiles.has(f))
    .sort((a, b) => b[1] - a[1]).slice(0, 15)
    .map(([file, churn]) => ({ file, commits: churn }));

  const model = {
    version: 1,
    generatedAt: new Date().toISOString(),
    headSha,
    root: null, // 由 route 填（避免存 absolute path）
    summary: {
      features: featureViews.length,
      apis: apis.length,
      apisWithFeature,
      files: codeFiles.length,
      filesMapped: codeFiles.length - unmapped.length,
      tests: testRelations.length,
      commits: changes.length,
      commitLimit,
    },
    // 情報源新鮮度（staleness 由消費端檢查）
    sources: {
      apiMapGeneratedAt: apiMap.generatedAt || null,
      testMapGeneratedAt: testMap.generatedAt || null,
      depGraphGeneratedAt: depGraph.generatedAt || null,
      featuresUpdatedAt: featuresData?.updatedAt || null,
    },
    features: featureViews,
    apis,
    tests: testRelations,
    changes,
    knowledgeGaps: {
      featuresWithoutTests: featureViews.filter(f => f.knowledgeGaps.includes("no-tests")).map(f => f.id),
      featuresWithoutRunbooks: featureViews.filter(f => f.knowledgeGaps.includes("no-runbook")).map(f => f.id),
      apisWithoutFeature: apis.filter(a => a.featureIds.length === 0).map(a => `${a.method} ${a.path} (${a.file})`),
      filesWithoutFeature: unmapped.length,
      hotUnmappedFiles: hotUnmapped,
    },
  };

  if (save) {
    const outDir = join(root, ".paaw");
    if (existsSync(outDir)) {
      try {
        mkdirSync(dirname(join(outDir, ...MODEL_FILE)), { recursive: true });
        writeFileSync(join(outDir, ...MODEL_FILE), JSON.stringify(model, null, 2), "utf-8");
      } catch { /* 唯讀環境照樣回傳 model */ }
    }
  }
  return model;
}

/** 讀現有 model；過期（headSha 不同）或不存在時可重建 */
export async function loadReleaseUnitModel(root, { refresh = false } = {}) {
  const modelFile = join(root, ".paaw", ...MODEL_FILE);
  if (!refresh && existsSync(modelFile)) {
    const m = _readJson(modelFile, null);
    if (m?.headSha) {
      const head = await _gitHead(root);
      if (head && m.headSha === head) return { ...m, stale: false };
    }
  }
  return buildReleaseUnitModel(root); // 重建（建完即存）
}

// ── Query（deterministic — R5 Q&A 的地基）──

export function queryModelByFeature(model, featureId) {
  const f = model.features?.find(x => x.id === featureId || x.name === featureId);
  if (!f) return null;
  const changes = (model.changes || []).filter(c => c.featureIds.includes(f.id));
  return {
    ...f,
    recentChanges: changes.slice(0, 10),
    changeCount: changes.length,
    relatedApis: (model.apis || []).filter(a => a.featureIds.includes(f.id)).map(a => `${a.method} ${a.path}`),
  };
}

export function queryModelByFile(model, relPath) {
  const p = _norm(relPath);
  const featureIds = new Set();
  for (const f of (model.features || [])) {
    if ((f.files || []).includes(p)) featureIds.add(f.id);
  }
  const apis = (model.apis || []).filter(a => a.file === p).map(a => `${a.method} ${a.path}`);
  const tests = (model.tests || []).filter(t => t.productionFile === p || t.testFile === p)
    .map(t => t.productionFile === p ? { relation: "tested-by", file: t.testFile } : { relation: "tests", file: t.productionFile });
  const recentChanges = (model.changes || []).filter(c => c.featureIds.some(id => featureIds.has(id))).slice(0, 5);
  return {
    file: p,
    featureIds: [...featureIds],
    apis,
    tests,
    churnHint: recentChanges.length > 0,
    recentChanges,
  };
}

export function queryModelByApi(model, method, routePath) {
  const a = (model.apis || []).find(x =>
    x.method.toUpperCase() === String(method || "").toUpperCase() &&
    (x.path === routePath || x.path.endsWith(routePath)));
  if (!a) return null;
  const features = (model.features || []).filter(f => a.featureIds.includes(f.id));
  const tests = (model.tests || []).filter(t => a.featureIds.some(id => t.featureIds.includes(id)));
  return { ...a, features: features.map(f => ({ id: f.id, name: f.name })), tests: tests.map(t => t.testFile) };
}
