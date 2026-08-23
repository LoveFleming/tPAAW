// test-runner.mjs — 真實測試執行（deterministic facts：程式跑、程式算數字）
// 執行結果持久化到 <project>/.paaw/test-runs/last.json，readiness 直接引用
// 支援：vitest / jest（JSON reporter）、pytest（JUnit XML）、go test（-v 解析）、
//       maven / gradle（surefire / JUnit XML 報告）、playwright（JSON）、其他文字 fallback

import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, unlinkSync } from "fs";
import { join, basename } from "path";
import { spawn } from "child_process";
import { classifyTestType } from "./test-intelligence.mjs";
import { shellExec } from "./shell-exec.mjs";

const DEFAULT_TIMEOUT_UNIT = 5 * 60_000;
const DEFAULT_TIMEOUT_E2E = 20 * 60_000;

// ── 偵測專案的測試指令（多語言可並存 — monorepo 依序全跑）──
export function detectTestGroups(projectPath, { includeE2e = false } = {}) {
  const groups = [];
  let pkg = null;
  try { pkg = JSON.parse(readFileSync(join(projectPath, "package.json"), "utf-8")); } catch { /* not a node project */ }
  const scripts = pkg?.scripts || {};
  const devDeps = { ...(pkg?.devDependencies || {}), ...(pkg?.dependencies || {}) };

  // 1) 明確分類 script 優先
  const explicit = [["test:unit", "unit"], ["test:contract", "contract"], ["test:integration", "integration"]];
  for (const [script, kind] of explicit) {
    if (scripts[script]) groups.push({ kind, runner: "npm-script", cmd: ["npm", "run", script] });
  }

  // 2) 主 test script（unit/integration/contract 混合 — 之後 per-file 分類）
  if (scripts.test && scripts.test !== "echo \"Error: no test specified\" && exit 1") {
    const t = scripts.test;
    if (/\bvitest\b/.test(t) && devDeps.vitest) {
      groups.push({ kind: "mixed", runner: "vitest", cmd: ["npx", "vitest", "run", "--reporter=json", "--outputFile=.paaw/test-runs/.vitest.json"] });
    } else if (/\bjest\b/.test(t) && devDeps.jest) {
      groups.push({ kind: "mixed", runner: "jest", cmd: ["npx", "jest", "--json", "--outputFile=.paaw/test-runs/.jest.json"] });
    } else if (scripts.test) {
      groups.push({ kind: "mixed", runner: "npm-script", cmd: ["npm", "test"] }); // 文字 fallback
    }
  }

  // 3) Python — pytest（JUnit XML 精準）
  const py = detectPytest(projectPath);
  if (py) groups.push(py);

  // 4) Go — go test -v（per-test 解析）
  if (existsSync(join(projectPath, "go.mod"))) {
    groups.push({ kind: "unit", runner: "go", cmd: ["go", "test", "./...", "-v"] });
  }

  // 5) Java — Maven / Gradle（surefire / JUnit XML 報告）
  if (existsSync(join(projectPath, "pom.xml"))) {
    groups.push({ kind: "unit", runner: "maven", cmd: ["mvn", "-B", "test"] });
  }
  if (existsSync(join(projectPath, "build.gradle")) || existsSync(join(projectPath, "build.gradle.kts"))) {
    const gradlew = existsSync(join(projectPath, "gradlew"));
    const gw = gradlew ? (process.platform === "win32" ? "gradlew.bat" : "./gradlew") : "gradle";
    groups.push({ kind: "unit", runner: "gradle", cmd: [gw, "test", "--console=plain"] });
  }

  // 6) E2E（opt-in — 慢、可能需要 server）
  if (includeE2e) {
    if (scripts["test:e2e"] || (devDeps["@playwright/test"] && existsSync(join(projectPath, "playwright.config.ts")) || existsSync(join(projectPath, "playwright.config.js")))) {
      groups.push({ kind: "e2e", runner: "playwright", cmd: ["npx", "playwright", "test", "--reporter=json"] });
    }
  }
  return groups;
}

