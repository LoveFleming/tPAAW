// test-runner.mjs — 真實測試執行（deterministic facts：程式跑、程式算數字）
// 執行結果持久化到 <project>/.paaw/test-runs/last.json，readiness 直接引用
// 支援：vitest / jest（JSON reporter）、playwright（JSON reporter）、mocha / node:test / go test（文字 fallback）、無 runner 誠實回報

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { join, basename } from "path";
import { spawn } from "child_process";
import { classifyTestType } from "./test-intelligence.mjs";
import { shellExec } from "./shell-exec.mjs";

const DEFAULT_TIMEOUT_UNIT = 5 * 60_000;
const DEFAULT_TIMEOUT_E2E = 20 * 60_000;

// ── 偵測專案的測試指令 ──
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

  // 3) E2E（opt-in — 慢、可能需要 server）
  if (includeE2e) {
    if (scripts["test:e2e"] || (devDeps["@playwright/test"] && existsSync(join(projectPath, "playwright.config.ts")) || existsSync(join(projectPath, "playwright.config.js")))) {
      groups.push({ kind: "e2e", runner: "playwright", cmd: ["npx", "playwright", "test", "--reporter=json"] });
    }
  }

  // 4) 非 node 專案
  if (!groups.length && existsSync(join(projectPath, "go.mod"))) {
    groups.push({ kind: "mixed", runner: "go", cmd: ["go", "test", "./..."] });
  }
  if (!groups.length && existsSync(join(projectPath, "pom.xml"))) {
    groups.push({ kind: "mixed", runner: "maven", cmd: ["mvn", "test"] });
  }
  return groups;
}

// ── 執行單一 group，回傳結構化結果 ──
async function runGroup(projectPath, group) {
  const g = { kind: group.kind, runner: group.runner, cmd: group.cmd.join(" "), status: "pass", passed: 0, failed: 0, skipped: 0, files: {}, outputTail: "" };
  const timeout = group.kind === "e2e" ? DEFAULT_TIMEOUT_E2E : DEFAULT_TIMEOUT_UNIT;
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
    } else if (group.runner === "playwright") {
      // JSON reporter 輸出在 stdout，可能夾雜其他行 → 抓第一個 { 到最後一個 }
      const start = out.indexOf("{");
      const end = out.lastIndexOf("}");
      let j = null;
      if (start >= 0 && end > start) { try { j = JSON.parse(out.slice(start, end + 1)); } catch { /* parse 失敗 fallback */ } }
      if (j?.stats) {
        g.passed = (j.stats.expected || 0) + (j.stats.unexpected || 0) * 0; // passed = expected
        g.passed = j.stats.expected || 0;
        g.failed = (j.stats.unexpected || 0) + (j.stats.flaky || 0) * 0;
        g.skipped = j.stats.skipped || 0;
        // per-file
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
      } else { // 文字 fallback：playwright 摘要 "  5 passed (12s)" / "  2 failed"
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
    // byKind：mixed group 的 per-file 已帶 kind；純 e2e/contract group 整組歸 kind
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