// pytest 偵測：明確設定（pytest.ini / pyproject / requirements）或 tests/ 慣例
function detectPytest(projectPath) {
  const py = process.platform === "win32" ? "python" : "python3";
  const hasCfg = ["pytest.ini"].some(f => existsSync(join(projectPath, f)));
  let inPyproject = false, inReq = false;
  try { inPyproject = readFileSync(join(projectPath, "pyproject.toml"), "utf-8").includes("pytest"); } catch { /* no pyproject */ }
  for (const rf of ["requirements.txt", "requirements-dev.txt", "dev-requirements.txt"]) {
    try { if (readFileSync(join(projectPath, rf), "utf-8").includes("pytest")) { inReq = true; break; } } catch { /* next */ }
  }
  let hasTestFiles = false;
  if (!hasCfg && !inPyproject && !inReq) {
    for (const d of ["tests", "test"]) {
      try { if (readdirSync(join(projectPath, d)).some(f => /^test_.*\.py$/.test(f) || /_test\.py$/.test(f))) { hasTestFiles = true; break; } } catch { /* next */ }
    }
  }
  if (hasCfg || inPyproject || inReq || hasTestFiles) {
    return { kind: "unit", runner: "pytest", cmd: [py, "-m", "pytest", "--junitxml=.paaw/test-runs/.pytest.xml", "-q"] };
  }
  return null;
}

// ── JUnit XML（pytest / maven surefire / gradle 共通格式）──
function xmlAttrs(s) { const o = {}; for (const m of s.matchAll(/([A-Za-z_:][\w.:-]*)="([^"]*)"/g)) o[m[1]] = m[2]; return o; }

export function parseJUnitXml(xml) {
  const out = { passed: 0, failed: 0, skipped: 0 };
  for (const m of xml.matchAll(/<testsuite\s([^>]*?)\/?>/g)) {
    const a = xmlAttrs(m[1]);
    const tests = parseInt(a.tests || "0", 10) || 0;
    const failures = (parseInt(a.failures || "0", 10) || 0) + (parseInt(a.errors || "0", 10) || 0);
    const skipped = parseInt(a.skipped || "0", 10) || 0;
    out.passed += Math.max(0, tests - failures - skipped);
    out.failed += failures;
    out.skipped += skipped;
  }
  return out;
}

// per-testcase 解析（classname → kind 歸類）+ 總數
export function junitCounts(xmlText, isPy) {
  const entries = {}; // key（classname）→ { kind, passed, failed, skipped }
  const total = { passed: 0, failed: 0, skipped: 0 };
  for (const m of xmlText.matchAll(/<testcase\s([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const a = xmlAttrs(m[1]);
    const body = m[2] || "";
    let st = "passed";
    if (/<failure[\/\s>]/.test(body) || /<error[\/\s>]/.test(body)) st = "failed";
    else if (/<skipped[\/\s>]/.test(body)) st = "skipped";
    const cls = a.classname || a.file || "(suite)";
    const short = String(cls).split(".").pop() || "test";
    const kind = classifyTestType(short + (isPy ? ".py" : ".java"), String(cls).replace(/\./g, "/"));
    if (!entries[cls]) entries[cls] = { kind, passed: 0, failed: 0, skipped: 0 };
    entries[cls][st]++;
    total[st]++;
  }
  if (!Object.keys(entries).length) {
    const j = parseJUnitXml(xmlText);
    return { total: j, entries };
  }
  return { total, entries };
}

// ── go test -v 解析（per-test 精準；subtest 歸 parent）──
export function parseGoTestOutput(out) {
  const res = { passed: 0, failed: 0, skipped: 0, tests: [] };
  for (const m of out.matchAll(/^--- (PASS|FAIL|SKIP): (\S+)/gm)) {
    const [, st, name] = m;
    if (name.includes("/")) continue; // subtest 不重複計
    const kind = kindFromGoName(name);
    const status = st === "PASS" ? "passed" : st === "FAIL" ? "failed" : "skipped";
    res.tests.push({ name, kind, status });
    res[status]++;
  }
  return res;
}
function kindFromGoName(name) {
  const n = name.toLowerCase();
  if (/e2e/.test(n)) return "e2e";
  if (/integration/.test(n)) return "integration";
  if (/contract/.test(n)) return "contract";
  return "unit";
}

// ── surefire / gradle 報告 XML 收集（root + 兩層 module）──
function findReportXmls(projectPath, runner) {
  const rel = runner === "maven" ? ["target", "surefire-reports"] : ["build", "test-results", "test"];
  const found = [];
  const check = (base) => {
    const d = join(base, ...rel);
    try { for (const f of readdirSync(d)) if (/^TEST-.*\.xml$/i.test(f)) found.push(join(d, f)); } catch { /* no dir */ }
  };
  const skip = (n) => n === "node_modules" || n.startsWith(".") || n === "dist" || n === "build";
  check(projectPath);
  try {
    for (const e of readdirSync(projectPath, { withFileTypes: true })) {
      if (!e.isDirectory() || skip(e.name)) continue;
      check(join(projectPath, e.name));
      try {
        for (const e2 of readdirSync(join(projectPath, e.name), { withFileTypes: true })) {
          if (!e2.isDirectory() || skip(e2.name)) continue;
          check(join(projectPath, e.name, e2.name));
        }
      } catch { /* no perm */ }
    }
  } catch { /* no root */ }
  return found;
}

// ── 執行單一 group，回傳結構化結果 ──
async function runGroup(projectPath, group) {
  const g = { kind: group.kind, runner: group.runner, cmd: group.cmd.join(" "), status: "pass", passed: 0, failed: 0, skipped: 0, files: {}, outputTail: "" };
  const timeout = group.kind === "e2e" ? DEFAULT_TIMEOUT_E2E : DEFAULT_TIMEOUT_UNIT;
  // stale 產物防污染：跑前清掉上次的 reporter 檔
  for (const f of [".vitest.json", ".jest.json", ".pytest.xml"]) {
    try { unlinkSync(join(projectPath, ".paaw/test-runs", f)); } catch { /* not exist */ }
  }
  const t0 = Date.now();
  try {
    const { stdout, stderr, code } = await spawnCapture(projectPath, group.cmd, timeout);
    const out = stdout + "\n" + stderr;
    g.exitCode = code;
    g.durationMs = Date.now() - t0;
    g.outputTail = out.slice(-4000);

    if (group.runner === "vitest" || group.runner === "jest") {
      const jf = join(projectPath, ".paaw/test-runs", group.runner === "vitest" ? ".vitest.json" : ".jest.json");
      let j = null;
      try { j = JSON.parse(readFileSync(jf, "utf-8")); } catch { /* reporter 沒寫出來 */ }
      if (j) {
        g.passed = j.numPassedTests || 0;
        g.failed = j.numFailedTests || 0;
        g.skipped = j.numPendingTests || 0;
        for (const tr of j.testResults || []) {
          const short = tr.name.replace(projectPath + "/", "");
          const kind = classifyTestType(basename(short), short);
          g.files[short] = { kind, passed: 0, failed: 0, skipped: 0 };
          for (const a of tr.assertionResults || []) {
            const s = a.status === "passed" ? "passed" : a.status === "failed" ? "failed" : "skipped";
            g.files[short][s]++;
          }
        }
      } else { // fallback 文字
        const m = out.match(/(\d+) passed/); const f = out.match(/(\d+) failed/); const s = out.match(/(\d+) skipped/);
        g.passed = m ? +m[1] : 0; g.failed = f ? +f[1] : 0; g.skipped = s ? +s[1] : 0;
      }
    } else if (group.runner === "pytest") {
      let xml = null;
      try { xml = readFileSync(join(projectPath, ".paaw/test-runs/.pytest.xml"), "utf-8"); } catch { /* junitxml 沒寫出來 */ }
      if (xml && /<testsuite/.test(xml)) {
        const { total, entries } = junitCounts(xml, true);
        g.passed = total.passed; g.failed = total.failed; g.skipped = total.skipped;
        Object.assign(g.files, entries);
      } else {
        const m = out.match(/(\d+) passed/); const f = out.match(/(\d+) failed/); const s = out.match(/(\d+) skipped/);
        g.passed = m ? +m[1] : 0; g.failed = f ? +f[1] : 0; g.skipped = s ? +s[1] : 0;
      }
    } else if (group.runner === "go") {
      const parsed = parseGoTestOutput(out);
      g.passed = parsed.passed; g.failed = parsed.failed; g.skipped = parsed.skipped;
      for (const t of parsed.tests) {
        g.files[t.name] = { kind: t.kind, passed: t.status === "passed" ? 1 : 0, failed: t.status === "failed" ? 1 : 0, skipped: t.status === "skipped" ? 1 : 0 };
      }
    } else if (group.runner === "maven" || group.runner === "gradle") {
      const xmls = findReportXmls(projectPath, group.runner);
      if (xmls.length) {
        for (const xf of xmls) {
          try {
            const { total, entries } = junitCounts(readFileSync(xf, "utf-8"), false);
            g.passed += total.passed; g.failed += total.failed; g.skipped += total.skipped;
            Object.assign(g.files, entries);
          } catch { /* 壞檔跳過 */ }
        }
      } else {
        // maven 摘要 "Tests run: 12, Failures: 1, Errors: 0, Skipped: 0"（多 module 全加）
        let run = 0, fail = 0, skip = 0;
        for (const m of out.matchAll(/Tests run:\s*(\d+),\s*Failures:\s*(\d+)(?:,\s*Errors:\s*(\d+))?(?:,\s*Skipped:\s*(\d+))?/g)) {
          run += +m[1]; fail += +m[2] + (+(m[3] || 0)); skip += +(m[4] || 0);
        }
        // gradle 摘要 "12 tests completed, 1 failed"
        const gr = out.match(/(\d+) tests completed(?:,\s*(\d+) failed)?/);
        if (run > 0) { g.passed = run - fail - skip; g.failed = fail; g.skipped = skip; }
        else if (gr) { g.passed = +gr[1] - (+(gr[2] || 0)); g.failed = +(gr[2] || 0); }
      }
    } else if (group.runner === "playwright") {
      // JSON reporter 輸出在 stdout，可能夾雜其他行 → 抓第一個 { 到最後一個 }
      const start = out.indexOf("{");
      const end = out.lastIndexOf("}");
      let j = null;
      if (start >= 0 && end > start) { try { j = JSON.parse(out.slice(start, end + 1)); } catch { /* parse 失敗 fallback */ } }
      if (j?.stats) {
        g.passed = j.stats.expected || 0;
        g.failed = j.stats.unexpected || 0;
        g.skipped = j.stats.skipped || 0;
        const walk = (suites) => {
          for (const s of suites || []) {
            for (const spec of s.specs || []) {
              const file = (spec.file || s.file || "").replace(projectPath + "/", "");
              if (!file) continue;
              if (!g.files[file]) g.files[file] = { kind: "e2e", passed: 0, failed: 0, skipped: 0 };
              const st = spec.tests?.[0]?.results?.[0]?.status;
              if (st === "passed" || st === "expected") g.files[file].passed++;
              else if (st === "skipped") g.files[file].skipped++;
              else g.files[file].failed++;
            }
            walk(s.suites);
          }
        };
        walk(j.suites);
      } else { // 文字 fallback
        const p = out.match(/(\d+) passed/); const f = out.match(/(\d+) failed/); const s = out.match(/(\d+) skipped/);
        g.passed = p ? +p[1] : 0; g.failed = f ? +f[1] : 0; g.skipped = s ? +s[1] : 0;
      }
    } else {
      // mocha / npm-script / go / maven — 文字 heuristic + exit code
      const p = out.match(/(\d+) pass/i); const f = out.match(/(\d+) fail/i);
      const goOk = (out.match(/^ok\s/gm) || []).length; const goFail = (out.match(/^FAIL/gm) || []).length;
      if (p || f) { g.passed = p ? +p[1] : 0; g.failed = f ? +f[1] : 0; }
      else if (goOk || goFail) { g.passed = goOk; g.failed = goFail; }
      else { g.passed = 0; g.failed = 0; g.status = code === 0 ? "pass" : "fail"; }
    }
    g.status = g.failed > 0 || code !== 0 ? "fail" : "pass";
  } catch (e) {
    g.status = "error";
    g.error = e.message?.slice(0, 300);
    g.durationMs = Date.now() - t0;
  }
  return g;
}

function spawnCapture(cwd, cmd, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd[0], cmd.slice(1), { cwd, env: { ...process.env, CI: "1", NO_COLOR: "1" }, shell: process.platform === "win32" });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`timeout after ${timeoutMs / 1000}s`)); }, timeoutMs);
    child.stdout.on("data", (d) => { stdout += d; if (stdout.length > 20e6) stdout = stdout.slice(-10e6); });
    child.stderr.on("data", (d) => { stderr += d; if (stderr.length > 20e6) stderr = stderr.slice(-10e6); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ stdout, stderr, code: code ?? 1 }); });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

// ── 背景 job 管理（in-memory）──
const running = new Map(); // projectPath → { startedAt, groups: [...], currentIdx }

export function getRunState(projectPath) { return running.get(projectPath) || null; }

export async function startTestRun(projectPath, { includeE2e = false } = {}) {
  if (running.has(projectPath)) return { alreadyRunning: true, state: running.get(projectPath) };
  const groups = detectTestGroups(projectPath, { includeE2e });
  if (!groups.length) return { noRunner: true, detected: detectDetectedSummary(projectPath) };
  mkdirSync(join(projectPath, ".paaw/test-runs"), { recursive: true });
  const state = { startedAt: new Date().toISOString(), groups: groups.map(g => ({ kind: g.kind, runner: g.runner, cmd: g.cmd.join(" "), status: "running" })), currentIdx: 0 };
  running.set(projectPath, state);

  (async () => {
    const results = [];
    let headSha = null;
    try { headSha = (await shellExec("git rev-parse HEAD", { cwd: projectPath, timeout: 5000 })).stdout.trim(); } catch { /* 非 git repo */ }
    for (let i = 0; i < groups.length; i++) {
      state.currentIdx = i;
      const r = await runGroup(projectPath, groups[i]);
      results.push(r);
      state.groups[i] = { kind: r.kind, runner: r.runner, cmd: r.cmd, status: r.status };
    }
    const summary = results.reduce((acc, r) => ({ passed: acc.passed + r.passed, failed: acc.failed + r.failed, skipped: acc.skipped + r.skipped }), { passed: 0, failed: 0, skipped: 0 });
    summary.total = summary.passed + summary.failed + summary.skipped;
    // byKind：per-file/per-test 已帶 kind；無細粒度的整組歸 kind
    const byKind = {};
    for (const r of results) {
      const fk = Object.values(r.files || {});
      if (fk.length) {
        for (const f of fk) {
          const k = byKind[f.kind] || (byKind[f.kind] = { passed: 0, failed: 0, skipped: 0, files: 0 });
          k.passed += f.passed; k.failed += f.failed; k.skipped += f.skipped; k.files++;
        }
      } else {
        const k = byKind[r.kind] || (byKind[r.kind] = { passed: 0, failed: 0, skipped: 0, files: 0 });
        k.passed += r.passed; k.failed += r.failed; k.skipped += r.skipped;
      }
    }
    const record = {
      finishedAt: new Date().toISOString(),
      headSha,
      status: results.some(r => r.status === "fail") ? "fail" : results.every(r => r.status === "error") ? "error" : "pass",
      durationMs: Date.now() - new Date(state.startedAt).getTime(),
      includeE2e,
      summary,
      byKind,
      groups: results,
    };
    writeFileSync(join(projectPath, ".paaw/test-runs/last.json"), JSON.stringify(record, null, 2));
    state.done = true;
    state.result = record;
    running.delete(projectPath);
  })();

  return { started: true, state };
}

export function readLastTestRun(projectPath) {
  try { return JSON.parse(readFileSync(join(projectPath, ".paaw/test-runs/last.json"), "utf-8")); } catch { return null; }
}

function detectDetectedSummary(projectPath) {
  const groups = detectTestGroups(projectPath, { includeE2e: true });
  return groups.length ? groups.map(g => `${g.kind}:${g.runner}`) : [];
}
